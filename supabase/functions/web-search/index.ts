import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
// Server credentials are injected by Supabase, never sent to the client.
const endpoint = Deno.env.get('SUPABASE_URL') || '';
const publicKey = Deno.env.get('DOMASHKA_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const serviceKey = Deno.env.get('DOMASHKA_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const searchKey = Deno.env.get('TAVILY_API_KEY') || '';
const origins = (Deno.env.get('DOMASHKA_ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
const tidy = (s: unknown, max: number) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '';
function publicUrl(value: unknown) {
  try {
    if (typeof value !== 'string' || value.length > 1800) return '';
    const url = new URL(value); const host = url.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)
      || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /\.(localhost|local|internal|invalid|test)$/.test(host)) return '';
    return url.href;
  } catch { return ''; }
}
async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number, signal?: AbortSignal) {
  const reader = body?.getReader(); if (!reader) return '';
  let size = 0; const chunks: Uint8Array[] = [];
  const abort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) { if (signal?.aborted) throw new Error('timeout'); const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > limit) throw new Error('too large'); chunks.push(value); }
    if (signal?.aborted) throw new Error('timeout');
    const bytes = new Uint8Array(size); let at = 0; for (const c of chunks) { bytes.set(c, at); at += c.length; }
    return new TextDecoder().decode(bytes);
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); }
}
Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin');
  const headers: Record<string,string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
  if (origin && origins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers });
  if (!origins.length || !endpoint || !publicKey || !serviceKey) return reply(503, { ok: false, error: 'Владелец ещё не настроил поисковую функцию и разрешённый адрес сайта.' });
  if (origin && !origins.includes(origin)) return reply(403, { ok: false, error: 'Адрес сайта не разрешён.' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers,
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' } });
  if (request.method !== 'POST') return reply(405, { ok: false, error: 'Нужен POST.' });
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return reply(401, { ok: false, error: 'Сначала войдите в облачный кабинет.' });
  try {
    if (Number(request.headers.get('Content-Length')) > 4096) return reply(413, { ok: false, error: 'Поисковая фраза слишком длинная.' });
    const body = JSON.parse(await boundedText(request.body, 4096, AbortSignal.timeout(8000)));
    if (!body || typeof body !== 'object' || Object.keys(body).some((k) => !['query','requestId'].includes(k)) || !uuid(body.requestId)
      || typeof body.query !== 'string' || body.query.trim().length < 3 || body.query.length > 300)
      return reply(400, { ok: false, error: 'Нужны поисковая фраза 3–300 символов и идентификатор запроса.' });
    const query = body.query.trim();
    if (/(?:sb_secret_|sb_publishable_|tvly-|sk-[a-z0-9]{12}|eyJ[a-z0-9_-]{20})/i.test(query))
      return reply(400, { ok: false, error: 'Поисковая фраза похожа на секретный ключ. Уберите ключи, пароли и личные данные.' });
    const user = createClient(endpoint, publicKey, { ...options, global: { headers: { Authorization: authorization } } });
    const { data, error } = await user.auth.getUser(authorization.slice(7));
    if (error || !data.user) return reply(401, { ok: false, error: 'Сеанс истёк. Войдите заново.' });
    const claims = JSON.parse(atob(authorization.slice(7).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (claims.sub !== data.user.id || !uuid(claims.session_id)) return reply(401, { ok: false, error: 'Некорректный сеанс.' });
    if (!searchKey) return reply(503, { ok: false, error: 'Полный поиск ещё не включён: владелец должен добавить TAVILY_API_KEY в секреты сервера. Пользовательский ключ ИИ не нужен.' });
    const admin = createClient(endpoint, serviceKey, options);
    const reserved = await admin.rpc('domashka_reserve_search', { actor_id: data.user.id, actor_session: claims.session_id, request_id: body.requestId });
    if (reserved.error || reserved.data !== true) return reply(reserved.error?.code === '42501' ? 403 : 429, { ok: false,
      error: reserved.error?.code === '42501' ? 'Поиск запрещён для этого сеанса или родительским режимом.' : 'Поиск не разрешён: исчерпана квота, запрос уже принят или владелец ещё не установил миграцию поиска. Повтор автоматически не выполняется.' });
    const signal = AbortSignal.timeout(18000);
    const response = await fetch('https://api.tavily.com/search', { method: 'POST', signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${searchKey}` },
      body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, topic: 'general', auto_parameters: false,
        include_answer: false, include_raw_content: false, include_images: false, safe_search: true }) });
    if (!response.ok) { await response.body?.cancel(); return reply(response.status === 429 || response.status >= 432 && response.status <= 434 ? 429 : 502,
      { ok: false, error: 'Поисковый сервис не выполнил запрос. Возможны лимит бесплатного тарифа, проблема ключа или временная недоступность. Автоматического повтора/платного перехода нет.' }); }
    const payload = JSON.parse(await boundedText(response.body, 100000, signal));
    if (!Array.isArray(payload.results)) throw new Error('protocol');
    const results = payload.results.slice(0,5).map((r: Record<string,unknown>) => ({ title: tidy(r?.title,160), url: publicUrl(r?.url), content: tidy(r?.content,1200) })).filter((r: { url: string }) => r.url);
    return reply(200, { ok: true, provider: 'Tavily', query, fetchedAt: new Date().toISOString(), results });
  } catch { return reply(502, { ok: false, error: 'Поиск не завершён. Ожидание остановлено без автоматического повтора; запрос мог уже расходовать квоту. Без источников ответ не выдаётся за результат поиска.' }); }
});
