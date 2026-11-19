import { afterEach, describe, it, expect, vi } from 'vitest';
import { runWebSearch, validateSearchQuery, searchAvailability } from '../src/standalone/webSearch';
import { clearSearchKey, setSearchKey, hasSearchKey, getSearchKey } from '../src/standalone/searchCredentials';
import { setTutorModeEnabled } from '../src/standalone/parentalControl';
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
const output={results:[{title:'Учебный источник',url:'https://example.org/material',content:'Отрывок'}]};
afterEach(clearSearchKey);
describe('automatic search transport and memory-only credentials',()=>{
  it('keyless mode sends one bounded basic search without history, photos, cookies or a key',async()=>{
    fetch.mockImplementation(async()=>json(output));expect(searchAvailability().available).toBe(true);const result=await runWebSearch('закон Ома');
    expect(result.results).toHaveLength(1);expect(fetch).toHaveBeenCalledTimes(1);const [url,init]=fetch.mock.calls[0];expect(url).toBe('https://api.tavily.com/search');
    expect(init.headers['X-Tavily-Access-Mode']).toBe('keyless');expect(init.headers.Authorization).toBeUndefined();expect(init.credentials).toBe('omit');expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body)).toEqual({query:'закон Ома',search_depth:'basic',max_results:5,topic:'general',auto_parameters:false,include_answer:false,include_raw_content:false,include_images:false,safe_search:true});
  });
  it('does not require a UUID generator for direct local keyless search',async()=>{
    vi.stubGlobal('crypto',undefined);fetch.mockImplementation(async()=>json(output));
    expect((await runWebSearch('учебные источники')).results).toHaveLength(1);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses a user-supplied key only in the authorization header, never in browser storage or output',async()=>{
    const secret='tvly-test-key-sentinel-123';setSearchKey(secret);expect(hasSearchKey()).toBe(true);fetch.mockImplementation(async()=>json(output));const result=await runWebSearch('геометрия треугольник');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${secret}`);expect(fetch.mock.calls[0][1].headers['X-Tavily-Access-Mode']).toBeUndefined();expect(fetch.mock.calls[0][1].body).not.toContain(secret);
    expect(JSON.stringify(localStorage)+JSON.stringify(sessionStorage)+JSON.stringify(result)).not.toContain(secret);clearSearchKey();expect(hasSearchKey()).toBe(false);
  });
  it('clears a personal key on a parental policy change and blocks search before network',async()=>{
    setSearchKey('tvly-test-key-sentinel-123');await setTutorModeEnabled(true,'parent-password');expect(getSearchKey()).toBe('');expect(()=>setSearchKey('tvly-test-key-sentinel-123')).toThrow();await expect(runWebSearch('геометрия')).rejects.toThrow(/репетитора/);expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['child@example.com','+48 123 456 789','ABCDEF12-ABCDEF12-ABCDEF12-ABCDEF12','password: hidden','sk-abcdefghijklmnopqrstuvwxyz','x\nsecret','tvly-abcdefghijklmnop'])('rejects obvious personal data before any call: %s',async(query)=>{expect(()=>validateSearchQuery(query)).toThrow();await expect(runWebSearch(query)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();});
  it.each([401,403,429,432,503])('never retries status %s, leaks an upstream body or switches to a paid service',async status=>{fetch.mockImplementation(async()=>json({error:'PRIVATE_QUERY_AND_SECRET'},status));await expect(runWebSearch('модель атома')).rejects.not.toThrow(/PRIVATE_QUERY_AND_SECRET/);expect(fetch).toHaveBeenCalledTimes(1);});
  it('rejects empty, excessive or unsafe results',async()=>{
    fetch.mockImplementationOnce(async()=>json({results:[]}));await expect(runWebSearch('учебные источники')).rejects.toThrow(/не вернул/);
    fetch.mockImplementationOnce(async()=>json({results:[{url:'http://127.0.0.1/'}]}));await expect(runWebSearch('учебные источники')).rejects.toThrow(/не вернул/);
    fetch.mockImplementationOnce(async()=>new Response('x'.repeat(100001)));await expect(runWebSearch('учебные источники')).rejects.toThrow(/слишком большой/);
  });
  it('cancels waiting without starting another search',async()=>{fetch.mockImplementation(()=>new Promise(()=>{}));const controller=new AbortController();const pending=runWebSearch('учебные источники',{signal:controller.signal});controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(fetch).toHaveBeenCalledTimes(1);});
  it('bounds a stalled response to 22 seconds without a retry',async()=>{vi.useFakeTimers();fetch.mockImplementation(()=>new Promise(()=>{}));const pending=runWebSearch('учебные источники');const assertion=expect(pending).rejects.toThrow(/22 с/);await vi.advanceTimersByTimeAsync(22001);await assertion;expect(fetch).toHaveBeenCalledTimes(1);});
  it('cancels when parental restrictions change during search',async()=>{fetch.mockImplementation(()=>new Promise(()=>{}));const pending=runWebSearch('учебные источники');const assertion=expect(pending).rejects.toMatchObject({name:'AbortError'});await setTutorModeEnabled(true,'parent-password');await assertion;expect(fetch).toHaveBeenCalledTimes(1);});
});
