import BuiltinModelPicker from './BuiltinModelPicker';
import { getPhotoInputLabel } from '../standalone/photoPayload';
import { getPhotoCapability } from '../standalone/aiClient';
import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Send,
  Copy,
  Check,
  Download,
  BookOpen,
  GraduationCap,
  RefreshCw,
  MessageSquarePlus,
  CheckCircle2,
  AlertTriangle,
  Volume2,
  VolumeX,
  Printer,
  Target,
  RotateCcw,
  Mic2,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import {
  api,
  copyTextSafe,
  getActiveAuthPayload,
  saveInputDraft,
  loadInputDraft,
  preparePhotoFile,
} from '../api';
import { HELP_MODES, NON_TEXTBOOK_EXAMPLES, SUBJECTS } from '../data/referenceData';
import MarkdownMath from './MarkdownMath';
import AiThinkingCard from './AiThinkingCard';
import PhotoScannerBox, { stripSnippetFromField } from './PhotoScannerBox';
import VoiceMicButton from './VoiceMicButton';
import DrawingPadModal from './DrawingPadModal';
import TeleprompterModal from './TeleprompterModal';
import { exportMarkdownToDocx, exportNotebookSheetPng } from '../standalone/exportEngine';

const QUICK_SUBJECT_IDS = ['auto', 'math', 'russian', 'physics', 'chemistry', 'english'];
const MATH_SYMBOLS = ['²', '³', '√(', 'π', '°', '≤', '≥', '≠', '→', 'Δ'];

