import { safeStorage } from './storageEngine';
export { safeStorage };

const HISTORY_KEY = 'domashka_pro_notebook_history_v2';

function readAllHistory() {
  try {
    const raw = safeStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAllHistory(items) {
  // Keep up to 100 latest items so localStorage never overflows
  const trimmed = items.slice(0, 100);
  safeStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

export const localNotebookDB = {
  list(favoritesOnly = false) {
    const all = readAllHistory();
    all.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return favoritesOnly ? all.filter((x) => x.favorite === 1) : all;
  },

  saveItem({
    item_type,
    grade,
    exam_goal,
    subject,
    mode,
    task_text,
    has_image,
    response_md,
    sympy_badge = '',
    provider_used = '',
    messages = [],
  }) {
    const all = readAllHistory();
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const record = {
      id,
      created_at: Math.floor(Date.now() / 1000),
      item_type,
      grade: Number(grade) || 8,
      exam_goal: exam_goal || 'fgos',
      subject: subject || 'auto',
      mode: mode || 'notebook',
      task_text: (task_text || '').trim() || '(Задание по фото)',
      has_image: has_image ? 1 : 0,
      response_md,
      sympy_badge,
      provider_used,
      favorite: 0,
      messages,
    };
    all.unshift(record);
    writeAllHistory(all);
    return id;
  },

  updateMessages(id, messages) {
    const all = readAllHistory();
    const idx = all.findIndex((x) => x.id === id);
    if (idx !== -1) {
      all[idx].messages = messages;
      writeAllHistory(all);
    }
  },

  toggleFavorite(id) {
    const all = readAllHistory();
    const idx = all.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    all[idx].favorite = all[idx].favorite ? 0 : 1;
    writeAllHistory(all);
    return all[idx].favorite;
  },

  deleteItem(id) {
    const all = readAllHistory();
    const next = all.filter((x) => x.id !== id);
    writeAllHistory(next);
    return next.length !== all.length;
  },

  exportJson() {
    return JSON.stringify(
      {
        app: 'Домашка.ПРО',
        exportedAt: new Date().toISOString(),
        items: readAllHistory(),
      },
      null,
      2
    );
  },

  importJson(jsonStr) {
    const data = JSON.parse(jsonStr);
    const incoming = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(incoming)) {
      throw new Error('Некорректный файл резервной копии тетради.');
    }
    const existing = readAllHistory();
    const seenIds = new Set(existing.map((x) => x.id));
    for (const item of incoming) {
      if (item && item.response_md && !seenIds.has(item.id)) {
        existing.push(item);
        seenIds.add(item.id);
      }
    }
    existing.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    writeAllHistory(existing);
    return existing.length;
  },
};
