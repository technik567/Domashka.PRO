import { getCloudClient } from './client.js';

export function parentUsername(value) {
  const login = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,24}$/.test(login)) throw new Error('Логин: 3–24 латинские буквы, цифры, дефис или подчёркивание. Почта не нужна.');
  return login;
}
export function checkNewPassword(password, confirm = password) {
  if (typeof password !== 'string' || password !== confirm || password.trim().length < 8 || password.length > 128)
    throw new Error('Пароли должны совпадать; минимум 8 символов.');
  if (new TextEncoder().encode(password).length > 72) throw new Error('Пароль слишком длинный: максимум 72 байта UTF-8 (до 72 латинских символов).');
}
export function normalizeBackupCode(value) {
  const code = String(value || '').replace(/[\s-]/g,'').toUpperCase();
  if (!/^[A-F0-9]{32}$/.test(code)) throw new Error('Введите один полный резервный код: все четыре группы по восемь символов.');
  return code;
}
// Mutations MUST NOT be retried automatically. No secret enters the study
// workspace, outbox, localStorage, IndexedDB, URLs, analytics or AI context.
export async function accountAccess(body, client = getCloudClient(), token) {
  let result;
  try {
    result = await client.functions.invoke('account-access', { body, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) });
  } catch {
    throw new Error('Ответ сервера не получен. Сначала проверьте вход с новым паролем: операция могла завершиться. Коды можно перевыпустить после входа; не расходуйте следующий код сразу.');
  }
  if (result.error || result.data?.error) {
    let detail = result.data;
    try { if (result.error?.context) detail = await result.error.context.json(); } catch { /* safe generic error, no raw provider error */ }
    throw new Error(detail?.error || 'Операция не подтверждена. Проверьте сеть и сначала попробуйте войти с новым паролем. При регистрации коды можно перевыпустить после входа.');
  }
  const data = result.data;
  if (!data?.ok || !Number.isInteger(data.remaining) || data.remaining < 0 || data.remaining > 10)
    throw new Error('Сервер не подтвердил результат. Сначала проверьте вход с новым паролем.');
  if (body.action !== 'recover' && (typeof data.login !== 'string' || !Array.isArray(data.codes) || data.codes.length !== 10 ||
      new Set(data.codes).size !== 10 || data.codes.some(code => typeof code !== 'string' || !/^[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/.test(code))))
    throw new Error('Сервер не вернул полный набор из 10 кодов. Войдите с паролем и перевыпустите набор в семейном кабинете.');
  return data;
}
