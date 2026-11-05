import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Timer,
  CheckCircle2,
  XCircle,
  Sparkles,
  HelpCircle,
  Trophy,
  RotateCcw,
  ShieldAlert,
  Check,
  Trash2,
  Plus,
  Layers,
  Award,
  Search,
} from 'lucide-react';
import {
  api,
  getActiveAuthPayload,
  recordStudentActivity,
  mistakeStore,
  subscribeMistakes,
} from '../api';
import { CHEAT_SHEETS, SUBJECTS } from '../data/referenceData';
import MarkdownMath from './MarkdownMath';
import AiThinkingCard from './AiThinkingCard';
import FlashcardsDeck, { buildFlashcardsFromSheets } from './FlashcardsDeck';

function normalizeShortAnswer(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/,/g, '.')
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isShortAnswerCorrect(userRaw, acceptedAnswers = []) {
  const u = normalizeShortAnswer(userRaw);
  if (!u) return false;
  for (const cand of acceptedAnswers) {
    const c = normalizeShortAnswer(cand);
    if (!c) continue;
    if (u === c) return true;
    // Numeric equivalence (e.g., 6.0 == 6)
    const numU = Number(u);
    const numC = Number(c);
    if (!Number.isNaN(numU) && !Number.isNaN(numC) && Math.abs(numU - numC) < 1e-6) {
      return true;
    }
  }
  return false;
}

function computeSchoolMark(correct, total) {
  if (total <= 0) return 5;
  const ratio = correct / total;
  if (ratio >= 0.88) return 5;
  if (ratio >= 0.68) return 4;
  if (ratio >= 0.45) return 3;
  return 2;
}

