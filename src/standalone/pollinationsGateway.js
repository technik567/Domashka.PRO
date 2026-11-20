// The vendor's legacy origin explicitly queues stream:true requests through
// the same free 45s/IP slot. Never sign/pay a 402 challenge or retry a refusal.
// Source: pollinations/pollinations, master, text.pollinations.ai/cloudflare-cache/src/origin.js
import config from '../../shared/legacy-gateways.json';
import { fetchAbortable, linkAbortSignals, throwIfAborted, withAbort } from './network';

export const POLLINATIONS_TIMEOUT_MS = config.pollinationsTimeoutMs;
export const POLLINATIONS_MODEL = config.pollinationsModel;
const ENDPOINT = 'https://text.pollinations.ai/openai';
const MAX_RESPONSE = 2_000_000;
const MAX_EVENT = 100_000;
const cancel = body => { try { Promise.resolve(body?.cancel()).catch(() => {}); } catch { /* already closed */ } };

export class PollinationsError extends Error {
  constructor(code, status = 0, retryAfterSeconds = 0) {
    const http = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 0;
    const wait = Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0 && retryAfterSeconds <= 3600 ? retryAfterSeconds : 0;
    const messages = {
      network: 'Браузер не получил ответ от Pollinations. По этой ошибке нельзя отличить CORS, обрыв сети и недоступность сервиса.',
      timeout: 'Pollinations не завершил очередь и ответ за 2 минуты. Ожидание остановлено; сервер мог уже принять запрос.',
      auth: 'Pollinations не разрешил анонимный запрос. Ключи других провайдеров сюда не передаются.',
      quota: 'Pollinations отказал в бесплатном запросе. Возможны занятый бесплатный интервал или лимит сервиса; платный режим не включается.',
      unavailable: 'Pollinations временно недоступен или перегружен.',
      protocol: 'Pollinations вернул неподдерживаемый ответ.',
      incomplete: 'Поток Pollinations оборвался до завершения. Неполный ответ не принят.',
      empty: 'Pollinations завершил запрос без текста ответа.',
      context: 'Задание и история превышают безопасный объём этого подключения. Сократите задание или начните новый диалог.',
    };
    super(`${messages[code] || messages.protocol}${http ? ` HTTP ${http}.` : ''}${wait ? ` Сервис просит подождать не менее ${wait} с.` : ''} Автоматического повтора и оплаты нет.`);
    this.name = 'PollinationsError'; this.code = `pollinations-${code}`; this.status = http; this.retryAfterSeconds = wait;
  }
}
function statusError(response) {
  const status = response.status;
  const delay = Number(response.headers?.get('retry-after'));
  return new PollinationsError([401, 403].includes(status) ? 'auth' : [402, 429].includes(status) ? 'quota'
    : status >= 500 ? 'unavailable' : 'protocol', status, delay);
}

