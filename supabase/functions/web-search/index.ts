import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
// Server credentials are injected by Supabase, never returned or logged.
const endpoint = Deno.env.get('SUPABASE_URL') || '';
const publicKey = Deno.env.get('DOMASHKA_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const serviceKey = Deno.env.get('DOMASHKA_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const searchKey = Deno.env.get('TAVILY_API_KEY') || '';
const origins = (Deno.env.get('DOMASHKA_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const VERSION = '4.5';
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
const tidy = (s: unknown, max: number) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '';
function publicUrl(value: unknown) {
  try {
    if (typeof value !== 'string' || value.length > 1800) return '';
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)
      || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /\.(localhost|local|internal|invalid|test)$/.test(host)) return '';
    return url.href;
  } catch { return ''; }
}
class BodyLimitError extends Error {}
function abortable<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  const pending = Promise.resolve(work);
  if (signal.aborted) { pending.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(signal.reason); else resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal) {
  const reader = body?.getReader(); if (!reader) return '';
  let size = 0; const chunks: Uint8Array[] = [];
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await abortable(reader.read(), signal); if (done) break;
      size += value.byteLength; if (size > limit) throw new BodyLimitError(); chunks.push(value);
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return new TextDecoder().decode(bytes);
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}
Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
    'X-Domashka-Search-Version': VERSION, 'Access-Control-Expose-Headers': 'X-Domashka-Search-Version' };
  if (origin && origins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (status: number, body: object) => new Response(JSON.stringify({ ...body, version: VERSION }), { status, headers });
  const fail = (status: number, code: string, error: string) => reply(status, { ok: false, code, error });
  if (!origins.length) return fail(503, 'SEARCH_SETUP_REQUIRED', 'Владелец ещё не настроил разрешённый адрес сайта.');
  if (!origin || !origins.includes(origin)) return fail(403, 'SEARCH_ORIGIN_DENIED', 'Адрес сайта не разрешён.');
  // OPTIONS must not depend on service credentials or Tavily readiness. With
  // a permitted Origin the POST can then expose a useful 503, not opaque CORS.
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers,
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' } });
  if (!endpoint || !publicKey || !serviceKey) return fail(503, 'SEARCH_SETUP_REQUIRED', 'Владелец ещё не настроил поисковую функцию.');
  if (request.method !== 'POST') return fail(405, 'SEARCH_METHOD', 'Нужен POST.');
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return fail(401, 'SEARCH_AUTH_REQUIRED', 'Сначала войдите в облачный кабинет.');
  // The total budget includes Auth + SQL + Tavily, not just the provider call.
  const deadlines: ReturnType<typeof setTimeout>[] = [];
  const deadline = (ms: number) => {
    const controller = new AbortController();
    deadlines.push(setTimeout(() => controller.abort(new DOMException('Search deadline', 'TimeoutError')), ms));
    return controller.signal;
  };
  const total = AbortSignal.any([request.signal, deadline(30000)]);
  const backendFetch: typeof fetch = (url, init) => {
    total.throwIfAborted();
    const signal = init?.signal ? AbortSignal.any([total, init.signal]) : total;
    return abortable(fetch(url, { ...init, signal }), signal);
  };
  let providerSignal: AbortSignal | undefined;
  let phase = 'request';
  try {
    if (Number(request.headers.get('Content-Length')) > 4096) return fail(413, 'SEARCH_BAD_REQUEST', 'Поисковая фраза слишком длинная.');
    let body;
    try { body = JSON.parse(await boundedText(request.body, 4096, AbortSignal.any([total, deadline(8000)]))); }
    catch (error) { return fail(error instanceof BodyLimitError ? 413 : 400, 'SEARCH_BAD_REQUEST', 'Нужен короткий JSON-запрос поиска.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['query', 'requestId', 'searchKey'].includes(k)) || !uuid(body.requestId)
      || typeof body.query !== 'string' || body.query.trim().length < 3 || body.query.length > 300 || /[\u0000-\u001f\u007f]/.test(body.query)
      || body.searchKey !== undefined && (typeof body.searchKey !== 'string' || !/^tvly-[A-Za-z0-9_-]{10,240}$/.test(body.searchKey)))
      return fail(400, 'SEARCH_BAD_REQUEST', 'Нужны поисковая фраза 3–300 символов и идентификатор запроса.');
    const query = body.query.trim();
    if (/(?:sb_secret_|sb_publishable_|tvly-|sk-[a-z0-9]{12}|eyJ[a-z0-9_-]{20}|[a-f0-9]{8}(?:[- ]?[a-f0-9]{8}){3}|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:пароль|password|секрет|secret)\s*[:=]|(?:\+?\d[ ()-]*){10,})/i.test(query))
      return fail(400, 'SEARCH_BAD_REQUEST', 'Поисковая фраза похожа на личные данные или секрет. Ничего не отправлено поисковику.');
    phase = 'auth';
    const user = createClient(endpoint, publicKey, { ...options, global: { headers: { Authorization: authorization }, fetch: backendFetch } });
    const { data, error } = await abortable(user.auth.getUser(authorization.slice(7)), total);
    if (total.aborted) return fail(504, 'SEARCH_TIMEOUT', 'Истекло время проверки сеанса.');
    if (error || !data.user) return fail(error?.status && error.status >= 500 ? 503 : 401,
      error?.status && error.status >= 500 ? 'SEARCH_BACKEND_UNAVAILABLE' : 'SEARCH_AUTH_REQUIRED', 'Не удалось подтвердить действующий сеанс.');
    let claims;
    try {
      const encoded = (authorization.slice(7).split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/');
      claims = JSON.parse(atob(encoded + '='.repeat((4 - encoded.length % 4) % 4)));
    } catch { return fail(401, 'SEARCH_AUTH_REQUIRED', 'Некорректный сеанс.'); }
    if (claims?.sub !== data.user.id || !uuid(claims?.session_id)) return fail(401, 'SEARCH_AUTH_REQUIRED', 'Некорректный сеанс.');
    phase = 'reservation';
    const admin = createClient(endpoint, serviceKey, { ...options, global: { fetch: backendFetch } });
    const reserved = await abortable(admin.rpc('domashka_reserve_search', { actor_id: data.user.id, actor_session: claims.session_id, request_id: body.requestId }), total);
    if (total.aborted) return fail(504, 'SEARCH_TIMEOUT', 'Истекло время проверки квоты.');
    if (reserved.error || reserved.data !== true) {
      const code = reserved.error?.code;
      if (code === '42501') return fail(403, 'SEARCH_POLICY_DENIED', 'Поиск запрещён для этого сеанса или родительским режимом.');
      if (code === '23505') return fail(429, 'SEARCH_REQUEST_USED', 'Запрос уже принят. Повтор автоматически не выполняется.');
      if (code === 'P0001') return fail(429, 'SEARCH_QUOTA', 'Исчерпана квота поиска сайта. Личный ключ её не отменяет.');
      if (['PGRST202', '42P01', '42883'].includes(code || '')) return fail(503, 'SEARCH_SETUP_REQUIRED', 'Владелец должен проверить установленную поисковую функцию и её RPC.');
      return fail(503, 'SEARCH_BACKEND_UNAVAILABLE', 'Не удалось проверить квоту поиска. Поисковик не вызывался.');
    }
    // Personal -> owner -> documented keyless access. Every mode reserves the
    // same server quota. Never store/log/return credentials or refund timeouts.
    const effectiveKey = body.searchKey || searchKey;
    phase = 'provider';
    providerSignal = AbortSignal.any([total, deadline(18000)]);
    const pending = fetch('https://api.tavily.com/search', { method: 'POST', signal: providerSignal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(effectiveKey ? { Authorization: `Bearer ${effectiveKey}` } : { 'X-Tavily-Access-Mode': 'keyless' }) },
      body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, topic: 'general', auto_parameters: false,
        include_answer: false, include_raw_content: false, include_images: false, safe_search: true }) });
    pending.then(late => { if (providerSignal?.aborted) late.body?.cancel().catch(() => {}); }, () => {});
    const response = await abortable(pending, providerSignal);
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      if (response.status === 429 || response.status >= 432 && response.status <= 434) return fail(429, 'SEARCH_UPSTREAM_QUOTA', 'Достигнут лимит поискового сервиса.');
      if ([401, 403].includes(response.status)) return fail(502, 'SEARCH_UPSTREAM_AUTH', 'Поисковый сервис не разрешил запрос с выбранным способом доступа.');
      return fail(response.status >= 500 ? 503 : 502, 'SEARCH_UPSTREAM_UNAVAILABLE', 'Поисковый сервис не выполнил запрос. Автоматического повтора/платного перехода нет.');
    }
    let payload;
    try { payload = JSON.parse(await boundedText(response.body, 100000, providerSignal)); }
    catch (error) { if (providerSignal.aborted) throw error; return fail(502, 'SEARCH_UPSTREAM_PROTOCOL', 'Поисковый ответ слишком большой или повреждён.'); }
    if (!Array.isArray(payload?.results)) return fail(502, 'SEARCH_UPSTREAM_PROTOCOL', 'Поисковый сервис вернул неподдерживаемый ответ.');
    const results = payload.results.slice(0, 5).map((r: Record<string, unknown>) => ({ title: tidy(r?.title, 160), url: publicUrl(r?.url), content: tidy(r?.content, 1200) })).filter((r: { url: string }) => r.url);
    return reply(200, { ok: true, provider: 'Tavily', query, fetchedAt: new Date().toISOString(), results });
  } catch (error) {
    if (total.aborted || providerSignal?.aborted || error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
      return fail(504, 'SEARCH_TIMEOUT', 'Ожидание поиска истекло. Запрос мог уже расходовать квоту; повтора нет.');
    return fail(502, phase === 'provider' ? 'SEARCH_UPSTREAM_UNAVAILABLE' : 'SEARCH_BACKEND_UNAVAILABLE',
      'Поиск не завершён. Повтора нет; без источников ответ не выдаётся за результат поиска.');
  } finally { deadlines.forEach(clearTimeout); }
});
