import { getCurrentAccount, ensureWorkspaceActive, canManageChild, persistLocal } from './accounts';

const BACKEND_KEY = 'domashka_family_backend_v4';
const FALLBACK_KEY = 'domashka_family_homework_v4';
const DB_NAME = 'domashka_family_v4';
const STORE = 'homework';
let opening;
const listeners = new Set();
const CHANGE_KEY = 'domashka_family_change_v4';

function actor() {
  ensureWorkspaceActive();
  const current = getCurrentAccount();
  if (!current) throw new Error('Войдите в семейный аккаунт.');
  return current;
}
function mayRead(item, user = actor()) {
  return user.role === 'child' ? item.childId === user.id : canManageChild(item.childId);
}
function emit() {
  try { localStorage.setItem(CHANGE_KEY, `${Date.now()}-${Math.random()}`); } catch { /* records are already durable */ }
  for (const listener of listeners) listener();
}
export function subscribeHomework(listener) {
  listeners.add(listener);
  const update = (event) => { if ([CHANGE_KEY, FALLBACK_KEY, null].includes(event.key)) listener(); };
  window.addEventListener('storage', update);
  return () => { listeners.delete(listener); window.removeEventListener('storage', update); };
}
function openDB() {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    if (!globalThis.indexedDB) { resolve(null); return; }
    let settled = false;
    const finish = (db) => { if (settled) { db?.close(); return; } settled = true; clearTimeout(timer); resolve(db); };
    const timer = setTimeout(() => finish(null), 4000);
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }); };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
      request.onsuccess = () => finish(request.result);
    } catch { finish(null); }
  });
  return opening;
}
async function backend() {
  const selected = localStorage.getItem(BACKEND_KEY);
  if (selected === 'localStorage') return null;
  const db = await openDB();
  if (selected === 'indexedDB' && !db) throw new Error('Хранилище семейных ДЗ сейчас недоступно. Данные не заменены пустой базой. Перезапустите браузер или откройте тот же адрес/HTML в прежнем приложении.');
  if (!selected) persistLocal(BACKEND_KEY, db ? 'indexedDB' : 'localStorage');
  return db;
}
export function homeworkStorageNotice() {
  return localStorage.getItem(BACKEND_KEY) === 'localStorage'
    ? 'IndexedDB недоступна: используется ограниченное localStorage. Если место закончится, экспортируйте проверенные работы и удалите их.' : '';
}
function fallbackRead() {
  const raw = localStorage.getItem(FALLBACK_KEY);
  if (!raw) return [];
  try { const data = JSON.parse(raw); if (!Array.isArray(data)) throw new Error(); data.forEach(validateRecord); return data; }
  catch { throw new Error('Локальная база ДЗ повреждена. Не очищайте хранилище: сохраните данные браузера.'); }
}
function assertSameActor(initial) { if (actor().id !== initial.id) throw new DOMException('Аккаунт изменён.', 'AbortError'); }
function validateRecord(item) {
  if (!item || typeof item.id !== 'string' || typeof item.childId !== 'string' || !Number.isInteger(item.version) ||
      !['assigned', 'submitted', 'revision', 'accepted'].includes(item.status)) throw new Error('Запись семейного ДЗ повреждена.');
}
export async function listHomework(childId = '') {
  const user = actor(); const db = await backend();
  const metadata = (item) => ({ ...item, submission: item.submission ? {
    ...item.submission, image: '', hasImage: Boolean(item.submission.image),
  } : null });
  // Do not materialize every family's base64 photographs into one getAll result.
  const all = db ? await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly'); const request = transaction.objectStore(STORE).openCursor();
    const list = [];
    request.onsuccess = () => { try { const cursor = request.result;
      if (!cursor) { resolve(list); return; }
      validateRecord(cursor.value);
      if (mayRead(cursor.value, user) && (!childId || cursor.value.childId === childId)) list.push(metadata(cursor.value));
      cursor.continue();
    } catch (error) { reject(error); } };
    transaction.onabort = () => reject(new Error('Чтение семейных заданий прервано. Повторите после входа.'));
    request.onerror = () => reject(new Error('Не удалось прочитать семейные задания.'));
  }) : fallbackRead().filter((item) => mayRead(item, user)).map(metadata);
  assertSameActor(user);
  return all.filter((item) => mayRead(item, user) && (!childId || item.childId === childId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
async function mutate(id, update, expectedVersion) {
  const user = actor(); const db = await backend(); assertSameActor(user);
  let result;
  const apply = (previous) => {
    assertSameActor(user);
    if (previous) {
      validateRecord(previous);
      if (!mayRead(previous, user)) throw new Error('Это задание недоступно вашему аккаунту.');
      if (expectedVersion !== undefined && previous.version !== expectedVersion) throw new Error('Работа изменилась в другой вкладке. Обновите список и проверьте свежую версию.');
    }
    result = update(previous, user);
    if (result) result = { ...result, version: (previous?.version || 0) + 1, updatedAt: Date.now() };
    return result;
  };
  if (db) {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite'); const store = transaction.objectStore(STORE);
      const request = store.get(id); let cause;
      request.onsuccess = () => {
        try { const next = apply(request.result); if (next) store.put(next); else store.delete(id); }
        catch (error) { cause = error; transaction.abort(); }
      };
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => reject(cause || new Error('Работа не сохранена: хранилище недоступно или переполнено. Освободите место, не закрывая форму.'));
    });
  } else {
    const all = fallbackRead(); const index = all.findIndex((item) => item.id === id);
    const next = apply(index >= 0 ? all[index] : null);
    if (index >= 0) all.splice(index, 1);
    if (next) all.push(next);
    persistLocal(FALLBACK_KEY, all);
  }
  emit(); return result;
}
function text(value, label, max, required = false) {
  const output = String(value || '').trim();
  if ((required && !output) || output.length > max) throw new Error(`${label}: ${required ? 'от 1' : 'от 0'} до ${max} символов.`);
  return output;
}
function photo(value) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 1600000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) throw new Error('Фото ответа слишком велико или имеет неподдерживаемый формат.');
  return value;
}
export async function assignHomework({ childId, subject, title, instructions, due }) {
  const user = actor();
  if (user.role !== 'parent' || !canManageChild(childId)) throw new Error('Задания назначает родитель своему ученику.');
  if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due)) || new Date(`${due}T12:00:00Z`).toISOString().slice(0, 10) !== due)) throw new Error('Укажите корректную дату сдачи.');
  const id = crypto.randomUUID();
  const item = { id, childId, subject: text(subject, 'Предмет', 40, true), title: text(title, 'Заголовок', 200, true),
    instructions: text(instructions, 'Условие', 12000, true), due: due || '', status: 'assigned',
    authorId: user.id, authorName: user.name, createdAt: Date.now(), submission: null, review: null };
  return mutate(id, (_, current) => {
    if (current.role !== 'parent' || !canManageChild(childId)) throw new Error('Нет доступа к ученику.');
    return item;
  });
}
export async function submitHomework(id, { answer, image = '' }, version) {
  const submission = { text: text(answer, 'Ответ', 16000), image: photo(image), submittedAt: Date.now() };
  if (!submission.text && !submission.image) throw new Error('Напишите ответ или приложите фотографию работы.');
  return mutate(id, (item, user) => {
    if (!item || user.role !== 'child' || item.childId !== user.id) throw new Error('Отправить ответ может только назначенный ученик.');
    if (item.status === 'accepted') throw new Error('Работа уже принята. Попросите родителя вернуть её на доработку.');
    return { ...item, status: 'submitted', submission, review: null };
  }, version);
}
export async function reviewHomework(id, { accepted, comment, mark }, version) {
  if (mark !== '' && mark !== null && mark !== undefined && (!Number.isInteger(Number(mark)) || Number(mark) < 1 || Number(mark) > 5)) throw new Error('Оценка: от 1 до 5 или без оценки.');
  const feedback = text(comment, 'Комментарий', 8000, !accepted);
  return mutate(id, (item, user) => {
    if (!item || user.role !== 'parent' || !canManageChild(item.childId) || !item.submission) throw new Error('Сначала ученик должен прислать работу.');
    return { ...item, status: accepted ? 'accepted' : 'revision', review: { comment: feedback,
      mark: mark === '' || mark === null || mark === undefined ? null : Number(mark), byName: user.name, byId: user.id, reviewedAt: Date.now() } };
  }, version);
}
export async function deleteHomework(id, version) {
  return mutate(id, (item, user) => {
    if (!item || user.role !== 'parent' || !canManageChild(item.childId)) throw new Error('Удаление задания доступно родителю.');
    return null;
  }, version);
}
export async function getHomework(id) {
  const user = actor(); const db = await backend();
  const item = db ? await new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Не удалось загрузить работу.'));
  }) : fallbackRead().find((record) => record.id === id);
  assertSameActor(user);
  if (!item || !mayRead(item, user)) throw new Error('Это задание недоступно вашему аккаунту.');
  validateRecord(item); return item;
}
export async function exportHomework(childId = '', ids) {
  const list = await listHomework(childId);
  const selected = ids ? list.filter((item) => ids.includes(item.id)) : list;
  if (selected.length > 50) throw new Error('Для безопасного экспорта выберите не более 50 работ. В интерфейсе скачиваются работы текущей страницы.');
  const items = [];
  for (const item of selected) items.push(await getHomework(item.id));
  return JSON.stringify({ app: 'Домашка.ПРО', type: 'family-homework-export', version: 1,
    exportedAt: new Date().toISOString(), items }, null, 2);
}
