// Local, single-browser family accounts. This is an application boundary, NOT OS-level
// security or encryption of study data. Never accept account credentials from notebook imports.
export const ACCOUNTS_KEY = 'domashka_accounts_v4';
const SESSION_KEY = 'domashka_session_v4';
const ATTEMPTS_PREFIX = 'domashka_login_attempts_v4_';
const LEGACY_LOCK_KEY = 'domashka_parental_control_v1';
const ITERATIONS = 310000;
const SESSION_LIFETIME = 8 * 60 * 60 * 1000;
export const AVATARS = ['🦊', '🐱', '🐼', '🦉', '🐸', '🐯', '🐨', '🐰', '🚀', '🌟', '🎨', '🧑‍🏫'];
const listeners = new Set();
const challenges = new Map();
let transitioning = false;

function storage() {
  try { return window.localStorage; } catch { throw new Error('Хранилище браузера недоступно. Аккаунты требуют постоянного локального хранения.'); }
}
export function persistLocal(key, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  try {
    storage().setItem(key, text);
    if (storage().getItem(key) !== text) throw new Error('Not saved');
  } catch {
    throw new Error('Не удалось сохранить данные. Разрешите хранение в браузере и освободите место. Изменение не подтверждено.');
  }
}
const hex = (bytes) => Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
function randomToken() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Безопасный генератор недоступен. Откройте HTTPS или локальный HTML в современном браузере.');
  return hex(crypto.getRandomValues(new Uint8Array(24)));
}
function checkPassword(password) {
  if (typeof password !== 'string' || password.trim().length < 8 || password.length > 128) throw new Error('Пароль: от 8 до 128 символов, не только пробелы.');
}
async function passwordHash(password, salt) {
  if (!globalThis.crypto?.subtle) throw new Error('Пароли требуют Web Crypto: HTTPS или локальный HTML в современном браузере. Этот HTML Viewer может не поддерживать защиту.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS,
    salt: Uint8Array.from(salt.match(/../g), (n) => parseInt(n, 16)) }, key, 256)));
}
async function makeCredential(password) {
  checkPassword(password);
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await passwordHash(password, salt), iterations: ITERATIONS };
}
function validCredential(auth) {
  return auth?.iterations === ITERATIONS && /^[a-f0-9]{32}$/.test(auth.salt) && /^[a-f0-9]{64}$/.test(auth.hash);
}
function equals(a, b) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
function normalizeLogin(value) {
  const login = String(value || '').normalize('NFKC').trim().toLowerCase();
  if (!/^[a-zа-яё0-9_.-]{3,32}$/u.test(login)) throw new Error('Логин: 3–32 буквы, цифры, точки, дефисы или подчёркивания, без пробелов.');
  return login;
}
function cleanName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 60) throw new Error('Имя: от 1 до 60 символов.');
  return name;
}
function cleanAvatar(value) {
  if (AVATARS.includes(value)) return value;
  if (typeof value === 'string' && value.length < 100000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) return value;
  throw new Error('Выберите аватар из списка или загрузите небольшую фотографию.');
}
function validAgeGrade(age, grade) {
  if (!Number.isInteger(Number(age)) || Number(age) < 5 || Number(age) > 21) throw new Error('Возраст ученика: 5–21 год.');
  if (!Number.isInteger(Number(grade)) || Number(grade) < 1 || Number(grade) > 11) throw new Error('Класс: от 1 до 11.');
}

