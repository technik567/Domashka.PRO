// Explicit, read-only diagnostics: metadata GET + CORS OPTIONS only.
// No inference, upload, search POST, Supabase access, credentials or retry.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ORIGIN = 'https://gentle-fog-7c3b.jr-polyakoff.workers.dev';
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/public-demos.json'), 'utf8'));
export const TARGETS = Object.freeze([
  {id:'qwen-3.5', host:'https://qwen-qwen3-5-omni-offline-demo.hf.space', apiName:'chat_predict'},
  {id:'qwen-2.5-vl', host:'https://developer0hye-qwen2-5-vl-7b-instruct.hf.space', apiName:'qwen_vl_inference'},
  ...catalog.models.map(({id,host,apiName})=>({id,host,apiName})),
  {id:'qwen3-demo', host:'https://qwen-qwen3-demo.hf.space', apiName:'add_message'},
  {id:'pollinations', host:'https://text.pollinations.ai', preflight:'/openai'},
  {id:'tavily-direct', host:'https://api.tavily.com', preflight:'/search', headers:'content-type,x-tavily-access-mode'},
]);

function cors(headers, requestedHeaders) {
  const origin = headers.get('access-control-allow-origin') || '';
  const methods = (headers.get('access-control-allow-methods') || '').toUpperCase().split(/\s*,\s*/);
  const allowed = (headers.get('access-control-allow-headers') || '').toLowerCase().split(/\s*,\s*/);
  return {origin:origin==='*'?'wildcard':origin===ORIGIN?'match':origin?'other':'missing',
    post:methods.includes('POST') || methods.includes('*'),
    headers:requestedHeaders.split(',').every(h=>allowed.includes(h) || allowed.includes('*'))};
}
async function readJson(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('metadata');
  let text = '', size = 0;
  try {
    const decoder = new TextDecoder();
    while (true) {
      signal.throwIfAborted();
      const {value,done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1000000) throw new Error('metadata');
      text += decoder.decode(value,{stream:true});
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.cancel().catch(()=>{}); }
}
export async function probeTarget(target, fetchImpl = fetch) {
  if (!TARGETS.some(item=>item.id===target.id && item.host===target.host && item.apiName===target.apiName && item.preflight===target.preflight && item.headers===target.headers)) throw new Error('Only the fixed public metadata targets are permitted.');
  const report = {id:target.id, host:target.host, inference:'not-tested'};
  const headers = target.headers || 'content-type';
  const checks = target.apiName ? [
    {name:'metadata', method:'GET', url:`${target.host}/gradio_api/info`},
    {name:'preflight', method:'OPTIONS', url:`${target.host}/gradio_api/call/${target.apiName}`},
  ] : [{name:'preflight',method:'OPTIONS',url:target.host+target.preflight}];
  for (const check of checks) {
    const signal = AbortSignal.timeout(10000), started = Date.now();
    let response;
    try {
      response = await fetchImpl(check.url, {method:check.method, redirect:'manual', credentials:'omit', signal,
        headers:{Origin:ORIGIN, ...(check.method==='OPTIONS'?{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':headers}:{})}});
      const result = {status:response.status, elapsedMs:Date.now()-started, cors:cors(response.headers,headers)};
      report[check.name] = result;
      if (response.status >= 300 && response.status < 400) {
        // A redirect is evidence, not permission to follow it or send cookies.
        result.redirect = true;
        try { result.redirectHost = new URL(response.headers.get('location'),target.host).hostname; } catch { /* no raw header */ }
      }
      if (check.name==='metadata' && response.ok) {
        const data = await readJson(response,signal);
        const named = data?.named_endpoints;
        result.validApiMetadata = Boolean(named && typeof named==='object' && !Array.isArray(named));
        result.apiFound = result.validApiMetadata && Object.hasOwn(named,`/${target.apiName}`);
        // Never copy provider defaults, prompts or full response bodies.
      }
    } catch (error) {
      report[check.name] = {...report[check.name], error:signal.aborted?'timeout':response?'invalid-metadata':'transport', elapsedMs:Date.now()-started};
    } finally { response?.body?.cancel().catch(()=>{}); }
  }
  return report;
}
export async function probeAll(fetchImpl = fetch) {
  const report = {schemaVersion:1, checkedAt:new Date().toISOString(), origin:ORIGIN,
    scope:'Public GET metadata and OPTIONS only; NOT inference, phone/browser acceptance or Supabase deployment.', targets:[]};
  for (const target of TARGETS) report.targets.push(await probeTarget(target,fetchImpl));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).join(' ') !== '--run-metadata') {
    console.error('No requests made. Explicit opt-in: node scripts/probe_ai_network.mjs --run-metadata');
    process.exitCode = 2;
  } else {
    const report = await probeAll();
    fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
    fs.writeFileSync(path.join(ROOT,'.cache/ai-network-report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
    // Readable via GitHub's checks API when artifact storage is unreachable.
    const safe = JSON.stringify(report).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
    console.log('::notice title=Public metadata and CORS report - NO INFERENCE::'+safe);
    // Reporting succeeded does NOT mean the providers, CORS or models work.
  }
}
