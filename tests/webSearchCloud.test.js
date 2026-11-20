// Cloud-route fixtures: these never call a live Supabase project or Tavily.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({driver:null,key:'',account:'fixture-account',accounts:new Set(),policies:new Set(),tutor:false,allowAi:true}));
vi.mock('../src/cloud/bridge',()=>({cloudConfigured:()=>true,cloud:()=>fixture.driver}));
vi.mock('../src/cloud/client',()=>({getCloudConfig:()=>({url:'https://fixture.supabase.co',publishableKey:'public-fixture'})}));
vi.mock('../src/standalone/accounts',()=>({assertAiAllowed:()=>{if(!fixture.allowAi)throw new Error('AI disabled');},getCurrentAccount:()=>({id:fixture.account}),subscribeAccounts:fn=>{fixture.accounts.add(fn);return()=>fixture.accounts.delete(fn);}}));
vi.mock('../src/standalone/parentalControl',()=>({isTutorModeEnabled:()=>fixture.tutor,subscribeParentalControl:fn=>{fixture.policies.add(fn);return()=>fixture.policies.delete(fn);}}));
vi.mock('../src/standalone/searchCredentials',()=>({getSearchKey:()=>fixture.key}));
import {generateAiBrowser} from '../src/standalone/aiClient';
import { runWebSearch, CLOUD_SEARCH_TIMEOUT_MS } from '../src/standalone/webSearch';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const output={ok:true,provider:'Tavily',query:'закон Ома',fetchedAt:'2026-11-05T12:00:00Z',results:[{title:'Учебный источник',url:'https://example.org/',content:'Выдержка'}]};
beforeEach(()=>{fixture.driver={request:vi.fn(action=>action('fixture-bearer'))};fixture.key='';fixture.account='fixture-account';fixture.tutor=false;fixture.allowAi=true;fixture.accounts.clear();fixture.policies.clear();});
describe('cloud search routing and safe diagnostics',()=>{
  it('sends only a minimal phrase and a fresh ID to the authenticated function, never directly to Tavily',async()=>{
    fetch.mockImplementation(async()=>json(output));await runWebSearch('закон Ома');await runWebSearch('закон Ома');
    const ids=[];for(const [url,init]of fetch.mock.calls){expect(url).toBe('https://fixture.supabase.co/functions/v1/web-search');expect(init.headers.Authorization).toBe('Bearer fixture-bearer');expect(init.headers.apikey).toBe('public-fixture');const body=JSON.parse(init.body);expect(Object.keys(body).sort()).toEqual(['query','requestId']);expect(body.query).toBe('закон Ома');ids.push(body.requestId);}
    expect(ids[0]).not.toBe(ids[1]);expect(fixture.accounts.size).toBe(0);expect(fixture.policies.size).toBe(0);
  });
  it.each([
    ['SEARCH_SETUP_REQUIRED',503,/неполной настройке/],['SEARCH_UPSTREAM_UNAVAILABLE',503,/не означает/],
    ['SEARCH_BACKEND_UNAVAILABLE',503,/сеанса или квоты/],['SEARCH_QUOTA',429,/Личный ключ не отменяет/],
    ['SEARCH_POLICY_DENIED',403,/родительскими/],['SEARCH_UPSTREAM_AUTH',502,/Поисковик не разрешил/],
    ['SEARCH_TIMEOUT',504,/Истекло ожидание/],['SEARCH_AUTH_REQUIRED',401,/Войдите/],
  ])('maps %s without exposing the returned error body',async(code,status,message)=>{
    fetch.mockResolvedValue(json({ok:false,code,error:'PRIVATE_SENTINEL',url:'https://private.example/?key=PRIVATE_SENTINEL'},status));
    try{await runWebSearch('закон Ома');throw new Error('not rejected');}catch(e){expect(e).toMatchObject({code,status});expect(e.message).toMatch(message);expect(e.message).toContain(`HTTP ${status}`);expect(e.message).not.toContain('PRIVATE_SENTINEL');}
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not call an unversioned 503 proof that the function needs updating',async()=>{
    fetch.mockResolvedValue(json({error:'PRIVATE_SENTINEL'},503));await expect(runWebSearch('закон Ома')).rejects.toThrow(/Без кода причины нельзя отличить/);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('ignores unknown machine codes and arbitrary response messages',async()=>{
    fetch.mockResolvedValue(json({code:'PRIVATE_SENTINEL',error:'PRIVATE_SENTINEL'},502));await expect(runWebSearch('закон Ома')).rejects.not.toThrow('PRIVATE_SENTINEL');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not diagnose opaque browser failure as a proven CORS/configuration failure',async()=>{
    fetch.mockRejectedValue(new TypeError('Failed to fetch PRIVATE_SENTINEL'));await expect(runWebSearch('закон Ома')).rejects.toThrow(/нельзя отличить сеть, CORS/);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps a personal key scoped to one request and never bypasses the cloud quota',async()=>{
    fixture.key='tvly-personal-fixture';fetch.mockImplementation(async()=>json(output));const result=await runWebSearch('закон Ома');expect(JSON.parse(fetch.mock.calls[0][1].body).searchKey).toBe(fixture.key);expect(JSON.stringify(result)).not.toContain(fixture.key);expect(fetch.mock.calls[0][0]).toContain('/functions/v1/web-search');
  });
  it('waits long enough for Auth + reservation + search, not the old 22-second total',async()=>{
    vi.useFakeTimers();fetch.mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve(json(output)),28000)));let done=false;const p=runWebSearch('закон Ома').finally(()=>{done=true;});await vi.advanceTimersByTimeAsync(22001);expect(done).toBe(false);await vi.advanceTimersByTimeAsync(6000);expect((await p).results).toHaveLength(1);
  });
  it('bounds even a stalled Auth session and prevents its late callback from sending a search',async()=>{
    vi.useFakeTimers();let resume;fixture.driver.request.mockImplementation(action=>new Promise(resolve=>{resume=()=>resolve(action('old-bearer'));}));
    const p=runWebSearch('закон Ома');const check=expect(p).rejects.toThrow(/35 с/);await vi.advanceTimersByTimeAsync(CLOUD_SEARCH_TIMEOUT_MS+1);await check;expect(fetch).not.toHaveBeenCalled();resume();await Promise.resolve();expect(fetch).not.toHaveBeenCalled();expect(fixture.accounts.size).toBe(0);
  });
  it('bounds a stalled error body without losing the HTTP 503 already received',async()=>{
    vi.useFakeTimers();const cancel=vi.fn(()=>new Promise(()=>{}));
    fetch.mockResolvedValue({ok:false,status:503,body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel})}});
    const p=runWebSearch('закон Ома');const check=expect(p).rejects.toMatchObject({code:'SEARCH_HTTP',status:503});
    await vi.advanceTimersByTimeAsync(CLOUD_SEARCH_TIMEOUT_MS+1);await check;expect(cancel).toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  });
  it('also restores the status of an unversioned failure after cloud error normalization',async()=>{
    fixture.driver.request.mockImplementation(async action=>{try{return await action('fixture-bearer');}catch(e){throw Object.assign(new Error(e.message),{code:e.code});}});
    fetch.mockResolvedValue(json({error:'PRIVATE_SENTINEL'},503));await expect(runWebSearch('закон Ома')).rejects.toMatchObject({code:'SEARCH_HTTP',status:503});expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('aborts on account switch even between two allowed parent accounts',async()=>{
    fetch.mockImplementation(()=>new Promise(()=>{}));const p=runWebSearch('закон Ома');const check=expect(p).rejects.toMatchObject({name:'AbortError'});fixture.account='another-account';fixture.accounts.forEach(fn=>fn());await check;expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves safe diagnostics even when the cloud driver normalizes the Error instance',async()=>{
    fixture.driver.request.mockImplementation(async action=>{try{return await action('fixture-bearer');}catch(e){throw Object.assign(new Error(e.message),{code:e.code});}});
    fetch.mockResolvedValue(json({code:'SEARCH_UPSTREAM_UNAVAILABLE'},503));await expect(runWebSearch('закон Ома')).rejects.toMatchObject({code:'SEARCH_UPSTREAM_UNAVAILABLE',status:503});
  });
});


