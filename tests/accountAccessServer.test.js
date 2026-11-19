// Actual Edge handler + explicit transport/Auth fixtures (not a live deployment).
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { webcrypto, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
const code=execFileSync(process.execPath,['--input-type=module','-e',String.raw`import fs from 'node:fs';import {transformSync} from 'esbuild';process.stdout.write(transformSync(fs.readFileSync('supabase/functions/account-access/index.ts','utf8').replace(/^import .*;$/m,''),{loader:'ts',target:'es2022'}).code);`],{encoding:'utf8'});
const actor=crypto.randomUUID(), sid=crypto.randomUUID(), proofSid=crypto.randomUUID(), ticket=crypto.randomUUID(), registered=crypto.randomUUID();
const token=(session=sid,user=actor)=>'e30.'+btoa(JSON.stringify({sub:user,session_id:session}))+'.fixture';
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
const registration={action:'register',login:' Alice ',password:'Safe-fixture-123',name:'Родитель',avatar:'🦉',timeZone:'Europe/Warsaw',captchaToken:'captcha-fixture'};
const recovery={action:'recover',login:'alice',password:'New-fixture-123',code:'ABCDEF01-23456789-ABCDEF01-23456789',captchaToken:'captcha-fixture'};
const hash=(s)=>createHash('sha256').update('domashka-backup-v1\0'+s.replace(/[\s-]/g,'').toUpperCase()).digest('hex');
function setup(overrides={}) {
  let handler;
  const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'public-fixture',SUPABASE_SERVICE_ROLE_KEY:'secret-fixture',DOMASHKA_ALLOWED_ORIGINS:'https://site.workers.dev',DOMASHKA_TURNSTILE_SECRET_KEY:'real-format-fixture-not-a-production-secret',...overrides};
  const rpc=vi.fn(async name=>({data:name==='domashka_register_ticket'?{ticket,userId:registered}:name==='domashka_recovery_ticket'?{ticket,userId:actor,remaining:9}:null,error:null}));
  const create=vi.fn(async()=>({data:{user:{id:registered}},error:null}));const update=vi.fn(async()=>({data:{user:{id:actor}},error:null}));
  const auth=vi.fn(async()=>({data:{user:{id:actor,email:'alice@parents.domashka.invalid'}},error:null}));
  const family=vi.fn(async()=>({data:{account:{id:actor,role:'parent',login:'alice'}},error:null}));
  const signin=vi.fn(async()=>({data:{user:{id:actor},session:{access_token:token(proofSid)}},error:null}));
  const signout=vi.fn(async()=>({error:null}));const external=vi.fn(async()=>response({success:true,hostname:'site.workers.dev',action:'domashka-auth'}));
  const admin={rpc,auth:{admin:{createUser:create,updateUserById:update}}};
  vm.runInNewContext(code,{Deno:{env:{get:key=>env[key]},serve:f=>{handler=f;}},createClient:(_url,key)=>key===env.SUPABASE_SERVICE_ROLE_KEY?admin:{auth:{getUser:auth,signInWithPassword:signin,signOut:signout},rpc:family},
    URL,Response,Request,AbortSignal,TextDecoder,TextEncoder,Uint8Array,Date,atob,crypto:webcrypto,fetch:external});
  const call=(body=registration,headers={})=>handler(new Request('https://fixture.supabase.co/functions/v1/account-access',{method:'POST',headers:{Origin:'https://site.workers.dev','Content-Type':'application/json',Authorization:`Bearer ${token()}`,...headers},body:JSON.stringify(body)}));
  return {call,handler,rpc,create,update,auth,family,signin,signout,external};
}
describe('username and backup-code Edge boundary',()=>{
  it('returns ten independent 128-bit codes, sends only their hashes to SQL and never calls email signup',async()=>{
    const s=setup();const r=await s.call();const b=await r.json();expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('no-store');expect(b.login).toBe('alice');
    expect(b.codes).toHaveLength(10);expect(new Set(b.codes).size).toBe(10);b.codes.forEach(c=>expect(c).toMatch(/^[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/));
    expect(s.rpc).toHaveBeenCalledWith('domashka_register_ticket',{username:'alice',hashes:b.codes.map(hash)});
    expect(JSON.stringify(s.rpc.mock.calls)).not.toContain(b.codes[0]);expect(JSON.stringify(s.rpc.mock.calls)).not.toContain(registration.password);
    expect(s.create).toHaveBeenCalledWith(expect.objectContaining({id:registered,email:'alice@parents.domashka.invalid',email_confirm:true,app_metadata:{domashka_role:'parent',domashka_auth:'username',domashka_login:'alice'}}));
    expect(JSON.stringify(s.create.mock.calls)).not.toContain(b.codes[0]);expect(s.external).toHaveBeenCalledTimes(1);expect(s.update).not.toHaveBeenCalled();
  });
  it.each([{DOMASHKA_ALLOWED_ORIGINS:''},{SUPABASE_SERVICE_ROLE_KEY:''},{DOMASHKA_TURNSTILE_SECRET_KEY:''},{DOMASHKA_TURNSTILE_SECRET_KEY:'1x0000000000000000000000000000000AA'}])('fails closed without real deployment config %j',async env=>{
    const s=setup(env);expect((await s.call()).status).toBe(503);expect(s.create).not.toHaveBeenCalled();expect(s.external).not.toHaveBeenCalled();
  });
  it.each(['','https://evil.example','https://site.workers.dev.attacker.test'])('rejects origin %s before any privileged call',async origin=>{
    const s=setup();expect((await s.call(registration,{Origin:origin})).status).toBe(403);expect(s.rpc).not.toHaveBeenCalled();
  });
  it('allows only exact-origin preflight without Auth',async()=>{
    const s=setup();const r=await s.handler(new Request('https://fixture.supabase.co',{method:'OPTIONS',headers:{Origin:'https://site.workers.dev'}}));expect(r.status).toBe(204);expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://site.workers.dev');expect(s.auth).not.toHaveBeenCalled();
  });
  it.each([{login:'user@example.test'},{login:'alice.family'},{login:'я-родитель'},{password:'short'},{password:'я'.repeat(37)},{role:'admin'},{avatar:'<img>'},{captchaToken:''}])('refuses malformed registration %j',async patch=>{
    const s=setup();expect((await s.call({...registration,...patch})).status).toBe(400);expect(s.create).not.toHaveBeenCalled();expect(s.external).not.toHaveBeenCalled();
  });
  it.each([{success:false},{success:true,hostname:'other.test',action:'domashka-auth'},{success:true,hostname:'site.workers.dev',action:'other'}])('validates CAPTCHA success, hostname and action %j',async captcha=>{
    const s=setup();s.external.mockResolvedValueOnce(response(captcha));expect((await s.call()).status).toBe(403);expect(s.create).not.toHaveBeenCalled();expect(s.rpc.mock.calls.map(c=>c[0])).toEqual(['domashka_account_rate']);
  });
  it('uses an atomic rate limit before contacting CAPTCHA, and never retries',async()=>{
    const s=setup();s.rpc.mockResolvedValueOnce({error:{code:'P0001',message:'raw-secret'},data:null});const r=await s.call();expect(r.status).toBe(429);expect(JSON.stringify(await r.json())).not.toContain('raw-secret');expect(s.external).not.toHaveBeenCalled();
  });
  it('fails closed on CAPTCHA outage',async()=>{const s=setup();s.external.mockRejectedValueOnce(new Error('outage-secret'));const r=await s.call();expect(r.status).toBe(503);expect(s.create).not.toHaveBeenCalled();expect(JSON.stringify(await r.json())).not.toContain('outage-secret');});
  it('hashes a normalized recovery code and changes only the identified password',async()=>{
    const s=setup();const r=await s.call({...recovery,code:recovery.code.toLowerCase().replaceAll('-',' ')});expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true,remaining:9});
    expect(s.rpc).toHaveBeenCalledWith('domashka_recovery_ticket',{username:'alice',hash:hash(recovery.code)});
    expect(s.update).toHaveBeenCalledWith(actor,{password:recovery.password,app_metadata:{domashka_recovery_ticket:ticket}});expect(s.create).not.toHaveBeenCalled();
  });
  it('does not update a user or disclose existence when a recovery code is invalid',async()=>{
    const s=setup();s.rpc.mockImplementation(async name=>name==='domashka_recovery_ticket'?{data:null,error:{message:'internal-detail'}}:{data:null,error:null});const r=await s.call(recovery);expect(r.status).toBe(400);expect(s.update).not.toHaveBeenCalled();expect(JSON.stringify(await r.json())).not.toContain('internal-detail');
  });
  it('does not retry a timed-out password change or claim the code is unused',async()=>{
    const s=setup();s.update.mockRejectedValueOnce(new Error('timeout-password'));const r=await s.call(recovery);expect(r.status).toBe(400);const b=await r.json();expect(b.error).toMatch(/сначала проверьте вход/i);expect(b.error).not.toContain('timeout-password');expect(s.update).toHaveBeenCalledTimes(1);
  });
  it('reauthenticates the same parent and binds code rotation to both real sessions',async()=>{
    const s=setup();const r=await s.call({action:'rotate_codes',password:'Current-fixture123',captchaToken:'fixture'});const b=await r.json();expect(r.status).toBe(200);expect(b.codes).toHaveLength(10);
    expect(s.signin).toHaveBeenCalledWith({email:'alice@parents.domashka.invalid',password:'Current-fixture123',options:{captchaToken:'fixture'}});
    expect(s.rpc).toHaveBeenCalledWith('domashka_replace_backup_codes',{actor_id:actor,actor_session:sid,proof_session:proofSid,hashes:b.codes.map(hash)});expect(s.signout).toHaveBeenCalledWith({scope:'local'});expect(s.external).not.toHaveBeenCalled();
  });
  it.each(['missing','wrong','child','other-proof','stale'])('rejects %s authorization for rotation',async variant=>{
    const s=setup();let headers={};
    if(variant==='missing') headers.Authorization='';
    if(variant==='wrong') s.signin.mockResolvedValue({data:{},error:{message:'wrong'}});
    if(variant==='child') s.family.mockResolvedValue({data:{account:{id:actor,role:'child'}},error:null});
    if(variant==='other-proof') s.signin.mockResolvedValue({data:{user:{id:crypto.randomUUID()},session:{access_token:token(proofSid)}},error:null});
    if(variant==='stale') s.auth.mockResolvedValue({data:{user:null},error:{message:'invalid'}});
    const r=await s.call({action:'rotate_codes',password:'Current-fixture123'},headers);expect([401,403]).toContain(r.status);expect(s.rpc).not.toHaveBeenCalled();
  });
  it('rejects oversize and non-JSON requests without Auth/database access',async()=>{
    const s=setup();expect((await s.call(registration,{'Content-Length':'17000'})).status).toBe(413);expect((await s.call(registration,{'Content-Type':'text/plain'})).status).toBe(415);expect(s.rpc).not.toHaveBeenCalled();
  });
});
