import { cloud } from '../cloud/bridge';
import { SYNC_PREFS, assertDocument, clone } from '../cloud/schema';
import { getCurrentAccount, ensureWorkspaceActive } from './accounts';
import { chatStore, safeStorage, getStudentStats } from './storageEngine';

const CHAT_FIELDS = ['id','item_type','grade','exam_goal','subject','mode','photo_mode','photo_input_used','tutor_only','title',
  'task_text','condition_text','draft_text','has_image','image_b64','images_b64','ocr_text','response_md','precheck_md',
  'sympy_badge','provider_used','favorite','messages','created_at','updated_at'];
const COUNTERS = ['xp','solvedCount','checkedCount','quizCorrect','streakDays'];
function studyStats(raw = {}) {
  return Object.fromEntries(COUNTERS.map((key) => [key, Number.isSafeInteger(raw[key]) && raw[key] >= 0 ? Math.min(raw[key],10000000) : 0]));
}
function cleanChat(record) {
  if (!record || !['string','number'].includes(typeof record.id) || !/^[A-Za-z0-9_-]{1,128}$/.test(String(record.id)) || typeof record.response_md !== 'string') throw new Error('Файл содержит повреждённый чат.');
  const clean = Object.fromEntries(CHAT_FIELDS.filter((key) => Object.hasOwn(record,key)).map((key) => [key, clone(record[key])]));
  const photos = [clean.image_b64, ...(Array.isArray(clean.images_b64) ? clean.images_b64 : [])].filter(Boolean);
  if (photos.length > 5 || photos.some((image) => typeof image !== 'string' || image.length > 2700000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(image))) throw new Error('В переносимом файле нужны сами фото JPEG/PNG/WebP до 2 МБ каждое, не чужие облачные ссылки.');
  for (const key of ['title','task_text','condition_text','draft_text','ocr_text','response_md','precheck_md']) if (clean[key] !== undefined && typeof clean[key] !== 'string') throw new Error('Некорректный текст чата.');
  clean.messages = Array.isArray(clean.messages) ? clean.messages.filter((item) => item && ['user','assistant'].includes(item.role) && typeof item.content === 'string')
    .slice(0,500).map(({ role, content }) => ({ role, content })) : [];
  return clean;
}
export async function exportStudyWorkspace() {
  ensureWorkspaceActive(); const settings = {};
  for (const key of SYNC_PREFS) { const value = safeStorage.getItem(key); if (value !== null) settings[key] = value; }
  const chats = []; let size = 0;
  for (const record of await chatStore.list()) {
    ensureWorkspaceActive(); const item = cleanChat(cloud() ? await chatStore.get(record.id) : record);
    size += JSON.stringify(item).length;
    if (size > 40000000) throw new Error('Экспорт с фото больше 40 МБ. Сначала сохраните тетрадь отдельным архивом и уменьшите объём переноса.');
    chats.push(item);
  }
  return { type: 'domashka-study-transfer', version: 1, exportedAt: new Date().toISOString(),
    sourceName: getCurrentAccount()?.name || 'Локальное рабочее пространство', settings, chats, stats: studyStats(getStudentStats()) };
}
export function parseStudyImport(text) {
  if (typeof text !== 'string' || text.length > 40000000) throw new Error('Файл переноса должен быть JSON до 40 МБ.');
  const parsed = JSON.parse(text);
  if (parsed?.type === 'domashka-cloud-recovery') return { recovery: parsed };
  const notebook = !parsed?.type && Array.isArray(parsed?.items);
  if (!notebook && (parsed?.type !== 'domashka-study-transfer' || parsed.version !== 1)) throw new Error('Нужен экспорт учебного пространства или тетради. Базы аккаунтов, пароли и архивы семейных работ сюда не импортируются.');
  const settings = notebook ? {} : parsed.settings || {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Некорректные настройки переноса.');
  const documents = []; const seen = new Set();
  for (const [key, value] of Object.entries(settings)) { assertDocument(`pref/${key}`, value); documents.push({ key: `pref/${key}`, value }); }
  const chats = notebook ? parsed.items : parsed.chats;
  if (!Array.isArray(chats) || chats.length > 5000) throw new Error('В файле должно быть не более 5000 чатов.');
  for (const raw of chats) {
    const value = cleanChat(raw); const key = `chat/${value.id}`;
    if (seen.has(key)) throw new Error('Файл содержит повторяющиеся идентификаторы чатов.');
    seen.add(key); assertDocument(key, value); documents.push({ key, value });
  }
  return { documents, stats: studyStats(parsed.stats), chats: chats.length, settings: Object.keys(settings).length,
    sourceName: String(parsed.sourceName || 'Архив тетради').slice(0,60) };
}
export async function importStudyToCloud(parsed, target, { includeStats = false } = {}) {
  const runtime = cloud(); if (!runtime) throw new Error('Импорт в облако выполняется после входа на облачном сайте.');
  await runtime.requireSaved(); runtime.assertActive();
  if (target !== runtime.uid && !runtime.canManageChild(target)) throw new Error('Можно перенести только себе или своему ученику.');
  if (parsed.recovery) {
    const data = parsed.recovery;
    if (data.project !== runtime.projectRef || data.workspace?.uid !== runtime.uid || target !== runtime.uid || data.workspace.format !== 1) throw new Error('Копия восстановления подходит только для того же аккаунта и облачного проекта.');
    const pending = data.workspace.pending || {};
    // Validate everything BEFORE changing the durable outbox. Never import the
    // cached roles/stats/receipts from a recovery file as authoritative data.
    for (const [key, op] of Object.entries(pending)) {
      assertDocument(key, op.value);
      if (!/^[a-f0-9-]{36}$/.test(op.id) || !Number.isSafeInteger(op.baseVersion) || op.baseVersion < 0) throw new Error('Повреждена очередь восстановления.');
    }
    const events = data.workspace.events || {};
    for (const [id, event] of Object.entries(events)) if (id !== event.id || !/^[a-f0-9-]{36}$/.test(id) || !['solve','check','quiz','quiz_correct','homework_done'].includes(event.kind) || !Number.isSafeInteger(event.gain) || event.gain < 0 || event.gain > 240) throw new Error('Повреждены события восстановления.');
    let added = 0; let skipped = 0;
    for (const [key, op] of Object.entries(pending)) {
      if (runtime.sync.pending[key]) skipped++;
      else { runtime.sync.pending[key] = clone(op); added++; }
    }
    for (const [id, event] of Object.entries(events)) if (!runtime.sync.events[id] && !runtime.sync.receipts.includes(id)) { runtime.sync.events[id] = clone(event); added++; }
    await runtime.sync.durable(); await runtime.refresh(); return { added, skipped, recovery: true };
  }
  if (includeStats && runtime.family.account.role !== 'parent') throw new Error('Старые XP переносит родитель с отдельной отметкой, не как проверенные ответы.');
  let added = 0; let skipped = 0;
  try {
    for (let offset = 0; offset < parsed.documents.length; offset += 200) {
      const documents = [];
      for (const doc of parsed.documents.slice(offset,offset + 200)) documents.push({ key: doc.key, value: await runtime.photos.pack(doc.value, { target }) });
      const result = await runtime.rpc('domashka_import_workspace', { target, documents, legacy_stats: null });
      added += result.added; skipped += result.skipped;
    }
    if (includeStats) await runtime.rpc('domashka_import_workspace', { target, documents: [], legacy_stats: parsed.stats });
    await runtime.refreshFamily(); if (target !== runtime.uid) await runtime.refreshChildSummary(target);
    await runtime.refresh(); return { added, skipped };
  } catch (error) { throw new Error(`Подтверждённо добавлено: ${added}, пропущено: ${skipped}. ${error.message} Оригинальный файл и старые локальные данные не удалены. Повторный импорт не заменяет существующие записи.`); }
}
