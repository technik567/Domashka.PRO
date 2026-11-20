import {describe,it,expect,vi} from 'vitest';
import {probeSearchWorkflow,inspectSearchResponse} from '../scripts/probe_search_workflow.mjs';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const reply=text=>new Response(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
const action='```domashka-search\n{"search":true,"queries":["NASA solar system planets"]}\n```';
const source={title:'NASA Solar System',url:'https://science.nasa.gov/solar-system/',content:'There are eight planets.'};
function handler(url,init){
  if(url==='https://api.tavily.com/search')return json({results:[source]});
  return reply(JSON.parse(init.body).messages[0].content.includes('ИНТЕРНЕТ ПО НЕОБХОДИМОСТИ')?action:'В Солнечной системе восемь планет [1].');
}
describe('bounded opt-in search workflow regression probe',()=>{
  it('runs the actual workflow and direct search transport with only two model calls and one keyless search',async()=>{
    const original=globalThis.fetch,transport=vi.fn(async(...args)=>handler(...args));
    const report=await probeSearchWorkflow(transport);
    expect(globalThis.fetch).toBe(original);expect(report).toMatchObject({status:'verified',searchAttempts:1,sourcesOnly:false,hasSearchFooter:true,workflow:{calls:2,searches:1,verified:0},sources:{hosts:['science.nasa.gov']}});
    expect(transport).toHaveBeenCalledTimes(3);expect(report.requests.map(row=>row.stage)).toEqual(['answer-or-search','search-1','answer']);
    for(const [url,init]of transport.mock.calls){expect(url).not.toMatch(/hf\.space|supabase|auth|gen\.pollinations/);expect(init.credentials).toBe('omit');expect(init.redirect).toBe('error');expect(init.headers.has('Authorization')).toBe(false);}
    expect(JSON.parse(transport.mock.calls[0][1].body)).toMatchObject({tool_choice:'none',stream:true});
    expect(JSON.parse(transport.mock.calls[2][1].body)).toMatchObject({tool_choice:'none',stream:true});
    const [,search]=transport.mock.calls[1];expect(search.headers.get('X-Tavily-Access-Mode')).toBe('keyless');expect(JSON.parse(search.body)).toMatchObject({query:'NASA solar system planets',include_answer:false,include_raw_content:false,safe_search:true});
    expect(JSON.stringify(report)).not.toMatch(/NASA solar system planets|eight planets|В Солнечной системе восемь/);
  });
  it('supports an empty standalone Node guest without inventing a cloud identity',async()=>{
    vi.stubGlobal('window',undefined);const report=await probeSearchWorkflow(async(...args)=>handler(...args));
    expect(report.status).toBe('verified');expect(globalThis.window).toBeUndefined();
  });
  it('does not call an ordinary memory answer a successful live search',async()=>{
    const transport=vi.fn(async()=>reply('Восемь планет.'));const report=await probeSearchWorkflow(transport);
    expect(report).toMatchObject({status:'not-verified',searchAttempts:0,hasSearchFooter:false});expect(transport).toHaveBeenCalledTimes(1);
  });
  it('stops after the first model refusal without another provider call',async()=>{
    const transport=vi.fn(async()=>json({error:'PRIVATE_PAYMENT_BODY'},402));const report=await probeSearchWorkflow(transport);
    expect(report).toMatchObject({status:'not-verified',errorCode:'pollinations-quota',httpStatus:402,stage:'answer-or-search',searchAttempts:0});expect(transport).toHaveBeenCalledTimes(1);expect(JSON.stringify(report)).not.toContain('PRIVATE');
  });
  it('stops after a real search failure instead of generating a fake sourced answer',async()=>{
    const transport=vi.fn(async(url,init)=>url.includes('tavily')?json({},429):handler(url,init));const report=await probeSearchWorkflow(transport);
    expect(report).toMatchObject({status:'not-verified',stage:'search-1',searchAttempts:1,httpStatus:429});expect(transport).toHaveBeenCalledTimes(2);
  });
  it('records sources-only separately from a verified AI answer, without retrying the refusal',async()=>{
    let modelCalls=0;const transport=vi.fn(async(url,init)=>url.includes('pollinations')&&++modelCalls===2?json({},503):handler(url,init));
    const report=await probeSearchWorkflow(transport);expect(report).toMatchObject({status:'sources-only',sourcesOnly:true,searchAttempts:1,workflow:{calls:2,searches:1}});expect(transport).toHaveBeenCalledTimes(3);
  });
  it('records a bad action without allowing secrets to reach the real search transport',async()=>{
    const transport=vi.fn(async()=>reply('{"search":true,"queries":["child@example.org"]}'));const report=await probeSearchWorkflow(transport);
    expect(report).toMatchObject({status:'not-verified',stage:'answer-or-search',searchAttempts:0});expect(transport).toHaveBeenCalledTimes(1);expect(JSON.stringify(report)).not.toContain('child@example');
  });
});


it('the separate response inspection makes only one call and reports no raw stream/error/query',async()=>{
  const original=globalThis.fetch,transport=vi.fn(async()=>new Response('data: {"error":{"message":"PRIVATE_SENTINEL rate_limit_exceeded"}}\n\n',{headers:{'Content-Type':'text/event-stream'}}));
  const report=await inspectSearchResponse(transport);expect(report).toMatchObject({kind:'pollinations-diagnostic',status:'not-verified',diagnostic:'upstream-quota'});
  expect(transport).toHaveBeenCalledTimes(1);expect(report.requests[0].status).toBe(200);expect(JSON.stringify(report)).not.toContain('PRIVATE_SENTINEL');expect(globalThis.fetch).toBe(original);
});
