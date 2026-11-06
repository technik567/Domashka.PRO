// Unified Persistent Storage Engine (IndexedDB for large chat histories + photos, localStorage for fast prefs & drafts, memory fallback)
import { APP_VERSION } from '../version';
import { workspaceKey, workspaceDbName, ensureWorkspaceActive, persistLocal } from './accounts';
import { cloud } from '../cloud/bridge';
import { isSyncPreference } from '../cloud/schema';

const memoryMap = new Map();
const volatileKeys = new Set();

export const safeStorage = {
  getItem(key) {
    if (cloud() && isSyncPreference(key)) return cloud().getPreference(key);
    key = workspaceKey(key);
    if (volatileKeys.has(key)) return memoryMap.get(key) ?? null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memoryMap.has(key) ? memoryMap.get(key) : null;
    }
  },
  setItem(key, value) {
    if (cloud() && isSyncPreference(key)) { cloud().setPreference(key, String(value)); return; }
    key = workspaceKey(key);
    const str = String(value);
    memoryMap.set(key, str);
    try {
      window.localStorage.setItem(key, str);
      volatileKeys.delete(key);
    } catch {
      volatileKeys.add(key);
      // Ignore quota or sandboxed iframe error
    }
  },
  removeItem(key) {
    if (cloud() && isSyncPreference(key)) { cloud().setPreference(key, null); return; }
    key = workspaceKey(key);
    memoryMap.delete(key);
    try {
      window.localStorage.removeItem(key);
      volatileKeys.delete(key);
    } catch {
      volatileKeys.add(key);
      // Ignore
    }
  },
  setItemStrict(key, value) {
    if (cloud() && isSyncPreference(key)) throw new Error('В облаке нужен подтверждённый сервером результат.');
    const scoped = workspaceKey(key); const text = String(value);
    persistLocal(scoped, text); memoryMap.set(scoped, text); volatileKeys.delete(scoped);
  },
  isPersistent() {
    try {
      const k = '__domashka_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  },
};

// ==================== IndexedDB Wrapper for Unlimited Chat & Photo History ====================
let idbName; // resolved once, after account/bootstrap; never changes mid-page
const IDB_STORE = 'chats';
const LS_FALLBACK_KEY = 'domashka_pro_notebook_history_v2';

let idbPromise = null;
const memoryChats = new Map();
let chatSequence = 0;

function openChatDB() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(idbName ||= workspaceDbName(), 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          store.createIndex('updated_at', 'updated_at', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return idbPromise;
}

async function migrateLegacyLocalStorageIfNeeded(db) {
  try {
    const migrated = safeStorage.getItem('__domashka_idb_migrated_v3__');
    if (migrated) return;
    const raw = safeStorage.getItem(LS_FALLBACK_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0 && db) {
        await new Promise((res) => {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          const store = tx.objectStore(IDB_STORE);
          for (const item of arr) {
            if (item && item.id) {
              store.put({
                ...item,
                title: item.title || (item.task_text || 'Домашнее задание').slice(0, 70),
                updated_at: item.updated_at || item.created_at || Math.floor(Date.now() / 1000),
              });
            }
          }
          tx.oncomplete = () => res();
          tx.onerror = () => res();
        });
      }
    }
    safeStorage.setItem('__domashka_idb_migrated_v3__', '1');
  } catch {
    // ignore
  }
}

function readFallbackList() {
  try {
    const raw = safeStorage.getItem(LS_FALLBACK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return Array.from(memoryChats.values());
}

function writeFallbackList(list) {
  memoryChats.clear();
  for (const item of list) memoryChats.set(item.id, item);
  // Strip heavy base64 images in localStorage fallback to prevent 5MB overflow
  const slim = list.slice(0, 80).map((x) => {
    const copy = { ...x };
    if (copy.image_b64 && copy.image_b64.length > 40000) {
      delete copy.image_b64;
    }
    copy.images_b64 = (copy.images_b64 || []).filter((uri) => uri.length <= 40000);
    return copy;
  });
  safeStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(slim));
}

export const chatStore = {
  async list({ filter = 'all', search = '' } = {}) {
    const db = cloud() ? null : await openChatDB();
    let all = [];
    if (cloud()) { all = cloud().listChats(); } else if (db) {
      await migrateLegacyLocalStorageIfNeeded(db);
      all = await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve(readFallbackList());
      });
    } else {
      all = readFallbackList();
    }

    all.sort((a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0));

    let filtered = all;
    if (filter === 'favorites') filtered = filtered.filter((x) => x.favorite === 1);
    else if (filter === 'solve') filtered = filtered.filter((x) => x.item_type === 'solve');
    else if (filter === 'check') filtered = filtered.filter((x) => x.item_type === 'check');
    else if (filter === 'quiz') filtered = filtered.filter((x) => x.item_type === 'quiz');

    const q = (search || '').trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(
        (x) =>
          (x.title || '').toLowerCase().includes(q) ||
          (x.task_text || '').toLowerCase().includes(q) ||
          (x.response_md || '').toLowerCase().includes(q)
      );
    }
    return filtered;
  },

  async get(id) {
    if (cloud()) return cloud().getChat(id);
    const db = await openChatDB();
    if (db) {
      return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    }
    return readFallbackList().find((x) => x.id === id) || null;
  },

  async saveNew({
    item_type = 'solve',
    grade = 8,
    exam_goal = 'fgos',
    subject = 'auto',
    mode = 'notebook',
    tutor_only = false,
    images_b64 = [],
    photo_mode = 'auto',
    photo_input_used = 'none',
    title = '',
    task_text = '',
    condition_text = '',
    draft_text = '',
    image_b64 = '',
    ocr_text = '',
    response_md = '',
    precheck_md = '',
    sympy_badge = '',
    provider_used = '',
    messages = [],
  }) {
    ensureWorkspaceActive();
    const now = Math.floor(Date.now() / 1000);
    const id = globalThis.crypto?.randomUUID?.() || `chat-${Date.now()}-${++chatSequence}`;
    const autoTitle =
      (title || task_text || condition_text || draft_text || 'Задание по фото')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 68) || 'Новый разбор';

    const record = {
      id,
      created_at: now,
      updated_at: now,
      item_type,
      grade: Number(grade) || 8,
      exam_goal,
      subject,
      mode,
      tutor_only: Boolean(tutor_only),
      photo_mode: ['auto', 'vision', 'ocr'].includes(photo_mode) ? photo_mode : 'auto',
      photo_input_used: ['vision', 'ocr', 'none'].includes(photo_input_used) ? photo_input_used : 'none',
      images_b64: images_b64.length ? images_b64.slice(0, 4) : image_b64 ? [image_b64] : [],
      title: autoTitle,
      task_text: (task_text || '').trim() || autoTitle,
      condition_text: condition_text || '',
      draft_text: draft_text || '',
      has_image: image_b64 || images_b64.length ? 1 : 0,
      image_b64: image_b64 || '',
      ocr_text: ocr_text || '',
      response_md,
      precheck_md,
      sympy_badge,
      provider_used,
      favorite: 0,
      messages,
    };

    if (cloud()) { await cloud().putChat(record); recordStudentActivity(item_type); return record; }
    const db = await openChatDB();
    if (db) {
      ensureWorkspaceActive();
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    const fb = readFallbackList();
    fb.unshift(record);
    writeFallbackList(fb);

    recordStudentActivity(item_type);
    notifyHistoryListeners();
    return record;
  },

  async update(id, patch) {
    ensureWorkspaceActive();
    const existing = await this.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...patch,
      updated_at: Math.floor(Date.now() / 1000),
    };
    if (cloud()) return cloud().putChat(updated);
    const db = await openChatDB();
    if (db) {
      ensureWorkspaceActive();
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(updated);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    const fb = readFallbackList().map((x) => (x.id === id ? updated : x));
    writeFallbackList(fb);
    notifyHistoryListeners();
    return updated;
  },

  async toggleFavorite(id) {
    const existing = await this.get(id);
    if (!existing) return null;
    const nextFav = existing.favorite ? 0 : 1;
    await this.update(id, { favorite: nextFav });
    return nextFav;
  },

  async delete(id) {
    if (cloud()) return cloud().deleteChat(id);
    ensureWorkspaceActive();
    const db = await openChatDB();
    if (db) {
      ensureWorkspaceActive();
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    const fb = readFallbackList().filter((x) => x.id !== id);
    writeFallbackList(fb);
    notifyHistoryListeners();
    return true;
  },

  async clearAll() {
    if (cloud()) return cloud().clearChats();
    ensureWorkspaceActive();
    const db = await openChatDB();
    if (db) {
      ensureWorkspaceActive();
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    writeFallbackList([]);
    notifyHistoryListeners();
  },

  async exportJson() {
    if (cloud()) return cloud().exportChats();
    const items = await this.list();
    return JSON.stringify(
      {
        app: `Домашка.ПРО ${APP_VERSION}`,
        exportedAt: new Date().toISOString(),
        stats: getStudentStats(),
        items,
      },
      null,
      2
    );
  },

  async importJson(jsonStr) {
    ensureWorkspaceActive();
    const parsed = JSON.parse(jsonStr);
    const incoming = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(incoming)) {
      throw new Error('Файл не содержит записей Домашка.ПРО.');
    }
    const existing = await this.list();
    const seen = new Set(existing.map((x) => x.id));
    const db = cloud() ? null : await openChatDB();
    let added = 0;
    for (const item of incoming) {
      if (item && (typeof item.id === 'string' || (typeof item.id === 'number' && Number.isFinite(item.id))) &&
          typeof item.response_md === 'string' && item.response_md && !seen.has(item.id)) {
        item.tutor_only = false;
        item.photo_mode = ['auto', 'vision', 'ocr'].includes(item.photo_mode) ? item.photo_mode : 'auto';
        item.photo_input_used = ['vision', 'ocr', 'none'].includes(item.photo_input_used) ? item.photo_input_used : 'none';
        for (const field of ['title', 'task_text', 'subject', 'mode']) item[field] = String(item[field] || '');
        item.messages = Array.isArray(item.messages) ? item.messages.filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string') : [];
        item.images_b64 = Array.isArray(item.images_b64) ? item.images_b64.filter((uri) => typeof uri === 'string').slice(0, 4) : [];
        seen.add(item.id);
        added++;
        ensureWorkspaceActive();
        if (cloud()) await cloud().putChat(item);
        else if (db) {
          await new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(item);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          });
        }
        existing.push(item);
      }
    }
    if (!cloud()) writeFallbackList(existing);
    notifyHistoryListeners();
    return { added, total: existing.length };
  },
};

