import React, { useEffect, useRef, useState } from 'react';
import {
  MessageSquarePlus,
  Search,
  Star,
  Trash2,
  Edit3,
  Check,
  X,
  Download,
  Upload,
  Sparkles,
  CheckCircle2,
  HardDrive,
  Flame,
} from 'lucide-react';
import { chatStore, subscribeHistory, getStudentStats } from '../api';

export default function ChatSidebar({
  tutorOnly = false,
  variant = 'desktop', // 'desktop' | 'drawer'
  open = true,
  onClose,
  activeChatId,
  onSelectChat,
  onStartNewChat,
  onCountChange,
}) {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all' | 'solve' | 'check' | 'favorites'
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [backupMsg, setBackupMsg] = useState('');
  const [stats, setStats] = useState(() => getStudentStats());
  const importRef = useRef(null);

  const refresh = async () => {
    const all = await chatStore.list({ filter, search });
    const list = tutorOnly ? all.filter((item) => item.tutor_only === true && item.item_type === 'solve') : all;
    setItems(list);
    if (filter === 'all' && !search) {
      onCountChange?.(list.length);
    } else {
      const total = await chatStore.list({ filter: 'all', search: '' });
      onCountChange?.(tutorOnly ? total.filter((item) => item.tutor_only === true && item.item_type === 'solve').length : total.length);
    }
    setStats(getStudentStats());
  };

  useEffect(() => {
    refresh();
  }, [filter, search, tutorOnly]);

  useEffect(() => {
    return subscribeHistory(() => {
      refresh();
    });
  }, [filter, search, tutorOnly]);

  // CRITICAL: When rendered as slide-over drawer and closed, render NOTHING!
  if (variant === 'drawer' && !open) {
    return null;
  }
  if (variant === 'desktop' && !open) {
    return null;
  }

  const handleToggleFav = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    await chatStore.toggleFavorite(id);
  };

  const handleDelete = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    await chatStore.delete(id);
    if (activeChatId === id) {
      onStartNewChat?.();
    }
  };

  const startRename = (e, item) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(item.id);
    setEditTitle(item.title || item.task_text || '');
  };

  const saveRename = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    if (editTitle.trim()) {
      await chatStore.update(id, { title: editTitle.trim() });
    }
    setEditingId(null);
  };

  const handleExport = async () => {
    if (tutorOnly) return;
    const jsonStr = await chatStore.exportJson();
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Domashka_PRO_Chats_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupMsg('Копия чатов скачана!');
    setTimeout(() => setBackupMsg(''), 3000);
  };

  const handleImport = async (e) => {
    if (tutorOnly) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await chatStore.importJson(text);
      setBackupMsg(`Загружено чатов: +${res.added}`);
    } catch (err) {
      setBackupMsg(err.message);
    }
    e.target.value = '';
    setTimeout(() => setBackupMsg(''), 3500);
  };

  const formatRelTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const xp = stats.xp || 0;
  const rankInfo =
    xp >= 1500
      ? { title: '👑 Стобалльник', next: null, pct: 100 }
      : xp >= 700
      ? { title: '🏆 Олимпиадник', next: 1500, pct: Math.round(((xp - 700) / 800) * 100) }
      : xp >= 300
      ? { title: '🏅 Отличник', next: 700, pct: Math.round(((xp - 300) / 400) * 100) }
      : xp >= 100
      ? { title: '📘 Знаток', next: 300, pct: Math.round(((xp - 100) / 200) * 100) }
      : { title: '🌱 Ученик', next: 100, pct: Math.round((xp / 100) * 100) };

  const badges = [
    { id: 'solve1', icon: '✨', label: 'Решатель', unlocked: (stats.solvedCount || 0) >= 1 || items.some((i) => i.item_type !== 'check') },
    { id: 'check1', icon: '🔍', label: 'Ревизор', unlocked: (stats.checkedCount || 0) >= 1 || items.some((i) => i.item_type === 'check') },
    { id: 'quiz5', icon: '🎯', label: 'Снайпер', unlocked: (stats.quizCorrect || 0) >= 3 || xp >= 80 },
    { id: 'streak3', icon: '🔥', label: '3+ дня', unlocked: (stats.streakDays || 1) >= 3 },
  ];

  const panel = (
    <div className="flex flex-col h-full w-full overflow-hidden bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 select-none">
      {/* Top: New Chat + Close (for drawer) */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onStartNewChat?.();
              if (variant === 'drawer') onClose?.();
            }}
            className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-extrabold shadow-sm transition"
          >
            <MessageSquarePlus className="w-4 h-4 shrink-0" />
            <span>Новое задание / чат</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Скрыть панель чатов"
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по чатам..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Filters */}
        <div className="grid grid-cols-4 gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl">
          {[
            { id: 'all', label: 'Все' },
            { id: 'solve', label: tutorOnly ? 'Обучение' : 'Решения' },
            { id: 'check', label: 'Проверки' },
            { id: 'favorites', label: '⭐' },
          ].filter((f) => !tutorOnly || f.id !== 'check').map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`py-1 rounded-lg text-[11px] font-bold transition ${
                filter === f.id
                  ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable Chat History List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2.5 space-y-1.5">
        {items.length === 0 ? (
          <div className="text-center py-10 px-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto mb-2.5">
              <HardDrive className="w-5 h-5" />
            </div>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Список чатов пуст
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Решённые задачи и проверенные работы автоматически сохранятся здесь.
            </p>
          </div>
        ) : (
          items.map((item) => {
            const isSelected = activeChatId === item.id;
            const msgCount = Array.isArray(item.messages) ? item.messages.length : 2;
            const isCheck = item.item_type === 'check';

            return (
              <div
                key={item.id}
                onClick={() => {
                  onSelectChat?.(item);
                  if (variant === 'drawer') onClose?.();
                }}
                className={`group w-full rounded-xl p-2.5 cursor-pointer border transition ${
                  isSelected
                    ? 'bg-indigo-50 dark:bg-indigo-950/70 border-indigo-300 dark:border-indigo-700 shadow-sm'
                    : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/70 border-slate-200/70 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                    {isCheck ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    )}

                    {editingId === item.id ? (
                      <div
                        className="flex items-center gap-1 flex-1 min-w-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRename(e, item.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                          className="w-full min-w-0 text-xs px-2 py-0.5 rounded border border-indigo-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={(e) => saveRename(e, item.id)}
                          className="text-emerald-600 p-1 hover:bg-emerald-50 rounded shrink-0"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="block text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                        {item.title || item.task_text || 'Домашнее задание'}
                      </span>
                    )}
                  </div>

                  {editingId !== item.id && (
                    <div className="flex items-center shrink-0">
                      <button
                        type="button"
                        onClick={(e) => handleToggleFav(e, item.id)}
                        title="В избранное"
                        className={`p-1 rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-700 transition ${
                          item.favorite ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'
                        }`}
                      >
                        <Star className={`w-3.5 h-3.5 ${item.favorite ? 'fill-amber-400' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => startRename(e, item)}
                        title="Переименовать"
                        className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(e, item.id)}
                        title="Удалить чат"
                        className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 mt-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-semibold text-slate-600 dark:text-slate-300">
                      {item.grade} кл.
                    </span>
                    {item.has_image ? <span title="С фото">📷</span> : null}
                    <span>💬 {Math.max(1, Math.floor(msgCount / 2))}</span>
                  </span>
                  <span>{formatRelTime(item.updated_at || item.created_at)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer: Student Rank + Achievements + Auto-Save + Backup */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900 space-y-2 shrink-0">
        <div className="p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-extrabold text-amber-950 dark:text-amber-200">
            <span>{rankInfo.title}</span>
            <span className="inline-flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-orange-500 fill-orange-500" />
              {stats.streakDays || 1} дн. · ⭐ {xp} XP
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-amber-200/70 dark:bg-amber-900/60 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all"
              style={{ width: `${Math.min(100, Math.max(6, rankInfo.pct))}%` }}
            />
          </div>
          <div className="grid grid-cols-4 gap-1 pt-0.5">
            {badges.map((b) => (
              <div
                key={b.id}
                title={b.unlocked ? `Ачивка открыта: ${b.label}` : `Ачивка закрыта: ${b.label}`}
                className={`text-center py-0.5 rounded-md text-[10px] font-bold border ${
                  b.unlocked
                    ? 'bg-white dark:bg-slate-800 border-amber-300 dark:border-amber-700 text-slate-800 dark:text-amber-200'
                    : 'bg-slate-100/60 dark:bg-slate-900/50 border-transparent text-slate-400 opacity-55 grayscale'
                }`}
              >
                {b.icon}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-0.5">
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Автосохранение
          </span>
          <span>Всего: {items.length}</span>
        </div>

        {backupMsg && (
          <div className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 rounded-lg">
            {backupMsg}
          </div>
        )}

        {!tutorOnly && <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            <Download className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
            Скачать копию
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            <Upload className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            Загрузить
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImport}
          />
        </div>}
      </div>
    </div>
  );

  if (variant === 'drawer') {
    return (
      <div className="fixed inset-0 z-50 flex lg:hidden">
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
          onClick={onClose}
        />
        <div className="relative z-10 w-72 max-w-[85vw] h-full shadow-2xl">{panel}</div>
      </div>
    );
  }

  return (
    <aside className="no-print hidden lg:block w-72 min-w-[288px] max-w-[288px] shrink-0 sticky top-[57px] h-[calc(100vh-57px)]">
      {panel}
    </aside>
  );
}
