import { createClient } from '@supabase/supabase-js';
let client; let config;
export function validateCloudConfig(raw) {
  if (!raw || typeof raw !== 'object' || Object.keys(raw).some((key) => !['url','publishableKey','siteUrl','captchaSiteKey'].includes(key))) throw new Error('Некорректная публичная конфигурация облака.');
  const url = new URL(raw.url);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw new Error('Нужен HTTPS-адрес проекта Supabase.');
  const key = String(raw.publishableKey || '');
  let isPublic = /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key);
  if (!isPublic) {
    try { isPublic = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon' && key.split('.').length === 3; } catch { /* not a public JWT */ }
  }
  if (!isPublic) throw new Error('В HTML разрешён только publishable / anon ключ, никогда service_role или secret.');
  const site = new URL(raw.siteUrl);
  if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash || site.hostname.endsWith('.github.io')) throw new Error('Укажите HTTPS-адрес облачного сайта (не GitHub Pages).');
  return Object.freeze({ url: url.origin, publishableKey: key, siteUrl: site.href, captchaSiteKey: String(raw.captchaSiteKey || '') });
}
export function getCloudConfig() {
  if (!config) config = validateCloudConfig(window.__DOMASHKA_CLOUD__);
  return config;
}

// Bound both connection AND body reading. Do not leave Auth or a large notebook
// stalled indefinitely after headers arrive. No requests to arbitrary hosts.
export async function cloudFetch(input, init = {}) {
  const controller = new AbortController(); const upstream = init.signal;
  const abort = () => controller.abort();
  if (upstream?.aborted) abort(); else upstream?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 45000);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (!response.body) return response;
    const reader = response.body.getReader(); const parts = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 24000000) { controller.abort(); throw new Error('Ответ облака слишком велик для безопасной загрузки.'); } parts.push(value); }
    const bytes = new Uint8Array(size); let at = 0; for (const part of parts) { bytes.set(part, at); at += part.byteLength; }
    return new Response([204,205,304].includes(response.status) ? null : bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally { clearTimeout(timer); upstream?.removeEventListener('abort', abort); }
}
export function getCloudClient() {
  if (!client) {
    const cfg = getCloudConfig();
    client = createClient(cfg.url, cfg.publishableKey, { global: { fetch: cloudFetch }, auth: {
      persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce',
      storageKey: `domashka_auth_${new URL(cfg.url).hostname.split('.')[0]}`,
    } });
  }
  return client;
}
export function loginEmail(value) {
  const login = String(value || '').trim().toLowerCase();
  if (login.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login) || login.endsWith('@children.domashka.invalid')) throw new Error('Введите почту родителя или полный логин ребёнка без @.');
    return login;
  }
  if (!/^[a-z0-9_-]{3,24}\.[a-f0-9]{12}$/.test(login)) throw new Error('Нужен полный логин ребёнка из семейного кабинета, включая часть после точки.');
  return `${login}@children.domashka.invalid`;
}
export function cloudError(error) {
  if (error?.code === '40001') return new Error('Версия уже изменена. Ваш черновик остался на экране: сравните данные и обновите версию перед сохранением.');
  if (error?.code === '42501') return new Error('Недостаточно прав или сеанс завершён. Войдите заново; для ученика проверьте ограничения родителя.');
  if (error?.code === 'PGRST202' || error?.code === '42P01') return new Error('Владелец ещё не установил облачную базу этой версии. Обратитесь к нему; локальные данные не удалены.');
  if (/invalid login credentials/i.test(error?.message || '')) return new Error('Неверная почта/логин или пароль.');
  if (/email not confirmed/i.test(error?.message || '')) return new Error('Сначала подтвердите почту по письму.');
  if (/fetch|network|abort|timeout/i.test(error?.message || '') || error?.name === 'AbortError') return new Error('Нет ответа облака. Проверьте интернет и состояние проекта; не очищайте данные сайта.');
  return new Error(String(error?.message || 'Облако не подтвердило операцию. Повторите позже.'));
}
export async function cloudAuthLink() {
  // Recommended mail templates use a fragment: token hashes do not reach the
  // static hosting server, analytics or Referer headers. Strip before any UI.
  const parameters = new URLSearchParams(location.hash.replace(/^#/, ''));
  const hash = parameters.get('token_hash'); const type = parameters.get('type');
  if (!hash) return false;
  history.replaceState(null, '', location.pathname);
  if (!['signup','recovery','email'].includes(type) || !/^[A-Za-z0-9_-]{20,200}$/.test(hash)) throw new Error('Ссылка подтверждения повреждена. Запросите новое письмо.');
  const { error } = await getCloudClient().auth.verifyOtp({ token_hash: hash, type });
  if (error) throw cloudError(error);
  return type === 'recovery';
}
export async function checkCloudEnvironment() {
  if (location.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(location.hostname)) throw new Error('Облачный кабинет открывается по HTTPS, не внутри скачанного HTML/HTML Viewer.');
  if (!crypto?.subtle || !crypto?.randomUUID || !globalThis.indexedDB || !navigator.locks?.request) throw new Error('Облачный кабинет требует современный Safari/Chrome/Firefox с IndexedDB, Web Crypto и Web Locks. Автономный HTML можно использовать отдельно.');
  try { localStorage.setItem('domashka_cloud_probe','1'); localStorage.removeItem('domashka_cloud_probe'); }
  catch { throw new Error('Разрешите хранение данных сайта для безопасного входа и синхронизации.'); }
}
let releaseLock; let lockClaim;
export function claimCloudTab() {
  if (lockClaim) return lockClaim;
  lockClaim = new Promise((resolve, reject) => {
    navigator.locks.request('domashka-cloud-workspace-v42', { ifAvailable: true }, async (lock) => {
      if (!lock) { reject(new Error('Облачный кабинет уже открыт в другой вкладке этого браузера. Закройте её и обновите эту страницу. На другом устройстве вход разрешён.')); return; }
      resolve(); await new Promise((release) => { releaseLock = release; });
    }).catch(reject);
  });
  return lockClaim;
}
export function releaseCloudTab() { releaseLock?.(); releaseLock = null; }
