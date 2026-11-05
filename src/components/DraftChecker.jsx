import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Send,
  BookOpen,
  MessageSquarePlus,
  RotateCcw,
  Sparkles,
  Printer,
  Mic2,
  Clock,
  SearchCheck,
  FileText,
  Image as ImageIcon,
  ShieldAlert,
} from 'lucide-react';
import {
  api,
  copyTextSafe,
  getActiveAuthPayload,
  saveInputDraft,
  loadInputDraft,
  runLocalExpressCheck,
  fileToDataUri,
  transformImageCanvas,
} from '../api';
import MarkdownMath from './MarkdownMath';
import AiThinkingCard from './AiThinkingCard';
import PhotoScannerBox, { stripSnippetFromField } from './PhotoScannerBox';
import VoiceMicButton from './VoiceMicButton';
import DrawingPadModal from './DrawingPadModal';
import TeleprompterModal from './TeleprompterModal';
import { exportMarkdownToDocx, exportNotebookSheetPng } from '../standalone/exportEngine';

const RU_STOPWORDS = new Set([
  'этот', 'этого', 'этой', 'этом', 'было', 'были', 'быть', 'будет', 'очень', 'когда',
  'если', 'чтобы', 'потому', 'поэтому', 'также', 'только', 'через', 'после', 'перед',
  'между', 'который', 'которая', 'которые', 'которого', 'своей', 'своего', 'свои',
  'наши', 'весь', 'всех', 'всего', 'один', 'одна', 'одно', 'может', 'могут', 'такой',
]);

const CHECK_MODES = [
  {
    id: 'general',
    title: '📋 Любая работа / Упражнение',
    desc: 'Орфография, пунктуация, вычисления и соответствие заданию',
  },
  {
    id: 'math_step',
    title: '📐 Задача (Алгебра / Физика / Химия)',
    desc: 'Поиск ошибок в знаках, формулах, переводе в СИ и вычислениях',
  },
  {
    id: 'essay_oge',
    title: '📝 Сочинение ОГЭ (9 кл., ≥ 70 слов)',
    desc: 'Критерии ФИПИ 13.1–13.3: тезис, 2 примера-аргумента, грамотность',
  },
  {
    id: 'essay_ege',
    title: '🎓 Сочинение ЕГЭ (10–11 кл., ≥ 150 слов)',
    desc: 'Критерии К1–К10: позиция автора, комментарий, своя позиция, нормы',
  },
];

const SAMPLE_DRAFTS = [
  {
    label: 'Пример: Русский язык (с ошибками)',
    type: 'general',
    cond: 'Перепишите текст, раскрывая скобки и исправляя орфографические и пунктуационные ошибки.',
    draft:
      'Когда мы приехали на дачю солнце уже садилось за гаризонт. Мы не чуствовали усталости потомучто вечер был по настоящему чудесный и празник удался!',
  },
  {
    label: 'Пример: Алгебра (ошибка в решении)',
    type: 'math_step',
    cond: 'Решите квадратное уравнение: x^2 - 7x + 10 = 0',
    draft:
      'x^2 - 7x + 10 = 0\nДискриминант: D = (-7)^2 - 4 * 1 * 10 = 49 - 40 = 19\nКорни: x1 = (7 - 3) / 2 = 2; x2 = (7 + 3) / 2 = 6.\nОтвет: 2 и 6.',
  },
];

