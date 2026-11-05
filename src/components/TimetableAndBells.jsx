import React, { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarDays, Clock, Plus, RotateCcw } from 'lucide-react';
import { SUBJECTS } from '../data/referenceData';
import { safeStorage } from '../standalone/storageEngine';

const TIMETABLE_KEY = 'domashka_timetable_v30';
const BELLS_KEY = 'domashka_bells_v30';

const DAYS = [
  { id: 'mon', short: 'ПН', full: 'Понедельник', jsDay: 1 },
  { id: 'tue', short: 'ВТ', full: 'Вторник', jsDay: 2 },
  { id: 'wed', short: 'СР', full: 'Среда', jsDay: 3 },
  { id: 'thu', short: 'ЧТ', full: 'Четверг', jsDay: 4 },
  { id: 'fri', short: 'ПТ', full: 'Пятница', jsDay: 5 },
  { id: 'sat', short: 'СБ', full: 'Суббота', jsDay: 6 },
];

const DEFAULT_TIMETABLE = {
  mon: ['math', 'russian', 'history', 'english', 'biology', '', ''],
  tue: ['geometry', 'physics', 'literature', 'informatics', 'geography', '', ''],
  wed: ['math', 'russian', 'chemistry', 'english', 'social', '', ''],
  thu: ['geometry', 'physics', 'russian', 'history', 'literature', '', ''],
  fri: ['math', 'english', 'biology', 'chemistry', 'informatics', '', ''],
  sat: ['', '', '', '', '', '', ''],
};

const DEFAULT_BELL_CONFIG = {
  firstStart: '08:30',
  lessonMin: 45,
  breaks: [10, 15, 20, 15, 10, 10], // breaks after lessons 1..6
};

function parseHm(hm) {
  const [h, m] = String(hm || '08:30').split(':').map(Number);
  return (Number.isFinite(h) ? h : 8) * 60 + (Number.isFinite(m) ? m : 30);
}

