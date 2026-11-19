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

// Keep the deadline alive until the BODY has arrived, not just response headers.
// Streaming Gradio requests manage their signal separately.
export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000, externalSignal) {
  const { signal, cleanup } = linkAbortSignals(externalSignal, timeoutMs);
  try {
    throwIfAborted(externalSignal);
    const response = await fetch(url, { ...options, signal });
    const bytes = await response.arrayBuffer();
    throwIfAborted(externalSignal);
    if (signal.aborted) throw signal.reason;
    return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
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