export function TimedMockExamPanel({ profile, aiSettings, onOpenAiSettings }) {
  const defaultExam =
    profile.grade >= 10 ? 'ege' : profile.grade === 9 ? 'oge' : profile.grade >= 4 ? 'vpr' : 'sr';

  const [examType, setExamType] = useState(defaultExam);
  const [subject, setSubject] = useState('math');
  const [topic, setTopic] = useState('');

  const [loading, setLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [providerUsed, setProviderUsed] = useState('');
  const [userAnswers, setUserAnswers] = useState({});
  const [shownHints, setShownHints] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const [secondsLeft, setSecondsLeft] = useState(15 * 60);
  const [timerActive, setTimerActive] = useState(false);
  const abortRef = useRef(null);
  const authInfo = getActiveAuthPayload(aiSettings);

  useEffect(() => {
    if (!timerActive || submitted) return;
    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setTimerActive(false);
          setSubmitted(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerActive, submitted]);

  const startMockExam = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setSubmitted(false);
    setUserAnswers({});
    setShownHints({});
    setAiStatus({ stage: 'prepare', message: 'Формируем вариант проверочной работы по ФГОС...' });

    const res = await api.generateExamVariant({
      grade: profile.grade,
      subject,
      examType,
      topic,
      ...authInfo,
      signal: ctrl.signal,
      onStatus: (st) => setAiStatus(st),
    });

    if (abortRef.current === ctrl) abortRef.current = null;
    setLoading(false);
    setAiStatus(null);

    if (res?.ok && res.tasks?.length) {
      setTasks(res.tasks);
      setProviderUsed(res.used || '');
      setSecondsLeft(examType === 'sr' ? 10 * 60 : 15 * 60);
      setTimerActive(true);
    }
  };

  const handleFinishExam = () => {
    setTimerActive(false);
    setSubmitted(true);

    let right = 0;
    const wrongForBank = [];
    tasks.forEach((t, idx) => {
      const ans = userAnswers[idx] || '';
      if (isShortAnswerCorrect(ans, t.answers)) {
        right += 1;
      } else {
        wrongForBank.push({
          subject,
          grade: profile.grade,
          category: `Пробная работа (${examType.toUpperCase()})`,
          wrong: `Задание №${t.num}: ваш ответ «${ans.trim() || 'пусто'}» (верно: ${t.answers[0]})`,
          rule: t.explain || t.hint,
          source: 'exam',
        });
      }
    });

    if (wrongForBank.length > 0) {
      mistakeStore.addMany(wrongForBank);
    }
    recordStudentActivity('quiz_correct', Math.max(10, right * 12));
  };

  const fmtClock = (sec) => {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const resultsSummary = useMemo(() => {
    if (!submitted || !tasks.length) return null;
    let correct = 0;
    tasks.forEach((t, idx) => {
      if (isShortAnswerCorrect(userAnswers[idx] || '', t.answers)) correct += 1;
    });
    const mark = computeSchoolMark(correct, tasks.length);
    return { correct, total: tasks.length, mark };
  }, [submitted, tasks, userAnswers]);

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <Timer className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Пробная самостоятельная / ВПР / ОГЭ / ЕГЭ (10–15 минут)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              5 заданий с кратким ответом как на настоящей контрольной, таймер, итоговая оценка и автосохранение ошибок в копилку!
            </p>
          </div>
        </div>

        {/* Exam Format Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { id: 'sr', label: '📝 С/Р (10 мин)', sub: 'Текущий урок' },
            { id: 'vpr', label: '🇷🇺 ВПР (15 мин)', sub: '4–8 классы' },
            { id: 'oge', label: '📘 ОГЭ (15 мин)', sub: '9 класс · ФИПИ' },
            { id: 'ege', label: '🎓 ЕГЭ база/проф', sub: '10–11 кл. · 1 часть' },
          ].map((fmt) => (
            <button
              key={fmt.id}
              type="button"
              onClick={() => setExamType(fmt.id)}
              className={`p-2.5 rounded-xl border text-left transition ${
                examType === fmt.id
                  ? 'border-indigo-600 bg-indigo-50/90 dark:bg-indigo-950/60 ring-1 ring-indigo-600'
                  : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 bg-slate-50/50 dark:bg-slate-800/50'
              }`}
            >
              <div className="text-xs font-extrabold text-slate-900 dark:text-white">{fmt.label}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{fmt.sub}</div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {SUBJECTS.filter((s) => s.id !== 'auto').map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({profile.grade} кл.)
              </option>
            ))}
          </select>

          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Тема (необязательно, например: Дроби, Причастия, Закон Ома)"
            className="sm:col-span-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Пропущенные правила автоматически попадут в <b>«Копилку моих ошибок»</b>
          </span>
          <button
            type="button"
            onClick={startMockExam}
            disabled={loading}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-55 text-white text-xs sm:text-sm font-extrabold shadow-md shadow-indigo-600/20 inline-flex items-center justify-center gap-2 transition"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            {loading ? 'Составляем вариант...' : 'Начать пробную работу'}
          </button>
        </div>
      </div>

      {loading && (
        <AiThinkingCard
          title="Составляем тренировочный вариант контрольной..."
          status={aiStatus}
          modeLabel="Экзаменатор ФГОС"
          onOpenSettings={onOpenAiSettings}
          onCancel={() => {
            abortRef.current?.abort();
            setLoading(false);
          }}
        />
      )}

      {tasks.length > 0 && !loading && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md overflow-hidden space-y-4 p-4 sm:p-6">
          {/* Exam Sticky Status Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-200 text-xs font-extrabold">
                Бланк заданий ({tasks.length} шт.)
              </span>
              {providerUsed && (
                <span className="text-[11px] text-slate-400 hidden sm:inline">{providerUsed}</span>
              )}
            </div>

            {!submitted ? (
              <div className="flex items-center gap-2">
                <div
                  className={`px-3 py-1 rounded-xl font-mono text-sm font-extrabold border ${
                    secondsLeft <= 120
                      ? 'bg-rose-50 border-rose-300 text-rose-700 animate-pulse'
                      : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100'
                  }`}
                >
                  ⏱ {fmtClock(secondsLeft)}
                </div>
                <button
                  type="button"
                  onClick={handleFinishExam}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-sm transition"
                >
                  Сдать работу на проверку
                </button>
              </div>
            ) : (
              resultsSummary && (
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`px-3.5 py-1 rounded-xl text-xs sm:text-sm font-extrabold ${
                      resultsSummary.mark >= 4
                        ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200'
                        : resultsSummary.mark === 3
                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200'
                        : 'bg-rose-100 text-rose-900 dark:bg-rose-950/70 dark:text-rose-200'
                    }`}
                  >
                    Оценка: «{resultsSummary.mark}» ({resultsSummary.correct} из {resultsSummary.total} верно)
                  </span>
                  <button
                    type="button"
                    onClick={startMockExam}
                    className="px-3 py-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Новый вариант
                  </button>
                </div>
              )
            )}
          </div>

          {/* 5 Exam Blank Tasks */}
          <div className="space-y-4">
            {tasks.map((t, idx) => {
              const userVal = userAnswers[idx] || '';
              const ok = submitted ? isShortAnswerCorrect(userVal, t.answers) : null;
              return (
                <div
                  key={idx}
                  className={`p-4 rounded-2xl border transition space-y-3 ${
                    !submitted
                      ? 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'
                      : ok
                      ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20'
                      : 'border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="px-2.5 py-0.5 rounded-lg bg-indigo-600 text-white text-xs font-extrabold shrink-0">
                      Задание №{t.num || idx + 1}
                    </span>
                    {!submitted && t.hint && (
                      <button
                        type="button"
                        onClick={() => setShownHints((h) => ({ ...h, [idx]: !h[idx] }))}
                        className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                        {shownHints[idx] ? 'Скрыть подсказку' : 'Подсказка'}
                      </button>
                    )}
                  </div>

                  <div className="text-sm text-slate-900 dark:text-slate-100">
                    <MarkdownMath content={t.prompt} />
                  </div>

                  {shownHints[idx] && !submitted && (
                    <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
                      <MarkdownMath content={`💡 **Подсказка:** ${t.hint}`} />
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                    <label className="text-xs font-extrabold uppercase tracking-wider text-slate-500 shrink-0">
                      Ответ:
                    </label>
                    <input
                      type="text"
                      disabled={submitted}
                      value={userVal}
                      onChange={(e) => setUserAnswers((prev) => ({ ...prev, [idx]: e.target.value }))}
                      placeholder="Число или слово в бланк..."
                      className="w-full sm:max-w-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-80"
                    />
                    {submitted && (
                      <div className="flex items-center gap-1.5 text-xs font-bold">
                        {ok ? (
                          <span className="text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" /> Верно!
                          </span>
                        ) : (
                          <span className="text-rose-700 dark:text-rose-400 inline-flex items-center gap-1">
                            <XCircle className="w-4 h-4" /> Эталон: <b>{t.answers[0]}</b>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {submitted && t.explain && (
                    <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700/60 text-xs text-slate-700 dark:text-slate-300">
                      <MarkdownMath content={`**Разбор:** ${t.explain}`} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function SmartFlashcardsSection({ grade = 7 }) {
  const [subjFilter, setSubjFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyMyGrade, setOnlyMyGrade] = useState(true);

  const matchingSheets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase().replace(/ё/g, 'е');
    return CHEAT_SHEETS.filter((sh) => {
      if (subjFilter !== 'all' && sh.subject !== subjFilter) return false;
      if (onlyMyGrade && (grade < sh.minGrade || grade > sh.maxGrade)) return false;
      if (q) {
        const hay = `${sh.title} ${sh.content}`.toLowerCase().replace(/ё/g, 'е');
        if (!hay.includes(q)) return false;
      }
      return true;
    }).slice(0, 14);
  }, [subjFilter, searchQuery, onlyMyGrade, grade]);

  const cards = useMemo(() => buildFlashcardsFromSheets(matchingSheets, 20), [matchingSheets]);

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-600" />
              Умные карточки на 5 минут («Знаю / Повторить»)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Трудные карточки возвращаются обратно в стопку, пока вы не выучите все формулы и правила!
            </p>
          </div>

          <button
            type="button"
            onClick={() => setOnlyMyGrade((v) => !v)}
            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border transition ${
              onlyMyGrade
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
            }`}
          >
            {onlyMyGrade ? `🎯 Только ${grade} класс` : 'Все классы (1–11)'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <select
            value={subjFilter}
            onChange={(e) => setSubjFilter(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none"
          >
            <option value="all">Все школьные предметы</option>
            {SUBJECTS.filter((s) => s.id !== 'auto').map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          <div className="sm:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Фильтр по теме (например: Пифагор, причастия, закон Ома, кислоты)..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
      </div>

      <FlashcardsDeck
        cards={cards}
        deckTitle={
          searchQuery.trim()
            ? `Карточки по теме «${searchQuery.trim()}»`
            : `Стопка карточек (${onlyMyGrade ? `${grade} класс` : '1–11 класс'})`
        }
      />
    </div>
  );
}

export function MistakeBankPanel({ profile, aiSettings }) {
  const [mistakes, setMistakes] = useState(() => mistakeStore.list());
  const [filterMode, setFilterMode] = useState('active'); // 'active' | 'mastered' | 'all'
  const [manualWrong, setManualWrong] = useState('');
  const [manualRule, setManualRule] = useState('');
  const [manualSubj, setManualSubj] = useState('russian');
  const [showAddForm, setShowAddForm] = useState(false);

  // Active 3-example drill state
  const [drillTarget, setDrillTarget] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillQuestions, setDrillQuestions] = useState([]);
  const [drillAnswers, setDrillAnswers] = useState({});

  const authInfo = getActiveAuthPayload(aiSettings);

  useEffect(() => {
    const sync = () => setMistakes(mistakeStore.list());
    return subscribeMistakes(sync);
  }, []);

  const visibleMistakes = useMemo(() => {
    if (filterMode === 'active') return mistakes.filter((m) => !m.mastered);
    if (filterMode === 'mastered') return mistakes.filter((m) => m.mastered);
    return mistakes;
  }, [mistakes, filterMode]);

  const handleAddManual = (e) => {
    e.preventDefault();
    if (!manualWrong.trim() && !manualRule.trim()) return;
    mistakeStore.addMany([
      {
        subject: manualSubj,
        grade: profile.grade,
        category: 'Добавлено вручную',
        wrong: manualWrong.trim() || 'Моё трудное место',
        rule: manualRule.trim() || 'Повторить правило и примеры',
        source: 'manual',
      },
    ]);
    setManualWrong('');
    setManualRule('');
    setShowAddForm(false);
  };

  const startThreeExampleDrill = async (item) => {
    setDrillTarget(item);
    setDrillLoading(true);
    setDrillQuestions([]);
    setDrillAnswers({});
    const res = await api.generateMistakeDrill({
      mistake: item,
      grade: profile.grade,
      ...authInfo,
    });
    setDrillLoading(false);
    if (res?.ok && res.questions?.length) {
      setDrillQuestions(res.questions);
    }
  };

  const pickDrillAnswer = (qIdx, optIdx) => {
    if (drillAnswers[qIdx] !== undefined) return;
    const next = { ...drillAnswers, [qIdx]: optIdx };
    setDrillAnswers(next);

    if (drillQuestions[qIdx]?.correct === optIdx) {
      recordStudentActivity('quiz_correct', 8);
    }

    // If all 3 answered and >= 2 correct -> mark rule Mastered!
    if (Object.keys(next).length === drillQuestions.length && drillTarget) {
      const rightCnt = Object.entries(next).filter(
        ([qi, oi]) => drillQuestions[Number(qi)]?.correct === oi
      ).length;
      if (rightCnt >= 2) {
        mistakeStore.toggleMastered(drillTarget.id, true);
        recordStudentActivity('quiz_correct', 15);
      }
    }
  };

  const activeCount = mistakes.filter((m) => !m.mastered).length;
  const masteredCount = mistakes.filter((m) => m.mastered).length;

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-500" />
              Копилка моих ошибок (умная работа над ошибками)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Все ошибки из вкладки «Проверить» и пробных контрольных собираются здесь автоматически. Закрепите любое правило на 3 примерах!
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center gap-1 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Записать ошибку</span>
          </button>
        </div>

        {/* Filter pills */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setFilterMode('active')}
              className={`px-3 py-1 rounded-lg transition ${
                filterMode === 'active'
                  ? 'bg-white dark:bg-slate-700 text-amber-700 dark:text-amber-300 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              Нужно закрепить ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('mastered')}
              className={`px-3 py-1 rounded-lg transition ${
                filterMode === 'mastered'
                  ? 'bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-300 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              Закреплено ✓ ({masteredCount})
            </button>
          </div>

          {masteredCount > 0 && (
            <button
              type="button"
              onClick={() => mistakeStore.clearMastered()}
              className="text-xs text-slate-400 hover:text-rose-500 font-semibold"
            >
              Очистить выученные
            </button>
          )}
        </div>

        {showAddForm && (
          <form
            onSubmit={handleAddManual}
            className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2.5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                value={manualSubj}
                onChange={(e) => setManualSubj(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs font-semibold"
              >
                {SUBJECTS.filter((s) => s.id !== 'auto').map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={manualWrong}
                onChange={(e) => setManualWrong(e.target.value)}
                placeholder="В чём была ошибка (например: не чуствовал, D = 49 - 40 = 19)"
                className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={manualRule}
                onChange={(e) => setManualRule(e.target.value)}
                placeholder="Правило (например: Непроизносимая согласная В — чувствовать)"
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shrink-0"
              >
                Сохранить в копилку
              </button>
            </div>
          </form>
        )}
      </div>

      {/* 3-Example Targeted Drill Box */}
      {drillTarget && (
        <div className="bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/50 dark:to-slate-900 rounded-2xl border-2 border-indigo-300 dark:border-indigo-800 p-4 sm:p-6 space-y-4 animate-fade-up">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                ⚡ Тренировка на 3 примерах
              </span>
              <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white mt-0.5">
                Закрепляем: {drillTarget.wrong}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setDrillTarget(null)}
              className="text-xs font-bold text-slate-500 hover:text-slate-800"
            >
              Закрыть ✕
            </button>
          </div>

          {drillLoading ? (
            <div className="py-6 text-center text-xs sm:text-sm font-semibold text-indigo-700 dark:text-indigo-300 animate-pulse">
              ИИ-репетитор подбирает 3 закрепляющих примера специально под ваше правило...
            </div>
          ) : (
            <div className="space-y-3">
              {drillQuestions.map((q, qi) => {
                const picked = drillAnswers[qi];
                return (
                  <div
                    key={qi}
                    className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5"
                  >
                    <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                      <MarkdownMath content={`${qi + 1}. ${q.q}`} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(q.options || []).map((opt, oi) => {
                        const isPicked = picked === oi;
                        const isRight = q.correct === oi;
                        let cls =
                          'border-slate-200 dark:border-slate-700 hover:border-indigo-400 bg-slate-50 dark:bg-slate-800/60';
                        if (picked !== undefined) {
                          if (isRight) cls = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 font-bold';
                          else if (isPicked) cls = 'border-rose-400 bg-rose-50 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200';
                        }
                        return (
                          <button
                            key={oi}
                            type="button"
                            onClick={() => pickDrillAnswer(qi, oi)}
                            className={`text-left px-3 py-2 rounded-xl border text-xs transition ${cls}`}
                          >
                            <MarkdownMath content={opt} />
                          </button>
                        );
                      })}
                    </div>
                    {picked !== undefined && q.explain && (
                      <div className="text-xs text-slate-600 dark:text-slate-300 pt-1">
                        <MarkdownMath content={`💡 ${q.explain}`} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Mistake Cards List */}
      {visibleMistakes.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
          <Award className="w-10 h-10 text-emerald-500 mx-auto" />
          <div className="text-sm font-extrabold text-slate-900 dark:text-white">
            {filterMode === 'active'
              ? 'Незакреплённых ошибок сейчас нет!'
              : 'В этом списке пока пусто'}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Когда вы проверяете черновик во вкладке <b>«Проверить»</b> или решаете пробную контрольную, найденные ошибки автоматически сохраняются сюда для проработки.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {visibleMistakes.map((m) => (
            <div
              key={m.id}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                    {m.category}
                  </span>
                  <span className="text-slate-400">{m.grade} кл.</span>
                </div>
                <div className="text-xs sm:text-sm font-extrabold text-rose-700 dark:text-rose-400">
                  ✗ {m.wrong}
                </div>
                <div className="text-xs text-slate-700 dark:text-slate-300">
                  <MarkdownMath content={`✓ **Правило:** ${m.rule}`} />
                </div>
              </div>

              <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => startThreeExampleDrill(m)}
                  className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold inline-flex items-center gap-1 shadow-xs transition"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>Закрепить на 3 примерах</span>
                </button>
                <button
                  type="button"
                  onClick={() => mistakeStore.toggleMastered(m.id)}
                  className={`p-2 rounded-xl border transition ${
                    m.mastered
                      ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-emerald-600'
                  }`}
                  title={m.mastered ? 'Вернуть в список для повторения' : 'Отметить правило выученным'}
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => mistakeStore.remove(m.id)}
                  className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-500 transition"
                  title="Удалить запись"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