function fmtHm(totalMin) {
  const norm = ((totalMin % 1440) + 1440) % 1440;
  const h = String(Math.floor(norm / 60)).padStart(2, '0');
  const m = String(norm % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export default function TimetableAndBells({ onQuickAddHomework }) {
  const realSubjects = useMemo(() => SUBJECTS.filter((s) => s.id !== 'auto'), []);
  const todayJsDay = new Date().getDay(); // 0 Sun .. 6 Sat
  const initialDay = DAYS.find((d) => d.jsDay === todayJsDay)?.id || 'mon';

  const [activeDay, setActiveDay] = useState(initialDay);
  const [quickTaskNote, setQuickTaskNote] = useState({});
  const [addedBanner, setAddedBanner] = useState('');
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [timetable, setTimetable] = useState(() => {
    try {
      const raw = JSON.parse(safeStorage.getItem(TIMETABLE_KEY) || 'null');
      return raw && typeof raw === 'object' ? { ...DEFAULT_TIMETABLE, ...raw } : DEFAULT_TIMETABLE;
    } catch {
      return DEFAULT_TIMETABLE;
    }
  });

  const [bellCfg, setBellCfg] = useState(() => {
    try {
      const raw = JSON.parse(safeStorage.getItem(BELLS_KEY) || 'null');
      return raw && typeof raw === 'object' ? { ...DEFAULT_BELL_CONFIG, ...raw } : DEFAULT_BELL_CONFIG;
    } catch {
      return DEFAULT_BELL_CONFIG;
    }
  });

  useEffect(() => {
    safeStorage.setItem(TIMETABLE_KEY, JSON.stringify(timetable));
  }, [timetable]);

  useEffect(() => {
    safeStorage.setItem(BELLS_KEY, JSON.stringify(bellCfg));
  }, [bellCfg]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  const scheduleRows = useMemo(() => {
    let cur = parseHm(bellCfg.firstStart);
    const dur = Math.max(30, Math.min(60, Number(bellCfg.lessonMin) || 45));
    const rows = [];
    for (let i = 0; i < 7; i += 1) {
      const start = cur;
      const end = cur + dur;
      const breakMin = bellCfg.breaks[i] ?? 10;
      rows.push({
        num: i + 1,
        start,
        end,
        startStr: fmtHm(start),
        endStr: fmtHm(end),
        breakAfter: i < 6 ? breakMin : 0,
      });
      cur = end + breakMin;
    }
    return rows;
  }, [bellCfg]);

  const liveBellStatus = useMemo(() => {
    const d = new Date(nowTick);
    if (d.getDay() === 0) {
      return { badge: 'Выходной (воскресенье)', tone: 'slate' };
    }
    const nowMin = d.getHours() * 60 + d.getMinutes();
    const first = scheduleRows[0];
    const last = scheduleRows[scheduleRows.length - 1];
    if (nowMin < first.start) {
      const diff = first.start - nowMin;
      return {
        badge:
          diff <= 90
            ? `До 1-го урока осталось ${diff} мин (начало в ${first.startStr})`
            : `Уроки начинаются в ${first.startStr}`,
        tone: 'indigo',
      };
    }
    if (nowMin >= last.end) {
      return { badge: 'Уроки на сегодня завершены — время отдыха и домашки!', tone: 'emerald' };
    }
    for (let i = 0; i < scheduleRows.length; i += 1) {
      const r = scheduleRows[i];
      if (nowMin >= r.start && nowMin < r.end) {
        const left = r.end - nowMin;
        return {
          badge: `🔔 Сейчас идёт ${r.num}-й урок · до звонка на перемену: ${left} мин (${r.endStr})`,
          tone: 'amber',
          activeLessonIdx: i,
        };
      }
      const nextR = scheduleRows[i + 1];
      if (nextR && nowMin >= r.end && nowMin < nextR.start) {
        const left = nextR.start - nowMin;
        return {
          badge: `☕ Перемена после ${r.num}-го урока · до ${nextR.num}-го урока: ${left} мин`,
          tone: 'emerald',
        };
      }
    }
    return { badge: 'Расписание звонков активно', tone: 'slate' };
  }, [nowTick, scheduleRows]);

  const updateLesson = (dayId, idx, subjId) => {
    setTimetable((prev) => {
      const nextDay = [...(prev[dayId] || Array(7).fill(''))];
      nextDay[idx] = subjId;
      return { ...prev, [dayId]: nextDay };
    });
  };

  const handleQuickHomework = (idx, subjId) => {
    if (!subjId || !onQuickAddHomework) return;
    const key = `${activeDay}_${idx}`;
    const text = (quickTaskNote[key] || '').trim() || 'Подготовиться к уроку / повторить конспект';
    const dayObj = DAYS.find((d) => d.id === activeDay);
    onQuickAddHomework({
      subject: subjId,
      text: `[${dayObj?.short || ''}, ${idx + 1} ур.] ${text}`,
    });
    setQuickTaskNote((prev) => ({ ...prev, [key]: '' }));
    setAddedBanner(`Добавлено в планер ДЗ: ${idx + 1}-й урок (${dayObj?.full})`);
    setTimeout(() => setAddedBanner(''), 2500);
  };

  const dayLessons = timetable[activeDay] || Array(7).fill('');

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm space-y-4">
      {/* Header + Live Bell Countdown */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
              Расписание уроков и живой таймер звонков
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Заполните свои уроки с ПН по СБ и добавляйте домашку в планер в 1 клик
            </p>
          </div>
        </div>

        <div
          className={`px-3 py-1.5 rounded-xl text-xs font-bold border inline-flex items-center gap-1.5 ${
            liveBellStatus.tone === 'amber'
              ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200'
              : liveBellStatus.tone === 'emerald'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-300'
          }`}
        >
          <Bell className="w-3.5 h-3.5 shrink-0" />
          <span>{liveBellStatus.badge}</span>
        </div>
      </div>

      {/* Bell settings bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
            <Clock className="w-3.5 h-3.5 text-indigo-500" />
            Начало 1-го урока:
            <input
              type="time"
              value={bellCfg.firstStart}
              onChange={(e) => setBellCfg((p) => ({ ...p, firstStart: e.target.value || '08:30' }))}
              className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold"
            />
          </label>
          <label className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
            Длительность урока:
            <select
              value={bellCfg.lessonMin}
              onChange={(e) => setBellCfg((p) => ({ ...p, lessonMin: Number(e.target.value) }))}
              className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold"
            >
              <option value={40}>40 мин</option>
              <option value={45}>45 мин (стандарт)</option>
              <option value={35}>35 мин (1 кл.)</option>
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={() => {
            setTimetable(DEFAULT_TIMETABLE);
            setBellCfg(DEFAULT_BELL_CONFIG);
          }}
          className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 inline-flex items-center gap-1"
        >
          <RotateCcw className="w-3 h-3" />
          По умолчанию
        </button>
      </div>

      {/* Day switcher */}
      <div className="grid grid-cols-6 gap-1.5">
        {DAYS.map((d) => {
          const isToday = d.jsDay === todayJsDay;
          const active = activeDay === d.id;
          const filledCount = (timetable[d.id] || []).filter(Boolean).length;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => setActiveDay(d.id)}
              className={`py-2 px-1 rounded-xl border text-center transition ${
                active
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                  : 'bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
              }`}
            >
              <div className="text-xs font-extrabold">
                {d.short}
                {isToday ? ' •' : ''}
              </div>
              <div className={`text-[10px] ${active ? 'text-indigo-100' : 'text-slate-400'}`}>
                {filledCount} ур.
              </div>
            </button>
          );
        })}
      </div>

      {addedBanner && (
        <div className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-800 dark:text-emerald-300">
          ✓ {addedBanner}
        </div>
      )}

      {/* Lessons list 1..7 */}
      <div className="space-y-2">
        {scheduleRows.map((row, idx) => {
          const subjId = dayLessons[idx] || '';
          const isCurrentNow =
            liveBellStatus.activeLessonIdx === idx &&
            DAYS.find((d) => d.id === activeDay)?.jsDay === todayJsDay;
          const noteKey = `${activeDay}_${idx}`;

          return (
            <div
              key={row.num}
              className={`p-2.5 sm:p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center gap-2 transition ${
                isCurrentNow
                  ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-400 ring-1 ring-amber-400'
                  : 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center gap-2.5 sm:w-44 shrink-0">
                <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
                  {row.num}
                </span>
                <div className="text-xs">
                  <div className="font-bold text-slate-800 dark:text-slate-100 font-mono">
                    {row.startStr} – {row.endStr}
                  </div>
                  {row.breakAfter > 0 && (
                    <div className="text-[10px] text-slate-400">перемена {row.breakAfter} мин</div>
                  )}
                </div>
              </div>

              <select
                value={subjId}
                onChange={(e) => updateLesson(activeDay, idx, e.target.value)}
                className="sm:w-56 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white outline-none"
              >
                <option value="">— Нет урока / окно —</option>
                {realSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>

              {subjId && onQuickAddHomework && (
                <div className="flex items-center gap-1.5 flex-1">
                  <input
                    type="text"
                    value={quickTaskNote[noteKey] || ''}
                    onChange={(e) =>
                      setQuickTaskNote((prev) => ({ ...prev, [noteKey]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleQuickHomework(idx, subjId);
                      }
                    }}
                    placeholder="Что задали? (например: §14, упр. 205)"
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleQuickHomework(idx, subjId)}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center gap-1 shrink-0"
                    title="Записать домашнее задание в планер"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>В ДЗ</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
