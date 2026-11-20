export function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Запрос остановлен.', 'AbortError');
}

// Also bounds transports/readers that do not honor AbortSignal (older WebViews
// and test fixtures). Late resolutions are ignored, never replayed.
export function withAbort(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) {
    // The operation may already have started while evaluating the argument.
    // Observe its rejection even though this caller no longer awaits it.
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(signal.reason || new DOMException('Запрос остановлен.', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason || new DOMException('Запрос остановлен.', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) abort(); else resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

export function linkAbortSignals(externalSignal, timeoutMs = 0) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(externalSignal.reason || new DOMException('Запрос остановлен.', 'AbortError'));
  if (externalSignal?.aborted) onAbort();
  else externalSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = timeoutMs > 0
    ? setTimeout(() => controller.abort(new DOMException('Превышено время ожидания ответа.', 'TimeoutError')), timeoutMs)
    : null;
  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onAbort);
    },
  };
}

export const MAX_BUFFERED_RESPONSE_BYTES = 16_000_000;
const quietlyCancel = body => {
  // Broken readers may never settle their cancellation promise. Do not let
  // cancellation itself defeat the deadline, or leak an unhandled rejection.
  try { Promise.resolve(body?.cancel()).catch(() => {}); } catch { /* closed */ }
};
// Streaming users own the body reader/deadline. This helper still bounds
// header arrival and disposes a late body when fetch ignores cancellation.
export function fetchAbortable(url, options = {}, signal) {
  throwIfAborted(signal);
  const pending = Promise.resolve(fetch(url, { ...options, signal }));
  pending.then(late => { if (signal?.aborted) quietlyCancel(late?.body); }, () => {});
  return withAbort(pending, signal);
}
async function boundedBytes(response, signal) {
  const tooLarge = () => new Error('Ответ сервиса превышает безопасный размер. Запрос не повторяется.');
  if (Number(response.headers?.get('content-length')) > MAX_BUFFERED_RESPONSE_BYTES) throw tooLarge();
  if (!response.body?.getReader) {
    const bytes = await withAbort(response.arrayBuffer(), signal);
    if (bytes.byteLength > MAX_BUFFERED_RESPONSE_BYTES) throw tooLarge();
    return bytes;
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { value, done } = await withAbort(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BUFFERED_RESPONSE_BYTES) throw tooLarge();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    return bytes;
  } finally {
    quietlyCancel(reader);
    try { reader.releaseLock(); } catch { /* older WebViews */ }
  }
}

// Bound BOTH headers and body, even if a mobile transport ignores AbortSignal.
// Streaming Gradio requests manage their signal separately. Never retry here.
export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000, externalSignal, { readErrorBody = true } = {}) {
  const { signal, cleanup } = linkAbortSignals(externalSignal, timeoutMs);
  let response;
  try {
    throwIfAborted(externalSignal);
    response = await fetchAbortable(url, options, signal);
    // Status-only adapters must not lose a known rejection behind a stalled
    // error body. Other callers explicitly retain their bounded JSON errors.
    const bytes = !readErrorBody && response.status >= 400 ? null : await boundedBytes(response, signal);
    throwIfAborted(externalSignal);
    if (signal.aborted) throw signal.reason;
    return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    quietlyCancel(response?.body);
    cleanup();
  }
}

export function abortableDelay(ms, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Запрос остановлен.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Cancel all losing recognizers as soon as one succeeds (or the user cancels).
export async function raceFirstSuccess(tasks, externalSignal) {
  throwIfAborted(externalSignal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    const result = await Promise.any(tasks.map((task) => task(controller.signal)));
    throwIfAborted(externalSignal);
    return result;
  } finally {
    controller.abort();
    externalSignal?.removeEventListener('abort', onAbort);
  }
}
