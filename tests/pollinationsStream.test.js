import {describe,it,expect,vi} from 'vitest';
import {inflateSync} from 'node:zlib';
import config from '../shared/legacy-gateways.json';
import {callPollinationsStream, PollinationsError, POLLINATIONS_MODEL, POLLINATIONS_TIMEOUT_MS} from '../src/standalone/pollinationsGateway';
const turns=[{role:'user',content:'Сколько будет два плюс два?'}];
const data=value=>`data: ${JSON.stringify(value)}\r\n\r\n`;
const delta=(content,finish=null)=>data({choices:[{delta:{content},finish_reason:finish}]});
const stream=text=>new Response(text,{headers:{'Content-Type':'text/event-stream'}});
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

describe('Pollinations documented free queue, no payment or refusal retries',()=>{
  it('requests the explicit anonymous model and stream:true on the existing public endpoint',async()=>{
    fetch.mockResolvedValue(stream(delta('Ответ: 4.')+delta('','stop')+'data: [DONE]\n\n'));
    expect((await callPollinationsStream('Учитель',turns)).text).toBe('Ответ: 4.');
    const [url,init]=fetch.mock.calls[0],body=JSON.parse(init.body);
    expect(url).toBe('https://text.pollinations.ai/openai');expect(body).toMatchObject({model:POLLINATIONS_MODEL,stream:true});
    expect(init.credentials).toBe('omit');expect(init.redirect).toBe('error');
    expect(Object.keys(init.headers).some(k=>/authorization|payment|forwarded|token|cookie/i.test(k))).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('allows the provider free interval plus generation, rather than expiring at 45 seconds',async()=>{
    vi.useFakeTimers();fetch.mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve(stream(delta('4','stop'))),50000)));
    const pending=callPollinationsStream('Учитель',turns);await vi.advanceTimersByTimeAsync(50001);
    expect((await pending).text).toBe('4');expect(fetch).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  });
  it('handles a split UTF-8/CRLF stream and discards reasoning/tool fields',async()=>{
    const raw=data({choices:[{delta:{reasoning:'PRIVATE_REASONING',reasoning_details:[{text:'PRIVATE_THOUGHT'}],tool_calls:[{function:{arguments:'PRIVATE_TOOL'}}]}}]})+delta('Подсказка: 4.')+delta('','stop');
    const bytes=new TextEncoder().encode(raw);let at=0;
    fetch.mockResolvedValue(new Response(new ReadableStream({pull(c){if(at===bytes.length)c.close();else c.enqueue(bytes.slice(at,++at));}}),{headers:{'Content-Type':'text/event-stream'}}));
    const status=vi.fn(),result=await callPollinationsStream('Учитель',turns,undefined,undefined,status);
    expect(result.text).toBe('Подсказка: 4.');expect(JSON.stringify(status.mock.calls)).not.toContain('PRIVATE');
  });
  it('returns on the final finish_reason without waiting for a silent HTTP EOF or cancel promise',async()=>{
    const cancel=vi.fn(()=>new Promise(()=>{}));
    fetch.mockResolvedValue(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(delta('4','stop')));},cancel}),{headers:{'Content-Type':'text/event-stream'}}));
    expect((await callPollinationsStream('Учитель',turns)).text).toBe('4');expect(cancel).toHaveBeenCalled();
  });
  it('rejects EOF after partial deltas and never calls that text a completed answer',async()=>{
    fetch.mockResolvedValue(stream(delta('Неполный ответ')));await expect(callPollinationsStream('Учитель',turns)).rejects.toMatchObject({code:'pollinations-incomplete'});
  });
  it('accepts a bounded non-streaming JSON response only as a compatibility response to the same request',async()=>{
    fetch.mockResolvedValue(json({choices:[{message:{content:'4',reasoning:'PRIVATE_REASONING'},finish_reason:'stop'}]}));
    expect((await callPollinationsStream('Учитель',turns)).text).toBe('4');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([[401,'auth'],[402,'quota'],[429,'quota'],[503,'unavailable']])('stops HTTP %s as %s without reading a blocked error body or changing access mode',async(status,code)=>{
    const read=vi.fn(()=>{throw new Error('PRIVATE_BODY');}),cancel=vi.fn(()=>new Promise(()=>{}));
    fetch.mockResolvedValue({ok:false,status,headers:new Headers({'Retry-After':'45'}),body:{getReader:read,cancel}});
    await expect(callPollinationsStream('Учитель',turns)).rejects.toMatchObject({code:`pollinations-${code}`,status,retryAfterSeconds:45});
    expect(fetch).toHaveBeenCalledTimes(1);expect(read).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalled();
  });
  it('does not expose a provider error inside HTTP 200 SSE',async()=>{
    fetch.mockResolvedValue(stream(data({error:{message:'PRIVATE_BODY',code:500}})));
    await expect(callPollinationsStream('Учитель',turns)).rejects.toMatchObject({code:'pollinations-protocol'});
  });
  it('bounds uncooperative header waits and cleans up the deadline',async()=>{
    vi.useFakeTimers();fetch.mockImplementation(()=>new Promise(()=>{}));const p=callPollinationsStream('Учитель',turns);
    const check=expect(p).rejects.toMatchObject({code:'pollinations-timeout'});await vi.advanceTimersByTimeAsync(POLLINATIONS_TIMEOUT_MS+1);await check;expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a stalled body and cancels without another network request',async()=>{
    vi.useFakeTimers();const cancel=vi.fn(()=>new Promise(()=>{}));
    fetch.mockResolvedValue({ok:true,status:200,headers:new Headers({'Content-Type':'text/event-stream'}),body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel,releaseLock:vi.fn()})}});
    const p=callPollinationsStream('Учитель',turns),check=expect(p).rejects.toMatchObject({code:'pollinations-timeout'});
    await vi.advanceTimersByTimeAsync(POLLINATIONS_TIMEOUT_MS+1);await check;expect(cancel).toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('stops immediately on cancellation; late header completion cannot return an answer',async()=>{
    const c=new AbortController();let finish;fetch.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const p=callPollinationsStream('Учитель',turns,c.signal),check=expect(p).rejects.toMatchObject({name:'AbortError'});c.abort();await check;
    const cancel=vi.fn().mockResolvedValue();finish({body:{cancel}});await Promise.resolve();expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized data and reasoning-only answers',async()=>{
    fetch.mockResolvedValue(stream(data({choices:[{delta:{reasoning:'PRIVATE'}}]})+'data: [DONE]\n\n'));
    await expect(callPollinationsStream('Учитель',turns)).rejects.toMatchObject({code:'pollinations-empty'});
    fetch.mockResolvedValue(stream(delta('x'.repeat(100001),'stop')));
    await expect(callPollinationsStream('Учитель',turns)).rejects.toMatchObject({code:'pollinations-protocol'});
  });
  it('rejects a native photo instead of silently discarding it or sending it to the text endpoint',async()=>{
    await expect(callPollinationsStream('Учитель',turns,undefined,config.neutralImageDataUrl)).rejects.toMatchObject({code:'pollinations-image'});expect(fetch).not.toHaveBeenCalled();
  });
  it('validates context before sending and warns when the provider ends on its length limit',async()=>{
    await expect(callPollinationsStream('x'.repeat(48001),turns)).rejects.toMatchObject({code:'pollinations-context'});expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValue(stream(delta('Часть ответа','length')));expect((await callPollinationsStream('Учитель',turns)).text).toContain('может быть неполным');
  });
});

