const STORAGE_KEY = 'domashka_parental_control_v1';
const ATTEMPTS_KEY = 'domashka_parental_attempts_v1';
const ITERATIONS = 310000;
const listeners = new Set();
let lastKnownConfig = null;

function readConfig() {
  let raw;
  try { raw = window.localStorage.getItem(STORAGE_KEY); }
  catch { return lastKnownConfig; }
  if (!raw) return (lastKnownConfig = null);
  try {
    const data = JSON.parse(raw);
    if (data.version !== 1 || typeof data.enabled !== 'boolean' ||
        !/^[0-9a-f]{32}$/.test(data.salt) || !/^[0-9a-f]{64}$/.test(data.hash) ||
        data.iterations !== ITERATIONS) {
      throw new Error('Invalid parental settings');
    }
    return (lastKnownConfig = data);
  } catch {
    // Fail closed on corruption / loss of storage access after activation.
    return lastKnownConfig || { enabled: true, corrupted: true };
  }
}

export function getParentalStatus() {
  const config = readConfig();
  return { enabled: Boolean(config?.enabled), configured: Boolean(config?.hash), corrupted: Boolean(config?.corrupted) };
}

export function isTutorModeEnabled() {
  return getParentalStatus().enabled;
}

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeParentalControl(listener) {
  listeners.add(listener);
  const onStorage = (event) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function writeConfig(config) {
  const value = JSON.stringify(config);
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
    if (window.localStorage.getItem(STORAGE_KEY) !== value) throw new Error('Not persisted');
  } catch {
    throw new Error('Не удалось сохранить защиту. Разрешите хранение данных в браузере и освободите место. Режим не изменён.');
  }
  lastKnownConfig = config;
  notify();
  return getParentalStatus();
}

function checkPasswordLength(password) {
  if (typeof password !== 'string' || password.trim().length < 8 || password.length > 128) {
    throw new Error('Пароль должен содержать от 8 до 128 символов (не только пробелы).');
  }
}

function hex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Защита паролем требует HTTPS или открытия локального HTML в современном браузере.');
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS,
    salt: Uint8Array.from(salt.match(/../g), (byte) => parseInt(byte, 16)),
  }, key, 256);
  return hex(new Uint8Array(bits));
}

function readAttempts() {
  try { return JSON.parse(window.localStorage.getItem(ATTEMPTS_KEY)) || {}; }
  catch { return {}; }
}

async function verifyPassword(password, config) {
  if (!config || config.corrupted) throw new Error('Настройки защиты повреждены. Пароль нельзя проверить.');
  const attempts = readAttempts();
  const remaining = Math.ceil(((attempts.until || 0) - Date.now()) / 1000);
  if (remaining > 0) throw new Error(`Слишком много попыток. Подождите ${remaining} сек.`);
  const actual = await hashPassword(String(password || ''), config.salt);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ config.hash.charCodeAt(i);
  if (difference) {
    const count = (Number(attempts.count) || 0) + 1;
    const until = count >= 5 ? Date.now() + Math.min(300000, 30000 * 2 ** Math.min(count - 5, 4)) : 0;
    try { window.localStorage.setItem(ATTEMPTS_KEY, JSON.stringify({ count, until })); } catch { /* lock itself remains persisted */ }
    throw new Error(until ? 'Неверный пароль. Следующая попытка — через 30 секунд или позже.' : 'Неверный родительский пароль.');
  }
  const current = readConfig();
  if (current?.hash !== config.hash || current?.enabled !== config.enabled) {
    throw new Error('Настройки изменились в другой вкладке. Повторите действие.');
  }
  try { window.localStorage.removeItem(ATTEMPTS_KEY); } catch { /* no effect on the lock */ }
}

export async function setTutorModeEnabled(enabled, password) {
  const config = readConfig();
  if (config) {
    await verifyPassword(password, config);
    return writeConfig({ ...config, enabled: Boolean(enabled) });
  }
  if (!enabled) return getParentalStatus();
  checkPasswordLength(password);
  if (!globalThis.crypto?.subtle) throw new Error('Откройте сайт по HTTPS или локальный HTML в современном браузере.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPassword(password, salt);
  if (readConfig()) throw new Error('Режим уже настроен в другой вкладке. Введите установленный пароль.');
  return writeConfig({ version: 1, enabled: true, salt, hash, iterations: ITERATIONS });
}

export async function changeParentPassword(currentPassword, nextPassword) {
  checkPasswordLength(nextPassword);
  const config = readConfig();
  await verifyPassword(currentPassword, config);
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPassword(nextPassword, salt);
  const latest = readConfig();
  if (latest?.hash !== config.hash || latest?.enabled !== config.enabled) throw new Error('Настройки изменились. Повторите действие.');
  return writeConfig({ ...config, salt, hash });
}
