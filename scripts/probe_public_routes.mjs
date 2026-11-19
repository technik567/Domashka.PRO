// Explicit opt-in only. Costs anonymous provider quota, never uses personal keys.
// Bundle with esbuild for Node's ESM resolution before running --run-live.
import fs from 'node:fs';
import {callQwenDemo, QWEN_DEMO_MODELS} from '../src/standalone/qwenDemo.js';
if (!process.argv.includes('--run-live')) {
  console.error('Not run. Pass --run-live only to authorize public synthetic requests.');
  process.exit(2);
}
const report={environment:'Node runner, NOT browser CORS or physical phone',startedAt:new Date().toISOString(),models:[],search:null};
let blocked=false;
for (const model of QWEN_DEMO_MODELS) {
  if (blocked) {report.models.push({id:model.id,status:'not-tested',reason:'Shared host failed; no quota/auth/network retries.'});continue;}
  const start=Date.now();
  try {
    const result=await callQwenDemo({model:model.id,reasoning:'off',systemPrompt:'Answer the public synthetic arithmetic test in one short line. No personal data is involved.',messages:[{role:'user',content:'What is 2 + 2? Return the number only.'}],signal:AbortSignal.timeout(60000)});
    const pass=/\b4\b/.test(result.text) && result.text.length<1000;
    report.models.push({id:model.id,status:pass?'reply-verified':'unexpected-reply',elapsedMs:Date.now()-start,reply:result.text.slice(0,120)});
    if(!pass)blocked=true;
  } catch(error) {
    report.models.push({id:model.id,status:'not-verified',elapsedMs:Date.now()-start,errorCode:error.code || error.name});
    // Same host, not five independent quotas. No login, proxy or paid fallback.
    blocked=true;
  }
}
try {
  const response=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json','X-Tavily-Access-Mode':'keyless'},body:JSON.stringify({query:'NASA solar system planets',search_depth:'basic',max_results:1,topic:'general',auto_parameters:false,include_answer:false,include_raw_content:false,include_images:false,safe_search:true}),signal:AbortSignal.timeout(22000),redirect:'error'});
  if(!response.ok){response.body?.cancel().catch(()=>{});report.search={status:'not-verified',http:response.status};}
  else {
    const body=await response.json();const first=body.results?.find(row=>/^https?:\/\//.test(row?.url));
    report.search={status:first?'results-verified':'empty-result',http:response.status,source:first?.url?.slice(0,300)};
  }
}catch(error){report.search={status:'not-verified',errorCode:error.name};}
fs.mkdirSync('.cache',{recursive:true});fs.writeFileSync('.cache/public-smoke.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(process.env.GITHUB_ACTIONS)console.log('::notice title=Public route smoke report::'+JSON.stringify(report).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));
if(report.models.some(model=>model.status!=='reply-verified') || report.search.status!=='results-verified')process.exitCode=1;