function readRegistry() {
  const raw = storage().getItem(ACCOUNTS_KEY);
  if (!raw) return { version: 1, revision: 0, accounts: [], sessions: [], invitations: [] };
  try {
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1 || !Array.isArray(data.accounts) || !data.accounts.length || data.accounts.length > 40 ||
        !Array.isArray(data.sessions) || !Array.isArray(data.invitations)) throw new Error();
    const ids = new Set(); const logins = new Set();
    for (const account of data.accounts) {
      if (!/^[a-f0-9]{48}$/.test(account.id) || ids.has(account.id) || logins.has(account.login) ||
          normalizeLogin(account.login) !== account.login || !validCredential(account.auth) ||
          !['parent', 'child'].includes(account.role) || !Number.isSafeInteger(account.authVersion) || account.authVersion < 1 ||
          typeof account.disabled !== 'boolean' || !Array.isArray(account.parentIds) || account.parentIds.some((id) => !/^[a-f0-9]{48}$/.test(id))) throw new Error();
      cleanName(account.name); cleanAvatar(account.avatar);
      ids.add(account.id); logins.add(account.login);
      if (account.role === 'child') {
        validAgeGrade(account.age, account.grade);
        if (!account.policy || typeof account.policy.tutorOnly !== 'boolean' || typeof account.policy.allowAi !== 'boolean' || typeof account.policy.aiSettingsOwnerId !== 'string' || (account.policy.aiSettingsOwnerId && !account.parentIds.includes(account.policy.aiSettingsOwnerId))) throw new Error();
      }
    }
    for (const account of data.accounts.filter((a) => a.role === 'child')) {
      if (!account.parentIds.length || account.parentIds.some((id) => !data.accounts.some((p) => p.id === id && p.role === 'parent'))) throw new Error();
    }
    if (!data.accounts.some((a) => a.id === data.legacyOwnerId && a.role === 'parent')) throw new Error();
    if (data.sessions.length > 80 || data.sessions.some((session) => !session || !ids.has(session.id) ||
        !/^[a-f0-9]{48}$/.test(session.token) || !Number.isSafeInteger(session.authVersion) || session.authVersion < 1 || !Number.isFinite(session.expires))) throw new Error();
    if (data.invitations.length > 40 || data.invitations.some((invitation) => !invitation || !ids.has(invitation.childId) ||
        !/^[A-F0-9]{12}$/.test(invitation.code) || !Number.isFinite(invitation.expires))) throw new Error();
    return data;
  } catch {
    throw new Error('База аккаунтов повреждена. Вход и создание обходного аккаунта заблокированы. Не очищайте данные: сохраните профиль браузера для восстановления.');
  }
}
function emit() { for (const fn of listeners) { try { fn(); } catch { /* subscribers are independent */ } } }
export function subscribeAccounts(fn) {
  listeners.add(fn);
  const onStorage = (event) => { if (event.key === ACCOUNTS_KEY || event.key === null) fn(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
}
function writeRegistry(data, expectedRevision) {
  const current = readRegistry();
  if (current.revision !== expectedRevision) throw new Error('Данные изменились в другой вкладке. Повторите действие.');
  persistLocal(ACCOUNTS_KEY, { ...data, revision: expectedRevision + 1 });
  emit();
}
function withLock(action) {
  return globalThis.navigator?.locks?.request ? navigator.locks.request('domashka-accounts-v4', action) : action();
}
function readBootSession() {
  try {
    const marker = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!marker) return null;
    const data = readRegistry();
    const session = data.sessions.find((s) => s.id === marker.id && s.token === marker.token && s.expires > Date.now());
    const account = data.accounts.find((a) => a.id === marker.id && !a.disabled && a.authVersion === session?.authVersion);
    return account && session ? { ...session, role: account.role } : null;
  } catch { return null; }
}
// Workspace identity never changes within a page. Switching accounts reloads the page,
// so an old asynchronous write cannot land in the next child's workspace.
const BOOT_SESSION = readBootSession();
export const WORKSPACE_ID = BOOT_SESSION?.id || '';
export function workspaceKeyFor(id, key) { return id ? `domashka_user_${id}::${key}` : key; }
export function workspaceKey(key) { return workspaceKeyFor(WORKSPACE_ID, key); }
export function workspaceDbName(id = WORKSPACE_ID) { return id ? `domashka_pro_db_v4_${id}` : 'domashka_pro_db_v3'; }
function publicAccount(account) {
  if (!account) return null;
  const { auth, authVersion, ...safe } = account;
  return structuredCloneSafe(safe);
}
function structuredCloneSafe(value) { return JSON.parse(JSON.stringify(value)); }
export function getCurrentAccount() {
  if (transitioning || !BOOT_SESSION) return null;
  try {
    const data = readRegistry();
    const account = data.accounts.find((a) => a.id === BOOT_SESSION.id && !a.disabled && a.authVersion === BOOT_SESSION.authVersion);
    const session = data.sessions.find((s) => s.token === BOOT_SESSION.token && s.id === BOOT_SESSION.id && s.expires > Date.now());
    return account && session ? publicAccount(account) : null;
  } catch { return null; }
}
export function getAccountGate() {
  try {
    const data = readRegistry();
    return { configured: data.accounts.length > 0, account: getCurrentAccount(), transitioning, error: '',
      accounts: data.accounts.map(({ id, login, name, avatar, role }) => ({ id, login, name, avatar, role })) };
  } catch (error) { return { configured: true, account: null, transitioning, error: error.message, accounts: [] }; }
}
export function ensureWorkspaceActive() {
  if (transitioning || (WORKSPACE_ID ? !getCurrentAccount() : getAccountGate().configured)) throw new DOMException('Аккаунт изменён. Войдите заново.', 'AbortError');
}
export function getManagedChild() { const a = getCurrentAccount(); return a?.role === 'child' ? a : null; }
export function isChildWorkspace() { return BOOT_SESSION?.role === 'child'; }
export function assertAiAllowed() {
  ensureWorkspaceActive();
  if (getManagedChild()?.policy.allowAi === false) throw new Error('Родитель отключил ИИ для этого аккаунта. Дневник и локальные материалы остаются доступны.');
}
function parentAccount() {
  ensureWorkspaceActive();
  const account = getCurrentAccount();
  if (account?.role !== 'parent') throw new Error('Это действие доступно только после входа в родительский аккаунт.');
  return account;
}
function ownedChild(data, id, parent = parentAccount()) {
  const child = data.accounts.find((a) => a.id === id && a.role === 'child' && a.parentIds.includes(parent.id));
  if (!child) throw new Error('Этот ученик не привязан к вашему аккаунту.');
  return child;
}
export function getChildren() {
  const parent = parentAccount();
  return readRegistry().accounts.filter((a) => a.role === 'child' && a.parentIds.includes(parent.id)).map(publicAccount);
}
export function canManageChild(id) {
  try { ownedChild(readRegistry(), id); return true; } catch { return false; }
}
export function getInheritedAiSettings() {
  const child = getManagedChild();
  const owner = child?.policy.aiSettingsOwnerId;
  if (!owner || !child.parentIds.includes(owner)) return null;
  try { return JSON.parse(storage().getItem(workspaceKeyFor(owner, 'domashka_pro_ai_settings_v2')) || 'null'); } catch { return null; }
}

function attemptState(key) {
  const raw = storage().getItem(key);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('Счётчик входа повреждён. Сохраните данные браузера для восстановления.'); }
}
async function verify(password, auth, attemptsKey) {
  if (!validCredential(auth)) throw new Error('Защита повреждена. Пароль нельзя проверить.');
  const state = attemptState(attemptsKey);
  if (state.until > Date.now()) throw new Error(`Слишком много попыток. Подождите ${Math.ceil((state.until - Date.now()) / 1000)} сек.`);
  if (!equals(await passwordHash(String(password || '').slice(0, 129), auth.salt), auth.hash)) {
    const count = (Number(state.count) || 0) + 1;
    persistLocal(attemptsKey, { count, until: count >= 5 ? Date.now() + Math.min(300000, 30000 * 2 ** Math.min(count - 5, 4)) : 0 });
    throw new Error(count >= 5 ? 'Неверный пароль. Следующая попытка — через 30 секунд или позже.' : 'Неверный логин или пароль.');
  }
  storage().removeItem(attemptsKey);
}
async function verifyParent(password) {
  const parent = parentAccount(); const data = readRegistry();
  const record = data.accounts.find((a) => a.id === parent.id);
  await verify(password, record.auth, ATTEMPTS_PREFIX + parent.id);
  parentAccount();
  if (readRegistry().revision !== data.revision) throw new Error('Данные изменились. Повторите действие.');
  return parent;
}
export function needsLegacyPassword() {
  try { return Boolean(storage().getItem(LEGACY_LOCK_KEY)); } catch { return true; }
}
async function authorizeLegacyMigration(password) {
  const raw = storage().getItem(LEGACY_LOCK_KEY);
  if (!raw) return;
  let config;
  try { config = JSON.parse(raw); } catch { throw new Error('Старая родительская защита повреждена. Создание аккаунта заблокировано.'); }
  if (config.version !== 1 || !validCredential(config)) throw new Error('Старая родительская защита повреждена.');
  await verify(password, config, 'domashka_parental_attempts_v1');
  if (storage().getItem(LEGACY_LOCK_KEY) !== raw) throw new Error('Старая защита изменилась. Повторите действие.');
}
export function issueParentChallenge() {
  for (const [id, challenge] of challenges) if (challenge.expires < Date.now()) challenges.delete(id);
  while (challenges.size >= 20) challenges.delete(challenges.keys().next().value);
  const random = crypto.getRandomValues(new Uint8Array(1))[0];
  const root = 4 + random % 12; const id = randomToken();
  challenges.set(id, { answer: root, expires: Date.now() + 300000 });
  return { id, square: root * root };
}
function checkChallenge(id, answer) {
  const challenge = challenges.get(id);
  if (!challenge || challenge.expires < Date.now() || String(answer).trim() !== String(challenge.answer)) throw new Error('Проверьте ответ на математический вопрос (или обновите вопрос). Это не проверка возраста.');
}
function sessionFor(account) { return { id: account.id, token: randomToken(), authVersion: account.authVersion, expires: Date.now() + SESSION_LIFETIME }; }
function stageSession(session) {
  try {
    const text = JSON.stringify({ id: session.id, token: session.token });
    window.sessionStorage.setItem(SESSION_KEY, text);
    if (window.sessionStorage.getItem(SESSION_KEY) !== text) throw new Error();
  } catch { throw new Error('Не удалось сохранить сеанс. Разрешите sessionStorage в браузере.'); }
}
export function beginAccountTransition() { transitioning = true; emit(); }