// Final answer text only: private reasoning/tool deltas are neither returned,
// sent to callbacks, persisted, nor passed to a later workflow stage.
export async function readPollinationsResponse(response, signal, onStatus) {
  let answer = '', complete = false, reason = '', pending = '', size = 0;
  function consume(data, json = false) {
    if (!data || typeof data !== 'object' || data.error) throw new PollinationsError('protocol');
    const choice = data.choices?.[0];
    if (!choice) { if (json) throw new PollinationsError('protocol'); return; }
    const value = json ? choice.message?.content : choice.delta?.content;
    if (typeof value === 'string') {
      answer += value;
      if (answer.length > MAX_EVENT) throw new PollinationsError('protocol');
      if (value) onStatus?.({stage:'streaming', receivedChars:answer.length, message:'Pollinations формирует текст ответа…'});
    }
    if (choice.finish_reason) {
      reason = choice.finish_reason;
      if (!['stop', 'length'].includes(reason)) throw new PollinationsError('protocol');
      complete = true;
    }
    if (json) complete = true;
  }
  function event(block) {
    if (complete || !block.trim()) return;
    if (block.length > MAX_EVENT) throw new PollinationsError('protocol');
    const raw = block.replace(/^\uFEFF/, '').split('\n').filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!raw) return; // comments/heartbeats are not completions
    if (raw === '[DONE]') { complete = true; return; }
    let data;
    try { data = JSON.parse(raw); } catch { throw new PollinationsError('protocol'); }
    consume(data);
  }
  const type = response.headers?.get('content-type') || '';
  const isJson = type.includes('application/json');
  if (!isJson && !type.includes('text/event-stream')) throw new PollinationsError('protocol');
  if (Number(response.headers?.get('content-length')) > MAX_RESPONSE) throw new PollinationsError('protocol');
  function chunk(text, final = false) {
    throwIfAborted(signal);
    size += text.length;
    if (size > MAX_RESPONSE) throw new PollinationsError('protocol');
    pending += text;
    if (isJson) {
      if (final) {
        let data;
        try { data = JSON.parse(pending); } catch { throw new PollinationsError('protocol'); }
        consume(data, true); pending = '';
      }
      return;
    }
    let delimiter;
    while (!complete && (delimiter = /\r?\n\r?\n/.exec(pending))) {
      event(pending.slice(0, delimiter.index).replace(/\r\n/g, '\n'));
      pending = pending.slice(delimiter.index + delimiter[0].length);
    }
    if (!complete && pending.length > MAX_EVENT) throw new PollinationsError('protocol');
    if (final && !complete && pending.trim()) event(pending.replace(/\r\n/g, '\n'));
  }
  const reader = response.body?.getReader();
  try {
    if (reader) {
      const decoder = new TextDecoder();
      while (!complete) {
        const next = await withAbort(reader.read(), signal);
        if (next.done) { chunk(decoder.decode(), true); break; }
        chunk(decoder.decode(next.value, {stream:true}));
      }
    } else chunk(await withAbort(response.text(), signal), true);
    throwIfAborted(signal);
    if (!complete) throw new PollinationsError('incomplete');
    if (!answer.trim()) throw new PollinationsError('empty');
    if (reason === 'length') answer += '\n\n> Ответ ограничен длиной модели и может быть неполным. Попросите продолжить или разделите задание.';
    return answer;
  } finally {
    cancel(reader);
    try { reader?.releaseLock(); } catch { /* older WebView */ }
  }
}

export async function callPollinationsStream(systemPrompt, messages, externalSignal, _image, onStatus) {
  throwIfAborted(externalSignal);
  const turns = (messages || []).filter(m => ['user','assistant'].includes(m?.role))
    .map(m => ({role:m.role, content:String(m.content || '')})).slice(-8);
  if (!turns.length) throw new PollinationsError('empty');
  if (String(systemPrompt || '').length + JSON.stringify(turns).length > 48000) throw new PollinationsError('context');
  const {signal, cleanup} = linkAbortSignals(externalSignal, POLLINATIONS_TIMEOUT_MS);
  let response;
  try {
    onStatus?.({stage:'cloud', message:'Pollinations: ожидаем бесплатную очередь и ответ, до 2 минут. Можно остановить ожидание.'});
    response = await fetchAbortable(ENDPOINT, {
      method:'POST', credentials:'omit', referrerPolicy:'no-referrer', redirect:'error',
      headers:{'Content-Type':'application/json', Accept:'text/event-stream'},
      body:JSON.stringify({model:POLLINATIONS_MODEL, messages:[{role:'system',content:String(systemPrompt || '')}, ...turns],
        stream:true, temperature:0.35}),
    }, signal);
    if (!response.ok) throw statusError(response);
    const text = await readPollinationsResponse(response, signal, onStatus);
    return {text, used:'Pollinations · openai-fast (бесплатный потоковый маршрут)'};
  } catch (error) {
    throwIfAborted(externalSignal);
    if (signal.aborted || error?.name === 'TimeoutError') throw new PollinationsError('timeout');
    if (error instanceof PollinationsError) throw error;
    throw new PollinationsError(error instanceof TypeError ? 'network' : 'protocol');
  } finally { cancel(response?.body); cleanup(); }
}
