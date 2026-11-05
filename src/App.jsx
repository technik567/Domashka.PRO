import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  CheckSquare,
  Calculator,
  BookMarked,
  Target,
  CalendarCheck2,
  Settings,
  GraduationCap,
  Download,
  MessageSquare,
  Moon,
  Sun,
  ShieldCheck,
  LockKeyhole,
} from 'lucide-react';
import {
  getActiveAuthPayload,
  loadAiSettings,
  loadStudentProfile,
  saveAiSettings,
  saveStudentProfile,
  loadTheme,
  saveTheme,
  recordStudentActivity,
} from './api';
import { APP_VERSION } from './version';
import { safeStorage } from './standalone/storageEngine';
import { EXAM_GOALS } from './data/referenceData';
import HomeworkSolver from './components/HomeworkSolver';
import DraftChecker from './components/DraftChecker';
import PracticeArena from './components/PracticeArena';
import ExactTools from './components/ExactTools';
import CheatSheets from './components/CheatSheets';
import DiaryAndGrades from './components/DiaryAndGrades';
import ChatSidebar from './components/ChatSidebar';
import AiSettingsModal from './components/AiSettingsModal';
import ParentModeModal from './components/ParentModeModal';
import { getParentalStatus, subscribeParentalControl } from './standalone/parentalControl';
import { getModelLabel } from './standalone/modelCatalog';

