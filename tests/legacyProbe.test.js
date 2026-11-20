import {describe,it,expect,vi} from 'vitest';
import {probeLegacyRoutes} from '../scripts/probe_legacy_routes.mjs';
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
const stream=value=>new Response(value,{headers:{'Content-Type':'text/event-stream','Access-Control-Allow-Origin':'*'}});
const gradio=data=>stream(`event: complete\ndata: ${JSON.stringify(data)}\n\n`);
function handler(url,init={}){
  if(url.includes('text.pollinations.ai')){const prompt=JSON.parse(init.body).messages.at(-1).content;return stream(`data: ${JSON.stringify({choices:[{delta:{content:prompt.includes('3 + 3')?'6':'4'},finish_reason:'stop'}]})}\n\n`);}
  if(url.endsWith('/upload'))return json(['/tmp/synthetic-white.png']);
  if(init.method==='POST')return json({event_id:'fixture'});
  return gradio(url.includes('qwen3-5')?[null,null,null,null,[{role:'assistant',content:'4'}]]:['4']);
}
describe('explicit narrow legacy integration probe',()=>{
  it('uses only synthetic prompts and one valid neutral image on the fixed routes; no search or credentials',async()=>{
    const original=globalThis.fetch,transport=vi.fn(async(...args)=>handler(...args));
    const report=await probeLegacyRoutes(transport);expect(globalThis.fetch).toBe(original);
    expect(report.routes.map(r=>r.status)).toEqual(['reply-verified','reply-verified','reply-verified','reply-verified']);
    expect(transport).toHaveBeenCalledTimes(7);
    for(const [url,init]of transport.mock.calls){expect(url).not.toMatch(/supabase|tavily|gen\.pollinations/);expect(init.headers.get('Origin')).toBe('https://gentle-fog-7c3b.jr-polyakoff.workers.dev');expect([...init.headers.keys()].some(name=>/authorization|cookie|payment|forwarded/i.test(name))).toBe(false);}
    const posts=transport.mock.calls.filter(([url])=>url.includes('text.pollinations.ai'));
    expect(posts).toHaveLength(2);for(const [,init]of posts)expect(JSON.parse(init.body).stream).toBe(true);
    expect(JSON.stringify(report)).not.toContain('synthetic-white.png');expect(JSON.stringify(report)).not.toContain('What is');
  });
  it('does not send a second Pollinations pass after a payment/quota refusal',async()=>{
    const transport=vi.fn(async(url,init)=>url.includes('text.pollinations.ai')?new Response('PRIVATE',{status:402}):handler(url,init));
    const report=await probeLegacyRoutes(transport);
    expect(report.routes[2]).toMatchObject({status:'not-verified',httpStatus:402,errorCode:'pollinations-quota'});
    expect(report.routes[3].status).toBe('not-tested');expect(transport.mock.calls.filter(([url])=>url.includes('text.pollinations.ai'))).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
  });
  it('records a Gradio hidden error honestly and never retries that endpoint',async()=>{
    const transport=vi.fn(async(url,init)=>url.includes('qwen3-5')&&init.method!=='POST'?stream('event: error\ndata: null\n\n'):handler(url,init));
    const report=await probeLegacyRoutes(transport);expect(report.routes[0]).toMatchObject({status:'not-verified',errorCode:'upstream'});
    expect(transport.mock.calls.filter(([url])=>url.includes('qwen3-5'))).toHaveLength(2);
    expect(report.routes[0].requests.map(r=>r.stage)).toEqual(['submit','stream']);
  });
});
