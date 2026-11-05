import React, { useEffect, useRef, useState } from 'react';
import {
  Target,
  Sparkles,
  CheckCircle2,
  XCircle,
  Trophy,
  RotateCw,
  Play,
  Pause,
  RotateCcw,
  Layers,
  Award,
  Timer,
  ShieldAlert,
} from 'lucide-react';
import {
  api,
  getActiveAuthPayload,
  recordStudentActivity,
  saveInputDraft,
  loadInputDraft,
  mistakeStore,
  subscribeMistakes,
} from '../api';
import { SUBJECTS, STRESS_BLITZ_WORDS, ORTHOGRAPHY_BLITZ_WORDS } from '../data/referenceData';
import MarkdownMath from './MarkdownMath';
import AiThinkingCard from './AiThinkingCard';
import { IrregularVerbsBlitz, HistoryDatesBlitz } from './ArenaBlitzPacks';
import { TimedMockExamPanel, SmartFlashcardsSection, MistakeBankPanel } from './ExamAndMistakesHub';

function generateMentalMathTask(grade) {
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  let expr = '';
  let ans = 0;
  let tip = '';

  if (grade <= 4) {
    const type = rand(0, 2);
    if (type === 0) {
      const a = rand(3, 9), b = rand(4, 9);
      expr = `${a} × ${b}`;
      ans = a * b;
      tip = `Таблица умножения: ${a} · ${b} = ${ans}.`;
    } else if (type === 1) {
      const b = rand(3, 9), q = rand(3, 9);
      const a = b * q;
      expr = `${a} : ${b}`;
      ans = q;
      tip = `Проверка умножением: ${q} · ${b} = ${a}.`;
    } else {
      const a = rand(25, 68), b = rand(14, 39);
      expr = `${a} + ${b}`;
      ans = a + b;
      tip = `Складываем десятки (${Math.floor(a / 10)*10} + ${Math.floor(b / 10)*10}) и единицы (${a % 10} + ${b % 10}) = ${ans}.`;
    }
  } else if (grade <= 7) {
    const type = rand(0, 2);
    if (type === 0) {
      const a = rand(12, 35), b = rand(15, 42);
      expr = `-${a} + ${b}`;
      ans = -a + b;
      tip = `Числа с разными знаками: из большего модуля вычитаем меньший и ставим знак большего модуля (${ans}).`;
    } else if (type === 1) {
      const pcts = [10, 20, 25, 50];
      const p = pcts[rand(0, pcts.length - 1)];
      const base = rand(2, 12) * 20;
      expr = `${p}% от ${base}`;
      ans = (base * p) / 100;
      tip = `${p}% = ${p}/100: ${base} · ${p / 100} = ${ans}.`;
    } else {
      const p = rand(3, 6);
      expr = `2^${p}`;
      ans = 2 ** p;
      tip = `Степень двойки: 2^${p} = ${ans}.`;
    }
  } else {
    const type = rand(0, 2);
    if (type === 0) {
      const n = rand(11, 25);
      expr = `${n}²`;
      ans = n * n;
      tip = `Таблица квадратов (ОГЭ / ЕГЭ): ${n} · ${n} = ${ans}.`;
    } else if (type === 1) {
      const n = rand(11, 25);
      expr = `√${n * n}`;
      ans = n;
      tip = `Арифметический квадратный корень: так как ${n}² = ${n * n}, то √${n * n} = ${n}.`;
    } else {
      const b = rand(3, 9) * 2;
      const a = 1, c = rand(2, 8);
      expr = `D для x² - ${b}x + ${c} = 0`;
      ans = b * b - 4 * a * c;
      tip = `Формула дискриминанта D = b² - 4ac = (-${b})² - 4·1·${c} = ${b * b} - ${4 * c} = ${ans}.`;
    }
  }

  const wrongSet = new Set();
  const offsets = [-10, -4, -2, -1, 1, 2, 4, 8, 10, 12];
  while (wrongSet.size < 3) {
    const cand = ans + offsets[rand(0, offsets.length - 1)];
    if (cand !== ans && (grade > 4 || cand >= 0)) wrongSet.add(cand);
  }
  const options = [...wrongSet, ans].sort(() => Math.random() - 0.5).map(String);
  return { expr, options, correct: options.indexOf(String(ans)), tip };
}