// The old 16x16 placeholder had an invalid IDAT checksum AND invalid deflate
// data. A text request to the image-only Qwen endpoint therefore failed before
// generation. Validate actual PNG bytes, not a mock upload's success status.
it('ships a decodable, checksummed 16x16 white RGB placeholder',()=>{
  const png=Buffer.from(config.neutralImageDataUrl.split(',')[1],'base64');
  expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;};
  let at=8,ended=false;const compressed=[];
  while(at<png.length){const size=png.readUInt32BE(at),type=png.subarray(at+4,at+8).toString(),bytes=png.subarray(at+8,at+8+size);
    expect(png.readUInt32BE(at+8+size)).toBe(crc32(png.subarray(at+4,at+8+size)));
    if(type==='IHDR'){expect(bytes.readUInt32BE(0)).toBe(16);expect(bytes.readUInt32BE(4)).toBe(16);expect([...bytes.subarray(8)]).toEqual([8,2,0,0,0]);}
    if(type==='IDAT')compressed.push(bytes);if(type==='IEND')ended=true;at+=size+12;
  }
  const pixels=inflateSync(Buffer.concat(compressed));expect(pixels.length).toBe(16*(1+16*3));
  for(let row=0;row<16;row++){expect(pixels[row*49]).toBe(0);expect([...pixels.subarray(row*49+1,(row+1)*49)].every(value=>value===255)).toBe(true);}expect(ended).toBe(true);
});


describe('fixed response-shape diagnostics, never provider bodies',()=>{
  it.each([
    [{error:{message:'PRIVATE_SENTINEL quota exceeded'}},'upstream-quota'],
    [{error:{message:'PRIVATE_SENTINEL max_tokens exceeded'}},'upstream-context'],
    [{error:{message:'PRIVATE_SENTINEL unsupported tool_calls'}},'upstream-tools'],
    [{error:{message:'PRIVATE_SENTINEL internal failure'}},'upstream-other'],
    [{choices:[{delta:{},finish_reason:'tool_calls'}]},'finish-tool_calls'],
    [{choices:[{delta:{},finish_reason:'PRIVATE_SENTINEL'}]},'finish-other'],
  ])('records only a fixed category %s',async(payload,diagnostic)=>{
    fetch.mockResolvedValue(stream(data(payload)));
    try {await callPollinationsStream('Учитель',turns);throw new Error('expected refusal');}
    catch(error){expect(error).toMatchObject({code:'pollinations-protocol',diagnostic});expect(error.message+JSON.stringify(error)).not.toContain('PRIVATE_SENTINEL');}
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects caller-supplied diagnostic text outside the allowlist',()=>{
    expect(new PollinationsError('protocol',0,0,'PRIVATE_SENTINEL').diagnostic).toBe('');
  });
});