export default function HomeworkSolver({
  tutorOnly = false,
  profile,
  aiSettings,
  onOpenAiSettings,
  onChangeAiSettings,
  loadedItem,
  clearLoadedItem,
  prefillTask,
  clearPrefillTask,
  resetSignal = 0,
  onActiveChatChange,
  onLaunchQuizTopic,
}) {
  const initialDraft = loadInputDraft(tutorOnly ? 'tutor' : 'solver') || {};

  const [subject, setSubject] = useState(initialDraft.subject || 'auto');
  const [selectedMode, setSelectedMode] = useState(initialDraft.mode || 'notebook');
  const mode = tutorOnly ? 'tutor' : selectedMode;
  const setMode = (next) => setSelectedMode(tutorOnly ? 'tutor' : next);
  const [taskText, setTaskText] = useState(initialDraft.taskText || '');
  const [imageBase64, setImageBase64] = useState('');
  const [imagesList, setImagesList] = useState([]);
  const [ocrText, setOcrText] = useState('');
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [pasteBusy, setPasteBusy] = useState(false);
  const pasteVersion = useRef(0);
  const [photoMode, setPhotoMode] = useState(initialDraft.photoMode || 'auto');

  const [solving, setSolving] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [error, setError] = useState('');

  const [result, setResult] = useState(null); // { id, markdown, sympyBadge, providerUsed, messages }
  const [paperView, setPaperView] = useState(tutorOnly ? 'modern' : 'notebook'); // 'modern' | 'notebook' | 'lined'
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState(null);
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [teleprompterOpen, setTeleprompterOpen] = useState(false);

  const resultRef = useRef(null);
  const thinkingRef = useRef(null);
  const chatThinkingRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);

  const handleCancelRequest = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSolving(false);
    setChatLoading(false);
    setAiStatus(null);
    setChatStatus(null);
  };

  useEffect(() => () => {
    abortRef.current?.abort(); abortRef.current = null;
    window.speechSynthesis?.cancel();
  }, []);

  const gradeBand = profile.grade <= 4 ? '1-4' : profile.grade <= 9 ? '5-9' : '10-11';
  const relevantExamples = NON_TEXTBOOK_EXAMPLES.filter((e) => e.band === gradeBand);
  const authInfo = getActiveAuthPayload(aiSettings);

  useEffect(() => { pasteVersion.current++; setPasteBusy(false); }, [imagesList]);
  useEffect(() => () => { pasteVersion.current++; }, []);

  // Auto-save unsent draft locally whenever student types
  useEffect(() => {
    saveInputDraft(tutorOnly ? 'tutor' : 'solver', { subject, mode, taskText, photoMode });
  }, [subject, mode, taskText, photoMode]);

  // Sync default paper style when subject changes
  useEffect(() => {
    const subjObj = SUBJECTS.find((s) => s.id === subject);
    if (subjObj && paperView !== 'modern') {
      setPaperView(subjObj.paper === 'lined' ? 'lined' : 'notebook');
    }
  }, [subject]);

  // Reset workspace when user clicks "+ Новое задание / чат"
  useEffect(() => {
    if (!resetSignal) return;
    handleCancelRequest();
    pasteVersion.current++; setPasteBusy(false);
    setTaskText('');
    setImageBase64('');
    setImagesList([]);
    setOcrText('');
    setResult(null);
    setError('');
    setChatInput('');
  }, [resetSignal]);

  // Restore full conversation from ChatSidebar
  useEffect(() => {
    if (loadedItem && loadedItem.item_type !== 'check' && (!tutorOnly || loadedItem.tutor_only)) {
      handleCancelRequest();
      pasteVersion.current++; setPasteBusy(false);
      setSubject(loadedItem.subject || 'auto');
      setMode(loadedItem.mode || 'notebook');
      setTaskText(loadedItem.task_text || '');
      setImageBase64(loadedItem.image_b64 || '');
      setImagesList(loadedItem.images_b64?.length ? loadedItem.images_b64 : loadedItem.image_b64 ? [loadedItem.image_b64] : []);
      setOcrText(loadedItem.ocr_text || '');
      setPhotoMode(loadedItem.photo_mode || 'auto');
      setResult({
        id: loadedItem.id,
        markdown: loadedItem.response_md || '',
        sympyBadge: tutorOnly ? '' : loadedItem.sympy_badge || '',
        providerUsed: loadedItem.provider_used || '',
        photoInputUsed: loadedItem.photo_input_used || 'none',
        messages: Array.isArray(loadedItem.messages) ? loadedItem.messages : [],
      });
      setError('');
      onActiveChatChange?.(loadedItem.id);
      clearLoadedItem?.();
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  }, [loadedItem]);

  // Prefill from CheatSheets or Quick Start
  useEffect(() => {
    if (prefillTask) {
      if (prefillTask.subject) setSubject(prefillTask.subject);
      if (prefillTask.mode) setMode(prefillTask.mode);
      if (prefillTask.text) setTaskText(prefillTask.text);
      clearPrefillTask?.();
      textareaRef.current?.focus();
    }
  }, [prefillTask]);

  const handlePasteClipboard = async (e) => {
    if (abortRef.current || attachmentBusy || pasteBusy) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const operation = ++pasteVersion.current;
          setPasteBusy(true);
          let clean;
          try { clean = await preparePhotoFile(file); }
          catch (error) { if (operation === pasteVersion.current) setError(error.message); return; }
          finally { if (operation === pasteVersion.current) setPasteBusy(false); }
          if (operation !== pasteVersion.current) return;
          setOcrText('');
          setImageBase64(clean);
          setImagesList([clean]);
        }
        break;
      }
    }
  };

  const insertSymbol = (sym) => {
    const el = textareaRef.current;
    if (!el) {
      setTaskText((prev) => prev + sym);
      return;
    }
    const start = el.selectionStart ?? taskText.length;
    const end = el.selectionEnd ?? taskText.length;
    const next = taskText.slice(0, start) + sym + taskText.slice(end);
    setTaskText(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + sym.length, start + sym.length);
    }, 10);
  };

  const handleSolve = async (e) => {
    e?.preventDefault?.();
    if (attachmentBusy || pasteBusy) return;
    if (abortRef.current) return;
    setError('');
    if (!taskText.trim() && !imageBase64 && imagesList.length === 0 && !ocrText.trim()) {
      setError('Напишите условие задания, продиктуйте голосом или прикрепите фотографию.');
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSolving(true);
    setAiStatus({ stage: 'prepare', message: 'Настраиваем решение под ваш класс...' });
    setTimeout(() => {
      thinkingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 65);

    const res = await api.solveHomework({
      grade: profile.grade,
      examGoal: profile.examGoal,
      subject,
      mode,
      taskText,
      imageBase64,
      imagesList,
      ocrText,
      photoMode,
      ...authInfo,
      signal: ctrl.signal,
      onStatus: (st) => setAiStatus(st),
    });

    if (abortRef.current !== ctrl) return;
    abortRef.current = null;
    setSolving(false);
    setAiStatus(null);

    if (res.aborted) return;
    if (!res.ok) {
      setError(res.error || 'Не удалось получить ответ.');
      return;
    }

    if (res.extractedPhotoText && !ocrText) {
      setOcrText(res.extractedPhotoText);
    }

    setResult({
      id: res.id,
      markdown: res.markdown,
      sympyBadge: res.sympyBadge,
      providerUsed: res.providerUsed,
      photoInputUsed: res.photoInputUsed,
      messages: res.messages,
    });
    onActiveChatChange?.(res.id);

    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  };

  const handleFollowup = async (action, customQuestion = '') => {
    if (!result || abortRef.current) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setChatLoading(true);
    setChatStatus({ stage: 'thinking', message: 'ИИ-учитель готовит ответ в диалоге...' });
    setError('');
    setTimeout(() => {
      chatThinkingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 65);

    const res = await api.chatFollowup({
      grade: profile.grade,
      examGoal: profile.examGoal,
      subject,
      mode,
      itemType: 'solve',
      historyId: result.id,
      messages: result.messages || [],
      action,
      question: customQuestion,
      ...authInfo,
      signal: ctrl.signal,
      onStatus: (st) => setChatStatus(st),
    });

    if (abortRef.current !== ctrl) return;
    abortRef.current = null;
    setChatLoading(false);
    setChatStatus(null);

    if (res.aborted) return;
    if (!res.ok) {
      setError(res.error || 'Ошибка при отправке вопроса.');
      return;
    }

    setResult((prev) => ({
      ...prev,
      messages: res.messages,
      providerUsed: res.providerUsed || prev.providerUsed,
    }));
    if (action === 'question') setChatInput('');
  };

  const fullTextForExport = () => {
    if (!result) return '';
    const extra = (result.messages || [])
      .slice(2)
      .map((m) => `${m.role === 'user' ? 'Вопрос ученика' : 'Ответ учителя'}:\n${m.content}`)
      .join('\n\n---\n\n');
    return extra ? `${result.markdown}\n\n---\n\n${extra}` : result.markdown;
  };

  const handleCopy = async () => {
    if (!result) return;
    const ok = await copyTextSafe(fullTextForExport());
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadTxt = () => {
    if (!result) return;
    const blob = new Blob([fullTextForExport()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Domashka_${profile.grade}kl_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSpeak = () => {
    if (!window.speechSynthesis || !result) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    try {
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      const cleanSpeech = result.markdown
        .replace(/[#*_`>|~$]/g, ' ')
        .replace(/\\[a-zA-Z]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1800);
      const utter = new SpeechSynthesisUtterance(cleanSpeech);
      utter.lang = 'ru-RU';
      const voices = window.speechSynthesis.getVoices?.() || [];
      const ruVoice = voices.find((v) => v.lang?.toLowerCase().startsWith('ru'));
      if (ruVoice) utter.voice = ruVoice;
      utter.rate = 1.02;
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(utter);
    } catch {
      setSpeaking(false);
    }
  };

  const followupMessages = (result?.messages || []).slice(2);
  const currentModeObj = HELP_MODES.find((m) => m.id === mode);

  return (
    <div className="space-y-5">
      <form
        onSubmit={handleSolve}
        className="bg-white dark:bg-slate-900 rounded-2xl border border-indigo-200/90 dark:border-indigo-800/80 ring-1 ring-indigo-500/10 shadow-md shadow-indigo-500/5 overflow-hidden"
      >
        {/* Flagship Hero Strip visually distinguishing the main function */}
        <div className="px-4 sm:px-6 py-2.5 bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-700 text-white flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/20 text-[10px] font-black uppercase tracking-wider">
              <Sparkles className="w-3 h-3 text-amber-300" />
              Главный раздел
            </span>
            <span className="text-xs sm:text-sm font-extrabold">
              {tutorOnly ? 'Разберёмся вместе: мой репетитор' : 'Решить домашку по тексту или фото задания'} ({profile.grade} класс)
            </span>
          </div>
          <span className="text-[11px] font-semibold text-indigo-100 hidden sm:inline">
            {tutorOnly ? 'Одна подсказка → твоя попытка → следующий шаг' : 'Готовая запись в тетрадь · Дано / СИ · Разборы 1–4 · Графики и пересказы'}
          </span>
        </div>

        {/* STEP 1: Subject & Help Format */}
        <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-extrabold flex items-center justify-center">
                1
              </span>
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                Выберите предмет и формат помощи
              </h2>
            </div>

            {(taskText || imageBase64 || result) && (
              <button
                type="button"
                onClick={() => {
                  handleCancelRequest();
                  setTaskText('');
                  setImagesList([]);
                  setImageBase64('');
                  setOcrText('');
                  setResult(null);
                  setError('');
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-rose-600 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Очистить поле
              </button>
            )}
          </div>

          {/* Visual Subject Chips (Easy for 1st-11th graders!) */}
          <div className="flex flex-wrap items-center gap-1.5">
            {SUBJECTS.filter((s) => QUICK_SUBJECT_IDS.includes(s.id)).map((s) => {
              const active = subject === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSubject(s.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                    active
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}

            <select
              value={QUICK_SUBJECT_IDS.includes(subject) ? '' : subject}
              onChange={(e) => e.target.value && setSubject(e.target.value)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border outline-none cursor-pointer ${
                !QUICK_SUBJECT_IDS.includes(subject)
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
              }`}
            >
              <option value="">Ещё предметы...</option>
              {SUBJECTS.filter((s) => !QUICK_SUBJECT_IDS.includes(s.id)).map((s) => (
                <option key={s.id} value={s.id} className="text-slate-900 bg-white">
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* 4 Clear Help Mode Cards in a spacious 2x2 grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {HELP_MODES.filter((m) => !tutorOnly || m.id === 'tutor').map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`text-left p-3.5 rounded-xl border transition ${
                    active
                      ? 'border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/60 ring-1 ring-indigo-600'
                      : 'border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                    {m.title}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    {m.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-4 sm:px-6 pb-4 pt-3"><BuiltinModelPicker settings={aiSettings} onChange={onChangeAiSettings} disabled={solving || chatLoading} tutorOnly={tutorOnly} onOpenSettings={onOpenAiSettings} /></div>

        {/* STEP 2: Task Input + Voice + Photo Scanner */}
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-extrabold flex items-center justify-center">
                2
              </span>
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                Напишите задание, скажите голосом или добавьте фото
              </h2>
            </div>

            <VoiceMicButton
              disabled={solving || chatLoading}
              onTranscript={(spoken) =>
                setTaskText((prev) => (prev ? `${prev} ${spoken}` : spoken))
              }
            />
          </div>

          {/* Quick Examples for Current Grade */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-400 mr-1">Примеры ({profile.grade} кл.):</span>
            {relevantExamples.map((ex, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setSubject(ex.subject);
                  setMode(ex.mode);
                  setTaskText(ex.text);
                }}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-950/60 text-slate-700 dark:text-slate-300 transition"
              >
                {ex.title}
              </button>
            ))}
          </div>

          {/* Textarea + Quick Math / Russian Parsing Toolbar */}
          <div className="space-y-2">
            <textarea
              ref={textareaRef}
              rows={4}
              value={taskText}
              onChange={(e) => setTaskText(e.target.value)}
              onPaste={handlePasteClipboard}
              placeholder="Напишите условие своими словами, скопируйте вопрос учителя или вставьте скриншот (Ctrl+V)... Черновик сохраняется автоматически!"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-800/70 text-slate-900 dark:text-white px-4 py-3 text-sm focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none transition"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[11px] text-slate-400 mr-1">Знаки:</span>
                {MATH_SYMBOLS.map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => insertSymbol(sym)}
                    className="px-2 py-0.5 rounded-md text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
                  >
                    {sym}
                  </button>
                ))}
              </div>

              {(subject === 'russian' || subject === 'auto') && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-slate-400">Разборы РФ:</span>
                  {[
                    { code: '¹ (фонетический)', add: 'Сделай фонетический (звуко-буквенный) разбор слова (1): ' },
                    { code: '² (по составу)', add: 'Сделай морфемный разбор по составу слова (2): ' },
                    { code: '³ (морфология)', add: 'Сделай полный морфологический разбор слова (3): ' },
                    { code: '⁴ (синтаксис)', add: 'Сделай синтаксический разбор предложения со схемой (4): ' },
                  ].map((r) => (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => {
                        setSubject('russian');
                        setTaskText((prev) => (prev ? `${r.add}${prev}` : r.add));
                        textareaRef.current?.focus();
                      }}
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100"
                    >
                      {r.code}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Upgraded Smart Photo Scanner 3.2 (Multi-Photo + Photo-Delete Text Strip + .docx/.pdf/.txt Import) */}
          {pasteBusy && <p role="status" className="text-xs text-indigo-600 dark:text-indigo-300">Готовим фото из буфера…</p>}
          <PhotoScannerBox
            onBusyChange={setAttachmentBusy}
            photoMode={photoMode} onChangePhotoMode={setPhotoMode}
            localProvider={authInfo.provider === 'custom'} maxVisionImages={getPhotoCapability(authInfo).maxImages} busy={solving || chatLoading || pasteBusy}
            imageBase64={imageBase64}
            imagesList={imagesList}
            onChangeImage={setImageBase64}
            onChangeImagesList={setImagesList}
            ocrText={ocrText}
            onChangeOcrText={setOcrText}
            purpose="solve"
            onOpenDrawingPad={() => setDrawingOpen(true)}
            onInsertOcrToTask={(txt) =>
              setTaskText((prev) => (prev.trim() ? `${prev}\n${txt}` : txt))
            }
            onRemoveOcrFromTask={(snippet) =>
              setTaskText((prev) => stripSnippetFromField(prev, snippet))
            }
          />

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs sm:text-sm text-rose-800 dark:text-rose-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {/* Submit Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Уровень объяснения: <strong className="text-slate-800 dark:text-slate-200">{profile.grade} класс</strong> · все чаты сохраняются автоматически
            </span>

            <button
              type="submit"
              disabled={solving || attachmentBusy || pasteBusy}
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 disabled:opacity-55 text-white font-extrabold text-sm shadow-lg shadow-indigo-600/20 inline-flex items-center justify-center gap-2 transition transform active:scale-[0.99]"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              {solving
                ? mode === 'tutor' ? 'Репетитор готовит подсказку...' : 'ИИ решает задание...'
                : mode === 'tutor' ? 'Начать с подсказки' : 'Решить домашнее задание'}
            </button>
          </div>
        </div>
      </form>

      {/* Rich Animated AI Thinking Screen (Auto-scrolled into view!) */}
      {solving && (
        <div ref={thinkingRef} className="scroll-mt-20">
          <AiThinkingCard
            title="ИИ-учитель разбирает ваше задание..."
            status={aiStatus}
            hasPhoto={Boolean(imageBase64) && !ocrText}
            modeLabel={currentModeObj?.title}
            onOpenSettings={onOpenAiSettings}
            onCancel={handleCancelRequest}
          />
        </div>
      )}

      {/* Solution & Interactive Chat Display */}
      {result && !solving && (
        <div
          ref={resultRef}
          className="animate-fade-up bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md overflow-hidden"
        >
          {/* Result Header Toolbar */}
          <div className="no-print px-4 sm:px-6 py-3.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/70 px-2.5 py-1 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Сохранено в чатах ({profile.grade} кл.)
              </span>
              {getPhotoInputLabel(result.photoInputUsed) && <span className="text-[11px] rounded-full bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 px-2.5 py-1">{getPhotoInputLabel(result.photoInputUsed)}</span>}
              {result.providerUsed && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-full">
                  {result.providerUsed}
                </span>
              )}
            </div>

            {/* Paper Style + Voice Readout + Print + Copy */}
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="inline-flex rounded-xl bg-slate-200/70 dark:bg-slate-900 p-0.5 text-xs font-medium">
                {[
                  { id: 'notebook', label: '# В клетку' },
                  { id: 'lined', label: '≡ В линейку' },
                  { id: 'modern', label: 'Чистый лист' },
                ].map((pv) => (
                  <button
                    key={pv.id}
                    type="button"
                    onClick={() => setPaperView(pv.id)}
                    className={`px-2.5 py-1 rounded-lg transition ${
                      paperView === pv.id
                        ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-white shadow-sm font-bold'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {pv.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  const subjObj = SUBJECTS.find((s) => s.id === subject);
                  exportMarkdownToDocx({
                    title: taskText ? `Домашняя работа: ${taskText.slice(0, 64)}` : 'Домашняя работа',
                    subtitle: `${profile.grade} класс · ${subjObj?.name || 'Школьный предмет'} · Домашка.ПРО`,
                    markdown: result.markdown,
                    filename: `Domashka_${profile.grade}kl_${subject || 'rabota'}.docx`,
                  });
                }}
                title="Скачать готовый документ Microsoft Word (.docx) для сдачи учителю или доклада"
                className="px-2.5 py-1.5 rounded-xl border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 text-xs font-bold text-blue-700 dark:text-blue-300 inline-flex items-center gap-1"
              >
                <FileText className="w-3.5 h-3.5" />
                Word (.docx)
              </button>

              <button
                type="button"
                onClick={() => {
                  const subjObj = SUBJECTS.find((s) => s.id === subject);
                  exportNotebookSheetPng({
                    title: `Домашняя работа · ${profile.grade} класс (${subjObj?.name || 'Предмет'})`,
                    markdown: result.markdown,
                    paperMode: paperView === 'lined' ? 'lined' : 'grid',
                    filename: `Tetrad_${profile.grade}kl_${paperView === 'lined' ? 'lineyka' : 'kletka'}.png`,
                  });
                }}
                title="Сохранить решение как картинку тетрадного листа (.png) с ровными клеточками или линейками"
                className="px-2.5 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 text-xs font-bold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Лист (.png)
              </button>

              <button
                type="button"
                onClick={() => setTeleprompterOpen(true)}
                title="Открыть телесуфлёр и тренажёр заучивания наизусть к устному ответу"
                className="px-2.5 py-1.5 rounded-xl border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-xs font-bold text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1"
              >
                <Mic2 className="w-3.5 h-3.5" />
                Суфлёр (учить)
              </button>

              <button
                type="button"
                onClick={toggleSpeak}
                title="Озвучить решение голосом"
                className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1 ${
                  speaking
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                }`}
              >
                {speaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                {speaking ? 'Стоп' : 'Озвучить'}
              </button>

              <button
                type="button"
                onClick={handleCopy}
                className="px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Скопировано' : 'Копировать'}
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                title="Распечатать или сохранить как PDF"
                className="px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"
              >
                <Printer className="w-3.5 h-3.5" />
                Печать
              </button>

              <button
                type="button"
                onClick={handleDownloadTxt}
                className="px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                TXT
              </button>
            </div>
          </div>

          {/* Exact Math Verification Banner */}
          {mode !== 'tutor' && result.sympyBadge && (
            <div className="px-5 py-2.5 bg-emerald-50/90 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="flex-1">
                <MarkdownMath content={`**Точная математическая проверка корней:** ${result.sympyBadge}`} />
              </div>
            </div>
          )}

          {/* Notebook Sheet Body */}
          <div
            className={`p-3.5 sm:p-7 sm:pr-14 transition-colors ${
              paperView === 'notebook'
                ? 'notebook-grid'
                : paperView === 'lined'
                ? 'notebook-lined'
                : 'bg-white dark:bg-slate-900'
            }`}
          >
            <MarkdownMath content={result.markdown} />

            {/* Follow-up Chat Messages */}
            {followupMessages.length > 0 && (
              <div className="mt-6 pt-5 border-t-2 border-dashed border-slate-300 dark:border-slate-700 space-y-4">
                <div className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 flex items-center gap-1.5">
                  <MessageSquarePlus className="w-4 h-4" />
                  Диалог с учителем по этой задаче:
                </div>
                {followupMessages.map((m, idx) => (
                  <div
                    key={idx}
                    className={`p-3.5 sm:p-4 rounded-2xl animate-fade-up ${
                      m.role === 'user'
                        ? 'bg-indigo-600 text-white ml-auto max-w-2xl text-sm font-medium shadow-sm'
                        : 'bg-white/95 dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 shadow-sm'
                    }`}
                  >
                    {m.role === 'user' ? <div>{m.content}</div> : <MarkdownMath content={m.content} />}
                  </div>
                ))}
              </div>
            )}

            {chatLoading && (
              <div ref={chatThinkingRef} className="mt-5 scroll-mt-20">
                <AiThinkingCard
                  title="ИИ-учитель отвечает на ваш вопрос..."
                  status={chatStatus}
                  onOpenSettings={onOpenAiSettings}
                />
              </div>
            )}
          </div>

          {/* Follow-up Actions + Chat Input */}
          <div className="no-print p-4 sm:p-5 bg-slate-50 dark:bg-slate-800/70 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300 mr-1">
                Продолжить разбор:
              </span>
              <button
                type="button"
                disabled={chatLoading}
                onClick={() => handleFollowup('board_prep')}
                className="text-xs px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800 font-semibold inline-flex items-center gap-1.5 transition"
              >
                <GraduationCap className="w-3.5 h-3.5 text-amber-600" />
                🙋 К доске (3 вопроса учителя)
              </button>

              <button
                type="button"
                disabled={chatLoading}
                onClick={() => handleFollowup('similar_task')}
                className="text-xs px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 text-indigo-900 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800 font-semibold inline-flex items-center gap-1.5 transition"
              >
                <RefreshCw className="w-3.5 h-3.5 text-indigo-600" />
                Похожая задача
              </button>

              <button
                type="button"
                disabled={chatLoading}
                onClick={() => handleFollowup('simpler')}
                className="text-xs px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-medium inline-flex items-center gap-1.5 transition"
              >
                <BookOpen className="w-3.5 h-3.5 text-blue-600" />
                Объясни ещё проще
              </button>

              {onLaunchQuizTopic && (
                <button
                  type="button"
                  onClick={() =>
                    onLaunchQuizTopic({
                      subject,
                      topic: (taskText || ocrText || 'Повторение темы').slice(0, 90),
                    })
                  }
                  className="text-xs px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-bold inline-flex items-center gap-1.5 transition"
                >
                  <Target className="w-3.5 h-3.5 text-emerald-600" />
                  Пройти мини-тест по этой теме
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleFollowup('question', chatInput);
                  }
                }}
                placeholder={
                  mode === 'tutor'
                    ? 'Напиши свой ответ репетитору или попроси следующую подсказку...'
                    : 'Задай любой уточняющий вопрос в этот чат (например: «Почему знак поменялся?», «Реши другим способом»)...'
                }
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              <button
                type="button"
                disabled={chatLoading || !chatInput.trim()}
                onClick={() => handleFollowup('question', chatInput)}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold inline-flex items-center gap-1.5 shrink-0 transition"
              >
                <Send className="w-4 h-4" />
                Спросить
              </button>
            </div>
          </div>
        </div>
      )}
      <DrawingPadModal
        open={drawingOpen}
        onClose={() => setDrawingOpen(false)}
        onSaveImage={(uri) => {
          setOcrText('');
          setImageBase64(uri);
          setImagesList([uri]);
        }}
      />

      <TeleprompterModal
        open={teleprompterOpen}
        onClose={() => setTeleprompterOpen(false)}
        markdown={result ? fullTextForExport() : taskText}
        title="Суфлёр и заучивание к ответу у доски"
      />
    </div>
  );
}
