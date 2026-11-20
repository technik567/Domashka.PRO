import {describe,it,expect,vi} from 'vitest';
import {generateAiBrowser} from '../src/standalone/aiClient';
import config from '../shared/legacy-gateways.json';
const query={provider:'builtin',model:'auto',systemPrompt:'Учитель',messages:[{role:'user',content:'Объясни 2 + 2.'}],allowLocalFallback:false};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const sse=text=>new Response(text,{headers:{'Content-Type':'text/event-stream'}});
const completion=text=>sse(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})}\n\n`);
const qwenResult=(model,text)=>sse(`event: complete\ndata: ${JSON.stringify(model==='qwen35'?[null,null,null,null,[{role:'assistant',content:text}]]:[text])}\n\n`);

describe('integrated free routes, local search decisions and separate reviews',()=>{
  it('Auto starts with one streaming text request and does not spend HF quota when it succeeds',async()=>{
    fetch.mockResolvedValue(completion('2 + 2 = 4'));
    const result=await generateAiBrowser(query);
    expect(result.text).toBe('2 + 2 = 4');expect(result.used).toContain('Pollinations');expect(fetch).toHaveBeenCalledTimes(1);
    const [url,init]=fetch.mock.calls[0];expect(url).toBe('https://text.pollinations.ai/openai');expect(JSON.parse(init.body)).toMatchObject({stream:true,model:'openai-fast'});
  });
  it('uses one initial answer and two reviews through the free queue, without racing Qwen or pretending to search',async()=>{
    vi.useFakeTimers();const status=vi.fn();
    fetch.mockImplementation(async(url,init)=>{
      const text='2 + 2 = 4';
      return new Promise(resolve=>setTimeout(()=>resolve(completion(text)),51263));
    });
    const pending=generateAiBrowser({...query,webSearch:'auto',reasoning:'high',onStatus:status});
    await vi.advanceTimersByTimeAsync(50000);expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3*51263);
    const result=await pending;expect(result.workflow).toMatchObject({calls:3,searches:0,verified:2});
    expect(fetch).toHaveBeenCalledTimes(3);expect(fetch.mock.calls.every(([url,init])=>url==='https://text.pollinations.ai/openai'&&JSON.parse(init.body).stream===true)).toBe(true);
    expect(result.workflow.trail.some(row=>row.stage==='internet-skipped')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('tries an original backup only after a refusal, never a paid or simultaneous retry',async()=>{
    let release;
    fetch.mockImplementation(async(url,init={})=>{
      if(url.includes('pollinations'))return new Promise(resolve=>{release=()=>resolve(json({},402));});
      if(init.method==='POST')return json({event_id:'fixture'});
      return qwenResult('qwen35','Подсказка');
    });
    const pending=generateAiBrowser(query);await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    release();expect((await pending).used).toContain('Qwen 3.5');
    expect(fetch.mock.calls.map(([url])=>new URL(url).hostname)).toEqual(['text.pollinations.ai','qwen-qwen3-5-omni-offline-demo.hf.space','qwen-qwen3-5-omni-offline-demo.hf.space']);
  });
  it('never replaces explicitly selected Qwen after an SSE error, including with automatic search enabled',async()=>{
    fetch.mockImplementation(async(url,init)=>init.method==='POST'?json({event_id:'fixture'}):sse('event: error\ndata: null\n\n'));
    await expect(generateAiBrowser({...query,model:'qwen-3.5',webSearch:true})).rejects.toMatchObject({stage:'answer',code:'upstream'});
    expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls.every(([url])=>url.includes('qwen3-5-omni'))).toBe(true);
  });
  it('keeps native photos on Qwen routes, never sends them to Pollinations or silently uses OCR',async()=>{
    fetch.mockImplementation(async(url,init={})=>{
      if(url.endsWith('/upload'))return json(['/tmp/photo.png']);
      if(init.method==='POST')return json({event_id:'fixture'});
      return url.includes('qwen3-5')?sse('event: error\ndata: null\n\n'):qwenResult('qwen25','На фото схема');
    });
    const result=await generateAiBrowser({...query,images:[config.neutralImageDataUrl],photoMode:'vision'});
    expect(result).toMatchObject({photoInputUsed:'vision',photoCount:1,extractedPhotoText:''});expect(result.used).toContain('Qwen 2.5');
    expect(fetch.mock.calls.every(([url])=>url.includes('qwen3-5-omni')||url.includes('qwen2-5-vl'))).toBe(true);expect(fetch).toHaveBeenCalledTimes(6);
  });
  it('has one five-minute Auto budget, not a fresh full deadline for every backup',async()=>{
    vi.useFakeTimers();fetch.mockImplementation(()=>new Promise(()=>{}));
    const pending=generateAiBrowser(query),check=expect(pending).rejects.toThrow('общее ожидание Авто');
    await vi.advanceTimersByTimeAsync(config.pollinationsTimeoutMs-1);expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(config.qwenTimeoutMs-config.pollinationsTimeoutMs+2);await check;
    expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[1][0]).toContain('qwen3-5-omni');expect(vi.getTimerCount()).toBe(0);
  });
  it('Stop does not start another route or a later workflow pass',async()=>{
    const controller=new AbortController();fetch.mockImplementation(()=>new Promise(()=>{}));
    const pending=generateAiBrowser({...query,reasoning:'high',webSearch:true,signal:controller.signal});
    const check=expect(pending).rejects.toMatchObject({name:'AbortError'});controller.abort();await check;expect(fetch).toHaveBeenCalledTimes(1);
  });
});
