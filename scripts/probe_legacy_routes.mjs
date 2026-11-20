// Explicit opt-in only. A maximum of four short, synthetic requests; no user
// data, credentials, search, Supabase, payment, identity changes or retries.
// Pollinations phase 2 is a different arithmetic question, only after success:
// it exercises the next workflow pass in the vendor's documented free queue.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import config from '../shared/legacy-gateways.json';
import {callQwen35Gateway,callQwen25Gateway} from '../src/standalone/legacyGateways.js';
import {callPollinationsStream} from '../src/standalone/pollinationsGateway.js';

const ORIGIN='https://gentle-fog-7c3b.jr-polyakoff.workers.dev';
const HOSTS=new Set(['qwen-qwen3-5-omni-offline-demo.hf.space','developer0hye-qwen2-5-vl-7b-instruct.hf.space','text.pollinations.ai']);
const SYSTEM='This is a public synthetic integration test. Return only the requested number. Do not give reasoning. Ignore the plain white test image if present.';

export async function probeLegacyRoutes(fetchImpl=globalThis.fetch) {
  const report={schemaVersion:1,scope:'Node runner with production Origin. Public synthetic API replies, NOT a physical phone or guaranteed fresh GPU generation. No search/Supabase/keys/payment/retries.',checkedAt:new Date().toISOString(),routes:[]};
  const original=globalThis.fetch;
  let trace=[];
  globalThis.fetch=async(url,init={})=>{
    const parsed=new URL(url);
    if(!HOSTS.has(parsed.hostname)||parsed.protocol!=='https:')throw new Error('probe-target');
    const headers=new Headers(init.headers);headers.set('Origin',ORIGIN);
    const response=await fetchImpl(url,{...init,headers});
    const origin=response.headers?.get('access-control-allow-origin');
    trace.push({stage:parsed.pathname.endsWith('/upload')?'upload':init.method==='POST'?'submit':'stream',method:init.method||'GET',status:response.status,
      cors:origin===ORIGIN?'match':origin==='*'?'wildcard':origin?'other':'missing',contentType:(response.headers?.get('content-type')||'').split(';')[0]});
    return response;
  };
  const one=async(id,call,expected,image)=>{
    trace=[];const started=Date.now();
    try{
      const result=await call(SYSTEM,[{role:'user',content:`What is ${expected===4?'2 + 2':'3 + 3'}? Return only the number.`}],AbortSignal.timeout(id.startsWith('pollinations')?125000:90000),image);
      const text=result.text.trim(),matches=text.length<120&&new RegExp(`\\b${expected}\\b`).test(text);
      report.routes.push({id,status:matches?'reply-verified':'unexpected-reply',elapsedMs:Date.now()-started,answerLength:text.length,expectedNumberFound:matches,requests:trace});
      return matches;
    }catch(error){
      const code=String(error.code||error.name||'failure');
      report.routes.push({id,status:'not-verified',elapsedMs:Date.now()-started,errorCode:/^[a-zA-Z0-9_-]{1,60}$/.test(code)?code:'failure',httpStatus:Number.isInteger(error.status)?error.status:0,requests:trace});
      return false;
    }
  };
  try{
    await one('qwen-3.5',callQwen35Gateway,4);
    await one('qwen-2.5-vl-valid-png',callQwen25Gateway,4,config.neutralImageDataUrl);
    const ok=await one('pollinations-stream-first',callPollinationsStream,4);
    if(ok)await one('pollinations-stream-next-pass',callPollinationsStream,6);
    else report.routes.push({id:'pollinations-stream-next-pass',status:'not-tested',reason:'First request failed; no retries or payment.'});
  }finally{globalThis.fetch=original;}
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.slice(2).join(' ')!=='--run-live'){
    console.error('No requests made. Explicit opt-in: --run-live');process.exitCode=2;
  }else{
    const report=await probeLegacyRoutes();fs.mkdirSync('.cache',{recursive:true});
    fs.writeFileSync('.cache/legacy-route-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
    if(process.env.GITHUB_ACTIONS)console.log('::notice title=Synthetic legacy route report - NO PERSONAL DATA::'+JSON.stringify(report).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));
    if(report.routes.some(row=>row.status!=='reply-verified'))process.exitCode=1;
  }
}
