// Explicit opt-in regression check for 4.7, synthetic public question only.
// At most TWO Pollinations generations + ONE real keyless Tavily search.
// Uses the actual workflow, streaming adapter and direct search transport.
// NOT hosted Auth/Supabase, phone/CORS verification or fresh-GPU proof.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAnswerWorkflow} from '../src/standalone/workflow.js';
import {callPollinationsStream} from '../src/standalone/pollinationsGateway.js';
import {runWebSearch} from '../src/standalone/webSearch.js';

export async function probeSearchWorkflow(fetchImpl=globalThis.fetch) {
  const report={schemaVersion:1,kind:'answer-or-search',checkedAt:new Date().toISOString(),status:'not-verified',
    scope:'Synthetic Node workflow, up to 2 Pollinations + 1 keyless Tavily. No Auth/Supabase/photos/keys/payment/retries; not browser CORS or physical phone.',requests:[],searchAttempts:0};
  const original=globalThis.fetch,originalWindow=globalThis.window,controller=new AbortController();
  // Node has no browser. An EMPTY standalone guest storage is sufficient for
  // the production direct-search transport's policy/subscription checks. No
  // cloud config/identity is supplied; never a hosted authorization bypass.
  if(!originalWindow)globalThis.window=Object.assign(new EventTarget(),{localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null}});
  let modelCalls=0,searchCalls=0;
  const deadline=setTimeout(()=>controller.abort(),270000);
  globalThis.fetch=async(url,init={})=>{
    const headers=new Headers(init.headers),model=url==='https://text.pollinations.ai/openai',search=url==='https://api.tavily.com/search';
    if((!model&&!search)||init.method!=='POST'||headers.has('authorization')||headers.has('cookie')||headers.has('payment-signature')||headers.has('x-payment'))throw Object.assign(new Error('Probe target refused.'),{code:'probe-target'});
    if(model?++modelCalls>2:++searchCalls>1)throw Object.assign(new Error('Probe budget exceeded.'),{code:'probe-budget'});
    if(search&&headers.get('x-tavily-access-mode')!=='keyless')throw Object.assign(new Error('Keyless only.'),{code:'probe-keyless'});
    headers.set('Origin','https://gentle-fog-7c3b.jr-polyakoff.workers.dev');
    const record={stage:model?(modelCalls===1?'answer-or-search':'answer'):'search-1',status:0,headersReceived:false};
    report.requests.push(record);const started=Date.now();
    const response=await fetchImpl(url,{...init,headers});
    Object.assign(record,{status:response.status,headersReceived:true,headersElapsedMs:Date.now()-started,contentType:(response.headers.get('content-type')||'').split(';')[0]});
    return response;
  };
  try{
    const output=await runAnswerWorkflow({options:{provider:'builtin',model:'pollinations',webSearch:'auto',reasoning:'off',allowLocalFallback:false,signal:controller.signal},
      messages:[{role:'user',content:'Найди официальный источник NASA о количестве планет в Солнечной системе. Используй веб-поиск, ответь одним коротким предложением со ссылкой на найденный источник.'}],
      systemPrompt:'Ты учитель. Это безличный тест поиска. Нужен краткий ответ по-русски, с источником только из реально полученных выдержек.',
      request:args=>callPollinationsStream(args.systemPrompt,args.messages,args.signal,undefined,args.onStatus),
      search:async(query,args)=>{report.searchAttempts++;const data=await runWebSearch(query,args);report.sources={count:data.results.length,hosts:data.results.map(row=>new URL(row.url).hostname)};return data;},contextLimit:48000});
    report.workflow={calls:output.workflow.calls,searches:output.workflow.searches,verified:output.workflow.verified,elapsedMs:output.workflow.elapsedMs};
    report.answerLength=output.text.length;report.sourcesOnly=output.sourcesOnly===true;
    report.expectedAnswerFound=/восемь|восьми|(?:^|\D)8(?:\D|$)/i.test(output.text);
    report.hasSearchFooter=output.text.includes('Источники поиска');
    if(report.sourcesOnly)report.status='sources-only';
    else if(modelCalls===2&&searchCalls===1&&report.searchAttempts===1&&output.workflow.searches===1&&report.expectedAnswerFound&&report.hasSearchFooter)report.status='verified';
  }catch(error){
    const code=String(error.code||error.name||'failure');report.errorCode=/^[a-zA-Z0-9_-]{1,60}$/.test(code)?code:'failure';
    report.httpStatus=Number.isInteger(error.status)?error.status:0;
    report.stage=['answer-or-search','answer','search-1'].includes(error.stage)?error.stage:'unknown';
  }finally{
    clearTimeout(deadline);controller.abort();globalThis.fetch=original;
    if(!originalWindow)delete globalThis.window;
  }
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.slice(2).join(' ')!=='--run-live'){
    console.error('No requests made. Explicit --run-live permits at most 2 synthetic Pollinations calls + 1 keyless Tavily search.');process.exitCode=2;
  }else{
    const report=await probeSearchWorkflow();fs.mkdirSync('.cache',{recursive:true});
    fs.writeFileSync('.cache/search-workflow-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
    if(process.env.GITHUB_ACTIONS)console.log('::notice title=Synthetic search workflow - NO PERSONAL DATA::'+JSON.stringify(report).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));
    if(report.status!=='verified')process.exitCode=1;
  }
}
