// Execute the actual Edge handler with network/Auth fixtures. This does NOT
// claim live Supabase/Tavily authentication. Real SQL has separate role tests.
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { it,expect,describe,vi } from 'vitest';
const code=execFileSync(process.execPath,['--input-type=module','-e', String.raw`import fs from 'node:fs'; import {transformSync} from 'esbuild'; const source=fs.readFileSync('supabase/functions/web-search/index.ts','utf8').split('\n').slice(1).join('\n'); process.stdout.write(transformSync(source,{loader:'ts',target:'es2022'}).code);`],{encoding:'utf8'});
const actor=crypto.randomUUID(),session=crypto.randomUUID();
const token='header.'+btoa(JSON.stringify({sub:actor,session_id:session}))+'.fixture-only';
const result=(x,status=200)=>new Response(JSON.stringify(x),{status});
function setup(overrides={}, authError=false,reservation={data:true,error:null}) {
  let handler; const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'public-fixture',SUPABASE_SERVICE_ROLE_KEY:'server-fixture',TAVILY_API_KEY:'tvly-owner-fixture',DOMASHKA_ALLOWED_ORIGINS:'https://site.pages.dev',...overrides};
  const auth=vi.fn(async()=>({data:{user:authError?null:{id:actor}},error:authError?new Error('bad'):null})); const rpc=vi.fn(async()=>reservation);
  const external=vi.fn(async()=>result({results:[{title:'Источник',url:'https://example.org/',content:'Выдержка'}]}));
  const createClient=vi.fn(()=>({auth:{getUser:auth},rpc}));
  vm.runInNewContext(code,{Deno:{env:{get:(key)=>env[key]},serve:(f)=>{handler=f;}},createClient,URL,Response,Request,AbortSignal,AbortController,DOMException,TextDecoder,Uint8Array,Date,atob,setTimeout,clearTimeout,fetch:external});
  const call=(body={query:'закон Ома',requestId:crypto.randomUUID()},headers={})=>handler(new Request('https://fixture.supabase.co/functions/v1/web-search',{method:'POST',headers:{Origin:'https://site.pages.dev',Authorization:`Bearer ${token}`,...headers},body:JSON.stringify(body)}));
  return {call,handler,auth,rpc,external,createClient};
}
describe('server-only Tavily function',()=>{
  it('validates Auth, then real-session reservation, then a single fixed basic search',async()=>{
    const s=setup(); const response=await s.call(); const body=await response.json(); expect(response.status).toBe(200); expect(body.provider).toBe('Tavily');
    expect(s.auth).toHaveBeenCalledWith(token); expect(s.rpc).toHaveBeenCalledWith('domashka_reserve_search',expect.objectContaining({actor_id:actor,actor_session:session}));
    expect(s.external).toHaveBeenCalledTimes(1); const [url,init]=s.external.mock.calls[0]; expect(url).toBe('https://api.tavily.com/search');
    expect(init.headers.Authorization).toBe('Bearer tvly-owner-fixture'); expect(JSON.parse(init.body)).toEqual({query:'закон Ома',search_depth:'basic',max_results:5,topic:'general',auto_parameters:false,include_answer:false,include_raw_content:false,include_images:false,safe_search:true});
    expect(JSON.stringify(body)).not.toContain('fixture');
  });
  it.each([{DOMASHKA_ALLOWED_ORIGINS:''},{SUPABASE_SERVICE_ROLE_KEY:''}])('fails closed for incomplete server setup %j',async(env)=>{
    const s=setup(env); expect((await s.call()).status).toBe(503); expect(s.external).not.toHaveBeenCalled();
  });
  it('rejects an unlisted origin before any Auth/network work',async()=>{const s=setup(); expect((await s.call(undefined,{Origin:'https://evil.example'})).status).toBe(403); expect(s.auth).not.toHaveBeenCalled();});
  it('answers only permitted preflight without requiring a user token',async()=>{const s=setup();const res=await s.handler(new Request('https://fixture.supabase.co',{method:'OPTIONS',headers:{Origin:'https://site.pages.dev'}}));expect(res.status).toBe(204);expect(s.auth).not.toHaveBeenCalled();});
  it('does not accept missing/invalid Auth or arbitrary session claims',async()=>{
    let s=setup(); expect((await s.call(undefined,{Authorization:''})).status).toBe(401); s=setup({},true); expect((await s.call()).status).toBe(401); expect(s.rpc).not.toHaveBeenCalled();
    s=setup(); const bad='header.'+btoa(JSON.stringify({sub:actor,session_id:'wrong'}))+'.x'; expect((await s.call(undefined,{Authorization:`Bearer ${bad}`})).status).toBe(401); expect(s.rpc).not.toHaveBeenCalled();
  });
  it.each([{query:'xx'},{query:'a'.repeat(301)},{query:'hello',photos:['private']},{query:'tvly-secret-do-not-send'}])('rejects malformed/private data without contacting a provider %j',async(body)=>{
    const s=setup(); expect((await s.call({requestId:crypto.randomUUID(),...body})).status).toBe(400); expect(s.external).not.toHaveBeenCalled();
  });
  it('uses keyless access when owner key is absent, still reserving quota first',async()=>{const s=setup({TAVILY_API_KEY:''}); const r=await s.call(); expect(r.status).toBe(200);expect(s.rpc).toHaveBeenCalledTimes(1);expect(s.external).toHaveBeenCalledTimes(1);expect(s.external.mock.calls[0][1].headers).toMatchObject({'X-Tavily-Access-Mode':'keyless'});expect(s.external.mock.calls[0][1].headers.Authorization).toBeUndefined();});
  it('keeps per-request search key out of responses, SQL and subsequent calls',async()=>{const s=setup({TAVILY_API_KEY:''});const key='tvly-personal-fixture';const r=await s.call({query:'закон Ома',requestId:crypto.randomUUID(),searchKey:key});expect(r.status).toBe(200);expect(s.external.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${key}`);expect(JSON.stringify(s.rpc.mock.calls)).not.toContain(key);expect(JSON.stringify(await r.json())).not.toContain(key);await s.call();expect(s.external.mock.calls[1][1].headers.Authorization).toBeUndefined();});
  it('rejects missing Origin even with a valid fixture token',async()=>{const s=setup();const res=await s.handler(new Request('https://fixture.supabase.co',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({query:'учебные материалы',requestId:crypto.randomUUID()})}));expect(res.status).toBe(403);expect(s.auth).not.toHaveBeenCalled();});
  it.each([['42501',403],['P0001',429],['23505',429]])('denies %s reservation without a billed call',async(code,status)=>{const s=setup({},false,{data:null,error:{code}});expect((await s.call()).status).toBe(status);expect(s.external).not.toHaveBeenCalled();});
  it('never retries/forwards upstream errors or keys',async()=>{const s=setup();s.external.mockResolvedValue(result({error:'SECRET-DETAIL'},429));const r=await s.call();expect(r.status).toBe(429);expect(JSON.stringify(await r.json())).not.toContain('SECRET-DETAIL');expect(s.external).toHaveBeenCalledTimes(1);});
  it('rejects huge response bodies and strips unsafe URLs',async()=>{
    const s=setup();s.external.mockResolvedValueOnce(result({results:[{url:'javascript:alert(1)'},{url:'http://127.0.0.1'},{url:'https://example.org/',content:'x'.repeat(1500)}]}));expect((await (await s.call()).json()).results).toHaveLength(1);
    s.external.mockResolvedValueOnce(new Response('x'.repeat(100001)));expect((await s.call()).status).toBe(502);
  });
});

describe('search readiness, failure stages and total budget',()=>{
  it('allows a permitted preflight even when service credentials are missing, then returns a readable 503',async()=>{
    const s=setup({SUPABASE_SERVICE_ROLE_KEY:''});const preflight=await s.handler(new Request('https://fixture.supabase.co',{method:'OPTIONS',headers:{Origin:'https://site.pages.dev'}}));
    expect(preflight.status).toBe(204);expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://site.pages.dev');expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    const r=await s.call();expect(r.status).toBe(503);expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://site.pages.dev');expect(r.headers.get('X-Domashka-Search-Version')).toBe('4.5');expect(await r.json()).toMatchObject({code:'SEARCH_SETUP_REQUIRED',version:'4.5'});expect(s.auth).not.toHaveBeenCalled();
  });
  it.each([['PGRST202','SEARCH_SETUP_REQUIRED'],['42P01','SEARCH_SETUP_REQUIRED'],['42883','SEARCH_SETUP_REQUIRED'],['08006','SEARCH_BACKEND_UNAVAILABLE'],['','SEARCH_BACKEND_UNAVAILABLE']])('does not mislabel RPC %s as an exhausted quota',async(code,expected)=>{
    const s=setup({},false,{data:null,error:{code,message:'PRIVATE_SENTINEL'}});const r=await s.call();expect(r.status).toBe(503);expect(await r.json()).toMatchObject({code:expected});expect(s.external).not.toHaveBeenCalled();
  });
  it('separates a real Auth service 503 from invalid credentials',async()=>{
    const s=setup();s.auth.mockResolvedValue({data:{user:null},error:{status:503,message:'PRIVATE_SENTINEL'}});const r=await s.call();expect(r.status).toBe(503);expect(await r.json()).toMatchObject({code:'SEARCH_BACKEND_UNAVAILABLE'});expect(s.rpc).not.toHaveBeenCalled();expect(s.external).not.toHaveBeenCalled();
  });
  it.each([[503,503,'SEARCH_UPSTREAM_UNAVAILABLE'],[429,429,'SEARCH_UPSTREAM_QUOTA'],[401,502,'SEARCH_UPSTREAM_AUTH']])('classifies Tavily HTTP %s separately from site setup',async(status,http,code)=>{
    const s=setup();s.external.mockResolvedValue(result({error:'PRIVATE_SENTINEL'},status));const r=await s.call();expect(r.status).toBe(http);const body=await r.json();expect(body.code).toBe(code);expect(JSON.stringify(body)).not.toContain('PRIVATE_SENTINEL');expect(s.rpc).toHaveBeenCalledTimes(1);expect(s.external).toHaveBeenCalledTimes(1);
  });
  it('rejects a malformed success body rather than claiming missing setup',async()=>{
    const s=setup();s.external.mockResolvedValue(new Response('not-json PRIVATE_SENTINEL'));const r=await s.call();expect(r.status).toBe(502);expect(await r.json()).toMatchObject({code:'SEARCH_UPSTREAM_PROTOCOL'});expect(s.external).toHaveBeenCalledTimes(1);
  });
  it.each(['auth','rpc'])('bounds a silent %s phase and never starts a late provider request',async(phase)=>{
    vi.useFakeTimers();const s=setup();let finish;s[phase].mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const pending=s.call();await vi.advanceTimersByTimeAsync(30001);const r=await pending;expect(r.status).toBe(504);expect(await r.json()).toMatchObject({code:'SEARCH_TIMEOUT'});expect(s.external).not.toHaveBeenCalled();
    finish(phase==='auth'?{data:{user:{id:actor}},error:null}:{data:true,error:null});await Promise.resolve();expect(s.external).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
  it('enforces the 18-second provider timeout even when fetch ignores cancellation, without refund/retry',async()=>{
    vi.useFakeTimers();const s=setup();s.external.mockImplementation(()=>new Promise(()=>{}));const pending=s.call();await vi.advanceTimersByTimeAsync(18001);const r=await pending;expect(r.status).toBe(504);expect(await r.json()).toMatchObject({code:'SEARCH_TIMEOUT'});expect(s.external).toHaveBeenCalledTimes(1);expect(s.rpc).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  });
  it('clears all timers on success and injects the deadline into Auth and SQL clients',async()=>{
    vi.useFakeTimers();const s=setup();expect((await s.call()).status).toBe(200);expect(vi.getTimerCount()).toBe(0);
    for(const [,,options]of s.createClient.mock.calls)expect(typeof options.global.fetch).toBe('function');
  });
});
