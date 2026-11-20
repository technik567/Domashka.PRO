import {describe,it,expect,vi} from 'vitest';
import {TARGETS,ORIGIN,probeTarget,probeAll} from '../scripts/probe_ai_network.mjs';
const response=(data,status=200,headers={})=>new Response(status===204?null:JSON.stringify(data),{status,headers});
describe('explicit metadata diagnostics, never a model/search request',()=>{
  it('does nothing merely by importing the diagnostic module',()=>{expect(fetch).not.toHaveBeenCalled();});
  it('requests metadata and preflight only, without credentials or Supabase',async()=>{
    const f=vi.fn(async()=>response({named_endpoints:{'/chat_predict':{}}},200,{'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Content-Type'}));
    const r=await probeTarget(TARGETS[0],f);expect(r.metadata.apiFound).toBe(true);expect(r.preflight.cors).toEqual({origin:'match',post:true,headers:true});expect(r.inference).toBe('not-tested');
    expect(f.mock.calls.map(([,init])=>init.method)).toEqual(['GET','OPTIONS']);
    for(const [url,init] of f.mock.calls){expect(init.credentials).toBe('omit');expect(init.redirect).toBe('manual');expect(init.body).toBeUndefined();expect(init.headers.Authorization).toBeUndefined();expect(init.headers.apikey).toBeUndefined();expect(url).not.toContain('supabase');}
  });
  it('does not make generation/search requests even when every preflight works',async()=>{
    const f=vi.fn(async()=>response({named_endpoints:{}}));const r=await probeAll(f);expect(r.targets).toHaveLength(TARGETS.length);
    expect(f.mock.calls.every(([url,init])=>init.method==='OPTIONS'||init.method==='GET'&&url.endsWith('/gradio_api/info'))).toBe(true);
    expect(f.mock.calls.filter(([url])=>url.includes('tavily'))).toHaveLength(1);expect(f.mock.calls.filter(([url])=>url.includes('pollinations'))).toHaveLength(1);
  });
  it('records HTTP failures and missing CORS without echoing bodies or retrying',async()=>{
    const f=vi.fn(async()=>response({private:'SECRET_SENTINEL'},503));const r=await probeTarget(TARGETS[0],f);expect(r.metadata.status).toBe(503);expect(r.preflight.cors.origin).toBe('missing');expect(JSON.stringify(r)).not.toContain('SECRET_SENTINEL');expect(f).toHaveBeenCalledTimes(2);
  });
  it('never follows redirects or publishes their credential-bearing URL',async()=>{
    const f=vi.fn(async()=>response({},302,{location:'https://login.example/?token=PRIVATE_SENTINEL'}));const r=await probeTarget(TARGETS[0],f);expect(r.metadata.redirectHost).toBe('login.example');expect(JSON.stringify(r)).not.toContain('PRIVATE_SENTINEL');expect(f).toHaveBeenCalledTimes(2);
  });
  it('refuses arbitrary URLs before any network request',async()=>{const f=vi.fn();await expect(probeTarget({...TARGETS[0],host:'http://127.0.0.1'},f)).rejects.toThrow(/fixed/);expect(f).not.toHaveBeenCalled();});
  it('redacts transport errors and invalid metadata without guessing their cause',async()=>{
    const f=vi.fn().mockRejectedValueOnce(new Error('private SENTINEL')).mockResolvedValueOnce(response({},204));const r=await probeTarget(TARGETS[0],f);expect(r.metadata.error).toBe('transport');expect(JSON.stringify(r)).not.toContain('SENTINEL');
  });
});
