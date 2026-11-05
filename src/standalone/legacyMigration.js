import { authorizeLegacyCopy, ensureWorkspaceActive, workspaceKeyFor, workspaceDbName, persistLocal } from './accounts';

const PREFS = ['domashka_pro_student_profile_v2', 'domashka_pro_theme_v3', 'domashka_cheat_bookmarks_v21',
  'domashka_diary_tasks_v21', 'domashka_subject_grades_v22', 'domashka_subject_grades_v21', 'domashka_grade_round_frac_v22',
  'domashka_timetable_v30', 'domashka_bells_v30', 'domashka_student_stats_v3', 'domashka_mistake_bank_v32',
  'domashka_draft_v3_solver', 'domashka_draft_v3_checker'];
const HISTORY = 'domashka_pro_notebook_history_v2';
function open(name) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { resolve(null); return; }
    let finished = false;
    const timer = setTimeout(() => { finished = true; reject(new Error('Перенос тетради не завершён: IndexedDB не ответила. Старые данные не удалены; повторите позже.')); }, 5000);
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('chats')) {
        const store = db.createObjectStore('chats', { keyPath: 'id' }); store.createIndex('updated_at', 'updated_at');
      }
    };
    request.onerror = () => { clearTimeout(timer); reject(new Error('Старая тетрадь недоступна. Перенос не завершён, оригиналы сохранены.')); };
    request.onsuccess = () => { clearTimeout(timer); if (finished) request.result.close(); else resolve(request.result); };
  });
}
export async function copyLegacyWorkspace(targetId) {
  authorizeLegacyCopy(targetId);
  let copiedPreferences = 0;
  // No API keys, family registry, passwords or login sessions are copied.
  for (const key of PREFS) {
    const value = localStorage.getItem(key); const target = workspaceKeyFor(targetId, key);
    if (value !== null && localStorage.getItem(target) === null) { persistLocal(target, value); copiedPreferences++; }
  }
  const source = await open(workspaceDbName(''));
  let records = [];
  try {
    if (source) records = await new Promise((resolve, reject) => {
      const request = source.transaction('chats', 'readonly').objectStore('chats').getAll();
      request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(new Error('Не удалось прочитать старые чаты.'));
    });
  } finally { source?.close(); }
  const raw = localStorage.getItem(HISTORY);
  const fallback = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(fallback)) throw new Error('Старая резервная история повреждена; оригиналы не удалены.');
  const seen = new Set(records.map((x) => x.id));
  for (const item of fallback) if (item?.id && !seen.has(item.id)) { records.push(item); seen.add(item.id); }
  ensureWorkspaceActive(); authorizeLegacyCopy(targetId);
  const target = await open(workspaceDbName(targetId));
  let copiedChats = 0;
  if (target) {
    try {
      await new Promise((resolve, reject) => {
        const transaction = target.transaction('chats', 'readwrite'); const store = transaction.objectStore('chats');
        const request = store.getAllKeys(); let cause;
        request.onsuccess = () => {
          try {
            authorizeLegacyCopy(targetId); const existing = new Set(request.result);
            for (const record of records) if (!existing.has(record.id)) { store.add(record); copiedChats++; }
          } catch (error) { cause = error; transaction.abort(); }
        };
        transaction.oncomplete = resolve; transaction.onerror = transaction.onabort = () => reject(cause || new Error('Не удалось перенести тетрадь. Старые данные не удалены.'));
      });
    } finally { target.close(); }
  } else {
    const key = workspaceKeyFor(targetId, HISTORY); const existing = JSON.parse(localStorage.getItem(key) || '[]');
    const ids = new Set(existing.map((x) => x.id));
    for (const item of records) if (!ids.has(item.id)) { existing.push(item); copiedChats++; }
    persistLocal(key, existing);
  }
  return { copiedPreferences, copiedChats };
}
