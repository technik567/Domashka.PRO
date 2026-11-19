// Execute the actual Edge handler with fixture Auth/database calls. No live users.
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
const code = execFileSync(process.execPath, ['--input-type=module', '-e', String.raw`import fs from 'node:fs';import {transformSync} from 'esbuild';process.stdout.write(transformSync(fs.readFileSync('supabase/functions/family-admin/index.ts','utf8').replace(/^import .*;$/m,''),{loader:'ts',target:'es2022'}).code);`], {encoding:'utf8'});
const parent = crypto.randomUUID(), child = crypto.randomUUID(), ticket = crypto.randomUUID();
const base = {login:'pupil',name:'Ученик',grade:3,age:9,avatar:'🦊',childId:child,parentPassword:'Parent-fixture-123',captchaToken:'fixture-captcha'};
function setup() {
  let handler;
  const env = {SUPABASE_URL:'https://family-fixture.supabase.co',SUPABASE_ANON_KEY:'public-fixture',SUPABASE_SERVICE_ROLE_KEY:'service-fixture',DOMASHKA_ALLOWED_ORIGINS:'https://family-fixture.workers.dev'};
  const create = vi.fn(async () => ({data:{user:{id:ticket}},error:null}));
  const update = vi.fn(async () => ({error:null}));
  const signin = vi.fn(async () => ({data:{user:{id:parent}},error:null}));
  const signout = vi.fn(async () => ({error:null}));
  const rpc = vi.fn(async name => ({data:name === 'domashka_get_family'
    ? {account:{id:parent,role:'parent',familyCode:'family123'},children:[{id:child}]} : ticket,error:null}));
  const user = {rpc,auth:{getUser:async () => ({data:{user:{id:parent,email:'parent@parents.domashka.invalid'}},error:null}),signInWithPassword:signin,signOut:signout}};
  vm.runInNewContext(code, {Deno:{env:{get:key => env[key]},serve:fn => {handler=fn;}},
    createClient:(_url,key) => key === env.SUPABASE_SERVICE_ROLE_KEY ? {auth:{admin:{createUser:create,updateUserById:update}}} : user,
    Response,Request,TextEncoder,TextDecoder,Uint8Array});
  const call = (action,password) => handler(new Request('https://family-fixture.supabase.co/functions/v1/family-admin',{
    method:'POST',headers:{Origin:'https://family-fixture.workers.dev','Content-Type':'application/json',Authorization:'Bearer fixture'},
    body:JSON.stringify({...base,action,password})}));
  return {call,create,update,signin,signout,rpc};
}
for (const action of ['create_child','reset_child']) {
  describe(`${action} cloud password boundary`, () => {
    it.each(['short',' '.repeat(8),'a'.repeat(73),'я'.repeat(37)])('rejects invalid new password before a ticket or privileged Auth mutation: %s', async password => {
      const s=setup();const response=await s.call(action,password);
      expect(response.status).toBe(400);expect((await response.json()).error).toContain('72 байта');
      expect(s.rpc.mock.calls.map(args => args[0])).toEqual(['domashka_get_family']);
      expect(s.create).not.toHaveBeenCalled();expect(s.update).not.toHaveBeenCalled();expect(s.signin).not.toHaveBeenCalled();
    });
    it.each(['a'.repeat(72),'я'.repeat(36)])('accepts exactly 72 UTF-8 bytes unchanged: %s', async password => {
      const s=setup();const response=await s.call(action,password);expect(response.status).toBe(200);
      if (action === 'create_child') {
        expect(s.create).toHaveBeenCalledWith(expect.objectContaining({id:ticket,email:'pupil.family123@children.domashka.invalid',password,email_confirm:true}));
        expect(s.update).not.toHaveBeenCalled();
      } else {
        expect(s.signin).toHaveBeenCalledWith({email:'parent@parents.domashka.invalid',password:base.parentPassword,options:{captchaToken:base.captchaToken}});
        expect(s.update).toHaveBeenCalledWith(child,{password,app_metadata:{domashka_reset_ticket:ticket}});
        expect(s.signout).toHaveBeenCalledWith({scope:'local'});expect(s.create).not.toHaveBeenCalled();
      }
    });
  });
}