const SECONDARY_SECTIONS = [
  {
    id: 'checker',
    label: 'Проверить',
    icon: CheckSquare,
    activeCls: 'bg-emerald-600 text-white shadow-sm',
  },
  {
    id: 'diary',
    label: 'Дневник',
    icon: CalendarCheck2,
    activeCls: 'bg-rose-600 text-white shadow-sm',
  },
  {
    id: 'arena',
    label: 'Тренажёр',
    icon: Target,
    activeCls: 'bg-violet-600 text-white shadow-sm',
  },
  {
    id: 'exact',
    label: 'Калькуляторы',
    icon: Calculator,
    activeCls: 'bg-amber-600 text-white shadow-sm',
  },
  {
    id: 'cheats',
    label: 'Шпаргалки',
    icon: BookMarked,
    activeCls: 'bg-sky-600 text-white shadow-sm',
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('solver');
  const [profile, setProfile] = useState(() => loadStudentProfile());
  const [aiSettings, setAiSettings] = useState(() => loadAiSettings());
  const [theme, setTheme] = useState(() => loadTheme());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [parentOpen, setParentOpen] = useState(false);
  const [parentStatus, setParentStatus] = useState(getParentalStatus);
  const tutorOnly = parentStatus.enabled;
  const sections = tutorOnly ? SECONDARY_SECTIONS.filter((section) => ['diary', 'cheats'].includes(section.id)) : SECONDARY_SECTIONS;

  useEffect(() => subscribeParentalControl(() => setParentStatus(getParentalStatus())), []);

  const [sidebarDesktopOpen, setSidebarDesktopOpen] = useState(true);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [chatCount, setChatCount] = useState(0);
  const [activeChatId, setActiveChatId] = useState(null);
  const [resetSignal, setResetSignal] = useState(0);

  const [loadedItem, setLoadedItem] = useState(null);
  const [prefillTask, setPrefillTask] = useState(null);
  const [prefillQuiz, setPrefillQuiz] = useState(null);
  const [arenaInitialSection, setArenaInitialSection] = useState(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    setActiveTab('solver'); setLoadedItem(null); setPrefillTask(null); setPrefillQuiz(null);
    setActiveChatId(null); setSettingsOpen(false); setSidebarMobileOpen(false);
    window.speechSynthesis?.cancel();
  }, [tutorOnly]);

  function openAiSettings() {
    if (tutorOnly) setParentOpen(true);
    else setSettingsOpen(true);
  }

  const authInfo = getActiveAuthPayload(aiSettings);
  const isLocalFile = typeof window !== 'undefined' && window.location.protocol === 'file:';
  const isHttpServer =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:');
  const isSandboxedViewer = !safeStorage.isPersistent() && !isLocalFile;

  function updateGrade(newGrade) {
    const g = Number(newGrade);
    let nextGoal = profile.examGoal;
    if (g === 9 && nextGoal === 'ege') nextGoal = 'oge';
    if (g >= 10 && nextGoal === 'oge') nextGoal = 'ege';
    if (g <= 4 && (nextGoal === 'oge' || nextGoal === 'ege')) nextGoal = 'fgos';
    const next = saveStudentProfile({ ...profile, grade: g, examGoal: nextGoal });
    setProfile(next);
  }

  function updateGoal(newGoal) {
    const next = saveStudentProfile({ ...profile, examGoal: newGoal });
    setProfile(next);
  }

  function handleSaveAi(nextSettings) {
    const saved = saveAiSettings(nextSettings);
    setAiSettings(saved);
  }

  function handleSelectChat(item) {
    if (tutorOnly && !item.tutor_only) return;
    setActiveChatId(item.id);
    setLoadedItem({ ...item });
    if (item.item_type === 'check') {
      setActiveTab('checker');
    } else {
      setActiveTab('solver');
    }
  }

  function handleStartNewChat() {
    setActiveChatId(null);
    setResetSignal((n) => n + 1);
    if (activeTab !== 'solver' && activeTab !== 'checker') {
      setActiveTab('solver');
    }
  }

  function handleSendToSolver(taskPayload) {
    setPrefillTask(taskPayload);
    setActiveTab('solver');
  }

  function handleLaunchQuiz(quizPayload) {
    if (tutorOnly) {
      handleSendToSolver({ subject: quizPayload.subject, mode: 'tutor', text: `Помоги мне разобраться в теме: ${quizPayload.topic || 'повторение'}. Начни с одного вопроса.` });
      return;
    }
    setPrefillQuiz(quizPayload);
    setActiveTab('arena');
  }

  const providerBadgeLabel = getModelLabel(aiSettings);

  const isSolverActive = activeTab === 'solver';

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Helpful banner inside Arena's no-network file viewer */}
      {isSandboxedViewer && (
        <div className="no-print bg-emerald-700 text-white text-xs px-4 py-2 text-center font-medium">
          📥 Это автономное приложение <strong>Domashka_PRO.html (v{APP_VERSION})</strong>! Нажмите кнопку <strong>Скачать (Download)</strong> в панели просмотра, сохраните файл на устройство и откройте его двойным кликом в браузере.
        </div>
      )}

      {/* Clean Sticky Header */}
      <header className="no-print bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 h-[54px] sm:h-[57px] flex items-center">
        <div className="w-full px-2 sm:px-5 flex items-center justify-between gap-1.5 sm:gap-3">
          {/* Left: Chat Toggle + Brand + Version */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
            {/* Mobile Drawer Button */}
            <button
              type="button"
              onClick={() => setSidebarMobileOpen(true)}
              aria-label="Открыть историю чатов"
              className="lg:hidden inline-flex items-center gap-1 px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold transition shrink-0"
            >
              <MessageSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span className="hidden sm:inline">Чаты</span>
              {chatCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-indigo-600 text-white text-[10px] font-extrabold">
                  {chatCount}
                </span>
              )}
            </button>

            {/* Desktop Sidebar Toggle */}
            <button
              type="button"
              onClick={() => setSidebarDesktopOpen((v) => !v)}
              className={`hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition ${
                sidebarDesktopOpen
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
              }`}
              title={sidebarDesktopOpen ? 'Скрыть панель истории чатов' : 'Открыть историю чатов'}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Чаты{chatCount > 0 ? ` (${chatCount})` : ''}</span>
            </button>

            {/* Brand + Version Badge */}
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-sm shrink-0">
                <GraduationCap className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <span className="hidden sm:inline text-[13px] sm:text-base font-black tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
                Домашка<span className="text-indigo-600 dark:text-indigo-400">.ПРО</span>
              </span>
              <span className="hidden sm:inline-block text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0">
                v{APP_VERSION}
              </span>
            </div>
          </div>

          {/* Right: Grade + Goal + Theme + AI Settings + Download */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Grade & Goal */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 border border-slate-200 dark:border-slate-700">
              <select
                value={profile.grade}
                onChange={(e) => updateGrade(e.target.value)}
                aria-label="Выберите класс"
                className="w-[84px] sm:w-auto bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-extrabold text-[11px] sm:text-xs px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700 outline-none cursor-pointer"
              >
                <optgroup label="Начальная школа (1–4)">
                  {[1, 2, 3, 4].map((g) => (
                    <option key={g} value={g}>
                      {g} класс
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Основная школа (5–9)">
                  {[5, 6, 7, 8, 9].map((g) => (
                    <option key={g} value={g}>
                      {g} класс
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Старшая школа (10–11)">
                  {[10, 11].map((g) => (
                    <option key={g} value={g}>
                      {g} класс
                    </option>
                  ))}
                </optgroup>
              </select>

              <select
                value={profile.examGoal}
                onChange={(e) => updateGoal(e.target.value)}
                aria-label="Цель обучения"
                className="ml-1 bg-transparent text-slate-700 dark:text-slate-200 font-bold text-xs px-2 py-1.5 rounded-lg outline-none cursor-pointer hidden md:block"
              >
                {EXAM_GOALS.map((eg) => (
                  <option key={eg.id} value={eg.id} className="bg-white text-slate-900">
                    {eg.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-amber-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* AI Settings */}
            <button
              type="button"
              onClick={openAiSettings}
              aria-label="Выбрать нейросеть"
              title={providerBadgeLabel}
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 transition"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  authInfo.provider === 'builtin' ? 'bg-emerald-500' : 'bg-indigo-500'
                }`}
              />
              <Settings className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span title={providerBadgeLabel} className="hidden lg:inline max-w-[150px] truncate">{providerBadgeLabel}</span>
            </button>

            <button type="button" onClick={() => setParentOpen(true)} aria-label="Детский режим и родительский пароль" title={tutorOnly ? 'Детский режим включён' : 'Включить детский режим'} className={`p-2 sm:px-3 rounded-xl border inline-flex items-center gap-1.5 text-xs font-bold ${tutorOnly ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'}`}>
              {tutorOnly ? <LockKeyhole className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}<span className="hidden xl:inline">Детский режим</span>
            </button>
            {/* Download Standalone HTML when on HTTP Server */}
            {isHttpServer && !isSandboxedViewer && !tutorOnly && (
              <a
                href="/Domashka_PRO.html"
                download="Domashka_PRO.html"
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold hidden sm:inline-flex items-center gap-1.5 shadow-sm transition"
                title="Скачать автономный однофайловый вариант приложения"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">Скачать .HTML</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {tutorOnly && <div className="no-print px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/50 border-b border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200 text-xs flex flex-wrap items-center justify-center gap-2"><ShieldCheck className="w-4 h-4" /><strong>Детский режим: только репетитор.</strong><span>Сначала твоя попытка, затем подсказка. Обычные чаты сохранены и скрыты.</span><button type="button" onClick={() => setParentOpen(true)} className="font-bold underline underline-offset-2">Для родителей</button></div>}
      {/* Main Layout: ONE Left Chat Sidebar + Centered Spacious Workspace */}
      <div className="flex-1 flex w-full min-w-0">
        <ChatSidebar
          key={`desktop-${tutorOnly}`}
          tutorOnly={tutorOnly}
          variant="desktop"
          open={sidebarDesktopOpen}
          onClose={() => setSidebarDesktopOpen(false)}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onStartNewChat={handleStartNewChat}
          onCountChange={setChatCount}
        />

        <ChatSidebar
          key={`drawer-${tutorOnly}`}
          tutorOnly={tutorOnly}
          variant="drawer"
          open={sidebarMobileOpen}
          onClose={() => setSidebarMobileOpen(false)}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onStartNewChat={handleStartNewChat}
          onCountChange={setChatCount}
        />

        <main className="flex-1 min-w-0 px-2.5 sm:px-6 pt-3 sm:pt-6 pb-20 md:pb-6">
          <div className="max-w-4xl mx-auto space-y-4 sm:space-y-5">
            {/* Desktop/Tablet Section Navigation Bar (mobile uses sticky thumb bar at bottom!) */}
            <nav
              aria-label="Разделы приложения"
              className="no-print hidden md:flex bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm items-center gap-1.5"
            >
              {/* PRIMARY HERO FUNCTION: Решить домашку */}
              <button
                type="button"
                onClick={() => setActiveTab('solver')}
                className={`w-full md:w-auto py-2.5 px-4 rounded-xl text-xs sm:text-sm font-black inline-flex items-center justify-center gap-2 transition whitespace-nowrap shrink-0 ${
                  isSolverActive
                    ? 'bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 text-white shadow-md shadow-indigo-500/25 ring-2 ring-indigo-500/25'
                    : 'bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/80 dark:to-violet-950/70 text-indigo-700 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700 hover:from-indigo-100 hover:to-violet-100 shadow-xs'
                }`}
              >
                <Sparkles
                  className={`w-4 h-4 shrink-0 ${
                    isSolverActive ? 'text-amber-300' : 'text-indigo-600 dark:text-amber-300'
                  }`}
                />
                <span>{tutorOnly ? 'Мой репетитор' : 'Решить домашку'}</span>
              </button>

              {/* Visual separator between main hero feature and auxiliary student tools */}
              <div
                aria-hidden="true"
                className="hidden md:block w-px h-7 bg-slate-200 dark:bg-slate-700 mx-0.5 shrink-0"
              />

              {/* SECONDARY TOOLS (horizontally scrollable on small phones, full flex on desktop) */}
              <div className="flex flex-1 overflow-x-auto no-scrollbar md:flex-nowrap items-center gap-1 min-w-0">
                {sections.map((sec) => {
                  const Icon = sec.icon;
                  const isAct = activeTab === sec.id;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => setActiveTab(sec.id)}
                      className={`flex-1 py-2 px-2.5 rounded-xl text-xs sm:text-[13px] font-bold inline-flex items-center justify-center gap-1.5 transition whitespace-nowrap shrink-0 ${
                        isAct
                          ? sec.activeCls
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{sec.label}</span>
                    </button>
                  );
                })}
              </div>
            </nav>

            {/* Active Workspace View */}
            <div key={`workspace-${tutorOnly}`}>
              {activeTab === 'solver' && (
                <HomeworkSolver
                  tutorOnly={tutorOnly}
                  profile={profile}
                  aiSettings={aiSettings}
                  onOpenAiSettings={openAiSettings}
                  loadedItem={loadedItem}
                  clearLoadedItem={() => setLoadedItem(null)}
                  prefillTask={prefillTask}
                  clearPrefillTask={() => setPrefillTask(null)}
                  resetSignal={resetSignal}
                  onActiveChatChange={setActiveChatId}
                  onLaunchQuizTopic={tutorOnly ? undefined : handleLaunchQuiz}
                />
              )}

              {!tutorOnly && activeTab === 'checker' && (
                <DraftChecker
                  profile={profile}
                  aiSettings={aiSettings}
                  onOpenAiSettings={openAiSettings}
                  loadedItem={loadedItem}
                  clearLoadedItem={() => setLoadedItem(null)}
                  resetSignal={resetSignal}
                  onActiveChatChange={setActiveChatId}
                  onOpenMistakeBank={() => {
                    setArenaInitialSection('mistakes');
                    setActiveTab('arena');
                  }}
                />
              )}

              {activeTab === 'diary' && (
                <DiaryAndGrades
                  grade={profile.grade}
                  onSolveTask={handleSendToSolver}
                  onEarnXp={(pts) => recordStudentActivity('homework_done', pts)}
                />
              )}

              {!tutorOnly && activeTab === 'arena' && (
                <PracticeArena
                  profile={profile}
                  aiSettings={aiSettings}
                  onOpenAiSettings={openAiSettings}
                  prefillQuiz={prefillQuiz}
                  clearPrefillQuiz={() => setPrefillQuiz(null)}
                  initialSection={arenaInitialSection}
                  clearInitialSection={() => setArenaInitialSection(null)}
                />
              )}

              {!tutorOnly && activeTab === 'exact' && <ExactTools onSendToAiSolver={handleSendToSolver} />}

              {activeTab === 'cheats' && (
                <CheatSheets
                  grade={profile.grade}
                  onPracticeTopic={handleLaunchQuiz}
                  onSolveSample={handleSendToSolver}
                />
              )}
            </div>
          </div>
        </main>
      </div>

      <footer className="no-print pb-20 md:pb-3 pt-3 px-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center text-xs text-slate-500 dark:text-slate-400">
        Домашка.ПРО v{APP_VERSION} · ФГОС, ВПР, ОГЭ и ЕГЭ (1–11 класс) · Локальное автосохранение чатов и дневника на вашем устройстве
      </footer>

      {/* Thumb-Friendly Sticky Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Мобильная навигация"
        className={`no-print md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 px-1 py-1.5 grid ${tutorOnly ? 'grid-cols-3' : 'grid-cols-6'} gap-0.5 shadow-[0_-4px_20px_rgba(15,23,42,0.08)]`}
      >
        <button
          type="button"
          onClick={() => setActiveTab('solver')}
          className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-xl transition ${
            isSolverActive
              ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm'
              : 'bg-indigo-50/90 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span className="text-[9.5px] font-extrabold leading-tight mt-0.5 tracking-tight">
            {tutorOnly ? 'Репетитор' : 'Решить'}
          </span>
        </button>
        {sections.map((sec) => {
          const Icon = sec.icon;
          const isAct = activeTab === sec.id;
          const shortMobLabel =
            sec.id === 'checker'
              ? 'Проверка'
              : sec.id === 'arena'
              ? 'Тесты'
              : sec.id === 'exact'
              ? 'Точные'
              : sec.id === 'cheats'
              ? 'Шпаргалки'
              : sec.label;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => setActiveTab(sec.id)}
              className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-xl transition ${
                isAct
                  ? sec.activeCls
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[9.5px] font-bold leading-tight mt-0.5 tracking-tight">
                {shortMobLabel}
              </span>
            </button>
          );
        })}
      </nav>

      <ParentModeModal isOpen={parentOpen} onClose={() => setParentOpen(false)} status={parentStatus} />
      <AiSettingsModal
        isOpen={settingsOpen && !tutorOnly}
        onClose={() => setSettingsOpen(false)}
        settings={aiSettings}
        onSave={handleSaveAi}
      />
    </div>
  );
}
