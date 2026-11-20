import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({id:'one',tutor:false,accounts:new Set(),policies:new Set()}));
vi.mock('../src/standalone/accounts',()=>({assertAiAllowed:()=>{},getCurrentAccount:()=>({id:fixture.id}),subscribeAccounts:fn=>{fixture.accounts.add(fn);return()=>fixture.accounts.delete(fn);}}));
vi.mock('../src/standalone/parentalControl',()=>({isTutorModeEnabled:()=>fixture.tutor,subscribeParentalControl:fn=>{fixture.policies.add(fn);return()=>fixture.policies.delete(fn);}}));
import { recognizeHomeworkPhoto } from '../src/standalone/visionEngine';
const PHOTO='data:image/png;base64,AAAA';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const complete=()=>new Response('event: complete\ndata: [null,null,null,null,[{"role":"assistant","content":"2 + 2 = 5"}]]\n\n',{headers:{'Content-Type':'text/event-stream'}});
beforeEach(()=>{
  fixture.id='one';fixture.tutor=false;fixture.accounts.clear();fixture.policies.clear();
  vi.stubGlobal('Image',class {width=4;height=4;set src(value){if(value)queueMicrotask(()=>this.onload?.());}});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({fillRect(){},save(){},translate(){},rotate(){},drawImage(){},restore(){},getImageData(){return{data:new Uint8ClampedArray(64)};},putImageData(){}});
  vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue(PHOTO);
});
afterEach(()=>{delete window.Tesseract;});
function routeQwen(delay=0){
  fetch.mockImplementation(async(url,init={})=>{
    if(!url.includes('qwen3-5-omni'))return json({},503);
    if(url.endsWith('/upload'))return json(['/tmp/homework.png']);
    if(init.method==='POST')return json({event_id:'fixture'});
    if(delay)return new Promise(resolve=>setTimeout(()=>resolve(complete()),delay));
    return complete();
  });
}
describe('explicit OCR uses the repaired transports, not short duplicate parsers',()=>{
  it('accepts a Qwen queue after 25 seconds and preserves student errors instead of correcting them',async()=>{
    vi.useFakeTimers();routeQwen(25000);const p=recognizeHomeworkPhoto(PHOTO,{purpose:'check'});await vi.advanceTimersByTimeAsync(25001);const result=await p;
    expect(result.text).toBe('2 + 2 = 5');expect(result.engine).toContain('Qwen');const post=fetch.mock.calls.find(([url,init])=>url.endsWith('chat_predict')&&init.method==='POST');expect(post[1].body).toContain('НЕ ИСПРАВЛЯЙ');expect(post[1].body).toContain('session_hash');expect(fixture.accounts.size).toBe(0);
  });
  it('the Python OCR route is not repeated directly from the browser after a server failure',async()=>{
    window.__STANDALONE_BUILD__=false;fetch.mockResolvedValue(json({ok:false,error:'PRIVATE_SENTINEL'}));await expect(recognizeHomeworkPhoto(PHOTO)).rejects.toThrow(/Повтора из браузера нет/);expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('/api/vision-ocr');
  });
  it('stops non-cooperative fetches and never starts the secondary OCR cascade after Stop',async()=>{
    vi.useFakeTimers();fetch.mockImplementation(()=>new Promise(()=>{}));const controller=new AbortController();const p=recognizeHomeworkPhoto(PHOTO,{signal:controller.signal});const check=expect(p).rejects.toMatchObject({name:'AbortError'});
    await vi.advanceTimersByTimeAsync(5);expect(fetch).toHaveBeenCalledTimes(3);controller.abort();await check;await vi.advanceTimersByTimeAsync(61000);expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each(['account','policy'])('cancels OCR on %s changes before accepting a late photo result',async(change)=>{
    vi.useFakeTimers();routeQwen(25000);const p=recognizeHomeworkPhoto(PHOTO);const check=expect(p).rejects.toMatchObject({name:'AbortError'});await vi.advanceTimersByTimeAsync(1);
    if(change==='account'){fixture.id='two';fixture.accounts.forEach(fn=>fn());}else{fixture.tutor=true;fixture.policies.forEach(fn=>fn());}
    await check;await vi.advanceTimersByTimeAsync(25001);expect(fixture.accounts.size).toBe(0);expect(fixture.policies.size).toBe(0);
  });
  it('does not hang on a broken worker termination after the local OCR timeout',async()=>{
    vi.useFakeTimers();fetch.mockResolvedValue(json({},503));const terminate=vi.fn(()=>new Promise(()=>{}));window.Tesseract={createWorker:vi.fn(async()=>({recognize:()=>new Promise(()=>{}),terminate}))};
    const p=recognizeHomeworkPhoto(PHOTO);const check=expect(p).rejects.toThrow(/Превышено время ожидания чтения/);await vi.advanceTimersByTimeAsync(16001);await check;expect(terminate).toHaveBeenCalledTimes(1);
  });
  it('bounds the whole OCR workflow even if image decoding never finishes',async()=>{
    vi.useFakeTimers();vi.stubGlobal('Image',class {set src(value){}});const p=recognizeHomeworkPhoto(PHOTO);const check=expect(p).rejects.toThrow(/3 минуты/);await vi.advanceTimersByTimeAsync(180001);await check;expect(fetch).not.toHaveBeenCalled();
  });
});