const PRESET_TOPICS = [
  { label: '📐 Квадратные уравнения и дискриминант', subject: 'math', topic: 'Квадратные уравнения, дискриминант и теорема Виета' },
  { label: '🖋️ Чередующиеся гласные в корне (-гар-/-гор-, -раст-/-рос-)', subject: 'russian', topic: 'Правописание чередующихся гласных в корне слова' },
  { label: '⚡ Перевод в СИ, скорость, масса, закон Ома', subject: 'physics', topic: 'Система СИ, механическое движение и закон Ома' },
  { label: '🧮 Обыкновенные и десятичные дроби, проценты', subject: 'math', topic: 'Действия с обыкновенными дробями и задачи на проценты' },
  { label: '🖋️ Н и НН в причастиях и прилагательных', subject: 'russian', topic: 'Правописание Н и НН в разных частях речи' },
  { label: '🌐 Английский: Present Simple vs Present Continuous', subject: 'english', topic: 'Present Simple, Present Continuous и неправильные глаголы' },
];

export default function PracticeArena({
  profile,
  aiSettings,
  onOpenAiSettings,
  prefillQuiz,
  clearPrefillQuiz,
  initialSection,
  clearInitialSection,
}) {
  const saved = loadInputDraft('quiz') || {};
  const [subject, setSubject] = useState(saved.subject || 'math');
  const [topic, setTopic] = useState(saved.topic || '');
  const [arenaMode, setArenaMode] = useState('quiz'); // 'quiz' | 'cards'
  const [arenaSection, setArenaSection] = useState('blitz'); // 'blitz' | 'exam' | 'flashcards' | 'mistakes'
  const [unmasteredMistakes, setUnmasteredMistakes] = useState(
    () => mistakeStore.list().filter((m) => !m.mastered).length
  );

  useEffect(() => {
    const sync = () =>
      setUnmasteredMistakes(mistakeStore.list().filter((m) => !m.mastered).length);
    return subscribeMistakes(sync);
  }, []);

  useEffect(() => {
    if (initialSection) {
      setArenaSection(initialSection);
      clearInitialSection?.();
    }
  }, [initialSection]);

  const [loading, setLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [providerUsed, setProviderUsed] = useState('');
  const [answers, setAnswers] = useState({}); // { qIdx: selectedOptIdx }
  const thinkingRef = useRef(null);

  // Auto-scroll smoothly to AI thinking animation when quiz generation starts
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      thinkingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    return () => clearTimeout(t);
  }, [loading]);

  // Flashcards state
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Orthoepy Stress Blitz state (works 100% offline with instant mnemonics)
  const [stressIdx, setStressIdx] = useState(0);
  const [stressPicked, setStressPicked] = useState(null);
  const [stressCombo, setStressCombo] = useState(0);
  const [stressScore, setStressScore] = useState(0);

  // Orthography Blitz state (ВПР / ОГЭ №6 / ЕГЭ №9–15)
  const [orthoIdx, setOrthoIdx] = useState(0);
  const [orthoPicked, setOrthoPicked] = useState(null);
  const [orthoCombo, setOrthoCombo] = useState(0);
  const [orthoScore, setOrthoScore] = useState(0);

  // Adaptive Mental Math Sprint state (1–11 grade)
  const [mathTask, setMathTask] = useState(() => generateMentalMathTask(profile.grade));
  const [mathPicked, setMathPicked] = useState(null);
  const [mathCombo, setMathCombo] = useState(0);
  const [mathScore, setMathScore] = useState(0);

  useEffect(() => {
    setMathTask(generateMentalMathTask(profile.grade));
    setMathPicked(null);
  }, [profile.grade]);

  // Built-in Pomodoro Study Timer (25 min / 5 min)
  const [pomoMode, setPomoMode] = useState('focus'); // 'focus' | 'break'
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [timerRunning, setTimerRunning] = useState(false);

  const authInfo = getActiveAuthPayload(aiSettings);

  useEffect(() => {
    saveInputDraft('quiz', { subject, topic });
  }, [subject, topic]);

  useEffect(() => {
    if (prefillQuiz) {
      setArenaSection('blitz');
      if (prefillQuiz.subject && prefillQuiz.subject !== 'auto') setSubject(prefillQuiz.subject);
      if (prefillQuiz.topic) setTopic(prefillQuiz.topic);
      clearPrefillQuiz?.();
    }
  }, [prefillQuiz]);

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          const nextMode = pomoMode === 'focus' ? 'break' : 'focus';
          setPomoMode(nextMode);
          recordStudentActivity('quiz_correct', 25);
          return nextMode === 'focus' ? 25 * 60 : 5 * 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerRunning, pomoMode]);

  const startTraining = async (customSubj = subject, customTopic = topic) => {
    setLoading(true);
    setAiStatus({ stage: 'prepare', message: 'Составляем проверочные задания по вашей теме...' });
    setAnswers({});
    setCardIndex(0);
    setFlipped(false);

    const res = await api.generateQuiz({
      grade: profile.grade,
      subject: customSubj,
      topic: customTopic,
      ...authInfo,
      onStatus: (st) => setAiStatus(st),
    });

    setLoading(false);
    setAiStatus(null);
    if (res.ok && res.questions?.length) {
      setQuestions(res.questions);
      setProviderUsed(res.used || '');
    }
  };

  const selectAnswer = (qIdx, optIdx) => {
    if (answers[qIdx] !== undefined) return;
    setAnswers((prev) => ({ ...prev, [qIdx]: optIdx }));
    if (questions[qIdx]?.correct === optIdx) {
      recordStudentActivity('quiz_correct', 10);
    }
  };

  const answeredCount = Object.keys(answers).length;
  const correctCount = Object.entries(answers).filter(
    ([qi, oi]) => questions[Number(qi)]?.correct === oi
  ).length;

  const fmtTime = (s) => {
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${m}:${sec}`;
  };

  const currentCard = questions[cardIndex];

  return (
    <div className="space-y-5">
      {/* v3.2 Top Exam, Flashcards & Mistake Bank Selector */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-2 shadow-xs grid grid-cols-2 lg:grid-cols-4 gap-1.5">
        {[
          {
            id: 'blitz',
            label: '🎯 Блиц-тренажёры',
            sub: 'Викторина · Счёт · Орфография',
          },
          {
            id: 'exam',
            label: '⏱️ Пробная С/Р · ВПР · ОГЭ',
            sub: '5 заданий на 10–15 мин',
          },
          {
            id: 'flashcards',
            label: '🃏 Умные карточки',
            sub: '«Знаю / Повторить» за 5 мин',
          },
          {
            id: 'mistakes',
            label: `🛡️ Копилка ошибок${unmasteredMistakes > 0 ? ` (${unmasteredMistakes})` : ''}`,
            sub: 'Отработка правил на 3 примерах',
          },
        ].map((tab) => {
          const active = arenaSection === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setArenaSection(tab.id)}
              className={`text-left px-3 py-2.5 rounded-xl transition ${
                active
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
              }`}
            >
              <div className="text-xs sm:text-sm font-extrabold truncate">{tab.label}</div>
              <div
                className={`text-[10px] sm:text-[11px] truncate ${
                  active ? 'text-indigo-100' : 'text-slate-400'
                }`}
              >
                {tab.sub}
              </div>
            </button>
          );
        })}
      </div>

      {arenaSection === 'exam' && (
        <TimedMockExamPanel
          profile={profile}
          aiSettings={aiSettings}
          onOpenAiSettings={onOpenAiSettings}
        />
      )}

      {arenaSection === 'flashcards' && <SmartFlashcardsSection grade={profile.grade} />}

      {arenaSection === 'mistakes' && (
        <MistakeBankPanel profile={profile} aiSettings={aiSettings} />
      )}

      {arenaSection === 'blitz' && (
        <>
      {/* Top Row: Quiz Generator + Compact Study Pomodoro Timer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Target className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                ИИ-Тренажёр и флеш-карточки перед контрольной
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Введите любую тему урока — ИИ составит мини-тест на 5 вопросов с разбором или карточки для быстрого повторения!
              </p>
            </div>

            <div className="inline-flex flex-wrap rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-bold gap-0.5">
              <button
                type="button"
                onClick={() => setArenaMode('quiz')}
                className={`px-2.5 py-1.5 rounded-lg transition ${
                  arenaMode === 'quiz'
                    ? 'bg-white dark:bg-slate-700 text-violet-700 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                🏆 Тест
              </button>
              <button
                type="button"
                onClick={() => setArenaMode('cards')}
                className={`px-2.5 py-1.5 rounded-lg transition ${
                  arenaMode === 'cards'
                    ? 'bg-white dark:bg-slate-700 text-violet-700 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                🃏 Карточки
              </button>
              <button
                type="button"
                onClick={() => setArenaMode('stress')}
                className={`px-2.5 py-1.5 rounded-lg transition ${
                  arenaMode === 'stress'
                    ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                ⚡ Ударения
              </button>
              <button
                type="button"
                onClick={() => setArenaMode('ortho')}
                className={`px-2.5 py-1.5 rounded-lg transition ${
                  arenaMode === 'ortho'
                    ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                🖋️ Орфография
              </button>
              <button
                type="button"
                onClick={() => setArenaMode('math')}
                className={`px-2.5 py-1.5 rounded-lg transition ${
                  arenaMode === 'math'
                    ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                🧮 Счёт
              </button>
              <button
                type="button"
                onClick={() => setArenaMode('verbs')}
                className={`px-2.5 py-1.5 rounded-lg transition ${
                  arenaMode === 'verbs'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                🌐 V1–V3
              </button>
              <button
                type="button"
                onClick={() => setArenaMode('history')}
                className={`px-2.5 py-1.5 rounded-lg transition ${
                  arenaMode === 'history'
                    ? 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                🏛️ Даты
              </button>
            </div>
          </div>

          {arenaMode === 'quiz' || arenaMode === 'cards' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <select
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-xs sm:text-sm font-semibold text-slate-800 dark:text-white outline-none"
                >
                  {SUBJECTS.filter((s) => s.id !== 'auto').map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && startTraining()}
                  placeholder={`Тема для ${profile.grade} класса (например: Причастный оборот, Теорема Пифагора)...`}
                  className="sm:col-span-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-violet-500 outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-400 mr-1">Быстрый старт:</span>
                {PRESET_TOPICS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setSubject(p.subject);
                      setTopic(p.topic);
                      startTraining(p.subject, p.topic);
                    }}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 text-violet-800 dark:text-violet-300 border border-violet-200 dark:border-violet-800/70 transition"
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => startTraining()}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 disabled:opacity-55 text-white font-extrabold text-sm shadow-md inline-flex items-center justify-center gap-2 transition"
                >
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  {loading ? 'Создаём тренировку...' : 'Создать тренировку на 5 вопросов'}
                </button>
              </div>
            </>
          ) : (
            <div className="p-3.5 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/60 text-xs text-slate-700 dark:text-slate-200 font-medium">
              {arenaMode === 'stress' && (
                <>⚡ <b>Блиц ударений (ВПР · ОГЭ · ЕГЭ №4)</b> работает мгновенно офлайн: выбирайте верное ударение, собирайте комбо и запоминайте рифмовки!</>
              )}
              {arenaMode === 'ortho' && (
                <>🖋️ <b>Орфографический блиц (ВПР · ОГЭ №6 · ЕГЭ №9–15)</b>: чередующиеся корни, ПРЕ-/ПРИ-, Н/НН и спряжения глаголов с мгновенным разбором правила!</>
              )}
              {arenaMode === 'math' && (
                <>🧮 <b>Устный счёт ({profile.grade} класс)</b>: бесконечный тренажёр вычислений в уме, адаптированный под программу вашего класса!</>
              )}
              {arenaMode === 'verbs' && (
                <>🌐 <b>Неправильные глаголы английского (V1 – V2 – V3)</b>: главные глаголы для школьных диктантов, ВПР, ОГЭ и ЕГЭ с запоминалками!</>
              )}
              {arenaMode === 'history' && (
                <>🏛️ <b>Блиц главных дат истории России (862–1993)</b>: ключевые вехи для ВПР, ОГЭ и ЕГЭ с историческими пояснениями!</>
              )}
            </div>
          )}
        </div>

        {/* Built-in Study Pomodoro Focus Timer */}
        <div className="bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 rounded-2xl p-5 text-white shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-100">
                ⏱️ Таймер концентрации
              </span>
              <div className="inline-flex rounded-lg bg-white/15 p-0.5 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setTimerRunning(false);
                    setPomoMode('focus');
                    setSecondsLeft(25 * 60);
                  }}
                  className={`px-2 py-0.5 rounded-md ${pomoMode === 'focus' ? 'bg-white text-indigo-700' : 'text-white/80'}`}
                >
                  25м Учёба
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTimerRunning(false);
                    setPomoMode('break');
                    setSecondsLeft(5 * 60);
                  }}
                  className={`px-2 py-0.5 rounded-md ${pomoMode === 'break' ? 'bg-white text-indigo-700' : 'text-white/80'}`}
                >
                  5м Отдых
                </button>
              </div>
            </div>

            <div className="text-4xl sm:text-5xl font-black font-mono tracking-tight my-5 text-center">
              {fmtTime(secondsLeft)}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setTimerRunning((r) => !r)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-white text-indigo-700 font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 shadow-sm hover:bg-indigo-50 transition"
              >
                {timerRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {timerRunning ? 'Пауза' : 'Старт'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTimerRunning(false);
                  setSecondsLeft(pomoMode === 'focus' ? 25 * 60 : 5 * 60);
                }}
                className="p-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-white transition"
                title="Сбросить таймер"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] text-indigo-100/90 text-center">
              Метод Помодоро: 25 минут делаем уроки без телефона → 5 минут отдыхаем (+25 XP)!
            </p>
          </div>
        </div>
      </div>

      {loading && (
        <div ref={thinkingRef} className="scroll-mt-24">
          <AiThinkingCard
            title="ИИ-методист составляет интерактивную тренировку..."
            status={aiStatus}
            modeLabel={`${profile.grade} класс`}
            onOpenSettings={onOpenAiSettings}
          />
        </div>
      )}

      {/* QUIZ MODE */}
      {!loading && questions.length > 0 && arenaMode === 'quiz' && (
        <div className="space-y-4 animate-fade-up">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
              Отвечено: {answeredCount} из {questions.length} · Верно: {correctCount}
            </span>
            {providerUsed && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">{providerUsed}</span>
            )}
          </div>

          {questions.map((item, qIdx) => {
            const chosen = answers[qIdx];
            const isAnswered = chosen !== undefined;
            return (
              <div
                key={qIdx}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-3"
              >
                <div className="flex items-start gap-3">
                  <span className="w-7 h-7 rounded-xl bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 font-extrabold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    {qIdx + 1}
                  </span>
                  <div className="flex-1 font-bold text-slate-900 dark:text-white text-sm sm:text-base">
                    <MarkdownMath content={item.q} />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {item.options.map((opt, optIdx) => {
                    const isCorrectOpt = optIdx === item.correct;
                    const isChosenOpt = optIdx === chosen;
                    let cls =
                      'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 hover:border-violet-400 text-slate-800 dark:text-slate-100';
                    if (isAnswered) {
                      if (isCorrectOpt) {
                        cls =
                          'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 ring-1 ring-emerald-500';
                      } else if (isChosenOpt) {
                        cls =
                          'border-rose-400 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200';
                      } else {
                        cls =
                          'border-slate-200 dark:border-slate-800 opacity-60 text-slate-500 dark:text-slate-400';
                      }
                    }

                    return (
                      <button
                        key={optIdx}
                        type="button"
                        disabled={isAnswered}
                        onClick={() => selectAnswer(qIdx, optIdx)}
                        className={`text-left p-3 rounded-xl border text-xs sm:text-sm font-semibold flex items-center justify-between gap-2 transition ${cls}`}
                      >
                        <div className="flex-1">
                          <MarkdownMath content={opt} />
                        </div>
                        {isAnswered && isCorrectOpt && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        )}
                        {isAnswered && isChosenOpt && !isCorrectOpt && (
                          <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {isAnswered && item.explain && (
                  <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800 text-xs text-slate-700 dark:text-slate-200">
                    <MarkdownMath content={`💡 **Пояснение:** ${item.explain}`} />
                  </div>
                )}
              </div>
            );
          })}

          {answeredCount === questions.length && (
            <div className="rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 p-6 text-white shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-up">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center">
                  <Trophy className="w-8 h-8 text-amber-300" />
                </div>
                <div>
                  <h3 className="text-lg font-black">
                    Результат: {correctCount} из {questions.length} верных ответов!
                  </h3>
                  <p className="text-xs sm:text-sm text-emerald-100">
                    Школьная оценка за тренировку:{' '}
                    <strong>
                      «
                      {correctCount === 5
                        ? '5 (Отлично!)'
                        : correctCount === 4
                        ? '4 (Хорошо!)'
                        : correctCount === 3
                        ? '3 (Повторим ещё раз)'
                        : 'Потренируемся ещё!'}
                      »
                    </strong>{' '}
                    · Начислено +{correctCount * 10} XP!
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => startTraining()}
                className="px-5 py-2.5 rounded-xl bg-white text-emerald-800 font-extrabold text-xs sm:text-sm inline-flex items-center gap-1.5 shadow-sm hover:bg-emerald-50"
              >
                <RotateCw className="w-4 h-4" />
                Новые 5 вопросов
              </button>
            </div>
          )}
        </div>
      )}

      {/* FLASHCARDS MODE */}
      {!loading && questions.length > 0 && arenaMode === 'cards' && currentCard && (
        <div className="animate-fade-up max-w-2xl mx-auto space-y-4">
          <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-violet-600" />
              Карточка {cardIndex + 1} из {questions.length}
            </span>
            <span>Нажмите на карточку, чтобы перевернуть</span>
          </div>

          <div
            onClick={() => setFlipped((f) => !f)}
            className={`cursor-pointer rounded-3xl border-2 p-8 min-h-[240px] flex flex-col items-center justify-center text-center shadow-md transition-all select-none ${
              flipped
                ? 'bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/60 dark:to-slate-900 border-emerald-400 dark:border-emerald-700'
                : 'bg-white dark:bg-slate-900 border-violet-300 dark:border-violet-800 hover:border-violet-500'
            }`}
          >
            <span className="text-[11px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 mb-4">
              {flipped ? '✅ Правильный ответ и правило' : '❓ Вопрос для самопроверки'}
            </span>

            {!flipped ? (
              <div className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                <MarkdownMath content={currentCard.q} />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-lg font-black text-emerald-700 dark:text-emerald-300">
                  <MarkdownMath content={currentCard.options[currentCard.correct] || ''} />
                </div>
                <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 max-w-lg">
                  <MarkdownMath content={currentCard.explain} />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={cardIndex === 0}
              onClick={() => {
                setCardIndex((i) => Math.max(0, i - 1));
                setFlipped(false);
              }}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40"
            >
              ← Предыдущая
            </button>

            <button
              type="button"
              onClick={() => setFlipped((f) => !f)}
              className="px-5 py-2 rounded-xl bg-violet-100 dark:bg-violet-950 text-violet-800 dark:text-violet-200 text-xs font-extrabold"
            >
              {flipped ? 'Показать вопрос' : 'Перевернуть ответ'}
            </button>

            <button
              type="button"
              disabled={cardIndex >= questions.length - 1}
              onClick={() => {
                setCardIndex((i) => Math.min(questions.length - 1, i + 1));
                setFlipped(false);
              }}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40"
            >
              Следующая →
            </button>
          </div>
        </div>
      )}

      {/* STRESS ACCENT BLITZ MODE (ВПР / ОГЭ / ЕГЭ №4) */}
      {arenaMode === 'stress' && (() => {
        const item = STRESS_BLITZ_WORDS[stressIdx % STRESS_BLITZ_WORDS.length];
        const isAnswered = stressPicked !== null;
        return (
          <div className="max-w-2xl mx-auto bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-5 animate-fade-up">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                ⚡ Орфоэпический блиц (ВПР · ОГЭ · ЕГЭ №4) — Слово {(stressIdx % STRESS_BLITZ_WORDS.length) + 1} из {STRESS_BLITZ_WORDS.length}
              </span>
              <div className="flex items-center gap-3 text-xs font-extrabold">
                <span className="text-orange-600 dark:text-orange-400">🔥 Серия: {stressCombo}</span>
                <span className="text-emerald-600 dark:text-emerald-400">✅ Верно: {stressScore}</span>
              </div>
            </div>

            <div className="text-center space-y-1.5 py-2">
              <div className="text-xs uppercase tracking-wider font-bold text-slate-400">
                Выберите вариант с ПРАВИЛЬНЫМ ударением:
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
                Как правильно произносится слово?
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {item.options.map((opt, idx) => {
                const isRight = idx === item.correct;
                const isChosen = idx === stressPicked;
                let cls =
                  'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-indigo-500 text-slate-900 dark:text-white';
                if (isAnswered) {
                  if (isRight) {
                    cls =
                      'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/40';
                  } else if (isChosen) {
                    cls =
                      'bg-rose-50 dark:bg-rose-950/50 border-rose-400 text-rose-900 dark:text-rose-200';
                  } else {
                    cls = 'opacity-50 border-slate-200 dark:border-slate-800 text-slate-400';
                  }
                }
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isAnswered}
                    onClick={() => {
                      setStressPicked(idx);
                      if (idx === item.correct) {
                        setStressCombo((c) => c + 1);
                        setStressScore((s) => s + 1);
                        recordStudentActivity('quiz_correct', 5);
                      } else {
                        setStressCombo(0);
                      }
                    }}
                    className={`p-5 rounded-2xl border-2 text-xl sm:text-2xl font-black tracking-wide transition flex items-center justify-center gap-2.5 ${cls}`}
                  >
                    <span>{opt}</span>
                    {isAnswered && isRight && <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />}
                    {isAnswered && isChosen && !isRight && <XCircle className="w-6 h-6 text-rose-600 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {isAnswered && (
              <div className="p-4 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-up">
                <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200">
                  💡 <b>Запоминалка:</b> {item.tip}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStressPicked(null);
                    setStressIdx((i) => i + 1);
                  }}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-extrabold shrink-0 shadow-sm transition"
                >
                  Дальше →
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ORTHOGRAPHY BLITZ MODE (ВПР / ОГЭ №6 / ЕГЭ №9–15) */}
      {arenaMode === 'ortho' && (() => {
        const item = ORTHOGRAPHY_BLITZ_WORDS[orthoIdx % ORTHOGRAPHY_BLITZ_WORDS.length];
        const isAnswered = orthoPicked !== null;
        return (
          <div className="max-w-2xl mx-auto bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-5 animate-fade-up">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                🖋️ Орфография (ВПР · ОГЭ · ЕГЭ) — {(orthoIdx % ORTHOGRAPHY_BLITZ_WORDS.length) + 1} из {ORTHOGRAPHY_BLITZ_WORDS.length}
              </span>
              <div className="flex items-center gap-3 text-xs font-extrabold">
                <span className="text-orange-600 dark:text-orange-400">🔥 Серия: {orthoCombo}</span>
                <span className="text-emerald-600 dark:text-emerald-400">✅ Верно: {orthoScore}</span>
              </div>
            </div>

            <div className="text-center space-y-1.5 py-2">
              <div className="text-xs uppercase tracking-wider font-bold text-slate-400">
                Вставьте пропущенную орфограмму:
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
                «{item.mask}»
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {item.options.map((opt, idx) => {
                const isRight = idx === item.correct;
                const isChosen = idx === orthoPicked;
                let cls =
                  'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-slate-900 dark:text-white';
                if (isAnswered) {
                  if (isRight) {
                    cls =
                      'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/40';
                  } else if (isChosen) {
                    cls =
                      'bg-rose-50 dark:bg-rose-950/50 border-rose-400 text-rose-900 dark:text-rose-200';
                  } else {
                    cls = 'opacity-50 border-slate-200 dark:border-slate-800 text-slate-400';
                  }
                }
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isAnswered}
                    onClick={() => {
                      setOrthoPicked(idx);
                      if (idx === item.correct) {
                        setOrthoCombo((c) => c + 1);
                        setOrthoScore((s) => s + 1);
                        recordStudentActivity('quiz_correct', 5);
                      } else {
                        setOrthoCombo(0);
                      }
                    }}
                    className={`p-5 rounded-2xl border-2 text-lg sm:text-xl font-black tracking-wide transition flex items-center justify-center gap-2.5 ${cls}`}
                  >
                    <span>{opt}</span>
                    {isAnswered && isRight && <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />}
                    {isAnswered && isChosen && !isRight && <XCircle className="w-6 h-6 text-rose-600 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {isAnswered && (
              <div className="p-4 rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-up">
                <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200">
                  📚 <b>Правило:</b> {item.tip}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setOrthoPicked(null);
                    setOrthoIdx((i) => i + 1);
                  }}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-extrabold shrink-0 shadow-sm transition"
                >
                  Следующее слово →
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* MENTAL MATH SPRINT MODE (1–11 КЛАСС) */}
      {arenaMode === 'math' && mathTask && (() => {
        const isAnswered = mathPicked !== null;
        return (
          <div className="max-w-2xl mx-auto bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-5 animate-fade-up">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                🧮 Устный счёт ({profile.grade} класс)
              </span>
              <div className="flex items-center gap-3 text-xs font-extrabold">
                <span className="text-orange-600 dark:text-orange-400">🔥 Серия: {mathCombo}</span>
                <span className="text-emerald-600 dark:text-emerald-400">✅ Решено: {mathScore}</span>
              </div>
            </div>

            <div className="text-center space-y-1.5 py-2">
              <div className="text-xs uppercase tracking-wider font-bold text-slate-400">
                Посчитайте в уме:
              </div>
              <div className="text-3xl sm:text-4xl font-black font-mono text-slate-900 dark:text-white">
                {mathTask.expr} = ?
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {mathTask.options.map((opt, idx) => {
                const isRight = idx === mathTask.correct;
                const isChosen = idx === mathPicked;
                let cls =
                  'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-sky-500 text-slate-900 dark:text-white';
                if (isAnswered) {
                  if (isRight) {
                    cls =
                      'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/40';
                  } else if (isChosen) {
                    cls =
                      'bg-rose-50 dark:bg-rose-950/50 border-rose-400 text-rose-900 dark:text-rose-200';
                  } else {
                    cls = 'opacity-50 border-slate-200 dark:border-slate-800 text-slate-400';
                  }
                }
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isAnswered}
                    onClick={() => {
                      setMathPicked(idx);
                      if (idx === mathTask.correct) {
                        setMathCombo((c) => c + 1);
                        setMathScore((s) => s + 1);
                        recordStudentActivity('quiz_correct', 5);
                      } else {
                        setMathCombo(0);
                      }
                    }}
                    className={`p-4 rounded-2xl border-2 text-xl sm:text-2xl font-black font-mono transition flex items-center justify-center gap-1.5 ${cls}`}
                  >
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>

            {isAnswered && (
              <div className="p-4 rounded-2xl bg-sky-50/80 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-up">
                <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200">
                  💡 <b>Проверка:</b> {mathTask.tip}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMathPicked(null);
                    setMathTask(generateMentalMathTask(profile.grade));
                  }}
                  className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs sm:text-sm font-extrabold shrink-0 shadow-sm transition"
                >
                  Новый пример →
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {arenaMode === 'verbs' && <IrregularVerbsBlitz />}
      {arenaMode === 'history' && <HistoryDatesBlitz />}

      {!loading && questions.length === 0 && (arenaMode === 'quiz' || arenaMode === 'cards') && (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/60 dark:bg-slate-900/50 p-8 text-center">
          <Award className="w-10 h-10 text-violet-500 mx-auto mb-2.5" />
          <h3 className="text-sm sm:text-base font-extrabold text-slate-800 dark:text-white">
            Выберите тему выше или включите мгновенные режимы «⚡ Ударения», «🖋️ Орфография» и «🧮 Счёт»!
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
            Отлично подходит, чтобы за 3 минуты подготовиться к самостоятельной (×3), проверочной (×4) или контрольной работе (×5).
          </p>
        </div>
      )}
        </>
      )}
    </div>
  );
}
