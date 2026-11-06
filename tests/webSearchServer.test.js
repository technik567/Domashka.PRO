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
  vm.runInNewContext(code,{Deno:{env:{get:(key)=>env[key]},serve:(f)=>{handler=f;}},createClient:()=>({auth:{getUser:auth},rpc}),URL,Response,Request,AbortSignal,TextDecoder,Uint8Array,Date,atob,fetch:external});
  const call=(body={query:'закон Ома',requestId:crypto.randomUUID()},headers={})=>handler(new Request('https://fixture.supabase.co/functions/v1/web-search',{method:'POST',headers:{Origin:'https://site.pages.dev',Authorization:`Bearer ${token}`,...headers},body:JSON.stringify(body)}));
  return {call,handler,auth,rpc,external};
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
  it('reports absent owner key, without reserving or returning fake search data',async()=>{const s=setup({TAVILY_API_KEY:''}); const r=await s.call(); expect(r.status).toBe(503);expect(s.rpc).not.toHaveBeenCalled();expect(s.external).not.toHaveBeenCalled();});
  it.each([['42501',403],['P0001',429],['23505',429]])('denies %s reservation without a billed call',async(code,status)=>{const s=setup({},false,{data:null,error:{code}});expect((await s.call()).status).toBe(status);expect(s.external).not.toHaveBeenCalled();});
  it('never retries/forwards upstream errors or keys',async()=>{const s=setup();s.external.mockResolvedValue(result({error:'SECRET-DETAIL'},429));const r=await s.call();expect(r.status).toBe(429);expect(JSON.stringify(await r.json())).not.toContain('SECRET-DETAIL');expect(s.external).toHaveBeenCalledTimes(1);});
  it('rejects huge response bodies and strips unsafe URLs',async()=>{
    const s=setup();s.external.mockResolvedValueOnce(result({results:[{url:'javascript:alert(1)'},{url:'http://127.0.0.1'},{url:'https://example.org/',content:'x'.repeat(1500)}]}));expect((await (await s.call()).json()).results).toHaveLength(1);
    s.external.mockResolvedValueOnce(new Response('x'.repeat(100001)));expect((await s.call()).status).toBe(502);
  });
});