export default function DraftChecker({
  profile,
  aiSettings,
  onOpenAiSettings,
  loadedItem,
  clearLoadedItem,
  resetSignal = 0,
  onActiveChatChange,
  onOpenMistakeBank,
}) {
  const saved = loadInputDraft('checker') || {};

  const [checkType, setCheckType] = useState(saved.checkType || 'general');
  const [conditionText, setConditionText] = useState(saved.conditionText || '');
  const [draftText, setDraftText] = useState(saved.draftText || '');
  const [imageBase64, setImageBase64] = useState('');
  const [imagesList, setImagesList] = useState([]);
  const [ocrText, setOcrText] = useState('');

  const [checking, setChecking] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [expressPreview, setExpressPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState(null);
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [teleprompterOpen, setTeleprompterOpen] = useState(false);

  const resultRef = useRef(null);
  const thinkingRef = useRef(null);
  const chatThinkingRef = useRef(null);
  const abortRef = useRef(null);
  useEffect(() => () => { abortRef.current?.abort(); abortRef.current = null; }, []);
  const authInfo = getActiveAuthPayload(aiSettings);

  const handleCancelRequest = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setChecking(false);
    setChatLoading(false);
    setAiStatus(null);
    setChatStatus(null);
  };

  // Auto-save unsent draft locally
  useEffect(() => {
    saveInputDraft('checker', { checkType, conditionText, draftText });
  }, [checkType, conditionText, draftText]);

  // Reset on "+ Новое задание / чат"
  useEffect(() => {
    if (!resetSignal) return;
    handleCancelRequest();
    setConditionText('');
    setDraftText('');
    setImageBase64('');
    setImagesList([]);
    setOcrText('');
    setResult(null);
    setExpressPreview(null);
    setError('');
  }, [resetSignal]);

  // Restore saved check session from ChatSidebar
  useEffect(() => {
    if (loadedItem && loadedItem.item_type === 'check') {
      handleCancelRequest();
      setCheckType(loadedItem.subject || 'general');
      setConditionText(loadedItem.condition_text || '');
      setDraftText(loadedItem.draft_text || loadedItem.task_text || '');
      setImageBase64(loadedItem.image_b64 || '');
      setImagesList(loadedItem.images_b64?.length ? loadedItem.images_b64 : loadedItem.image_b64 ? [loadedItem.image_b64] : []);
      setOcrText(loadedItem.ocr_text || '');
      setResult({
        id: loadedItem.id,
        markdown: loadedItem.response_md,
        providerUsed: loadedItem.provider_used || '',
        messages: loadedItem.messages || [],
      });
      setExpressPreview(null);
      setError('');
      onActiveChatChange?.(loadedItem.id);
      clearLoadedItem?.();
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  }, [loadedItem]);

  const textXray = useMemo(() => {
    const src = (draftText || ocrText || '').trim();
    if (!src) return null;
    const words = src.match(/[а-яёa-z0-9-]+/giu) || [];
    const wordCount = words.filter((w) => /[а-яёa-z0-9]/iu.test(w)).length;
    if (wordCount === 0) return null;

    const sentences = src.split(/[.!?…]+/).filter((s) => /[а-яёa-z0-9]/iu.test(s)).length || 1;
    const readSec = Math.max(4, Math.round((wordCount / 120) * 60));
    const min = Math.floor(readSec / 60);
    const sec = readSec % 60;
    const readTime = min > 0 ? `${min} мин ${sec} сек` : `${sec} сек`;

    // Detect lexical repetitions (tautology) for essays (words >= 5 chars repeated >= 3 times)
    const stemCounts = {};
    const stemExample = {};
    words.forEach((raw) => {
      const low = raw.toLowerCase().replace(/ё/g, 'е');
      if (!/^[а-яa-z]{5,}$/i.test(low) || RU_STOPWORDS.has(low)) return;
      const stem = low.length >= 7 ? low.slice(0, -2) : low.slice(0, -1);
      stemCounts[stem] = (stemCounts[stem] || 0) + 1;
      if (!stemExample[stem]) stemExample[stem] = raw.toLowerCase();
    });

    const repeats = Object.entries(stemCounts)
      .filter(([, cnt]) => cnt >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([stem, cnt]) => ({ word: stemExample[stem], count: cnt }));

    return { wordCount, sentences, readTime, repeats };
  }, [draftText, ocrText]);

  const liveWordCount = textXray?.wordCount || 0;

  const handlePasteClipboard = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const uri = await fileToDataUri(file);
          const clean = await transformImageCanvas(uri, { filterMode: 'original', maxDim: 1650 });
          setOcrText('');
          setImageBase64(clean);
          setImagesList([clean]);
        }
        break;
      }
    }
  };

  const handleCheck = async (e) => {
    e?.preventDefault?.();
    setError('');

    if (!draftText.trim() && !imageBase64 && imagesList.length === 0 && !ocrText.trim()) {
      setError('Напишите свой черновик в поле ниже ИЛИ прикрепите фотографию тетради.');
      return;
    }

    // 1. Instant 0.01s Express Pre-Check so user gets immediate feedback while AI prepares full grading!
    if (draftText.trim() || ocrText.trim()) {
      const exp = runLocalExpressCheck({
        conditionText,
        draftText: draftText.trim() || ocrText.trim(),
        checkType,
        grade: profile.grade,
      });
      setExpressPreview(exp);
    } else {
      setExpressPreview(null);
    }

    setChecking(true);
    setAiStatus({ stage: 'prepare', message: 'Начинаем внимательную проверку вашей работы...' });
    setTimeout(() => {
      thinkingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 65);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const res = await api.checkDraft({
      grade: profile.grade,
      examGoal: profile.examGoal,
      checkType,
      conditionText,
      draftText,
      imageBase64,
      imagesList,
      ocrText,
      ...authInfo,
      signal: ctrl.signal,
      onStatus: (st) => setAiStatus(st),
    });

    if (abortRef.current !== ctrl) return;
    abortRef.current = null;
    setChecking(false);
    setAiStatus(null);

    if (res.aborted) return;
    if (!res.ok) {
      setError(res.error || 'Не удалось выполнить проверку.');
      return;
    }

    if (res.extractedPhotoText && !ocrText) {
      setOcrText(res.extractedPhotoText);
    }
    if (res.express) {
      setExpressPreview(res.express);
    }

    setResult({
      id: res.id,
      markdown: res.markdown,
      providerUsed: res.providerUsed,
      mistakesAdded: res.mistakesAdded || 0,
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
    setChatStatus({ stage: 'thinking', message: 'Учитель отвечает на ваш вопрос по проверке...' });
    setError('');
    setTimeout(() => {
      chatThinkingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 65);

    const res = await api.chatFollowup({
      grade: profile.grade,
      examGoal: profile.examGoal,
      subject: checkType,
      mode: 'checker',
      itemType: 'check',
      historyId: result.id,
      messages: result.messages || [],
      action,
      question: customQuestion,
      ...authInfo,
      onStatus: (st) => setChatStatus(st),
      signal: ctrl.signal,
    });

    if (abortRef.current !== ctrl) return;
    abortRef.current = null;
    setChatLoading(false);
    setChatStatus(null);

    if (res.aborted) return;
    if (!res.ok) {
      setError(res.error || 'Ошибка отправки вопроса.');
      return;
    }

    setResult((prev) => ({
      ...prev,
      messages: res.messages,
    }));
    if (action === 'question') setChatInput('');
  };

  const handleCopy = async () => {
    if (!result) return;
    const ok = await copyTextSafe(result.markdown);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const followupMessages = (result?.messages || []).slice(2);

  return (
    <div className="space-y-5">
      <form
        onSubmit={handleCheck}
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden"
      >
        {/* Header & Mode Selector */}
        <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                Проверь мою работу (Поиск ошибок перед сдачей учителю)
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Вставьте своё решение или прикрепите фото тетради — ИИ найдёт ошибки, объяснит правила и напишет исправленный чистовик.
              </p>
            </div>

            {(conditionText || draftText || imageBase64 || result) && (
              <button
                type="button"
                onClick={() => {
                  handleCancelRequest();
                  setImagesList([]);
                  setConditionText('');
                  setDraftText('');
                  setImageBase64('');
                  setOcrText('');
                  setResult(null);
                  setExpressPreview(null);
                  setError('');
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-rose-600"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Очистить
              </button>
            )}
          </div>

          {/* 4 Clear Check Type Cards in spacious 2x2 grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {CHECK_MODES.map((m) => {
              const active = checkType === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setCheckType(m.id)}
                  className={`text-left p-3.5 rounded-xl border transition ${
                    active
                      ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/50 ring-1 ring-emerald-600'
                      : 'border-slate-200 dark:border-slate-800 hover:border-emerald-300 bg-white dark:bg-slate-900'
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

          {/* 1-Click Test Examples */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-400 mr-1">Проверить на примере:</span>
            {SAMPLE_DRAFTS.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setCheckType(s.type);
                  setConditionText(s.cond);
                  setDraftText(s.draft);
                  setError('');
                }}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/70 transition"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Inputs: Condition + Student Draft + Photo Scanner */}
        <div className="p-4 sm:p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
              1. Условие задачи или тема сочинения <span className="font-normal text-slate-400">(по желанию, но так проверка ещё точнее)</span>
            </label>
            <input
              type="text"
              value={conditionText}
              onChange={(e) => setConditionText(e.target.value)}
              placeholder="Например: «Решить уравнение 2x² - 7x + 3 = 0» или «Сочинение 13.3: Что такое настоящая дружба?»"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-800/70 text-slate-900 dark:text-white px-3.5 py-2.5 text-sm focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
                2. Текст вашего черновика / решения <span className="font-normal text-slate-400">(или прикрепите фото ниже)</span>
              </label>
              <div className="flex items-center gap-2">
                {liveWordCount > 0 && (
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      (checkType === 'essay_oge' && liveWordCount < 70) ||
                      (checkType === 'essay_ege' && liveWordCount < 150)
                        ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Слов: {liveWordCount}
                    {checkType === 'essay_oge' ? ' / мин. 70' : checkType === 'essay_ege' ? ' / мин. 150' : ''}
                  </span>
                )}
                {draftText.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTeleprompterOpen(true)}
                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-300 border border-violet-200 dark:border-violet-800 hover:bg-violet-200 transition"
                    title="Открыть телесуфлёр и тренажёр заучивания наизусть"
                  >
                    🎙️ Учить / Суфлёр
                  </button>
                )}
                <VoiceMicButton
                  onTranscript={(spoken) =>
                    setDraftText((prev) => (prev ? `${prev} ${spoken}` : spoken))
                  }
                />
              </div>
            </div>

            <textarea
              rows={5}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onPaste={handlePasteClipboard}
              placeholder="Вставьте сюда своё сочинение, упражнение или ход решения задачи (также можно вставить скриншот по Ctrl+V)..."
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-800/70 text-slate-900 dark:text-white px-4 py-3 text-sm focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none"
            />

            {/* Рентген текста: объём ОГЭ/ЕГЭ, таймер чтения вслух и детектор тавтологии */}
            {textXray && textXray.wordCount >= 8 && (
              <div className="mt-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5">
                    <SearchCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Рентген текста (сочинения и устные ответы):
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-200">
                      Слов: <b>{textXray.wordCount}</b> · Предложений: <b>{textXray.sentences}</b>
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 font-semibold text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Вслух: ~{textXray.readTime}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md font-bold ${
                        textXray.wordCount >= 70
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                          : 'bg-slate-200/70 dark:bg-slate-800 text-slate-500'
                      }`}
                    >
                      ОГЭ ≥70 {textXray.wordCount >= 70 ? '✓' : `(${70 - textXray.wordCount} ост.)`}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md font-bold ${
                        textXray.wordCount >= 150
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                          : 'bg-slate-200/70 dark:bg-slate-800 text-slate-500'
                      }`}
                    >
                      ЕГЭ ≥150 {textXray.wordCount >= 150 ? '✓' : `(${150 - textXray.wordCount} ост.)`}
                    </span>
                  </div>
                </div>
                {textXray.repeats.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-200/70 dark:border-slate-700/60 text-[11px]">
                    <span className="font-semibold text-amber-700 dark:text-amber-300">
                      ⚠️ Частые повторы (проверьте синонимы):
                    </span>
                    {textXray.repeats.map((r) => (
                      <span
                        key={r.word}
                        className="px-2 py-0.5 rounded-full bg-amber-100/80 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 font-semibold"
                      >
                        «{r.word}» ×{r.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <PhotoScannerBox
            imageBase64={imageBase64}
            imagesList={imagesList}
            onChangeImage={setImageBase64}
            onChangeImagesList={setImagesList}
            ocrText={ocrText}
            onChangeOcrText={setOcrText}
            purpose="check"
            onOpenDrawingPad={() => setDrawingOpen(true)}
            onInsertOcrToTask={(txt) =>
              setDraftText((prev) => (prev.trim() ? `${prev}\n${txt}` : txt))
            }
            onRemoveOcrFromTask={(snippet) =>
              setDraftText((prev) => stripSnippetFromField(prev, snippet))
            }
            compactLabel="Сфотографируйте тетрадь (до 4 снимков) или загрузите файл .docx / .pdf / .txt"
          />

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs sm:text-sm text-rose-800 dark:text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Проверка адаптирована под нормы <strong className="text-slate-800 dark:text-slate-200">{profile.grade} класса</strong>
            </span>

            <button
              type="submit"
              disabled={checking}
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-55 text-white font-extrabold text-sm shadow-lg shadow-emerald-600/20 inline-flex items-center justify-center gap-2 transition"
            >
              <CheckCircle2 className="w-4 h-4" />
              {checking ? 'Учитель проверяет работу...' : 'Проверить мою работу'}
            </button>
          </div>
        </div>
      </form>

      {/* Instant 0.01s Local Express Pre-Check Banner */}
      {expressPreview && (expressPreview.findings.length > 0 || expressPreview.volumeNote) && (
        <div className="animate-fade-up rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-600" />
              Мгновенный экспресс-сканер перед глубокой проверкой ИИ
            </span>
          </div>
          {expressPreview.volumeNote && (
            <div className="text-xs text-slate-700 dark:text-slate-200">
              <MarkdownMath content={expressPreview.volumeNote} />
            </div>
          )}
          {expressPreview.findings.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {expressPreview.findings.map((f, i) => (
                <div
                  key={i}
                  className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-200/80 dark:border-slate-700 text-xs"
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <span className="line-through text-rose-600">{f.fragment}</span>
                    <span>→</span>
                    <span className="text-emerald-700 dark:text-emerald-400">{f.fix}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{f.why}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rich Animated AI Thinking Card (Auto-scrolled into view!) */}
      {checking && (
        <div ref={thinkingRef} className="scroll-mt-20">
          <AiThinkingCard
            title="ИИ-учитель внимательно проверяет ваш черновик..."
            status={aiStatus}
            hasPhoto={Boolean(imageBase64) && !ocrText}
            modeLabel="Проверка работы"
            onOpenSettings={onOpenAiSettings}
            onCancel={handleCancelRequest}
          />
        </div>
      )}

      {/* Full Teacher Review + Follow-up Chat */}
      {result && !checking && (
        <div
          ref={resultRef}
          className="animate-fade-up bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md overflow-hidden"
        >
          <div className="no-print px-5 py-3.5 bg-emerald-50/80 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-800/70 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-extrabold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Разбор учителя сохранён в чатах ({profile.grade} класс)
              </span>
              {result.providerUsed && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-0.5 rounded-full">
                  {result.providerUsed}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  exportMarkdownToDocx({
                    title: conditionText ? `Проверка работы: ${conditionText.slice(0, 56)}` : 'Разбор и чистовик работы',
                    subtitle: `${profile.grade} класс · Проверка черновика · Домашка.ПРО`,
                    markdown: result.markdown,
                    filename: `Chistovik_${profile.grade}kl.docx`,
                  })
                }
                className="px-2.5 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-300 dark:border-blue-700 text-xs font-bold text-blue-700 dark:text-blue-300 inline-flex items-center gap-1"
                title="Скачать разбор и исправленный чистовик в формате Word (.docx)"
              >
                <FileText className="w-3.5 h-3.5" />
                Word (.docx)
              </button>
              <button
                type="button"
                onClick={() =>
                  exportNotebookSheetPng({
                    title: `Разбор работы · ${profile.grade} класс`,
                    markdown: result.markdown,
                    paperMode: checkType === 'math_step' ? 'grid' : 'lined',
                    filename: `Chistovik_${profile.grade}kl.png`,
                  })
                }
                className="px-2.5 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 text-xs font-bold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1"
                title="Сохранить чистовик как картинку тетрадного листа (.png)"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Лист (.png)
              </button>
              <button
                type="button"
                onClick={() => setTeleprompterOpen(true)}
                className="px-2.5 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-300 dark:border-indigo-700 text-xs font-bold text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1"
                title="Учить исправленный чистовик или сочинение в режиме суфлёра"
              >
                <Mic2 className="w-3.5 h-3.5" />
                Суфлёр
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-300 dark:border-slate-700 text-xs font-semibold text-emerald-900 dark:text-emerald-200 inline-flex items-center gap-1"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Скопировано' : 'Скопировать чистовик'}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"
              >
                <Printer className="w-3.5 h-3.5" />
                Печать
              </button>
            </div>
          </div>

          {result.mistakesAdded > 0 && (
            <div className="no-print px-5 py-2.5 bg-amber-50/90 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/70 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  В <b>«Копилку моих ошибок»</b> сохранено правил для закрепления: <b>+{result.mistakesAdded}</b>
                </span>
              </div>
              {onOpenMistakeBank && (
                <button
                  type="button"
                  onClick={onOpenMistakeBank}
                  className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold transition"
                >
                  Отработать ошибки →
                </button>
              )}
            </div>
          )}

          <div className="p-3.5 sm:p-7 sm:pr-14 notebook-lined">
            <MarkdownMath content={result.markdown} />

            {followupMessages.length > 0 && (
              <div className="mt-6 pt-5 border-t-2 border-dashed border-slate-300 dark:border-slate-700 space-y-4">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <MessageSquarePlus className="w-4 h-4" />
                  Вопросы учителю по проверке:
                </div>
                {followupMessages.map((m, idx) => (
                  <div
                    key={idx}
                    className={`p-3.5 sm:p-4 rounded-2xl animate-fade-up ${
                      m.role === 'user'
                        ? 'bg-emerald-600 text-white ml-auto max-w-2xl text-sm font-medium shadow-sm'
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
                  title="Учитель отвечает на вопрос по вашей работе..."
                  status={chatStatus}
                  onOpenSettings={onOpenAiSettings}
                />
              </div>
            )}
          </div>

          {/* Follow-up Chat inside DraftChecker */}
          <div className="no-print p-4 sm:p-5 bg-slate-50 dark:bg-slate-800/70 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={chatLoading}
                onClick={() => handleFollowup('explain_rules')}
                className="text-xs px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800 font-semibold inline-flex items-center gap-1.5"
              >
                <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
                Объясни подробнее правила, где я ошибся
              </button>
              <button
                type="button"
                disabled={chatLoading}
                onClick={() => handleFollowup('similar_task')}
                className="text-xs px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-medium"
              >
                Дай упражнение на закрепление этих правил
              </button>
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
                placeholder="Спросите учителя по проверке (например: «А можно ли было написать так?..»)"
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <button
                type="button"
                disabled={chatLoading || !chatInput.trim()}
                onClick={() => handleFollowup('question', chatInput)}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold inline-flex items-center gap-1.5 shrink-0"
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
        markdown={result?.markdown || draftText}
        title="Суфлёр по проверенному чистовику / сочинению"
      />
    </div>
  );
}
