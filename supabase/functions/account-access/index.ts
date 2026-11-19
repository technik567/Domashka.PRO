// Public username registration/recovery; authenticated backup-code rotation.
// Never log bodies, passwords, codes, tokens, provider errors, or raw IPs.
// No SMTP. Keep native Auth signup CLOSED: only this guarded server path creates
// username identities. Service credentials must NEVER enter a browser build.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const url = Deno.env.get('SUPABASE_URL') || '';
const publicKey = Deno.env.get('DOMASHKA_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const serviceKey = Deno.env.get('DOMASHKA_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const captchaSecret = Deno.env.get('DOMASHKA_TURNSTILE_SECRET_KEY') || '';
const origins = (Deno.env.get('DOMASHKA_ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const usernamePattern = /^[a-z0-9_-]{3,24}$/;
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } };
const encoder = new TextEncoder();
const passwordValid = (p: unknown): p is string => typeof p === 'string' && p.trim().length >= 8 && p.length <= 128 && encoder.encode(p).length <= 72;
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(s))), b => b.toString(16).padStart(2,'0')).join('');
const codeHash = (code: string) => sha256('domashka-backup-v1\0' + code.replace(/[\s-]/g,'').toUpperCase());
function generateCodes() {
  // Independent 128-bit CSPRNG secrets, not counters, passwords, dates, UUIDs or
  // reversible encrypted codes. Only their SHA-256 hashes leave server memory
  // for the database; the plaintext is returned once over HTTPS to its owner.
  return Array.from({ length: 10 }, () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2,'0')).join('').toUpperCase().match(/.{8}/g)!.join('-'));
}
function sessionId(token: string, userId: string): string | null {
  try {
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    return claims.sub === userId && uuid.test(claims.session_id) ? claims.session_id : null;
  } catch { return null; }
}
async function boundedJson(request: Request | Response, max: number) {
  const reader = request.body?.getReader(); if (!reader) throw new Error('Empty body');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > max) { await reader.cancel(); throw new Error('Body too big'); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { reader.releaseLock(); }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin') || '';
  const headers: Record<string,string> = { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'Vary':'Origin', 'Referrer-Policy':'no-referrer' };
  if (origins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status,headers });
  if (!url || !publicKey || !serviceKey || !origins.length) return reply(503,{error:'Владелец ещё не настроил сервер входа.'});
  if (!origin || !origins.includes(origin)) return reply(403,{error:'Этот адрес сайта не разрешён.'});
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{...headers,
    'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info'}});
  if (request.method !== 'POST') return reply(405,{error:'Требуется POST.'});
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return reply(415,{error:'Требуется JSON.'});
  if (Number(request.headers.get('Content-Length')) > 16000) return reply(413,{error:'Слишком большой запрос.'});
  try {
    const body = await boundedJson(request,16000);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !['register','recover','rotate_codes'].includes(body.action)) return reply(400,{error:'Неизвестная операция.'});
    const allowed = body.action === 'register' ? ['action','login','password','name','avatar','timeZone','captchaToken']
      : body.action === 'recover' ? ['action','login','password','code','captchaToken'] : ['action','password','captchaToken'];
    if (Object.keys(body).some(key => !allowed.includes(key))) return reply(400,{error:'Лишние поля в запросе.'});
    if (!passwordValid(body.password)) return reply(400,{error:'Пароль: минимум 8 символов, максимум 72 байта UTF-8 (до 72 латинских символов).'});
    const admin = createClient(url,serviceKey,options);
    if (body.action === 'rotate_codes') {
      const authorization = request.headers.get('Authorization') || '';
      if (!authorization.startsWith('Bearer ')) return reply(401,{error:'Войдите в родительский аккаунт.'});
      const token = authorization.slice(7);
      const userClient = createClient(url,publicKey,{...options,global:{...options.global,headers:{Authorization:authorization}}});
      const {data:identity,error:identityError} = await userClient.auth.getUser(token);
      const sid = identity.user && sessionId(token,identity.user.id);
      if (identityError || !identity.user || !sid) return reply(401,{error:'Сеанс истёк. Войдите заново.'});
      const {data:family,error:familyError} = await userClient.rpc('domashka_get_family');
      if (familyError || family?.account?.role !== 'parent' || family.account.id !== identity.user.id) return reply(403,{error:'Требуется действующий родительский аккаунт.'});
      // Password verification uses a separate nonpersistent session. It never
      // replaces the user's browser session. Auth handles its CAPTCHA token.
      const verifier = createClient(url,publicKey,options);
      try {
        const {data:proof,error:proofError} = await verifier.auth.signInWithPassword({email:identity.user.email!,password:body.password,
          options:{captchaToken:typeof body.captchaToken === 'string' ? body.captchaToken.slice(0,2048) : undefined}});
        const proofSid = proof.session && sessionId(proof.session.access_token,identity.user.id);
        if (proofError || proof.user?.id !== identity.user.id || !proofSid) return reply(403,{error:'Текущий пароль не подтверждён.'});
        const codes = generateCodes(); const hashes = await Promise.all(codes.map(codeHash));
        const {error} = await admin.rpc('domashka_replace_backup_codes',{actor_id:identity.user.id,actor_session:sid,proof_session:proofSid,hashes});
        if (error) return reply(error.code === 'P0001' ? 429 : 403,{error:error.code === 'P0001' ? 'Подождите минуту перед перевыпуском кодов.' : 'Сеанс изменился. Войдите заново.'});
        return reply(200,{ok:true,login:family.account.login,codes,remaining:10});
      } finally { await verifier.auth.signOut({scope:'local'}).catch(() => undefined); }
    }
    // Fail CLOSED until a real CAPTCHA secret AND the corresponding public
    // client site key are configured. No developer/test CAPTCHA in production.
    if (!captchaSecret || /^[123]x0{10,}/.test(captchaSecret)) return reply(503,{error:'Владелец ещё не подключил защиту от ботов. Регистрация и восстановление пока закрыты.'});
    const login = typeof body.login === 'string' ? body.login.trim().toLowerCase() : '';
    const legacyEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login) && !login.endsWith('.invalid');
    if (login.length > 254 || !(usernamePattern.test(login) || body.action === 'recover' && legacyEmail)) return reply(400,{error:'Логин родителя: 3–24 латинские буквы, цифры, дефис или подчёркивание. Пароль ребёнка меняет родитель.'});
    if (body.action === 'register' && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 60 ||
        !['🦉','🦊','🐱','🐼','🚀','🌟','🎨','🧑‍🏫'].includes(body.avatar))) return reply(400,{error:'Проверьте имя и аватар.'});
    if (body.action === 'recover' && (typeof body.code !== 'string' || body.code.length > 80 || !/^[A-F0-9]{32}$/.test(body.code.replace(/[\s-]/g,'').toUpperCase()))) return reply(400,{error:'Введите один полный резервный код.'});
    if (typeof body.captchaToken !== 'string' || !body.captchaToken || body.captchaToken.length > 2048) return reply(400,{error:'Пройдите проверку антиспама.'});
    // Nearest forwarded address only, not arbitrary leftmost client input.
    // Hash with a server-only salt; neither plaintext IP nor account name is
    // retained in the rate ledger. Global/identity caps never depend on this IP.
    const ip = (request.headers.get('x-forwarded-for') || '').split(',').at(-1)?.trim().slice(0,100) || 'unknown';
    const [ipDigest,identityDigest] = await Promise.all([sha256(serviceKey+'\0ip\0'+ip),sha256(serviceKey+'\0login\0'+login)]);
    const {error:rateError} = await admin.rpc('domashka_account_rate',{action_name:body.action,ip_digest:ipDigest,identity_digest:identityDigest});
    if (rateError) return reply(rateError.code === 'P0001' ? 429 : 503,{error:rateError.code === 'P0001' ? 'Слишком много попыток. Повторите позже.' : 'Сервер аккаунтов пока недоступен.'});
    let captcha;
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',signal:AbortSignal.timeout(10000),
        headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:captchaSecret,response:body.captchaToken})});
      captcha = response.ok ? await boundedJson(response,12000) : null;
    } catch { return reply(503,{error:'Сервис антиспама не ответил. Повторите проверку.'}); }
    if (!captcha?.success || captcha.hostname !== new URL(origin).hostname || captcha.action !== 'domashka-auth') return reply(403,{error:'Проверка антиспама не пройдена. Повторите её.'});
    if (body.action === 'register') {
      const codes = generateCodes(); const hashes = await Promise.all(codes.map(codeHash));
      const {data:ticket,error:ticketError} = await admin.rpc('domashka_register_ticket',{username:login,hashes});
      if (ticketError || !ticket || !uuid.test(ticket.ticket) || !uuid.test(ticket.userId)) return reply(400,{error:'Логин недоступен. Выберите другой или попробуйте войти, если уже регистрировались.'});
      const {data,error} = await admin.auth.admin.createUser({id:ticket.userId,email:`${login}@parents.domashka.invalid`,password:body.password,email_confirm:true,
        app_metadata:{domashka_role:'parent',domashka_auth:'username',domashka_login:login},
        user_metadata:{name:body.name.trim(),avatar:body.avatar,time_zone:typeof body.timeZone === 'string' ? body.timeZone.slice(0,100) : 'UTC'}});
      if (error || !data.user) return reply(400,{error:'Аккаунт не создан или ответ не подтверждён. Проверьте вход с выбранным логином перед повторной регистрацией. Коды можно перевыпустить после входа.'});
      return reply(200,{ok:true,login,codes,remaining:10});
    }
    const {data:authorization,error:recoveryError} = await admin.rpc('domashka_recovery_ticket',{username:login,hash:await codeHash(body.code)});
    if (recoveryError || !authorization || !uuid.test(authorization.ticket) || !uuid.test(authorization.userId)) return reply(400,{error:'Неверный логин или резервный код; код мог быть использован или заменён.'});
    const {error} = await admin.auth.admin.updateUserById(authorization.userId,{password:body.password,app_metadata:{domashka_recovery_ticket:authorization.ticket}});
    if (error) return reply(400,{error:'Смена пароля не подтверждена. Сначала попробуйте войти с новым паролем: при обрыве связи код мог уже использоваться. Не расходуйте следующий код сразу.'});
    return reply(200,{ok:true,remaining:authorization.remaining});
  } catch {
    // A lost response can follow a successful commit. Never automatically
    // retry a mutating operation or claim a code definitely wasn't consumed.
    return reply(400,{error:'Операция не подтверждена. При обрыве связи сначала проверьте вход с новым паролем. Коды после входа можно перевыпустить; не отправляйте их в чат.'});
  }
});