// ==================== Event Emitter for Live Chat List Sync ====================
const listeners = new Set();
export function subscribeHistory(fn) {
  if (cloud()) return cloud().subscribe(fn);
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notifyHistoryListeners() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
}

// ==================== Auto-Save Unsent Input Drafts ====================
const DRAFT_PREFIX = 'domashka_draft_v3_';

export function saveInputDraft(section, data) {
  safeStorage.setItem(
    DRAFT_PREFIX + section,
    JSON.stringify({ ...data, savedAt: Date.now() })
  );
}

export function loadInputDraft(section) {
  try {
    const raw = safeStorage.getItem(DRAFT_PREFIX + section);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ==================== Student Progress, XP & Streak ====================
const STATS_KEY = 'domashka_student_stats_v3';

const COUNTERS = ['solvedCount', 'checkedCount', 'quizCorrect', 'xp', 'streakDays'];
function localStats() {
  const base = { solvedCount: 0, checkedCount: 0, quizCorrect: 0, xp: 0, streakDays: 1, lastActiveDate: '', rewardClaims: {} };
  try {
    const raw = JSON.parse(safeStorage.getItem(STATS_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    const result = { ...base, ...raw };
    for (const key of COUNTERS) result[key] = Number.isSafeInteger(raw[key]) && raw[key] >= 0 ? raw[key] : base[key];
    if (!result.rewardClaims || typeof result.rewardClaims !== 'object' || Array.isArray(result.rewardClaims)) result.rewardClaims = {};
    return result;
  } catch { return base; }
}
export function getStudentStats() { return cloud() ? cloud().getStudentStats() : localStats(); }
function nextStats(cur, type, xpGain) {
  const date = new Date();
  // Calendar days in the device's local timezone, not UTC and not 24h/DST intervals.
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const previous = /^\d{4}-\d{2}-\d{2}$/.test(cur.lastActiveDate) ? Date.parse(cur.lastActiveDate + 'T00:00:00Z') : NaN;
  const difference = (Date.parse(today + 'T00:00:00Z') - previous) / 86400000;
  const streak = difference === 1 ? (cur.streakDays || 1) + 1 : difference > 1 ? 1 : cur.streakDays || 1;
  return { ...cur, solvedCount: cur.solvedCount + (type === 'solve' ? 1 : 0),
    checkedCount: cur.checkedCount + (type === 'check' ? 1 : 0), quizCorrect: cur.quizCorrect + (type === 'quiz_correct' ? 1 : 0),
    xp: cur.xp + xpGain, streakDays: streak, lastActiveDate: today };
}
export function recordStudentActivity(type, xpGain = 15, options = {}) {
  ensureWorkspaceActive();
  if (!['solve','check','quiz','quiz_correct','homework_done'].includes(type) || !Number.isSafeInteger(xpGain) || xpGain < 0 || xpGain > 240) throw new Error('Некорректное начисление опыта.');
  if (cloud()) return cloud().recordStudentActivity(type, xpGain, options);
  const current = localStats(); const key = options.eventKey ? `${type}:${options.eventKey}` : '';
  if (key && Object.hasOwn(current.rewardClaims, key)) return current;
  const next = nextStats(current, type, xpGain);
  if (key) { next.rewardClaims = { ...current.rewardClaims, [key]: true }; safeStorage.setItemStrict(STATS_KEY, JSON.stringify(next)); }
  else safeStorage.setItem(STATS_KEY, JSON.stringify(next));
  notifyHistoryListeners(); return next;
}
export function rewardVerifiedFlashcard(cardKey) {
  ensureWorkspaceActive();
  if (cloud()) throw new Error('Облачные карточки проверяет сервер.');
  const current = localStats(); const key = `card:${cardKey}`;
  if (Object.hasOwn(current.rewardClaims, key)) return 0;
  const next = nextStats(current, 'quiz_correct', 4);
  next.rewardClaims = { ...current.rewardClaims, [key]: true };
  // Claim and XP are ONE durable write. A quota error grants neither; a crash
  // between separate writes cannot consume a reward without updating the score.
  safeStorage.setItemStrict(STATS_KEY, JSON.stringify(next));
  notifyHistoryListeners(); return 4;
}

// ==================== Personal Mistake Bank ("Копилка моих ошибок" v3.2) ====================
const MISTAKES_KEY = 'domashka_mistake_bank_v32';
const mistakeListeners = new Set();

export function subscribeMistakes(fn) {
  if (cloud()) return cloud().subscribe(fn);
  mistakeListeners.add(fn);
  return () => mistakeListeners.delete(fn);
}

function notifyMistakeListeners() {
  for (const fn of mistakeListeners) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
}

function readMistakesRaw() {
  try {
    const raw = safeStorage.getItem(MISTAKES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeMistakesRaw(arr) {
  safeStorage.setItem(MISTAKES_KEY, JSON.stringify(arr.slice(0, 150)));
  notifyMistakeListeners();
}

export const mistakeStore = {
  list() {
    return readMistakesRaw().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  addMany(items) {
    if (!Array.isArray(items) || !items.length) return 0;
    const cur = readMistakesRaw();
    const seen = new Set(
      cur.map((m) => `${String(m.wrong || '').toLowerCase().trim()}::${String(m.rule || '').toLowerCase().slice(0, 40)}`)
    );
    let added = 0;
    for (const raw of items) {
      const wrong = String(raw.wrong || '').trim();
      const rule = String(raw.rule || '').trim();
      if (!wrong && !rule) continue;
      const key = `${wrong.toLowerCase()}::${rule.toLowerCase().slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cur.unshift({
        id: `mk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        subject: raw.subject || 'russian',
        grade: Number(raw.grade) || 8,
        category: String(raw.category || 'Правило ФГОС').trim(),
        wrong: wrong || 'Ошибка в задании',
        rule: rule || 'Повторить школьное правило',
        source: raw.source || 'check',
        mastered: false,
        createdAt: Date.now(),
      });
      added += 1;
    }
    if (added > 0) writeMistakesRaw(cur);
    return added;
  },

  toggleMastered(id, explicitVal) {
    const cur = readMistakesRaw();
    const next = cur.map((m) =>
      m.id === id ? { ...m, mastered: typeof explicitVal === 'boolean' ? explicitVal : !m.mastered } : m
    );
    writeMistakesRaw(next);
    return next;
  },

  remove(id) {
    const next = readMistakesRaw().filter((m) => m.id !== id);
    writeMistakesRaw(next);
    return next;
  },

  clearMastered() {
    const next = readMistakesRaw().filter((m) => !m.mastered);
    writeMistakesRaw(next);
    return next;
  },

  /**
   * Parses AI DraftChecker Markdown table (`| Фрагмент ученика | Тип ошибки | Как правильно и почему |`)
   * plus local express findings and saves real mistakes into the student's personal bank!
   */
  captureFromDraftCheck(markdown, expressFindings = [], { checkType = 'general', grade = 8 } = {}) {
    const collected = [];
    const subjGuess =
      checkType === 'math_step'
        ? 'math'
        : checkType === 'essay_oge' || checkType === 'essay_ege'
        ? 'russian'
        : 'russian';

    // 1. Parse Markdown error table rows
    const lines = String(markdown || '').split(/\r?\n/);
    for (const ln of lines) {
      const t = ln.trim();
      if (!t.startsWith('|') || !t.endsWith('|')) continue;
      if (/^\|[\s\-:|]+\|$/.test(t)) continue;
      const cols = t
        .slice(1, -1)
        .split('|')
        .map((c) => c.replace(/\*\*/g, '').replace(/`/g, '').trim());
      if (cols.length < 3) continue;
      const [frag, errType, fixRule] = cols;
      const lowFrag = frag.toLowerCase();
      const lowRule = fixRule.toLowerCase();
      if (
        lowFrag.includes('фрагмент') ||
        lowFrag.includes('ошибок нет') ||
        lowFrag === '—' ||
        lowFrag === '-' ||
        lowRule.includes('ошибок не найдено') ||
        lowRule.includes('всё верно')
      ) {
        continue;
      }
      const inferredSubj =
        /[0-9xXyY=+\-^]|дискриминант|корень уравнения|вычислен/i.test(`${frag} ${errType} ${fixRule}`)
          ? 'math'
          : subjGuess;
      collected.push({
        subject: inferredSubj,
        grade,
        category: errType || 'Ошибка в работе',
        wrong: frag,
        rule: fixRule,
        source: 'check',
      });
    }

    // 2. Merge express findings if AI table had none
    if (collected.length === 0 && Array.isArray(expressFindings)) {
      for (const f of expressFindings) {
        if (f?.fragment && f?.why) {
          collected.push({
            subject: /[0-9=]/.test(f.fragment) ? 'math' : subjGuess,
            grade,
            category: 'Экспресс-проверка',
            wrong: f.fragment,
            rule: `${f.fix ? `Правильно: «${f.fix}». ` : ''}${f.why}`,
            source: 'check',
          });
        }
      }
    }

    return this.addMany(collected);
  },
};
