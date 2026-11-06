const DB = 'domashka_cloud_cache_v42';
let opening;
function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Для облачного кабинета нужен IndexedDB. Разрешите хранение данных сайта.')); return; }
    let settled = false;
    const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Кэш облака недоступен. Разрешите IndexedDB и хранение данных сайта.')); } };
    const timer = setTimeout(fail, 5000);
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspaces', { keyPath: 'cacheId' });
    request.onerror = request.onblocked = fail;
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true; clearTimeout(timer); const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; }; resolve(db);
    };
  });
  return opening;
}
async function transaction(uid, operation, data, project) {
  if (!/^[a-z0-9-]{1,63}$/.test(project || '')) throw new Error('Неизвестный проект кэша.');
  const cacheId = `${project}:${uid}`;
  if (!/^[a-f0-9-]{36}$/.test(uid)) throw new Error('Неизвестный владелец кэша.');
  if (data && data.uid !== uid) throw new Error('Нельзя записать кэш другого аккаунта.');
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspaces', operation === 'get' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('workspaces');
    const request = operation === 'get' ? store.get(cacheId) : operation === 'delete' ? store.delete(cacheId) : store.put({ ...data, cacheId, project });
    const fail = () => { clearTimeout(timer); reject(new Error('Не удалось сохранить кэш на устройстве. Не закрывайте страницу: скачайте копию несохранённых изменений.')); };
    const timer = setTimeout(() => { try { tx.abort(); } catch { /* already closed */ } fail(); }, 12000);
    tx.oncomplete = () => { clearTimeout(timer); resolve(request.result || null); };
    tx.onerror = tx.onabort = fail;
  });
}
export const loadCloudCache = (uid, project) => transaction(uid, 'get', null, project);
export const saveCloudCache = (uid, data, project) => transaction(uid, 'put', data, project);
export const clearCloudCache = (uid, project) => transaction(uid, 'delete', null, project);