export async function createAccount({ login, password, name, avatar = AVATARS[0], role = 'child', grade = 1, age = 7,
  challengeId, challengeAnswer, legacyPassword = '', parentPassword = '' }) {
  return withLock(async () => {
    const data = readRegistry();
    const first = data.accounts.length === 0;
    const parent = first ? null : parentAccount();
    if (first && role !== 'parent') throw new Error('Сначала создайте родительский аккаунт.');
    if (!['parent', 'child'].includes(role)) throw new Error('Неизвестный тип аккаунта.');
    if (data.accounts.length >= 40) throw new Error('В этом браузере уже 40 аккаунтов.');
    const normalized = normalizeLogin(login); cleanName(name); cleanAvatar(avatar);
    if (data.accounts.some((a) => a.login === normalized)) throw new Error('Этот логин уже занят в данном браузере.');
    const legacySnapshot = first ? storage().getItem(LEGACY_LOCK_KEY) : null;
    if (role === 'parent') {
      checkChallenge(challengeId, challengeAnswer);
      if (first) await authorizeLegacyMigration(legacyPassword);
      else await verifyParent(parentPassword);
    } else validAgeGrade(age, grade);
    const auth = await makeCredential(password);
    if (first && storage().getItem(LEGACY_LOCK_KEY) !== legacySnapshot) throw new Error('Старая защита изменилась. Повторите действие.');
    if (!first) parentAccount();
    const account = { id: randomToken(), login: normalized, name: cleanName(name), avatar: cleanAvatar(avatar), role,
      grade: role === 'child' ? Number(grade) : null, age: role === 'child' ? Number(age) : null, parentIds: parent && role === 'child' ? [parent.id] : [],
      policy: { tutorOnly: true, allowAi: true, aiSettingsOwnerId: '' },
      disabled: false, authVersion: 1, auth, createdAt: Date.now() };
    data.accounts.push(account);
    if (first) data.legacyOwnerId = account.id;
    // Registration does not log a parent into the newly created child's workspace.
    let session;
    if (first) {
      session = sessionFor(account);
      stageSession(session); // fail before publishing accounts if the session cannot be stored
      data.sessions.push(session);
    }
    writeRegistry(data, data.revision);
    if (role === 'parent') challenges.delete(challengeId);
    if (session) beginAccountTransition();
    return publicAccount(account);
  });
}
export async function loginAccount(login, password) {
  return withLock(async () => {
    const data = readRegistry(); const normalized = normalizeLogin(login);
    const account = data.accounts.find((a) => a.login === normalized);
    if (!account || account.disabled) throw new Error('Неверный логин или пароль, либо аккаунт заблокирован родителем.');
    await verify(password, account.auth, ATTEMPTS_PREFIX + account.id);
    const session = sessionFor(account); stageSession(session);
    data.sessions = data.sessions.filter((s) => s.expires > Date.now()).slice(-79);
    data.sessions.push(session);
    writeRegistry(data, data.revision);
    beginAccountTransition();
    return publicAccount(account);
  });
}
export function logoutAccount() {
  const data = readRegistry();
  const account = data.accounts.find((a) => a.id === WORKSPACE_ID);
  if (account) {
    account.authVersion += 1;
    data.sessions = data.sessions.filter((s) => s.id !== account.id);
    writeRegistry(data, data.revision);
  }
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* already inaccessible */ }
  beginAccountTransition();
}
export function updateAppearance({ name, avatar }) {
  ensureWorkspaceActive(); const current = getCurrentAccount();
  if (!current) throw new Error('Сначала войдите в аккаунт.');
  const data = readRegistry(); const account = data.accounts.find((a) => a.id === current.id);
  account.name = cleanName(name); account.avatar = cleanAvatar(avatar);
  writeRegistry(data, data.revision);
  return publicAccount(account);
}
export function updateChild(id, { grade, age, tutorOnly, allowAi, disabled, shareAiSettings }) {
  const parent = parentAccount(); const data = readRegistry(); const child = ownedChild(data, id, parent);
  validAgeGrade(age, grade);
  child.grade = Number(grade); child.age = Number(age);
  child.policy = { tutorOnly: Boolean(tutorOnly), allowAi: Boolean(allowAi), aiSettingsOwnerId: shareAiSettings ? parent.id : '' };
  child.disabled = Boolean(disabled); child.authVersion += 1;
  data.sessions = data.sessions.filter((s) => s.id !== child.id);
  writeRegistry(data, data.revision);
  return publicAccount(child);
}
export async function changeAccountPassword(currentPassword, nextPassword) {
  return withLock(async () => {
    ensureWorkspaceActive(); const current = getCurrentAccount();
    if (!current) throw new Error('Сначала войдите.');
    const data = readRegistry(); const account = data.accounts.find((a) => a.id === current.id);
    await verify(currentPassword, account.auth, ATTEMPTS_PREFIX + account.id);
    const auth = await makeCredential(nextPassword); ensureWorkspaceActive();
    account.auth = auth; account.authVersion += 1;
    const session = sessionFor(account); stageSession(session);
    data.sessions = data.sessions.filter((s) => s.id !== account.id && s.expires > Date.now()); data.sessions.push(session);
    writeRegistry(data, data.revision); beginAccountTransition();
  });
}
export async function resetChildPassword(id, parentPassword, nextPassword) {
  return withLock(async () => {
    const parent = await verifyParent(parentPassword); const data = readRegistry(); const child = ownedChild(data, id, parent);
    const auth = await makeCredential(nextPassword); parentAccount();
    child.auth = auth; child.authVersion += 1;
    data.sessions = data.sessions.filter((s) => s.id !== child.id);
    writeRegistry(data, data.revision);
  });
}
export function createLinkCode(id) {
  const data = readRegistry(); ownedChild(data, id);
  const code = randomToken().slice(0, 12).toUpperCase();
  data.invitations = data.invitations.filter((x) => x.childId !== id && x.expires > Date.now());
  data.invitations.push({ code, childId: id, expires: Date.now() + 15 * 60 * 1000 });
  writeRegistry(data, data.revision);
  return code;
}
export function linkChild(code) {
  const parent = parentAccount(); const data = readRegistry();
  const invitation = data.invitations.find((i) => i.code === String(code).trim().toUpperCase() && i.expires > Date.now());
  if (!invitation) throw new Error('Код не найден, уже использован или истёк. Получите новый код у текущего родителя.');
  const child = data.accounts.find((a) => a.id === invitation.childId && a.role === 'child');
  if (!child) throw new Error('Ученик не найден.');
  if (!child.parentIds.includes(parent.id)) child.parentIds.push(parent.id);
  data.invitations = data.invitations.filter((i) => i !== invitation);
  writeRegistry(data, data.revision);
  return publicAccount(child);
}
export function revokeChildLink(childId, parentId) {
  const parent = parentAccount(); const data = readRegistry(); const child = ownedChild(data, childId, parent);
  if (!child.parentIds.includes(parentId) || child.parentIds.length <= 1) throw new Error('У ученика должен остаться хотя бы один родитель.');
  child.parentIds = child.parentIds.filter((id) => id !== parentId);
  if (child.policy.aiSettingsOwnerId === parentId) child.policy.aiSettingsOwnerId = '';
  child.authVersion += 1;
  data.sessions = data.sessions.filter((s) => s.id !== child.id);
  data.invitations = data.invitations.filter((i) => i.childId !== childId);
  writeRegistry(data, data.revision);
}
export function getChildStudySummary(id) {
  const data = readRegistry(); ownedChild(data, id);
  const read = (key, fallback) => { try { return JSON.parse(storage().getItem(workspaceKeyFor(id, key))) || fallback; } catch { return fallback; } };
  const tasks = read('domashka_diary_tasks_v21', []);
  return { stats: read('domashka_student_stats_v3', {}), grades: read('domashka_subject_grades_v22', {}),
    tasks: Array.isArray(tasks) ? tasks : [] };
}

export function authorizeLegacyCopy(targetId) {
  const parent = parentAccount(); const data = readRegistry();
  if (data.legacyOwnerId !== parent.id) throw new Error('Старые данные может перенести только первый родитель, создавший семейную базу.');
  if (targetId !== parent.id) ownedChild(data, targetId, parent);
  return true;
}
export function isLegacyOwner() { try { return readRegistry().legacyOwnerId === parentAccount().id; } catch { return false; } }