describe('hosted search-first workflow isolation (fixture transport, not live Auth)',()=>{
  const options={provider:'builtin',model:'pollinations',webSearch:'auto',reasoning:'high',messages:[{role:'user',content:'Найди источники о законе Ома.'}]};
  it('uses authenticated search before the first selected-model failure and preserves genuine sources',async()=>{
    fetch.mockImplementation(async url=>url.includes('supabase')?json(output):new Response('PRIVATE_UPSTREAM',{status:503}));
    const result=await generateAiBrowser(options);
    expect(result.sourcesOnly).toBe(true);expect(result.workflow).toMatchObject({calls:1,searches:1,verified:0});
    expect(fetch.mock.calls.map(([url])=>url)).toEqual(['https://fixture.supabase.co/functions/v1/web-search','https://text.pollinations.ai/openai']);
    const [first,second]=fetch.mock.calls;
    expect(JSON.parse(first[1].body).query).toBe('законе Ома');expect(first[1].headers.Authorization).toBe('Bearer fixture-bearer');
    expect(second[1].body).toContain('ПОИСКОВЫЕ ДАННЫЕ');expect(second[1].body).not.toContain('fixture-bearer');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_UPSTREAM');expect(fixture.accounts.size).toBe(0);expect(fixture.policies.size).toBe(0);
  });
  it('does not bypass cloud search quota or start a model when search is refused',async()=>{
    fetch.mockResolvedValue(json({ok:false,code:'SEARCH_QUOTA'},429));
    await expect(generateAiBrowser(options)).rejects.toMatchObject({stage:'search-1',code:'SEARCH_QUOTA',status:429});
    expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toContain('/functions/v1/web-search');
  });
  it.each(['account','tutor','allow-ai'])('a %s change while search is pending prevents model generation and late acceptance',async kind=>{
    let release;fetch.mockImplementation(()=>new Promise(resolve=>{release=()=>resolve(json(output));}));
    const pending=generateAiBrowser(options),stopped=expect(pending).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    if(kind==='account')fixture.account='different-account';if(kind==='tutor')fixture.tutor=true;if(kind==='allow-ai')fixture.allowAi=false;
    [...fixture.accounts,...fixture.policies].forEach(fn=>fn());await stopped;release();await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);expect(fixture.accounts.size).toBe(0);expect(fixture.policies.size).toBe(0);
  });
  it.each(['account','tutor','allow-ai'])('a %s change during first generation cannot publish already obtained sources-only',async kind=>{
    let release;fetch.mockImplementation(url=>url.includes('supabase')?Promise.resolve(json(output)):new Promise(resolve=>{release=()=>resolve(new Response('PRIVATE_ERROR',{status:503}));}));
    const pending=generateAiBrowser(options),stopped=expect(pending).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
    if(kind==='account')fixture.account='different-account';if(kind==='tutor')fixture.tutor=true;if(kind==='allow-ai')fixture.allowAi=false;
    [...fixture.accounts,...fixture.policies].forEach(fn=>fn());await stopped;release();await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);expect(fixture.accounts.size).toBe(0);expect(fixture.policies.size).toBe(0);
  });
});
