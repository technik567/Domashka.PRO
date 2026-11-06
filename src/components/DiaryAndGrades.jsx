import { studyId } from '../standalone/ids';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  CalendarCheck2,
  Calculator,
  Plus,
  Trash2,
  Sparkles,
  CheckCircle2,
  Circle,
  Award,
  TrendingUp,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Undo2,
  ClipboardPaste,
  Timer,
  Play,
  Pause,
  CalendarDays,
} from 'lucide-react';
import { SUBJECTS } from '../data/referenceData';
import TimetableAndBells from './TimetableAndBells';
import FamilyHomeworkBoard from './FamilyHomeworkBoard';
import { getManagedChild, getCurrentAccount } from '../standalone/accounts';
import ExamScoreCalculator from './ExamScoreCalculator';
import { safeStorage } from '../standalone/storageEngine';

const TIMETABLE_KEY = 'domashka_timetable_v30';
const FALLBACK_TIMETABLE = {
  mon: ['math', 'russian', 'history', 'english', 'biology'],
  tue: ['geometry', 'physics', 'literature', 'informatics', 'geography'],
  wed: ['math', 'russian', 'chemistry', 'english', 'social'],
  thu: ['geometry', 'physics', 'russian', 'history', 'literature'],
  fri: ['math', 'english', 'biology', 'chemistry', 'informatics'],
  sat: [],
};

function playSoftBell() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.14 + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.14);
      osc.stop(ctx.currentTime + i * 0.14 + 0.6);
    });
  } catch {
    // ignore audio restrictions
  }
}

const DIARY_KEY = 'domashka_diary_tasks_v21';
const GRADES_KEY = 'domashka_subject_grades_v22';
const GRADES_LEGACY_KEY = 'domashka_subject_grades_v21';
const ROUND_FRAC_KEY = 'domashka_grade_round_frac_v22';

export const GRADE_WEIGHTS = [
  { w: 1, short: '×1 Оценка', sub: 'Оценка', title: '1 — Просто оценка (ответ / работа на уроке)' },
  { w: 2, short: '×2 ДЗ', sub: 'Домашка', title: '2 — Домашка (домашнее задание)' },
  { w: 3, short: '×3 С/Р', sub: 'Самост.', title: '3 — Самостоятельная работа' },
  { w: 4, short: '×4 П/Р', sub: 'Провер.', title: '4 — Проверочная работа' },
  { w: 5, short: '×5 К/Р', sub: 'Контр./ОГЭ', title: '5 — Контрольная, зачёт, ВПР и ОГЭ' },
];

const ROUND_OPTIONS = [
  { frac: 0.5, label: '.50', hint: '4.50 → 5 · 3.50 → 4 · 2.50 → 3' },
  { frac: 0.55, label: '.55', hint: '4.55 → 5 · 3.55 → 4 · 2.55 → 3' },
  { frac: 0.6, label: '.60', hint: '4.60 → 5 · 3.60 → 4 · 2.60 → 3' },
  { frac: 0.65, label: '.65', hint: '4.65 → 5 · 3.65 → 4 · 2.65 → 3' },
];

const DEFAULT_TASKS = [
  {
    id: 'demo-1',
    subject: 'math',
    text: 'Решить уравнение: 2x² - 7x + 3 = 0 и сделать проверку корней',
    due: 'На завтра',
    done: false,
  },
  {
    id: 'demo-2',
    subject: 'russian',
    text: 'Синтаксический разбор предложения (4): Осенний ветер тихо кружит золотые листья над старым парком.',
    due: 'На завтра',
    done: false,
  },
];

function gradeColor(val) {
  if (val === 5) return 'bg-emerald-500 text-white border-emerald-600';
  if (val === 4) return 'bg-sky-500 text-white border-sky-600';
  if (val === 3) return 'bg-amber-500 text-white border-amber-600';
  return 'bg-rose-500 text-white border-rose-600';
}

function howManyMarksNeeded(sumWeighted, totalWeight, targetAvg, newMark = 5, newWeight = 1) {
  if (totalWeight > 0 && sumWeighted / totalWeight >= targetAvg - 1e-9) return 0;
  if (newMark <= targetAvg) return Infinity;
  const num = targetAvg * totalWeight - sumWeighted;
  const den = newWeight * (newMark - targetAvg);
  if (den <= 0) return Infinity;
  return Math.max(1, Math.ceil(num / den - 1e-9));
}

