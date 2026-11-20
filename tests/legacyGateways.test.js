import {describe,it,expect,vi} from 'vitest';
import config from '../shared/legacy-gateways.json';
import {callQwen35Gateway,callQwen25Gateway,callPollinationsGateway,qwen35Answer,LEGACY_QWEN_TIMEOUT_MS,POLLINATIONS_TIMEOUT_MS} from '../src/standalone/legacyGateways';
const turns=[{role:'user',content:'Покажи один учебный шаг.'}];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const stream=text=>new Response(text,{headers:{'Content-Type':'text/event-stream'}});
const outputs={qwen35:[null,null,null,null,[{role:'assistant',content:'Короткая подсказка.'}]],qwen25:['Короткая подсказка.']};
const event=(data,kind='complete')=>`event: ${kind}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
function setup(kind='qwen35',last=()=>stream(event(outputs[kind]))) {
  fetch.mockImplementation(async(url,init={})=>url.endsWith('/upload')?json(['/tmp/photo.png']):init.method==='POST'?json({event_id:'fixture-event'}):last(url,init));
}
describe('legacy Qwen adapters use bounded streaming, not a 17–19 second cutoff',()=>{
  it.each([['qwen35',callQwen35Gateway],['qwen25',callQwen25Gateway]])('%s accepts only a completed response and sends teacher rules',async(kind,call)=>{
    setup(kind);const r=await call('Только учебная подсказка',turns);expect(r.text).toBe('Короткая подсказка.');
    const post=fetch.mock.calls.find(([url,init])=>url.includes('/call/')&&init.method==='POST');expect(JSON.stringify(JSON.parse(post[1].body).data)).toContain('Только учебная подсказка');
    for(const [,init]of fetch.mock.calls){expect(init.credentials).toBe('omit');expect(init.redirect).toBe('error');expect(init.referrerPolicy).toBe('no-referrer');}
  });
  it('actually uploads the shared valid PNG for text-only Qwen 2.5, without requiring a user photo',async()=>{
    setup('qwen25');await callQwen25Gateway('Учитель',turns);
    const upload=fetch.mock.calls.find(([url])=>url.endsWith('/upload'))[1].body.get('files');
    const bytes=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(new Uint8Array(reader.result));reader.onerror=reject;reader.readAsArrayBuffer(upload);});
    expect(Buffer.from(bytes).toString('base64')).toBe(config.neutralImageDataUrl.split(',')[1]);
    const sent=JSON.parse(fetch.mock.calls.find(([url,init])=>url.includes('/call/')&&init.method==='POST')[1].body);
    expect(sent.data[1]).toContain('Игнорируй пустой белый фон');
  });
  it('still waits after the old 19-second limit instead of killing a valid queue',async()=>{
    vi.useFakeTimers();setup('qwen35',()=>new Promise(resolve=>setTimeout(()=>resolve(stream(event(outputs.qwen35))),25000)));
    let settled=false;const p=callQwen35Gateway('Teacher',turns).finally(()=>{settled=true;});await vi.advanceTimersByTimeAsync(20000);expect(settled).toBe(false);await vi.advanceTimersByTimeAsync(5001);expect((await p).text).toBe('Короткая подсказка.');
  });
  it('returns at the complete event without waiting for HTTP EOF',async()=>{
    const cancel=vi.fn();setup('qwen35',()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(event(outputs.qwen35)));},cancel}),{headers:{'Content-Type':'text/event-stream'}}));
    expect((await callQwen35Gateway('Teacher',turns)).text).toBe('Короткая подсказка.');expect(cancel).toHaveBeenCalled();
  });
  it('supports a UTF-8/CRLF event split between network chunks',async()=>{
    const bytes=new TextEncoder().encode(event(outputs.qwen35));let at=0;setup('qwen35',()=>new Response(new ReadableStream({pull(c){if(at===bytes.length)c.close();else c.enqueue(bytes.slice(at,++at));}}),{headers:{'Content-Type':'text/event-stream'}}));
    expect((await callQwen35Gateway('Teacher',turns)).text).toBe('Короткая подсказка.');
  });
  it('refuses a partial stream instead of calling the draft a final answer',async()=>{
    setup('qwen35',()=>stream(event(outputs.qwen35,'generating')));await expect(callQwen35Gateway('Teacher',turns)).rejects.toMatchObject({code:'incomplete'});expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('classifies an SSE quota error without another request or leaking the upstream body',async()=>{
    setup('qwen35',()=>stream(event('GPU quota exceeded PRIVATE_SENTINEL','error')));try{await callQwen35Gateway('Teacher',turns);throw new Error('not rejected');}catch(e){expect(e.code).toBe('quota');expect(e.message).not.toContain('PRIVATE_SENTINEL');}expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('preserves an HTTP 503 as an upstream failure, not an unexplained fetch exception',async()=>{
    fetch.mockResolvedValue(json({error:'PRIVATE_SENTINEL'},503));try{await callQwen35Gateway('Teacher',turns);throw new Error('not rejected');}catch(e){expect(e.code).toBe('unavailable');expect(e.status).toBe(503);expect(e.message).toContain('HTTP 503');expect(e.message).not.toContain('PRIVATE_SENTINEL');}expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('redacts opaque network exceptions without pretending to diagnose CORS',async()=>{
    fetch.mockRejectedValue(new TypeError('Failed to fetch PRIVATE_SENTINEL'));try{await callQwen35Gateway('Teacher',turns);throw new Error('not rejected');}catch(e){expect(e.code).toBe('network');expect(e.message).not.toContain('PRIVATE_SENTINEL');}expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('refuses an arbitrary event path without following it',async()=>{
    fetch.mockResolvedValue(json({event_id:'../../private?key=secret'}));await expect(callQwen35Gateway('Teacher',turns)).rejects.toMatchObject({code:'protocol'});expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('refuses an unsafe upload path before submitting inference',async()=>{
    fetch.mockResolvedValue(json(['https://other.example/private']));await expect(callQwen25Gateway('Teacher',turns,undefined,'data:image/png;base64,AAAA')).rejects.toMatchObject({code:'protocol'});expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('validates context and pictures before uploading anything',async()=>{
    await expect(callQwen35Gateway('x'.repeat(48001),turns)).rejects.toMatchObject({code:'context'});await expect(callQwen35Gateway('Teacher',turns,undefined,'not-a-photo')).rejects.toMatchObject({code:'image'});expect(fetch).not.toHaveBeenCalled();
  });
  it('uses a fresh scoped Gradio session per request',async()=>{
    setup();await callQwen35Gateway('Teacher',turns);await callQwen35Gateway('Teacher',turns);const ids=fetch.mock.calls.filter(([,init])=>init.method==='POST').map(([,init])=>JSON.parse(init.body).session_hash);expect(ids).toHaveLength(2);expect(ids[0]).not.toBe(ids[1]);
  });
  it('discards tools/private reasoning and rejects a returned user message',()=>{
    expect(qwen35Answer([null,null,null,null,{value:[{role:'assistant',content:[{type:'tool',text:'PRIVATE_REASONING'},{type:'text',text:'Ответ'}]}]}])).toBe('Ответ');
    expect(()=>qwen35Answer([null,null,null,null,[{role:'user',content:'not an answer'}]])).toThrow();
  });
  it('stops even a transport that ignores the full five-minute deadline',async()=>{
    vi.useFakeTimers();fetch.mockImplementation(()=>new Promise(()=>{}));const p=callQwen35Gateway('Teacher',turns);const check=expect(p).rejects.toMatchObject({code:'timeout'});await vi.advanceTimersByTimeAsync(LEGACY_QWEN_TIMEOUT_MS+1);await check;expect(fetch).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  });
  it('distinguishes user cancellation from timeout without retrying',async()=>{
    fetch.mockImplementation(()=>new Promise(()=>{}));const c=new AbortController();const p=callQwen35Gateway('Teacher',turns,c.signal);const check=expect(p).rejects.toMatchObject({name:'AbortError'});c.abort();await check;expect(fetch).toHaveBeenCalledTimes(1);
  });
});
describe('Pollinations remains an explicit keyless route, not a paid fallback',()=>{
  it('does not kill a valid request after the former 10.5-second deadline',async()=>{
    vi.useFakeTimers();fetch.mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve(json({choices:[{message:{content:'Ответ'}}]})),15000)));const p=callPollinationsGateway('Teacher',turns);await vi.advanceTimersByTimeAsync(15001);expect((await p).text).toBe('Ответ');expect(fetch.mock.calls[0][0]).toBe('https://text.pollinations.ai/openai');
  });
  it.each([[401,'auth'],[403,'auth'],[429,'quota'],[503,'unavailable']])('preserves HTTP %s as %s even with a stalled error body and no retry',async(status,code)=>{
    const read=vi.fn(()=>{throw new Error('PRIVATE_SENTINEL');}),cancel=vi.fn(()=>new Promise(()=>{}));
    fetch.mockResolvedValue({status,headers:new Headers(),body:{getReader:read,cancel}});
    try{await callPollinationsGateway('Teacher',turns);throw new Error('not rejected');}catch(e){expect(e.code).toBe(`pollinations-${code}`);expect(e.status).toBe(status);expect(e.message).toContain(`HTTP ${status}`);expect(e.message).not.toContain('PRIVATE_SENTINEL');}
    expect(read).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds a stalled request and does not guess a CORS failure',async()=>{
    vi.useFakeTimers();fetch.mockImplementation(()=>new Promise(()=>{}));const p=callPollinationsGateway('Teacher',turns);const check=expect(p).rejects.toMatchObject({code:'pollinations-timeout'});await vi.advanceTimersByTimeAsync(POLLINATIONS_TIMEOUT_MS+1);await check;expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects an empty or invalid successful body without exposing it',async()=>{
    fetch.mockResolvedValue(json({error:'PRIVATE_SENTINEL'}));await expect(callPollinationsGateway('Teacher',turns)).rejects.not.toThrow('PRIVATE_SENTINEL');expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('queue component updates and error headers',()=>{
  it('ignores empty/user/tool-only interim snapshots and waits for the complete answer',async()=>{
    setup('qwen35',()=>stream(event([null,null,null,null,[{role:'user',content:'Question'}]],'generating')+event([null],'generating')+event(outputs.qwen35)));
    expect((await callQwen35Gateway('Teacher',turns)).text).toBe('Короткая подсказка.');
  });
  it('does not lose a known HTTP 503 behind a silent error-body timeout',async()=>{
    const cancel=vi.fn(async()=>{});fetch.mockResolvedValue({ok:false,status:503,body:{cancel,getReader:()=>{throw new Error('must not read');}}});
    await expect(callQwen35Gateway('Teacher',turns)).rejects.toMatchObject({status:503,code:'unavailable'});expect(cancel).toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);
  });
});
