import {describe,it,expect,vi} from 'vitest';
import {fetchWithTimeout,MAX_BUFFERED_RESPONSE_BYTES} from '../src/standalone/network';
const url='https://public-fixture.example/api';
describe('bounded browser transport, including non-cooperative mobile readers',()=>{
  it('preserves status, headers and a complete UTF-8 response',async()=>{
    fetch.mockResolvedValue(new Response('Ответ ученику',{status:201,headers:{'Content-Type':'text/plain','X-Fixture':'ok'}}));
    const r=await fetchWithTimeout(url,{},500);expect(r.status).toBe(201);expect(r.headers.get('X-Fixture')).toBe('ok');expect(await r.text()).toBe('Ответ ученику');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([204,205,304])('preserves a bodyless HTTP %s',async status=>{
    fetch.mockResolvedValue(new Response(null,{status}));const r=await fetchWithTimeout(url,{},500);expect(r.status).toBe(status);expect(await r.text()).toBe('');
  });
  it('keeps bounded error bodies by default for callers that need structured errors',async()=>{
    fetch.mockResolvedValue(new Response('{"code":"fixture-error"}',{status:400,headers:{'Content-Type':'application/json'}}));
    const r=await fetchWithTimeout(url);expect(r.status).toBe(400);expect(await r.json()).toEqual({code:'fixture-error'});
  });
  it('can return known HTTP status without reading or awaiting cancellation of an error body',async()=>{
    vi.useFakeTimers();const read=vi.fn(()=>{throw new Error('must not read');}),cancel=vi.fn(()=>new Promise(()=>{}));
    fetch.mockResolvedValue({status:503,headers:new Headers(),body:{getReader:read,cancel}});
    const r=await fetchWithTimeout(url,{},1500,undefined,{readErrorBody:false});
    expect(r.status).toBe(503);expect(await r.text()).toBe('');expect(read).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  });
  it('stops a fetch that ignores AbortSignal instead of waiting indefinitely',async()=>{
    vi.useFakeTimers();fetch.mockImplementation(()=>new Promise(()=>{}));const p=fetchWithTimeout(url,{},1500);const check=expect(p).rejects.toMatchObject({name:'TimeoutError'});await vi.advanceTimersByTimeAsync(1501);await check;expect(fetch).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the deadline after headers, without waiting for a stuck cancel promise',async()=>{
    vi.useFakeTimers();const cancel=vi.fn(()=>new Promise(()=>{}));const read=vi.fn(()=>new Promise(()=>{}));
    fetch.mockResolvedValue({status:200,headers:new Headers(),body:{getReader:()=>({read,cancel,releaseLock:vi.fn()})}});
    const p=fetchWithTimeout(url,{},1500);const check=expect(p).rejects.toMatchObject({name:'TimeoutError'});await vi.advanceTimersByTimeAsync(1501);await check;expect(cancel).toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  });
  it('also bounds the arrayBuffer fallback used without a readable stream',async()=>{
    vi.useFakeTimers();fetch.mockResolvedValue({status:200,headers:new Headers(),arrayBuffer:()=>new Promise(()=>{})});const p=fetchWithTimeout(url,{},1500);const check=expect(p).rejects.toMatchObject({name:'TimeoutError'});await vi.advanceTimersByTimeAsync(1501);await check;
  });
  it('cancels before headers and disposes a late response instead of using it',async()=>{
    let finish;fetch.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const c=new AbortController();const p=fetchWithTimeout(url,{},1500,c.signal);const check=expect(p).rejects.toMatchObject({name:'AbortError'});c.abort();await check;
    const cancel=vi.fn().mockResolvedValue();finish({body:{cancel}});await Promise.resolve();expect(cancel).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does no network work for an already cancelled request',async()=>{
    const c=new AbortController();c.abort();await expect(fetchWithTimeout(url,{},1500,c.signal)).rejects.toMatchObject({name:'AbortError'});expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects an oversized declared response without reading it',async()=>{
    const read=vi.fn(),cancel=vi.fn().mockResolvedValue();fetch.mockResolvedValue({status:200,headers:new Headers({'Content-Length':String(MAX_BUFFERED_RESPONSE_BYTES+1)}),body:{getReader:read,cancel}});
    await expect(fetchWithTimeout(url)).rejects.toThrow(/безопасный размер/);expect(read).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalled();
  });
  it('stops an oversized undeclared stream while reading, not after allocating it all',async()=>{
    const cancel=vi.fn().mockResolvedValue();fetch.mockResolvedValue({status:200,headers:new Headers(),body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(MAX_BUFFERED_RESPONSE_BYTES+1)}),cancel,releaseLock:vi.fn()})}});
    await expect(fetchWithTimeout(url)).rejects.toThrow(/безопасный размер/);expect(cancel).toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('cleans up after a network rejection without a background retry',async()=>{
    vi.useFakeTimers();fetch.mockRejectedValue(new TypeError('Failed to fetch'));await expect(fetchWithTimeout(url)).rejects.toThrow('Failed to fetch');expect(vi.getTimerCount()).toBe(0);expect(fetch).toHaveBeenCalledTimes(1);
  });
});