function computeQuarterMark(avg, roundFrac) {
  if (avg >= 4 + roundFrac - 1e-9) return 5;
  if (avg >= 3 + roundFrac - 1e-9) return 4;
  if (avg >= 2 + roundFrac - 1e-9) return 3;
  return 2;
}

function normalizeLegacyGrades(obj) {
  const out = {};
  for (const [subj, arr] of Object.entries(obj || {})) {
    if (!Array.isArray(arr)) continue;
    out[subj] = arr
      .map((m) => {
        const val = Math.min(5, Math.max(2, Math.round(Number(m.val) || 4)));
        let w = Number(m.w) || 1;
        if (w === 1.5) w = 3;
        w = Math.min(5, Math.max(1, Math.round(w)));
        return { id: m.id || `m-${Math.random().toString(36).slice(2, 7)}`, val, w };
      });
  }
  return out;
}

export default function DiaryAndGrades({ grade = 7, onSolveTask, onEarnXp }) {
  const [diaryView, setDiaryView] = useState('all'); // 'all' | 'grades' | 'timetable' | 'exams'
  // ---- Homework Checklist State ----
  const [tasks, setTasks] = useState(() => {
    try {
      const raw = safeStorage.getItem(DIARY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return getCurrentAccount() ? [] : DEFAULT_TASKS;
  });

  const [newSubj, setNewSubj] = useState('math');
  const [newText, setNewText] = useState('');
  const [newDue, setNewDue] = useState('На завтра');
  const [taskFilter, setTaskFilter] = useState('all'); // 'all' | 'todo' | 'done'
  const [syncDay, setSyncDay] = useState('tomorrow');
  const [syncNotice, setSyncNotice] = useState('');

  // Calm Homework Pomodoro Focus Timer (Block Г, Item 10)
  const [focusPresetMin, setFocusPresetMin] = useState(25); // 25 | 15 | 5
  const [focusSeconds, setFocusSeconds] = useState(25 * 60);
  const [focusRunning, setFocusRunning] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState(null);
  const focusRun = useRef(''); const completedFocus = useRef(new Set());
  const startFocus = () => { if (focusSeconds === focusPresetMin * 60 || !focusRun.current) focusRun.current = studyId(); setFocusRunning(true); };

  useEffect(() => {
    if (!focusRunning) return;
    const deadline = Date.now() + focusSeconds * 1000;
    const id = setInterval(() => setFocusSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 1000);
    return () => clearInterval(id);
  }, [focusRunning, focusPresetMin]);
  useEffect(() => {
    if (!focusRunning || focusSeconds > 0) return;
    setFocusRunning(false); setFocusSeconds(focusPresetMin * 60);
    if (!completedFocus.current.has(focusRun.current)) {
      completedFocus.current.add(focusRun.current); playSoftBell();
      try { if (focusPresetMin >= 15) onEarnXp?.(20, `focus:${focusRun.current}`); }
      catch (error) { setSyncNotice(error.message); }
    }
  }, [focusSeconds, focusRunning, focusPresetMin, onEarnXp]);

  const switchFocusPreset = (mins) => {
    setFocusRunning(false);
    setFocusPresetMin(mins);
    setFocusSeconds(mins * 60);
  };

  const fmtFocusClock = (sec) => {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const syncFromTimetable = () => {
    const dayMap = [
      { id: 'mon', label: 'Понедельник', js: 1 },
      { id: 'tue', label: 'Вторник', js: 2 },
      { id: 'wed', label: 'Среда', js: 3 },
      { id: 'thu', label: 'Четверг', js: 4 },
      { id: 'fri', label: 'Пятница', js: 5 },
      { id: 'sat', label: 'Суббота', js: 6 },
    ];
    let targetDayObj = dayMap[0];
    if (syncDay === 'tomorrow') {
      const tomJs = (new Date().getDay() + 1) % 7;
      targetDayObj = dayMap.find((d) => d.js === tomJs) || dayMap[0];
    } else {
      targetDayObj = dayMap.find((d) => d.id === syncDay) || dayMap[0];
    }

    const defaults = getCurrentAccount() ? Object.fromEntries(Object.keys(FALLBACK_TIMETABLE).map((day) => [day, []])) : FALLBACK_TIMETABLE;
    let tt = defaults;
    try {
      const savedTt = JSON.parse(safeStorage.getItem(TIMETABLE_KEY) || 'null');
      if (savedTt && typeof savedTt === 'object') tt = { ...defaults, ...savedTt };
    } catch {
      // ignore
    }

    const subjIds = [...new Set((tt[targetDayObj.id] || []).filter(Boolean))];
    if (!subjIds.length) {
      setSyncNotice(`В расписании на ${targetDayObj.label.toLowerCase()} пока не указаны уроки.`);
      return;
    }

    const dueLabel = syncDay === 'tomorrow' ? `На завтра (${targetDayObj.label})` : targetDayObj.label;
    const existingActiveSubjs = new Set(tasks.filter((t) => !t.done).map((t) => `${t.subject}::${t.due}`));
    const toAdd = [];
    subjIds.forEach((sid, idx) => {
      const key = `${sid}::${dueLabel}`;
      if (existingActiveSubjs.has(key)) return;
      const sObj = SUBJECTS.find((s) => s.id === sid);
      toAdd.push({
        id: studyId(),
        subject: sid,
        text: `Проверить ДЗ по предмету «${sObj?.name || sid}» (запишите номер упражнения или тему)`,
        due: dueLabel,
        done: false,
      });
    });

    if (toAdd.length > 0) {
      setTasks((prev) => [...toAdd, ...prev]);
      setSyncNotice(`✓ Добавлено предметов из расписания (${targetDayObj.label}): ${toAdd.length}`);
    } else {
      setSyncNotice(`Все уроки на ${targetDayObj.label.toLowerCase()} уже есть в вашем списке ДЗ.`);
    }
    setTimeout(() => setSyncNotice(''), 4000);
  };

  useEffect(() => {
    try {
      safeStorage.setItem(DIARY_KEY, JSON.stringify(tasks));
    } catch {
      // ignore
    }
  }, [tasks]);

  // ---- Weighted Quarter Grade Calculator State (Weights 1..5 + .50/.55/.60/.65) ----
  const [gradesBySubj, setGradesBySubj] = useState(() => {
    try {
      const raw = safeStorage.getItem(GRADES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return normalizeLegacyGrades(parsed);
      }
      const legacy = safeStorage.getItem(GRADES_LEGACY_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (parsed && typeof parsed === 'object') return normalizeLegacyGrades(parsed);
      }
    } catch {
      // ignore
    }
    if (getCurrentAccount()) return {};
    return {
      math: [
        { id: 'g1', val: 5, w: 2 }, // домашка
        { id: 'g2', val: 4, w: 3 }, // самостоятельная
        { id: 'g3', val: 5, w: 1 }, // урок
        { id: 'g4', val: 4, w: 5 }, // контрольная
      ],
    };
  });

  const [calcSubj, setCalcSubj] = useState('math');
  const [selectedWeight, setSelectedWeight] = useState(1);
  const [roundFrac, setRoundFrac] = useState(() => {
    try {
      const saved = Number(safeStorage.getItem(ROUND_FRAC_KEY));
      if ([0.5, 0.55, 0.6, 0.65].includes(saved)) return saved;
    } catch {
      // ignore
    }
    return 0.55;
  });
  const [bulkInput, setBulkInput] = useState('');

  useEffect(() => {
    try {
      safeStorage.setItem(GRADES_KEY, JSON.stringify(gradesBySubj));
    } catch {
      // ignore
    }
  }, [gradesBySubj]);

  useEffect(() => {
    try {
      safeStorage.setItem(ROUND_FRAC_KEY, String(roundFrac));
    } catch {
      // ignore
    }
  }, [roundFrac]);

  const realSubjects = useMemo(() => SUBJECTS.filter((s) => s.id !== 'auto'), []);

  const handleAddTask = (e) => {
    e.preventDefault();
    const trimmed = newText.trim();
    if (!trimmed) return;
    setTasks((prev) => [
      {
        id: studyId(),
        subject: newSubj,
        text: trimmed,
        due: newDue,
        done: false,
      },
      ...prev,
    ]);
    setNewText('');
  };

  const handleToggleTask = (id) => {
    const task = tasks.find((item) => item.id === id); if (!task) return;
    const done = !task.done; let claimed = task.xpClaimed;
    // No side effects in React state updater functions: StrictMode may invoke
    // them twice. A stable event key also deduplicates retries/device conflicts.
    if (done && !claimed && onEarnXp) {
      try { onEarnXp(10, `diary:${id}`); claimed = true; }
      catch (error) { setSyncNotice(error.message); }
    }
    setTasks((previous) => previous.map((item) => item.id === id ? { ...item, done, xpClaimed: claimed } : item));
  };

  const handleDeleteTask = (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const handleClearCompleted = () => {
    setTasks((prev) => prev.filter((t) => !t.done));
  };

  const currentMarks = gradesBySubj[calcSubj] || [];

  const addMark = (val, customW = selectedWeight) => {
    setGradesBySubj((prev) => ({
      ...prev,
      [calcSubj]: [
        ...(prev[calcSubj] || []),
        {
          id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          val,
          w: customW,
        },
      ],
    }));
  };

  // Supports "5 4 5 3" (uses selectedWeight) OR "5x2, 4x5, 5*3, 4_4"
  const handleBulkAdd = (e) => {
    e.preventDefault();
    const tokens = bulkInput
      .trim()
      .split(/[\s,;]+/)
      .filter(Boolean);
    if (!tokens.length) return;
    const parsedMarks = [];
    for (const tok of tokens) {
      const m = tok.match(/^([2-5])(?:[xх*_(](\d)\)?)?$/i);
      if (m) {
        const val = Number(m[1]);
        const w = m[2] ? Math.min(5, Math.max(1, Number(m[2]))) : selectedWeight;
        parsedMarks.push({
          id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          val,
          w,
        });
      } else if (/^[2-5]+$/.test(tok)) {
        for (const ch of tok) {
          parsedMarks.push({
            id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            val: Number(ch),
            w: selectedWeight,
          });
        }
      }
    }
    if (parsedMarks.length > 0) {
      setGradesBySubj((prev) => ({
        ...prev,
        [calcSubj]: [...(prev[calcSubj] || []), ...parsedMarks],
      }));
      setBulkInput('');
    }
  };

  const removeMark = (id) => {
    setGradesBySubj((prev) => ({
      ...prev,
      [calcSubj]: (prev[calcSubj] || []).filter((m) => m.id !== id),
    }));
  };

  const undoLastMark = () => {
    setGradesBySubj((prev) => {
      const cur = prev[calcSubj] || [];
      if (!cur.length) return prev;
      return { ...prev, [calcSubj]: cur.slice(0, -1) };
    });
  };

  const clearMarks = () => {
    setGradesBySubj((prev) => ({ ...prev, [calcSubj]: [] }));
  };

  const threshold5 = Number((4 + roundFrac).toFixed(2));
  const threshold4 = Number((3 + roundFrac).toFixed(2));
  const threshold3 = Number((2 + roundFrac).toFixed(2));

  const stats = useMemo(() => {
    const totalWeight = currentMarks.reduce((acc, m) => acc + Number(m.w || 1), 0);
    const sumWeighted = currentMarks.reduce(
      (acc, m) => acc + Number(m.val) * Number(m.w || 1),
      0
    );
    const avg = totalWeight > 0 ? sumWeighted / totalWeight : 0;
    const quarterGrade = totalWeight > 0 ? computeQuarterMark(avg, roundFrac) : null;

    const fivesNeededByWeight = GRADE_WEIGHTS.map((gw) => ({
      ...gw,
      countFor5: howManyMarksNeeded(sumWeighted, totalWeight, threshold5, 5, gw.w),
      count5For4: howManyMarksNeeded(sumWeighted, totalWeight, threshold4, 5, gw.w),
      count4For4: howManyMarksNeeded(sumWeighted, totalWeight, threshold4, 4, gw.w),
    }));

    // Safety cushion check: what happens if student gets a "3" or "4" on a Control test (x5)?
    const avgIf3Control = totalWeight > 0 ? (sumWeighted + 3 * 5) / (totalWeight + 5) : 0;
    const avgIf4Control = totalWeight > 0 ? (sumWeighted + 4 * 5) / (totalWeight + 5) : 0;
    const markIf3Control = totalWeight > 0 ? computeQuarterMark(avgIf3Control, roundFrac) : null;
    const markIf4Control = totalWeight > 0 ? computeQuarterMark(avgIf4Control, roundFrac) : null;

    return {
      totalWeight,
      sumWeighted,
      avg,
      quarterGrade,
      fivesNeededByWeight,
      avgIf3Control,
      avgIf4Control,
      markIf3Control,
      markIf4Control,
    };
  }, [currentMarks, roundFrac, threshold5, threshold4]);

  // Multi-subject summary report card
  const reportCard = useMemo(() => {
    const rows = [];
    for (const s of realSubjects) {
      const arr = gradesBySubj[s.id];
      if (!arr || !arr.length) continue;
      const tw = arr.reduce((a, m) => a + Number(m.w || 1), 0);
      const sw = arr.reduce((a, m) => a + Number(m.val) * Number(m.w || 1), 0);
      const avg = sw / tw;
      const qm = computeQuarterMark(avg, roundFrac);
      rows.push({ id: s.id, label: s.label, count: arr.length, avg, qm });
    }
    return rows;
  }, [gradesBySubj, realSubjects, roundFrac]);

  const doneCount = tasks.filter((t) => t.done).length;
  const visibleTasks = useMemo(() => {
    if (taskFilter === 'todo') return tasks.filter((t) => !t.done);
    if (taskFilter === 'done') return tasks.filter((t) => t.done);
    return tasks;
  }, [tasks, taskFilter]);

  const activeWeightObj = GRADE_WEIGHTS.find((g) => g.w === selectedWeight) || GRADE_WEIGHTS[0];
  const activeRoundObj = ROUND_OPTIONS.find((r) => r.frac === roundFrac) || ROUND_OPTIONS[1];

  const handleQuickAddFromTimetable = ({ subject, text }) => {
    setTasks((prev) => [
      {
        id: studyId(),
        subject: subject || 'math',
        text,
        due: 'По расписанию',
        done: false,
      },
      ...prev,
    ]);
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation bar inside Diary & Grades */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-2 shadow-sm flex flex-wrap items-center gap-1.5">
        {[
          { id: 'all', label: '✨ Всё сразу' },
          { id: 'grades', label: '📒 Планер ДЗ и калькулятор оценок' },
          { id: 'timetable', label: '🔔 Расписание и таймер звонков' },
          { id: 'exams', label: '🎓 Перевод баллов ОГЭ и ЕГЭ' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setDiaryView(tab.id)}
            className={`px-3 py-2 rounded-xl text-xs font-extrabold transition ${
              diaryView === tab.id
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {(diaryView === 'all' || diaryView === 'grades') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* LEFT: Homework Planner */}
      <div className="lg:col-span-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <CalendarCheck2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                Мой дневник домашних заданий
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Записывайте ДЗ, решайте с ИИ в 1 клик и получайте +10 XP за выполнение
              </p>
            </div>
          </div>

          <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
            {doneCount}/{tasks.length}
          </span>
        </div>

        {/* Add form */}
        <form
          onSubmit={handleAddTask}
          className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-2.5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select
              value={newSubj}
              onChange={(e) => setNewSubj(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-3 py-2 text-xs font-semibold"
            >
              {realSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>

            <select
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-3 py-2 text-xs font-semibold"
            >
              <option value="На завтра">📅 На завтра (ДЗ ×2)</option>
              <option value="Самостоятельная (×3)">📝 К самостоятельной (×3)</option>
              <option value="Проверочная (×4)">📋 К проверочной (×4)</option>
              <option value="Контрольная / ВПР / ОГЭ (×5)">🔥 Контрольная / ВПР / ОГЭ (×5)</option>
            </select>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Что задали? Напр.: §14 пересказ или упр. 215..."
              className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <button
              type="submit"
              disabled={!newText.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-extrabold transition shrink-0 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Добавить
            </button>
          </div>
        </form>

        {/* v3.2: 1-Click Sync from School Timetable + Calm Pomodoro Focus Timer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Timetable Homework Sync Box */}
          <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/70 flex flex-col justify-between gap-2">
            <div className="text-[11px] font-extrabold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>Из школьного расписания уроков:</span>
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value={syncDay}
                onChange={(e) => setSyncDay(e.target.value)}
                className="flex-1 min-w-0 rounded-lg border border-indigo-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200"
              >
                <option value="tomorrow">На завтра (авто)</option>
                <option value="mon">Понедельник</option>
                <option value="tue">Вторник</option>
                <option value="wed">Среда</option>
                <option value="thu">Четверг</option>
                <option value="fri">Пятница</option>
                <option value="sat">Суббота</option>
              </select>
              <button
                type="button"
                onClick={syncFromTimetable}
                className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shrink-0 transition"
              >
                Подтянуть ДЗ
              </button>
            </div>
            {syncNotice && (
              <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                {syncNotice}
              </div>
            )}
          </div>

          {/* Calm Pomodoro Focus Timer Box */}
          <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/70 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[11px] font-extrabold text-emerald-900 dark:text-emerald-200 flex items-center gap-1">
                <Timer className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Таймер фокуса (+20 XP)</span>
              </span>
              <div className="inline-flex rounded-lg bg-white/80 dark:bg-slate-900 p-0.5 text-[10px] font-bold border border-emerald-200/70 dark:border-slate-700">
                {[
                  { m: 25, label: '25м' },
                  { m: 15, label: '15м' },
                  { m: 5, label: '5м отдых' },
                ].map((pr) => (
                  <button
                    key={pr.m}
                    type="button"
                    onClick={() => switchFocusPreset(pr.m)}
                    className={`px-1.5 py-0.5 rounded transition ${
                      focusPresetMin === pr.m
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {pr.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-lg font-black text-slate-900 dark:text-white">
                {fmtFocusClock(focusSeconds)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => focusRunning ? setFocusRunning(false) : startFocus()}
                  className={`px-2.5 py-1 rounded-lg text-xs font-extrabold inline-flex items-center gap-1 transition ${
                    focusRunning
                      ? 'bg-amber-500 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                >
                  {focusRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  <span>{focusRunning ? 'Пауза' : 'Старт'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFocusRunning(false);
                    setFocusSeconds(focusPresetMin * 60);
                  }}
                  className="p-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500"
                  title="Сбросить таймер"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {focusTaskId && tasks.some((t) => t.id === focusTaskId) && (
              <div className="text-[11px] text-emerald-800 dark:text-emerald-300 truncate font-medium">
                🎯 В фокусе: {tasks.find((t) => t.id === focusTaskId)?.text}
              </div>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 font-bold">
            {[
              { id: 'all', label: `Все (${tasks.length})` },
              { id: 'todo', label: `Активные (${tasks.length - doneCount})` },
              { id: 'done', label: `Готовые (${doneCount})` },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setTaskFilter(f.id)}
                className={`px-2.5 py-1 rounded-lg transition ${
                  taskFilter === f.id
                    ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {doneCount > 0 && (
            <button
              type="button"
              onClick={handleClearCompleted}
              className="text-[11px] font-bold text-slate-500 hover:text-rose-600 transition"
            >
              Очистить готовые
            </button>
          )}
        </div>

        {/* Task items */}
        <div className="space-y-2.5">
          {visibleTasks.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
              В этом списке пока пусто. Добавьте домашнее задание выше!
            </div>
          ) : (
            visibleTasks.map((task) => {
              const subjObj = SUBJECTS.find((s) => s.id === task.subject);
              return (
                <div
                  key={task.id}
                  className={`p-3.5 rounded-2xl border transition flex items-start gap-3 ${
                    task.done
                      ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200/70 dark:border-emerald-900/50 opacity-80'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleToggleTask(task.id)}
                    className="mt-0.5 text-indigo-600 dark:text-indigo-400 hover:scale-110 transition shrink-0"
                    role="checkbox" aria-checked={task.done} aria-label={`Выполнено: ${task.text}`}
                    title={task.done ? 'Отметить как невыполненное' : task.xpClaimed ? 'Отметить выполненным (XP уже начислялись)' : 'Отметить выполненным (+10 XP)'}
                  >
                    {task.done ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Circle className="w-5 h-5 text-slate-400" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {subjObj && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {subjObj.label}
                        </span>
                      )}
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300">
                        {task.due}
                      </span>
                    </div>
                    <p
                      className={`text-xs sm:text-sm font-medium break-words ${
                        task.done
                          ? 'line-through text-slate-400 dark:text-slate-500'
                          : 'text-slate-800 dark:text-slate-100'
                      }`}
                    >
                      {task.text}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {!task.done && (
                      <button
                        type="button"
                        onClick={() => {
                          setFocusTaskId(task.id);
                          startFocus();
                        }}
                        className={`p-1.5 rounded-xl border transition ${
                          focusTaskId === task.id && focusRunning
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
                        }`}
                        title="Включить таймер фокуса (25 минут) на это домашнее задание"
                      >
                        <Timer className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onSolveTask && !task.done && (
                      <button
                        type="button"
                        onClick={() =>
                          onSolveTask({
                            subject: task.subject,
                            text: task.text,
                            mode: 'notebook',
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white text-xs font-bold shadow-sm transition"
                        title="Решить это задание с ИИ"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Решить с ИИ</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteTask(task.id)}
                      className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                      title="Удалить задание"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Multi-subject summary report card */}
        {reportCard.length > 0 && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-extrabold text-slate-700 dark:text-slate-200">
                📊 Сводный табель четверти (порог {activeRoundObj.label}):
              </span>
              <span className="text-[11px] text-slate-500">
                Средний балл:{' '}
                <b>
                  {(
                    reportCard.reduce((a, r) => a + r.avg, 0) / reportCard.length
                  ).toFixed(2)}
                </b>
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {reportCard.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setCalcSubj(r.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-bold transition ${
                    calcSubj === r.id
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-400 text-indigo-900 dark:text-indigo-200'
                      : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-indigo-300'
                  }`}
                >
                  <span>{r.label.split(' ')[0]}</span>
                  <span className="truncate max-w-[110px]">
                    {r.label.replace(/^[^\s]+\s/, '')}
                  </span>
                  <span className="font-mono text-[11px] opacity-80">{r.avg.toFixed(2)}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-md text-[10px] font-black ${gradeColor(
                      r.qm
                    )}`}
                  >
                    {r.qm}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT: Upgraded 1..5 Weighted Quarter Grade Calculator */}
      <div className="lg:col-span-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
              Калькулятор оценок с весом 1–5 (ЭЖД / МЭШ)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Точный расчёт четвертной оценки по школьной системе весов работ (×1 … ×5)
            </p>
          </div>
        </div>

        {/* Subject + Rounding Threshold Pills (.50 / .55 / .60 / .65) */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-6">
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              Предмет
            </label>
            <select
              value={calcSubj}
              onChange={(e) => setCalcSubj(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white px-3 py-2 text-xs font-semibold"
            >
              {realSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-6">
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              Округление в пользу ученика с:
            </label>
            <div className="grid grid-cols-4 gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
              {ROUND_OPTIONS.map((opt) => (
                <button
                  key={opt.frac}
                  type="button"
                  onClick={() => setRoundFrac(opt.frac)}
                  title={opt.hint}
                  className={`py-1.5 rounded-lg text-xs font-extrabold transition ${
                    roundFrac === opt.frac
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="text-[11px] text-slate-500 dark:text-slate-400 -mt-2 px-0.5">
          Правило школы: <b>{threshold5.toFixed(2)}</b> → «5» · <b>{threshold4.toFixed(2)}</b> → «4» · <b>{threshold3.toFixed(2)}</b> → «3»
        </div>

        {/* 5-Tier School Weight Selector + Grade Buttons */}
        <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                Тип и вес оценки:
              </span>
              <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                {activeWeightObj.title}
              </span>
            </div>

            <div className="grid grid-cols-5 gap-1.5">
              {GRADE_WEIGHTS.map((item) => (
                <button
                  key={item.w}
                  type="button"
                  onClick={() => setSelectedWeight(item.w)}
                  title={item.title}
                  className={`px-1.5 py-2 rounded-xl transition text-center flex flex-col items-center justify-center ${
                    selectedWeight === item.w
                      ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-500/25'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                  }`}
                >
                  <span className="text-xs font-black leading-none">×{item.w}</span>
                  <span className="text-[9.5px] font-semibold leading-tight mt-1 whitespace-nowrap">
                    {item.sub}
                  </span>
                </button>
              ))}
            </div>
            <div className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-snug pt-0.5">
              Вес: <b>1</b> — оценка · <b>2</b> — домашка · <b>3</b> — самост. · <b>4</b> — провер. · <b>5</b> — контрольная, зачёт, ВПР, ОГЭ
            </div>
          </div>

          {/* +5 / +4 / +3 / +2 buttons */}
          <div className="grid grid-cols-4 gap-2">
            {[5, 4, 3, 2].map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => addMark(g)}
                className={`py-2.5 rounded-xl font-black text-sm shadow-sm hover:opacity-95 active:scale-95 transition border ${gradeColor(
                  g
                )}`}
              >
                + {g} <span className="text-[11px] opacity-90">×{selectedWeight}</span>
              </button>
            ))}
          </div>

          {/* Quick string paste */}
          <form onSubmit={handleBulkAdd} className="flex gap-1.5 pt-0.5">
            <input
              type="text"
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder="Быстрый ввод: напр. 5 4 5x2 4x5 3x3"
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={!bulkInput.trim()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 disabled:opacity-40 text-white text-xs font-bold transition shrink-0"
              title="Добавить оценки строкой (5x2 = пятёрка с весом 2 за домашку)"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              Ввести
            </button>
          </form>
        </div>

        {/* Current marks chips */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
              Оценки ({currentMarks.length}, сумма весов: {stats.totalWeight})
            </span>
            {currentMarks.length > 0 && (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={undoLastMark}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-indigo-600 transition"
                >
                  <Undo2 className="w-3 h-3" />
                  Шаг назад
                </button>
                <button
                  type="button"
                  onClick={clearMarks}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-rose-600 transition"
                >
                  <RotateCcw className="w-3 h-3" />
                  Сбросить
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 min-h-[40px] p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
            {currentMarks.length === 0 ? (
              <span className="text-xs text-slate-400">
                Выберите тип работы (×1…×5) и нажмите +5, +4, +3 или +2
              </span>
            ) : (
              currentMarks.map((m) => {
                const wMeta = GRADE_WEIGHTS.find((x) => x.w === m.w);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => removeMark(m.id)}
                    title={`${wMeta ? wMeta.title : `Вес ×${m.w}`} — нажмите, чтобы удалить`}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-extrabold shadow-xs hover:opacity-80 transition ${gradeColor(
                      m.val
                    )}`}
                  >
                    <span>{m.val}</span>
                    <sub className="text-[10px] opacity-95 font-mono">×{m.w}</sub>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Result + 5-Weight Rescue Matrix + Safety Cushion */}
        {stats.totalWeight > 0 && (
          <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-50 via-white to-violet-50 dark:from-indigo-950/40 dark:via-slate-900 dark:to-violet-950/30 border border-indigo-200/80 dark:border-indigo-800/60 space-y-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  Средневзвешенный балл
                </div>
                <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                  {stats.avg.toFixed(2)}
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  Выходит за четверть
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 mt-1 px-3.5 py-1 rounded-xl text-base font-black border ${gradeColor(
                    stats.quarterGrade
                  )}`}
                >
                  <Award className="w-4 h-4" />
                  Оценка «{stats.quarterGrade}»
                </span>
              </div>
            </div>

            {/* Rescue Matrix for reaching "5" across all 5 weights */}
            <div className="pt-2.5 border-t border-indigo-200/60 dark:border-indigo-800/60 space-y-2 text-xs">
              {stats.quarterGrade === 5 ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 font-extrabold text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    У вас выходит твёрдая «5» (порог {threshold5.toFixed(2)})!
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <span>
                      Запас прочности перед контрольной (×5): с четвёркой балл станет{' '}
                      <b>{stats.avgIf4Control.toFixed(2)} («{stats.markIf4Control}»)</b>, а с тройкой —{' '}
                      <b>{stats.avgIf3Control.toFixed(2)} («{stats.markIf3Control}»)</b>.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="font-extrabold flex items-center gap-1.5 text-indigo-950 dark:text-indigo-200">
                    <TrendingUp className="w-4 h-4 text-indigo-600 shrink-0" />
                    Сколько пятёрок нужно до «5» ({threshold5.toFixed(2)}) по типам работ:
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 text-center">
                    {stats.fivesNeededByWeight.map((row) => (
                      <div
                        key={row.w}
                        title={row.title}
                        className="p-2 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-indigo-200/70 dark:border-indigo-800/60"
                      >
                        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 truncate">
                          {row.short}
                        </div>
                        <div className="text-sm font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                          {row.countFor5}×«5»
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {stats.quarterGrade < 4 && (
                <div className="pt-1 space-y-1.5">
                  <div className="font-extrabold text-sky-900 dark:text-sky-300">
                    До «4» в четверти ({threshold4.toFixed(2)}) хватит:
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 text-center">
                    {stats.fivesNeededByWeight.map((row) => (
                      <div
                        key={row.w}
                        className="p-1.5 rounded-xl bg-sky-50/80 dark:bg-sky-950/40 border border-sky-200/70 dark:border-sky-800/60"
                      >
                        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 truncate">
                          {row.short}
                        </div>
                        <div className="text-xs font-black text-sky-700 dark:text-sky-300">
                          {row.count5For4}×«5» / {row.count4For4}×«4»
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
        </div>
      )}

      {getManagedChild() && <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 p-4 bg-white dark:bg-slate-900"><FamilyHomeworkBoard compact /></div>}
      {(diaryView === 'all' || diaryView === 'timetable') && (
        <TimetableAndBells onQuickAddHomework={handleQuickAddFromTimetable} />
      )}

      {(diaryView === 'all' || diaryView === 'exams') && (
        <ExamScoreCalculator grade={grade} />
      )}
    </div>
  );
}
