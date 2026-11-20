import {describe,it,expect,vi} from 'vitest';
import {probeSearchWorkflow,inspectSearchResponse} from '../scripts/probe_search_workflow.mjs';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const reply=text=>new Response(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
const source={title:'NASA Solar System',url:'https://science.nasa.gov/solar-system/',content:'There are eight planets.'};
function handler(url){
  if(url==='https://api.tavily.com/search')return json({results:[source]});
  return reply('В Солнечной системе восемь планет [1].');
}
describe('bounded opt-in independent search-first regression probe',()=>{
  it('runs one actual keyless search BEFORE a single model call, with no planning generation',async()=>{
    const original=globalThis.fetch,transport=vi.fn(async(...args)=>handler(...args));
    const report=await probeSearchWorkflow(transport);
    expect(globalThis.fetch).toBe(original);expect(report).toMatchObject({kind:'local-search-first',schemaVersion:2,status:'verified',searchAttempts:1,sourcesOnly:false,hasSearchFooter:true,workflow:{calls:1,searches:1,verified:0},sources:{hosts:['science.nasa.gov']}});
    expect(transport).toHaveBeenCalledTimes(2);expect(report.requests.map(row=>row.stage)).toEqual(['search-1','answer']);
    for(const [url,init]of transport.mock.calls){expect(url).not.toMatch(/hf\.space|supabase|auth|gen\.pollinations/);expect(init.credentials).toBe('omit');expect(init.redirect).toBe('error');expect(init.headers.has('Authorization')).toBe(false);}
    const model=JSON.parse(transport.mock.calls[1][1].body);expect(model).toMatchObject({tool_choice:'none',stream:true});
    expect(model.messages[0].content).toContain('ПОИСКОВЫЕ ДАННЫЕ');expect(model.messages[0].content).not.toContain('ИНТЕРНЕТ ПО НЕОБХОДИМОСТИ');
    const [,search]=transport.mock.calls[0];expect(search.headers.get('X-Tavily-Access-Mode')).toBe('keyless');
    expect(JSON.parse(search.body)).toMatchObject({query:'официальный NASA количестве планет Солнечной системе',include_answer:false,include_raw_content:false,safe_search:true});
    expect(JSON.stringify(report)).not.toMatch(/официальный NASA|eight planets|В Солнечной системе восемь/);
  });
  it('does not accept a source-title fact as if the model answered the question',async()=>{
    const transport=vi.fn(async url=>url.includes('tavily')?json({results:[{...source,title:'Восемь планет'}]}):reply('Не знаю.'));
    const report=await probeSearchWorkflow(transport);expect(report).toMatchObject({status:'not-verified',hasSearchFooter:true,expectedAnswerFound:false});expect(transport).toHaveBeenCalledTimes(2);
  });
  it('supports an empty standalone Node guest without inventing a cloud identity',async()=>{
    vi.stubGlobal('window',undefined);const report=await probeSearchWorkflow(async(...args)=>handler(...args));
    expect(report.status).toBe('verified');expect(globalThis.window).toBeUndefined();
  });
  it('does not call an ordinary memory answer from the wrong endpoint a successful search',async()=>{
    const transport=vi.fn(async()=>reply('Восемь планет.'));const report=await probeSearchWorkflow(transport);
    expect(report).toMatchObject({status:'not-verified',stage:'search-1',searchAttempts:1});expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe('https://api.tavily.com/search');
  });
  it('retains actual sources after the FIRST model refusal without another provider call',async()=>{
    const transport=vi.fn(async url=>url.includes('pollinations')?json({error:'PRIVATE_PAYMENT_BODY'},402):handler(url));
    const report=await probeSearchWorkflow(transport);
    expect(report).toMatchObject({status:'sources-only',errorCode:'pollinations-quota',httpStatus:402,stage:'answer',searchAttempts:1,workflow:{calls:1,searches:1}});
    expect(transport).toHaveBeenCalledTimes(2);expect(JSON.stringify(report)).not.toContain('PRIVATE');
  });
  it('stops after a real search failure BEFORE spending any model quota',async()=>{
    const transport=vi.fn(async url=>url.includes('tavily')?json({},429):handler(url));const report=await probeSearchWorkflow(transport);
    expect(report).toMatchObject({status:'not-verified',stage:'search-1',searchAttempts:1,httpStatus:429});expect(transport).toHaveBeenCalledTimes(1);
  });
  it('records sources-only separately from a verified AI answer, without retrying the refusal',async()=>{
    const transport=vi.fn(async url=>url.includes('pollinations')?json({},503):handler(url));
    const report=await probeSearchWorkflow(transport);expect(report).toMatchObject({status:'sources-only',sourcesOnly:true,searchAttempts:1,workflow:{calls:1,searches:1}});expect(transport).toHaveBeenCalledTimes(2);
  });
  it('never forwards a model search action/secret as a second query or launches a repair generation',async()=>{
    const transport=vi.fn(async url=>url.includes('pollinations')?reply('{"search":true,"queries":["child@example.org"]}'):handler(url));
    const report=await probeSearchWorkflow(transport);
    expect(report).toMatchObject({status:'sources-only',searchAttempts:1});expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(report)).not.toContain('child@example');expect(transport.mock.calls[0][1].body).not.toContain('child@example');
  });
});

it.each([probeSearchWorkflow,inspectSearchResponse])('does not publish arbitrary provider content-type text in reports',async probe=>{
  const transport=vi.fn(async()=>new Response('PRIVATE_BODY',{headers:{'Content-Type':'private/SECRET_SENTINEL'}}));
  const report=await probe(transport);
  expect(report.requests[0].contentType).toBe('other');expect(transport).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(report)).not.toMatch(/PRIVATE_BODY|SECRET_SENTINEL/);
});

it('separate response inspection makes only one arithmetic call and reports no raw stream/error/query',async()=>{
  const original=globalThis.fetch,transport=vi.fn(async()=>new Response('data: {"error":{"message":"PRIVATE_SENTINEL rate_limit_exceeded"}}\n\n',{headers:{'Content-Type':'text/event-stream'}}));
  const report=await inspectSearchResponse(transport);expect(report).toMatchObject({kind:'pollinations-diagnostic',status:'not-verified',diagnostic:'upstream-quota'});
  expect(transport).toHaveBeenCalledTimes(1);expect(report.requests[0].status).toBe(200);expect(JSON.stringify(report)).not.toContain('PRIVATE_SENTINEL');expect(globalThis.fetch).toBe(original);
  expect(JSON.parse(transport.mock.calls[0][1].body).messages.at(-1).content).toBe('Сколько будет два плюс два?');
});
