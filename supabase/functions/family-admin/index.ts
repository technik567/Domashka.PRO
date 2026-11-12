// Service credentials exist ONLY in the Edge Function environment.
// Gateway JWT verification is disabled for compatibility with publishable keys;
// getUser() + the database actor/ticket checks below are mandatory, not optional.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const url = Deno.env.get('SUPABASE_URL')!;
const publicKey = (Deno.env.get('DOMASHKA_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY'))!;
const serviceKey = (Deno.env.get('DOMASHKA_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
const allowedOrigins = (Deno.env.get('DOMASHKA_ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean);
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
  if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers });
  if (!url || !publicKey || !serviceKey) return reply(503, { error: 'Владелец ещё не настроил серверную функцию.' });
  if (!allowedOrigins.length) return reply(503, { error: 'Владелец ещё не настроил разрешённый адрес сайта.' });
  if (origin && !allowedOrigins.includes(origin)) return reply(403, { error: 'Этот адрес сайта не разрешён.' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers,
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' } });
  if (request.method !== 'POST') return reply(405, { error: 'Требуется POST.' });
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'Войдите в родительский аккаунт.' });
  try {
    // Bounded request body; do not log passwords, tokens or request bodies.
    if (Number(request.headers.get('Content-Length')) > 130000) return reply(413, { error: 'Слишком большой запрос.' });
    const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 130000) { await reader.cancel(); return reply(413, { error: 'Слишком большой запрос.' }); } chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const bodyText = new TextDecoder().decode(bytes);
    const body = JSON.parse(bodyText);
    const userClient = createClient(url, publicKey, { ...clientOptions, global: { headers: { Authorization: authorization } } });
    const { data: identity, error: identityError } = await userClient.auth.getUser(authorization.slice(7));
    if (identityError || !identity.user) return reply(401, { error: 'Сеанс истёк. Войдите заново.' });
    const { data: family, error: familyError } = await userClient.rpc('domashka_get_family');
    if (familyError || family?.account?.role !== 'parent' || family.account.id !== identity.user.id)
      return reply(403, { error: 'Требуется действующий родительский аккаунт.' });
    const password = body.password;
    if (typeof password !== 'string' || password.trim().length < 8 || password.length > 128)
      return reply(400, { error: 'Новый пароль: 8–128 символов, не только пробелы.' });
    const admin = createClient(url, serviceKey, clientOptions);
    if (body.action === 'create_child') {
      const login = String(body.login || '').trim().toLowerCase(); const name = String(body.name || '').trim();
      if (!/^[a-z0-9_-]{3,24}$/.test(login) || !name || name.length > 60 ||
          !Number.isInteger(body.grade) || body.grade < 1 || body.grade > 11 ||
          !Number.isInteger(body.age) || body.age < 5 || body.age > 21)
        return reply(400, { error: 'Проверьте имя, логин, класс и возраст ученика.' });
      const { data: ticket, error: ticketError } = await userClient.rpc('domashka_admin_ticket', { action: 'create_child', child: null, login });
      if (ticketError || typeof ticket !== 'string' || !/^[a-f0-9-]{36}$/.test(ticket)) return reply(403, { error: 'Операция не разрешена или достигнут лимит. Обновите кабинет.' });
      const fullLogin = `${login}.${family.account.familyCode}`;
      const { data, error } = await admin.auth.admin.createUser({ id: ticket, email: `${fullLogin}@children.domashka.invalid`, password,
        email_confirm: true,
        app_metadata: { domashka_role: 'child', domashka_parent: identity.user.id, domashka_login: login },
        user_metadata: { name, avatar: body.avatar || '🦊', grade: body.grade, age: body.age } });
      if (error) return reply(400, { error: 'Аккаунт не создан: проверьте данные и занятость логина в вашей семье. После сетевого сбоя обновите список — первая попытка могла уже завершиться.' });
      return reply(200, { id: data.user.id, login: fullLogin });
    }
    if (body.action === 'reset_child') {
      const child = family.children.find((item: { id: string }) => item.id === body.childId);
      if (!child || typeof body.parentPassword !== 'string') return reply(403, { error: 'Нет доступа к ученику.' });
      // Reauthentication uses a separate non-persistent client; never switches
      // the parent's browser session to a child/admin session.
      const verifier = createClient(url, publicKey, clientOptions);
      const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({ email: identity.user.email!, password: body.parentPassword, options: { captchaToken: typeof body.captchaToken === 'string' ? body.captchaToken.slice(0,8000) : undefined } });
      if (verifyError || verified.user?.id !== identity.user.id) return reply(403, { error: 'Родительский пароль не подтверждён.' });
      try {
        const { data: ticket, error: ticketError } = await userClient.rpc('domashka_admin_ticket', { action: 'reset_child', child: child.id, login: null });
        if (ticketError || typeof ticket !== 'string' || !/^[a-f0-9-]{36}$/.test(ticket)) return reply(403, { error: 'Сеанс или связь с учеником изменились.' });
        const { error } = await admin.auth.admin.updateUserById(child.id, { password, app_metadata: { domashka_reset_ticket: ticket } });
        if (error) return reply(400, { error: 'Пароль не изменён. Обновите кабинет и повторите.' });
        return reply(200, { ok: true });
      } finally { await verifier.auth.signOut({ scope: 'local' }); }
    }
    return reply(400, { error: 'Неизвестная операция.' });
  } catch {
    return reply(400, { error: 'Не удалось выполнить запрос. Данные аккаунтов и пароли не возвращаются в сообщении об ошибке.' });
  }
});
