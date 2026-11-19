import InterfaceSettings from './components/InterfaceSettings';
import { loadInterfacePreferences, saveInterfacePreferences } from './standalone/interfacePreferences';
import backgroundUrl from '../assets/study-background.webp?inline';
import SiteAssistant from './components/SiteAssistant';
import GuidedTour from './components/GuidedTour';
import React, { useEffect, useState } from 'react';
import {
  CheckSquare,
  Calculator,
  BookMarked,
  Target,
  CalendarCheck2,
  Settings,
  GraduationCap,
  MessageSquare,
  ShieldCheck,
  Users,
  PanelLeft,
  Plus,
  ChevronRight,
} from 'lucide-react';
import {
  loadAiSettings,
  loadStudentProfile,
  saveAiSettings,
  saveStudentProfile,
  loadTheme,
  saveTheme,
  recordStudentActivity,
} from './api';
import { APP_VERSION } from './version';
import { cloudConfigured } from './cloud/bridge';
import FamilyAccounts, { FamilyAccountBar } from './components/FamilyAccounts';
import { getCurrentAccount, getManagedChild, subscribeAccounts } from './standalone/accounts';
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

const SECONDARY_SECTIONS = [
  { id: 'family', label: 'Семья', icon: Users, activeCls: 'bg-indigo-600 text-white shadow-sm' },
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
  const [tourReplay, setTourReplay] = useState(0);
  const [activeTab, setActiveTab] = useState('solver');
  const [interfacePrefs,setInterfacePrefs]=useState(loadInterfacePreferences);
  const basic=interfacePrefs.mode==='basic';
  const [interfaceOpen,setInterfaceOpen]=useState(false);
  const updateInterface=next=>{setInterfacePrefs(saveInterfacePreferences(next));};
  const managedChild = getManagedChild();
  const [profile, setProfile] = useState(() => loadStudentProfile());
  const [aiSettings, setAiSettings] = useState(() => loadAiSettings());
  const [theme, setTheme] = useState(() => loadTheme());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [parentOpen, setParentOpen] = useState(false);
  const [parentStatus, setParentStatus] = useState(getParentalStatus);
  const tutorOnly = parentStatus.enabled;
  const sections = (tutorOnly ? SECONDARY_SECTIONS.filter((section) => ['diary', 'cheats', 'family'].includes(section.id)) : SECONDARY_SECTIONS).filter(s=>!basic || s.id==='family');

  useEffect(() => subscribeParentalControl(() => setParentStatus(getParentalStatus())), []);

  const [sidebarDesktopOpen, setSidebarDesktopOpen] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
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
    setActiveTab((current) => ['diary', 'cheats', 'family'].includes(current) ? current : 'solver'); setLoadedItem(null); setPrefillTask(null); setPrefillQuiz(null);
    setActiveChatId(null); setSettingsOpen(false); setSidebarMobileOpen(false);
    window.speechSynthesis?.cancel();
  }, [tutorOnly]);

  const navigateHelp = (section) => { setSidebarMobileOpen(false); setActiveTab(tutorOnly && !['family','diary','cheats','solver'].includes(section) ? 'solver' : section); };

  function openAiSettings() {
    if (managedChild) { setActiveTab('family'); return; }
    if (tutorOnly) setParentOpen(true);
    else setSettingsOpen(true);
  }

  useEffect(() => {
    const refreshSharedSettings = (event) => { if (getManagedChild() && (!event.key || event.key.endsWith('::domashka_pro_ai_settings_v2'))) setAiSettings(loadAiSettings()); };
    window.addEventListener('storage', refreshSharedSettings);
    return () => window.removeEventListener('storage', refreshSharedSettings);
  }, []);

  useEffect(() => subscribeAccounts(() => { if (getManagedChild()) { setAiSettings(loadAiSettings()); setProfile(loadStudentProfile()); } }), []);

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
    if (managedChild) { setActiveTab('family'); return; }
    if (getParentalStatus().enabled) { setParentOpen(true); return; }
    const saved = saveAiSettings(nextSettings);
    setAiSettings(saved);
  }

  function handleSelectChat(item) {
    if (tutorOnly && !item.tutor_only) return;
    setSidebarMobileOpen(false);
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

  const isSolverActive = activeTab === 'solver';

  return <div className="study-app" data-interface={interfacePrefs.mode} data-photo-background={interfacePrefs.background?'on':'off'} style={{'--study-photo':`url("${backgroundUrl}")`}}>
    {isSandboxedViewer&&<div className="study-viewer-notice">Скачайте Domashka_PRO.html и откройте в браузере. Просмотр файла здесь не предоставляет облачный кабинет.</div>}
    <header className="study-header no-print">
      <div className="flex items-center min-w-0 gap-2">
        <button type="button" aria-label="Открыть историю чатов" className="study-icon-button study-history-toggle-mobile" onClick={()=>setSidebarMobileOpen(true)}><PanelLeft size={20}/></button>
        <button type="button" aria-label={sidebarDesktopOpen?'Скрыть историю чатов':'Открыть историю чатов'} className="study-icon-button study-history-toggle-desktop" onClick={()=>setSidebarDesktopOpen(v=>!v)}><PanelLeft size={20}/></button>
        <button type="button" className="study-brand" onClick={()=>setActiveTab('solver')}><span className="study-brand-mark"><GraduationCap size={22}/></span><span>Домашка<span className="study-brand-suffix">.ПРО</span></span></button>
        <span className="study-version">{APP_VERSION}</span>
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        <button type="button" className="study-icon-button" aria-label="Новый чат" onClick={()=>{setActiveTab('solver');handleStartNewChat();}}><Plus size={20}/></button>
        <button type="button" className="study-button quiet" onClick={()=>setActiveTab('family')}><Users size={17}/><span className="hidden sm:inline">Семья</span><span className="sr-only sm:hidden">Семья</span></button>
        <button type="button" className="study-icon-button" data-tour="ai-settings" aria-label="Настройки" onClick={()=>setInterfaceOpen(true)}><Settings size={19}/></button>
      </div>
    </header>
    <div data-tour="account-bar" className="study-account-bar"><FamilyAccountBar onOpen={()=>setActiveTab('family')}/></div>
    {managedChild?.policy.allowAi===false&&<p className="study-important">ИИ и OCR отключены родителем. Семейные задания, дневник и справочники доступны в разделе «Семья» и продвинутом интерфейсе.</p>}
    {tutorOnly&&<div className="study-parent-notice"><ShieldCheck size={15}/><span>Детский режим: только репетитор.</span><button type="button" onClick={()=>managedChild?setActiveTab('family'):setParentOpen(true)}>Для родителей</button></div>}
    <div className="study-layout">
      <ChatSidebar basic={basic} key={`desktop-${tutorOnly}`} tutorOnly={tutorOnly} variant="desktop" open={sidebarDesktopOpen} onClose={()=>setSidebarDesktopOpen(false)} activeChatId={activeChatId} onSelectChat={handleSelectChat} onStartNewChat={handleStartNewChat}/>
      <ChatSidebar basic={basic} key={`drawer-${tutorOnly}`} tutorOnly={tutorOnly} variant="drawer" open={sidebarMobileOpen} onClose={()=>setSidebarMobileOpen(false)} activeChatId={activeChatId} onSelectChat={handleSelectChat} onStartNewChat={handleStartNewChat}/>
      <main data-tour="workspace" className={`study-workspace ${isSolverActive?'is-chat':''}`}>
        {!basic&&<nav aria-label="Разделы приложения" className="study-section-nav no-print"><button type="button" className={isSolverActive?'selected':''} onClick={()=>setActiveTab('solver')}><MessageSquare size={16}/>{tutorOnly?'Мой репетитор':'Чат'}</button>{sections.map(sec=><button type="button" key={sec.id} className={activeTab===sec.id?'selected':''} onClick={()=>setActiveTab(sec.id)}><sec.icon size={16}/>{sec.label}</button>)}</nav>}
        {basic&&!isSolverActive&&<div className="study-page-heading"><button type="button" className="study-link" onClick={()=>setActiveTab('solver')}>Чат</button><ChevronRight size={14}/><span>{SECONDARY_SECTIONS.find(s=>s.id===activeTab)?.label||'Учебные инструменты'}</span></div>}
        <div className={isSolverActive?'study-chat-width':'study-tools-width'}>
            <div key={`workspace-${tutorOnly}`}>
              {activeTab === 'family' && <FamilyAccounts />}
              <div hidden={activeTab !== 'solver'}>
                <HomeworkSolver
                  tutorOnly={tutorOnly}
                  interfaceMode={interfacePrefs.mode}
                  onChangeAiSettings={managedChild ? undefined : handleSaveAi}
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
              </div>

              {!tutorOnly && activeTab === 'checker' && (
                <DraftChecker
                  profile={profile}
                  aiSettings={aiSettings}
                  onOpenAiSettings={openAiSettings}
                  onChangeAiSettings={managedChild ? undefined : handleSaveAi}
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
                  onEarnXp={(pts, eventKey) => recordStudentActivity('homework_done', pts, { eventKey })}
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
    <footer className="study-footer no-print">ИИ может ошибаться. Проверяйте важное. <span>{cloudConfigured()?'Облачный кабинет':'Локальное хранение на этом устройстве'}</span>{!tutorOnly&&isHttpServer&&<a href="./Domashka_PRO.html" download="Domashka_PRO.html" aria-label="Скачать автономный HTML">Автономная версия</a>}</footer>
    <SiteAssistant page={activeTab} onNavigate={navigateHelp} onReplayTour={()=>setTourReplay(n=>n+1)}/>
    <GuidedTour inlineWelcome role={getCurrentAccount()?.role||'guest'} cloudMode={cloudConfigured()} tutorOnly={tutorOnly} interfaceMode={interfacePrefs.mode} allowAi={managedChild?.policy.allowAi!==false} replay={tourReplay} onNavigate={navigateHelp}/>
    <ParentModeModal isOpen={parentOpen} onClose={()=>setParentOpen(false)} status={parentStatus}/>
    <InterfaceSettings open={interfaceOpen} onClose={()=>setInterfaceOpen(false)} preferences={interfacePrefs} onPreferences={updateInterface} theme={theme} onTheme={setTheme} profile={profile} onGrade={updateGrade} onGoal={updateGoal} goals={EXAM_GOALS} managed={Boolean(managedChild)} tutorOnly={tutorOnly} onAi={openAiSettings} onParent={!cloudConfigured()&&!managedChild?()=>setParentOpen(true):undefined} onFamily={()=>setActiveTab('family')}/>
    <AiSettingsModal isOpen={settingsOpen&&!tutorOnly&&!managedChild} onClose={()=>setSettingsOpen(false)} settings={aiSettings} onSave={handleSaveAi} onOpenBuiltinPicker={()=>{
      if(getParentalStatus().enabled){setParentOpen(true);return;}
      setActiveTab('solver');setTimeout(()=>{const picker=document.getElementById('builtin-model-picker');if(picker?.tagName==='DETAILS')picker.open=true;picker?.scrollIntoView({behavior:'smooth',block:'start'});document.getElementById('chat-builtin-model')?.focus({preventScroll:true});},60);
    }}/>
  </div>;
}
