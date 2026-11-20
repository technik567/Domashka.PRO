// The original keyless routes use the same bounded Gradio transport as newer
// demos. No new endpoints, credentials, paid fallback or quota bypass.
import {linkAbortSignals, throwIfAborted, fetchAbortable} from './network';
import {readPublicDemoJson, readPublicDemoStream, PublicDemoError, publicDemoError} from './publicDemos';
import config from '../../shared/legacy-gateways.json';
export {callPollinationsStream as callPollinationsGateway, POLLINATIONS_TIMEOUT_MS} from './pollinationsGateway';

export const LEGACY_QWEN_TIMEOUT_MS = config.qwenTimeoutMs;
// Qwen 2.5's public endpoint requires an actual, decodable image even for text.
// Keep the same checksummed PNG for JS/Python; regression tests inflate IDAT.
const BLANK_PNG = config.neutralImageDataUrl;
const HOSTS = {qwen35:'https://qwen-qwen3-5-omni-offline-demo.hf.space',qwen25:'https://developer0hye-qwen2-5-vl-7b-instruct.hf.space'};

function photo(dataUri) {
  if (typeof dataUri !== 'string' || dataUri.length > 20 * 1024 * 1024) throw new PublicDemoError('image');
  const match = dataUri.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) throw new PublicDemoError('image');
  let bytes;
  try { bytes = Uint8Array.from(atob(match[2]), char=>char.charCodeAt(0)); } catch { throw new PublicDemoError('image'); }
  if (!bytes.length) throw new PublicDemoError('image');
  return new Blob([bytes],{type:match[1].toLowerCase()});
}
function checkedAnswer(text) {
  if (typeof text !== 'string') throw new PublicDemoError('protocol');
  if (/^\s*(?:\[error\]|you have exceeded your|<span[^>]*color[^>]*red)/i.test(text)) {
    const error = publicDemoError(0,text);
    throw error.code==='protocol'?new PublicDemoError('upstream'):error;
  }
  return text;
}
export function qwen35Answer(data) {
  const raw = data?.[4], history = Array.isArray(raw)?raw:raw?.value;
  if (!Array.isArray(history)) throw new PublicDemoError('protocol');
  const last = history.at(-1);
  // A returned user message is not an assistant response. Also support the
  // Gradio component-update wrapper and typed text blocks, but never tools.
  if (!last || last.role !== 'assistant') throw new PublicDemoError('protocol');
  const value = last.content;
  const text = typeof value==='string' ? value : Array.isArray(value) ? value.map(block=>typeof block==='string'?block:block?.type==='text'?String(block.text ?? block.content ?? ''):'').filter(Boolean).join('\n') : null;
  return checkedAnswer(text);
}
async function gradio(kind, systemPrompt, messages, externalSignal, imageB64, onStatus) {
  throwIfAborted(externalSignal);
  const host = HOSTS[kind], name = kind==='qwen35'?'chat_predict':'qwen_vl_inference';
  const turns = (messages || []).filter(m=>['user','assistant'].includes(m.role)).map(m=>({role:m.role,content:String(m.content || '')}));
  if (!turns.length) throw new PublicDemoError('emptyInput');
  if (String(systemPrompt || '').length + JSON.stringify(turns).length > 48000) throw new PublicDemoError('context');
  const image = imageB64 ? photo(imageB64) : kind==='qwen25' ? photo(BLANK_PNG) : null;
  const {signal,cleanup} = linkAbortSignals(externalSignal,LEGACY_QWEN_TIMEOUT_MS);
  const request = (url,options={}) => fetchAbortable(url,{...options,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'},signal);
  try {
    let descriptor = null;
    if (image) {
      const form = new FormData(); form.append('files',image,image.type==='image/png'?'homework.png':'homework.jpg');
      const uploaded = await readPublicDemoJson(await request(`${host}/gradio_api/upload`,{method:'POST',body:form}),signal);
      const file = Array.isArray(uploaded) && uploaded.length===1 ? uploaded[0] : null;
      if (typeof file!=='string' || !file.startsWith('/') || file.startsWith('//') || file.length>2048 || file.split('/').includes('..') || /[\u0000\r\n]/.test(file)) throw new PublicDemoError('protocol');
      descriptor = {path:file,meta:{_type:'gradio.FileData'}};
    }
    const data = kind==='qwen35' ? [turns.at(-1).content,null,descriptor,null,turns.slice(0,-1).slice(-6),systemPrompt || '',0.35,0.85,20]
      : [descriptor,(imageB64?'Рассмотри само изображение, включая схемы и рисунки.':'Игнорируй пустой белый фон.')+`\n\n[Инструкция школьного учителя]:\n${systemPrompt}\n\n`+turns.slice(-12).map(m=>`${m.role==='assistant'?'Учитель':'Ученик'}: ${m.content}`).join('\n\n')];
    const session = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const base = `${host}/gradio_api/call/${name}`;
    const submitted = await readPublicDemoJson(await request(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data,session_hash:session})}),signal);
    if (typeof submitted?.event_id!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(submitted.event_id)) throw new PublicDemoError('protocol');
    const answer = await readPublicDemoStream(await request(`${base}/${submitted.event_id}`),signal,onStatus,
      (data,event)=>event==='generating' ? '' : kind==='qwen35'?qwen35Answer(data):checkedAnswer(data?.[0]));
    throwIfAborted(signal);
    return {text:answer,used:kind==='qwen35'?'Qwen 3.5 Omni (облачный шлюз)':'Qwen 2.5 VL (облачный шлюз)'};
  } catch (error) {
    if (externalSignal?.aborted) throw new DOMException('Запрос остановлен.','AbortError');
    if (signal.aborted || error?.name==='TimeoutError') throw new PublicDemoError('timeout');
    if (error instanceof PublicDemoError) throw error;
    throw new PublicDemoError(error instanceof TypeError?'network':'protocol');
  } finally { cleanup(); }
}
export const callQwen35Gateway = (prompt,messages,signal,image,onStatus)=>gradio('qwen35',prompt,messages,signal,image,onStatus);
export const callQwen25Gateway = (prompt,messages,signal,image,onStatus)=>gradio('qwen25',prompt,messages,signal,image,onStatus);
