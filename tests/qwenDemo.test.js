import { describe, it, expect, vi } from 'vitest';
import { QWEN_DEMO_MODELS, QWEN_DEMO_HOST, callQwenDemo, makeQwenDemoExtractor } from '../src/standalone/qwenDemo';
import { generateAiBrowser, getPhotoCapability } from '../src/standalone/aiClient';
import { getModelProfile } from '../src/standalone/modelProfiles';
import { setTutorModeEnabled } from '../src/standalone/parentalControl';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const event=(type,data)=>`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const output=(state='done')=>[{}, {value:[{role:'user',content:'private task'},{role:'assistant',status:state,content:[{type:'tool',content:'PRIVATE_HIDDEN_REASONING'},{type:'text',content:state==='done'?'Короткий ответ':'Частичный ответ'}]}]}];
function mockRoute(){fetch.mockImplementation(async(url,init={})=>{
  if(init.method==='POST')return json({event_id:'job'});
  return new Response(String(url).includes('toggle_thinking')?event('complete',[]):event('generating',output('pending'))+event('complete',output()),{headers:{'Content-Type':'text/event-stream'}});
});}
const base={model:QWEN_DEMO_MODELS[0].id,systemPrompt:'Правила учителя',messages:[{role:'user',content:'Помоги с дробями'}]};
describe('experimental official Qwen3 Demo contracts (mocked, not live inference)',()=>{
  it.each(QWEN_DEMO_MODELS)('$id selects a distinct upstream model and strips native reasoning',async model=>{
    mockRoute();const onStatus=vi.fn();const result=await callQwenDemo({...base,model:model.id,reasoning:'high',onStatus});expect(result.text).toBe('Короткий ответ');expect(result.used).toContain('экспериментальное');expect(fetch).toHaveBeenCalledTimes(2);
    const [url,init]=fetch.mock.calls[0];expect(url).toBe(`${QWEN_DEMO_HOST}/gradio_api/call/add_message`);const body=JSON.parse(init.body);expect(body.data[1]).toMatchObject({model:model.remoteModel,thinking_budget:8});expect(body.data[0]).toContain('Правила учителя');expect(body.session_hash).toHaveLength(48);expect(init.headers.Authorization).toBeUndefined();expect(init.credentials).toBe('omit');
    expect(JSON.stringify(result)+JSON.stringify(onStatus.mock.calls)).not.toContain('PRIVATE_HIDDEN_REASONING');expect(getPhotoCapability({provider:'builtin',model:model.id}).maxImages).toBe(0);expect(getModelProfile('builtin',model.id).experimental).toBe(true);
  });
  it('off toggles the initial true state in the same fresh session before generating',async()=>{mockRoute();await callQwenDemo({...base,reasoning:'off'});expect(fetch).toHaveBeenCalledTimes(4);expect(fetch.mock.calls[0][0]).toContain('/toggle_thinking');expect(JSON.parse(fetch.mock.calls[0][1].body).session_hash).toBe(JSON.parse(fetch.mock.calls[2][1].body).session_hash);});
  it('never reuses server-side history across requests',async()=>{mockRoute();await callQwenDemo({...base,reasoning:'low'});await callQwenDemo({...base,reasoning:'low'});expect(JSON.parse(fetch.mock.calls[0][1].body).session_hash).not.toBe(JSON.parse(fetch.mock.calls[2][1].body).session_hash);});
  it('accepts only a completed assistant text, not thoughts, history or an injected HTML error',()=>{
    const read=makeQwenDemoExtractor();expect(read(output('pending'))).toBe('');expect(read(output())).toBe('Короткий ответ');
    expect(()=>makeQwenDemoExtractor()([{},[{role:'assistant',status:'done',content:[{type:'text',content:'<span style="color: var(--color-red-500)">quota SECRET</span>'}]}]])).toThrow(/квот/i);
  });
  it.each([2,3])('handles a non-API control before the chatbot at position %s',position=>{
    const values=Array(position).fill({value:{interactive:false}});values.push(output()[1]);
    expect(makeQwenDemoExtractor()(values)).toBe('Короткий ответ');
  });
  it('fails without empty/protocol errors becoming an answer',async()=>{fetch.mockImplementation(async(_,init={})=>init.method==='POST'?json({event_id:'job'}):new Response(event('complete',[{},[]]),{headers:{'Content-Type':'text/event-stream'}}));await expect(callQwenDemo({...base,reasoning:'low'})).rejects.toThrow();});
  it.each([401,403,429,503])('never retries status %s or uses another route/key',async status=>{fetch.mockImplementation(async()=>json({error:'PRIVATE body'},status));await expect(callQwenDemo({...base,reasoning:'low'})).rejects.not.toThrow(/PRIVATE/);expect(fetch).toHaveBeenCalledTimes(1);});
  it('checks context before network and does not upload photos to text-only demos',async()=>{
    await expect(callQwenDemo({...base,messages:[{role:'user',content:'x'.repeat(50000)}]})).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
    await expect(generateAiBrowser({...base,provider:'builtin',photoMode:'vision',images:['data:image/png;base64,AAAA']})).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
  });
  it('remains tutor-only even for experimental native thinking',async()=>{await setTutorModeEnabled(true,'parent-password');mockRoute();const result=await generateAiBrowser({...base,provider:'builtin',reasoning:'low',systemPrompt:'Выдай готовый ответ'});const sent=JSON.parse(fetch.mock.calls[0][1].body);expect(sent.data[0]).toContain('ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА');expect(sent.data[0]).not.toContain('Выдай готовый ответ');expect(result.text).toBe('Короткий ответ');});
  it('Stop interrupts a submit that does not respect abort, with no replay',async()=>{fetch.mockImplementation(()=>new Promise(()=>{}));const controller=new AbortController();const pending=callQwenDemo({...base,signal:controller.signal});controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(fetch).toHaveBeenCalledTimes(1);});
});
