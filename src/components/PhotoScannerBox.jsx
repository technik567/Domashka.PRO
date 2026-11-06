import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ImagePlus,
  RotateCw,
  Crop,
  ScanText,
  Trash2,
  Check,
  X,
  PenTool,
  Loader2,
  FileImage,
  FileText,
  ChevronLeft,
  ChevronRight,
  Layers,
} from 'lucide-react';
import {
  createDemoHomeworkDataUri,
  preparePhotoFile,
  transformImageCanvas,
} from '../standalone/visionEngine';
import { extractTextFromHomeworkFile } from '../standalone/docImporter';
import { api } from '../api';
import { ocrProgressLabel } from '../standalone/progressModel';
import { getBrowserEnvironment, IOS_CAMERA_HELP } from '../standalone/browserEnvironment';

const MAX_PHOTOS = 4;

/**
 * Cleanly removes an inserted OCR/document snippet from a textarea string
 * while preserving any manual text the student typed before or after it.
 */
export function stripSnippetFromField(fieldValue, snippet) {
  const src = String(fieldValue || '').replace(/\r\n/g, '\n');
  const rem = String(snippet || '').replace(/\r\n/g, '\n').trim();
  if (!src || !rem) return src;

  if (src.trim() === rem) return '';

  const idx = src.indexOf(rem);
  if (idx !== -1) {
    const before = src.slice(0, idx).replace(/[ \t]+\n?$/, '');
    const after = src.slice(idx + rem.length).replace(/^\n?[ \t]*/, '');
    if (!before.trim()) return after.trim();
    if (!after.trim()) return before.trim();
    return `${before.trimEnd()}\n${after.trimStart()}`;
  }

  // Line-by-line fallback if whitespace was slightly adjusted
  const remLines = new Set(
    rem
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length >= 3)
  );
  if (remLines.size > 0) {
    const kept = src
      .split('\n')
      .filter((line) => !remLines.has(line.trim()));
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  return src;
}

function makePhotoId() {
  return `ph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function PhotoScannerBox({
  imageBase64: imageBase64Prop,
  imageDataUri,
  imagesList,
  onChangeImage,
  onChangeImagesList,
  ocrText,
  onChangeOcrText,
  onInsertOcrToTask,
  onRemoveOcrFromTask,
  onOpenDrawingPad,
  photoMode = 'auto',
  onChangePhotoMode,
  maxVisionImages = 0,
  localProvider = false,
  busy = false,
  onBusyChange,
  purpose = 'solve', // 'solve' | 'check'
  compactLabel = 'Фото задания (до 4 снимков) или файл .docx / .pdf / .txt',
}) {
  const environment = getBrowserEnvironment();
  const [cameraHelp, setCameraHelp] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const loadVersion = useRef(0);
  const primaryImage = imageBase64Prop || imageDataUri || '';

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const docInputRef = useRef(null);
  const imgContainerRef = useRef(null);
  const ocrAbortRef = useRef(null);

  const [photos, setPhotos] = useState(() =>
    primaryImage
      ? [
          {
            id: makePhotoId(),
            uri: primaryImage,
            rawUri: primaryImage,
            filterMode: 'original',
            text: ocrText || '',
            engine: '',
          },
        ]
      : []
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrMessage, setOcrMessage] = useState('');
  const [ocrError, setOcrError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [importedDoc, setImportedDoc] = useState(null); // { label, text }

  // Interactive crop state for active photo
  const [cropMode, setCropMode] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [cropBox, setCropBox] = useState({ x: 0.06, y: 0.08, w: 0.88, h: 0.84 });

  useEffect(() => () => { ocrAbortRef.current?.abort(); loadVersion.current++; }, []);
  useEffect(() => { onBusyChange?.(photoLoading || ocrLoading); }, [photoLoading, ocrLoading, onBusyChange]);
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
  const invalidatePhotoWork = () => {
    loadVersion.current++;
    ocrAbortRef.current?.abort(); ocrAbortRef.current = null;
    setPhotoLoading(false); setOcrLoading(false); setOcrMessage('');
  };

  // Parent props are authoritative for paste, history restore, and clearing a task.
  useEffect(() => {
    const incoming = imagesList?.length ? imagesList : primaryImage ? [primaryImage] : [];
    const samePhotos = incoming.length === photos.length && incoming.every((uri, index) => uri === photos[index]?.uri);
    if (!samePhotos) {
      loadVersion.current++; setPhotoLoading(false);
      ocrAbortRef.current?.abort(); ocrAbortRef.current = null;
      setOcrLoading(false); setOcrError(''); setOcrMessage(''); setCropMode(false); setActiveIdx(0);
      setPhotos(incoming.slice(0, MAX_PHOTOS).map((uri) => ({
        id: makePhotoId(), uri, rawUri: uri, filterMode: 'original', engine: '',
        text: incoming.length === 1 ? ocrText || '' : '',
      })));
    } else if (incoming.length === 1 && photos[0].text !== (ocrText || '')) {
      setPhotos((previous) => [{ ...previous[0], text: ocrText || '' }]);
    }
  }, [primaryImage, imagesList, ocrText]);

  const syncParentFromPhotos = (nextPhotos) => {
    setPhotos(nextPhotos);
    const firstUri = nextPhotos[0]?.uri || '';
    onChangeImage?.(firstUri);
    onChangeImagesList?.(nextPhotos.map((p) => p.uri));
    const combinedOcr = nextPhotos
      .map((p, i) => {
        const t = (p.text || '').trim();
        if (!t) return '';
        return nextPhotos.length > 1 ? `[Фото ${i + 1}]:\n${t}` : t;
      })
      .filter(Boolean)
      .join('\n\n');
    // Partial OCR is not a complete replacement for the attached pages.
    onChangeOcrText?.(nextPhotos.every((photo) => photo.text?.trim()) ? combinedOcr : '');
  };

  const appendPhotoFiles = async (fileList) => {
    if (photoLoading || ocrLoading || busy) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;

    // Check if any dropped/selected file is a document (.docx / .pdf / .txt)
    const docFiles = files.filter((f) => {
      const n = (f.name || '').toLowerCase();
      return (
        n.endsWith('.docx') ||
        n.endsWith('.doc') ||
        n.endsWith('.pdf') ||
        n.endsWith('.txt') ||
        n.endsWith('.md') ||
        f.type === 'application/pdf' ||
        f.type.startsWith('text/')
      );
    });
    if (docFiles.length > 0) {
      await handleImportDocumentFile(docFiles[0]);
      return;
    }

    const imageFiles = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif|heic|heif)$/i.test(f.name || ''));
    if (!imageFiles.length) return;

    const slotsLeft = MAX_PHOTOS - photos.length;
    if (slotsLeft <= 0) {
      setOcrError(`В одном задании можно прикрепить до ${MAX_PHOTOS} фото.`);
      return;
    }

    if (photoLoading || busy) return;
    const operation = ++loadVersion.current;
    setPhotoLoading(true);
    setOcrError('');
    const added = [];
    for (const file of imageFiles.slice(0, slotsLeft)) {
      try {
        const processed = await preparePhotoFile(file);
        if (operation !== loadVersion.current) return;
        added.push({
          id: makePhotoId(),
          uri: processed,
          rawUri: processed,
          filterMode: 'original',
          text: '',
          engine: '',
        });
      } catch (err) {
        if (operation !== loadVersion.current) return;
        setOcrError(err.message || 'Ошибка чтения изображения');
      }
    }
    if (operation !== loadVersion.current) return;
    setPhotoLoading(false);
    if (added.length > 0) {
      const next = [...photos, ...added];
      syncParentFromPhotos(next);
      setActiveIdx(next.length - added.length);
    }
  };

  const handleFileSelect = async (e) => {
    await appendPhotoFiles(e.target.files);
    e.target.value = '';
  };

  const handleImportDocumentFile = async (file) => {
    if (!file || photoLoading || ocrLoading || busy) return;
    const operation = ++loadVersion.current;
    setOcrError('');
    setOcrLoading(true);
    setOcrMessage(`Читаем файл «${file.name}»...`);
    try {
      const { text, sourceLabel } = await extractTextFromHomeworkFile(file, {
        onProgress: (msg) => { if (operation === loadVersion.current) setOcrMessage(msg); },
      });
      if (operation !== loadVersion.current) return;
      if (importedDoc?.text) {
        onRemoveOcrFromTask?.(importedDoc.text);
      }
      setImportedDoc({ label: sourceLabel, text });
      onInsertOcrToTask?.(text);
      setOcrMessage('');
    } catch (err) {
      if (operation !== loadVersion.current) return;
      setOcrError(err.message || 'Не удалось прочитать документ');
      setOcrMessage('');
    } finally {
      if (operation === loadVersion.current) setOcrLoading(false);
    }
  };

  const handleDocInputSelect = async (e) => {
    const file = e.target.files?.[0];
    if (file) await handleImportDocumentFile(file);
    e.target.value = '';
  };

  const handleRemoveImportedDoc = () => {
    if (importedDoc?.text) {
      onRemoveOcrFromTask?.(importedDoc.text);
    }
    setImportedDoc(null);
  };

  const safeIdx = Math.min(activeIdx, Math.max(0, photos.length - 1));
  const currentPhoto = photos[safeIdx] || null;

  const updateCurrentPhoto = (patch) => {
    if (!currentPhoto) return;
    const next = photos.map((p, idx) => (idx === safeIdx ? { ...p, ...patch } : p));
    syncParentFromPhotos(next);
  };

  const transformCurrentPhoto = async (options, filterMode = 'original', keepOriginal = false) => {
    if (!currentPhoto || busy || photoLoading || ocrLoading) return;
    const operation = ++loadVersion.current;
    setPhotoLoading(true); setOcrError('');
    try {
      const uri = await transformImageCanvas(keepOriginal ? currentPhoto.rawUri || currentPhoto.uri : currentPhoto.uri, { maxDim: 1650, ...options });
      if (operation !== loadVersion.current) return;
      if (currentPhoto.text) onRemoveOcrFromTask?.(currentPhoto.text);
      updateCurrentPhoto({ uri, rawUri: keepOriginal ? currentPhoto.rawUri : uri, filterMode, text: '', engine: '' });
      setCropMode(false);
    } catch (error) {
      if (operation === loadVersion.current) setOcrError(error.message || 'Не удалось обработать фото.');
    } finally {
      if (operation === loadVersion.current) setPhotoLoading(false);
    }
  };
  const handleRotate90 = () => transformCurrentPhoto({ rotateDeg: 90, filterMode: 'original' });
  const handleSwitchFilter = (filterMode) => transformCurrentPhoto({ filterMode }, filterMode, true);

  const movePhotoOrder = (fromIdx, delta) => {
    if (busy) return;
    invalidatePhotoWork();
    const toIdx = fromIdx + delta;
    if (toIdx < 0 || toIdx >= photos.length) return;
    const next = [...photos];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    syncParentFromPhotos(next);
    setActiveIdx(toIdx);
  };

  /**
   * Deletes one photo AND strips its recognized text from the AI prompt field!
   */
  const handleDeletePhotoAt = (idxToRemove) => {
    if (busy) return;
    invalidatePhotoWork();
    const target = photos[idxToRemove];
    if (!target) return;
    // Strip recognized text belonging to this photo (or fallback ocrText if single photo was auto-scanned)
    const snippetToStrip = target.text || (photos.length === 1 ? ocrText : '');
    if (snippetToStrip) {
      onRemoveOcrFromTask?.(snippetToStrip);
    }
    const next = photos.filter((_, idx) => idx !== idxToRemove);
    syncParentFromPhotos(next);
    setActiveIdx((prev) => Math.max(0, Math.min(prev, next.length - 1)));
    setCropMode(false);
    setOcrError('');
  };

  /**
   * Clears ALL attached photos AND removes all recognized photo texts from the AI prompt field!
   */
  const handleClearAllPhotos = () => {
    if (busy) return;
    invalidatePhotoWork();
    for (const p of photos) {
      if (p.text) onRemoveOcrFromTask?.(p.text);
    }
    if (ocrText) onRemoveOcrFromTask?.(ocrText);
    syncParentFromPhotos([]);
    setActiveIdx(0);
    setCropMode(false);
    setOcrError('');
  };

  const getPointerNorm = (e) => {
    const rect = imgContainerRef.current.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const clientY = e.touches?.[0]?.clientY ?? e.clientY;
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { x, y };
  };

  const startCropDrag = (e) => {
    if (!cropMode) return;
    e.preventDefault();
    const pt = getPointerNorm(e);
    setDragStart(pt);
    setCropBox({ x: pt.x, y: pt.y, w: 0.02, h: 0.02 });
  };

  const moveCropDrag = (e) => {
    if (!cropMode || !dragStart) return;
    e.preventDefault();
    const pt = getPointerNorm(e);
    const x = Math.min(dragStart.x, pt.x);
    const y = Math.min(dragStart.y, pt.y);
    const w = Math.max(0.05, Math.abs(pt.x - dragStart.x));
    const h = Math.max(0.05, Math.abs(pt.y - dragStart.y));
    setCropBox({ x, y, w: Math.min(1 - x, w), h: Math.min(1 - y, h) });
  };

  const endCropDrag = () => setDragStart(null);

  const confirmCrop = () => transformCurrentPhoto({ cropRect: cropBox, filterMode: 'original' });

  const handleCancelVisionOcr = () => {
    loadVersion.current++;
    ocrAbortRef.current?.abort();
    ocrAbortRef.current = null;
    setOcrLoading(false);
    setOcrMessage('');
  };

  const recognizeSingleIndex = async (idx, ctrl) => {
    const item = photos[idx];
    if (!item) return null;
    const prefix = photos.length > 1 ? `[Фото ${idx + 1}/${photos.length}] ` : '';
    const result = await api.recognizePhoto(
      item.uri,
      {
        purpose,
        signal: ctrl.signal,
        onProgress: (info) => {
          setOcrMessage(`${prefix}${ocrProgressLabel(info)}`);
        },
      },
      purpose
    );
    return result;
  };

  const handleRunVisionOcr = async (scanAll = false) => {
    if (photoMode === 'vision') { setOcrError('Выбран режим «Само фото». Для отдельного распознавания текста явно переключите способ на OCR.'); return; }
    if (!photos.length || ocrLoading || photoLoading || busy) return;
    const ctrl = new AbortController();
    ocrAbortRef.current = ctrl;
    setOcrLoading(true);
    setOcrError('');
    setOcrMessage('Подключаем ИИ-сканер рукописи и формул...');

    try {
      if (!scanAll) {
        const prevTxt = currentPhoto?.text || '';
        const result = await recognizeSingleIndex(safeIdx, ctrl);
        if (ctrl.signal.aborted || ocrAbortRef.current !== ctrl) return;
        if (result?.text) {
          if (prevTxt) onRemoveOcrFromTask?.(prevTxt);
          onInsertOcrToTask?.(result.text);
          const next = photos.map((p, i) =>
            i === safeIdx ? { ...p, text: result.text, engine: result.engine || '' } : p
          );
          syncParentFromPhotos(next);
        }
      } else {
        const updated = [...photos];
        for (let i = 0; i < updated.length; i += 1) {
          if (ctrl.signal.aborted) break;
          const prevTxt = updated[i].text || '';
          const res = await api.recognizePhoto(
            updated[i].uri,
            {
              purpose,
              signal: ctrl.signal,
              onProgress: (info) => {
                setOcrMessage(ocrProgressLabel(info, i, updated.length));
              },
            },
            purpose
          );
          if (ctrl.signal.aborted || ocrAbortRef.current !== ctrl) return;
          if (res?.text) {
            if (prevTxt) onRemoveOcrFromTask?.(prevTxt);
            onInsertOcrToTask?.(res.text);
            updated[i] = { ...updated[i], text: res.text, engine: res.engine || '' };
          }
        }
        if (ctrl.signal.aborted || ocrAbortRef.current !== ctrl) return;
        syncParentFromPhotos(updated);
      }
      setOcrMessage('');
    } catch (err) {
      if (err?.name !== 'AbortError' && !ctrl.signal.aborted) {
        setOcrError(err.message || 'Не удалось прочитать текст с фото');
      }
      setOcrMessage('');
    } finally {
      if (ocrAbortRef.current === ctrl) {
        ocrAbortRef.current = null;
        setOcrLoading(false);
      }
    }
  };

  const loadDemoPhoto = async () => {
    const demoUri = createDemoHomeworkDataUri(purpose === 'check' ? 'check' : 'solve');
    if (demoUri) {
      const processed = await transformImageCanvas(demoUri, { filterMode: 'original', maxDim: 1650 });
      const next = [
        ...photos.slice(0, MAX_PHOTOS - 1),
        {
          id: makePhotoId(),
          uri: processed,
          rawUri: demoUri,
          filterMode: 'original',
          text: '',
          engine: '',
        },
      ];
      syncParentFromPhotos(next);
      setActiveIdx(next.length - 1);
    }
  };

  const handleDropZone = async (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) {
      await appendPhotoFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDropZone}
      className={`rounded-2xl border border-dashed transition p-3 sm:p-4 space-y-3 ${
        dragOver
          ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40'
          : 'border-slate-300 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/50'
      }`}
    >
      {/* Header & upload buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-start sm:items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
          <Camera className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5 sm:mt-0" />
          <span className="leading-snug">{compactLabel}</span>
          {photos.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-[11px] font-extrabold shrink-0">
              {photos.length}/{MAX_PHOTOS}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5">
          {/* Do not invoke native capture in iOS local/embedded viewers: the host app may crash outside JS. */}
          {photos.length < MAX_PHOTOS && <>
            <button type="button" disabled={busy || photoLoading || ocrLoading} onClick={() => {
              if (environment.unsafeNativeMedia) setCameraHelp(true);
              else cameraInputRef.current?.click();
            }} className="inline-flex items-center justify-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-xl font-bold sm:hidden disabled:opacity-50" aria-label="Камера для фото задания">
              <Camera className="w-3.5 h-3.5 shrink-0" /><span>{environment.unsafeNativeMedia ? 'Как снять фото' : 'Камера'}</span>
            </button>
            {!environment.unsafeNativeMedia && <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileSelect} disabled={busy || photoLoading || ocrLoading} className="hidden" aria-label="Снять фото задания" />}
          </>}

          {/* Gallery / Multi-photo picker */}
          {photos.length < MAX_PHOTOS && (
            <label className="cursor-pointer inline-flex items-center justify-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white px-3 py-2 sm:py-1.5 rounded-xl font-bold transition shadow-sm">
              <ImagePlus className="w-3.5 h-3.5 shrink-0" />
              <span className="sm:hidden">{photos.length ? '+ Ещё фото' : 'Галерея'}</span>
              <span className="hidden sm:inline">{photos.length ? `+ Добавить фото (${photos.length}/${MAX_PHOTOS})` : 'Загрузить фото'}</span>
              <input
                ref={fileInputRef}
                disabled={busy || photoLoading || ocrLoading}
                aria-label="Выбрать готовые фото"
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
          )}

          {/* Import homework document (.docx / .pdf / .txt) */}
          <label
            className="cursor-pointer inline-flex items-center justify-center gap-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400 px-2.5 py-2 sm:py-1.5 rounded-xl font-semibold transition"
            title="Загрузить домашнее задание из файла Word (.docx), PDF или TXT из электронного дневника"
          >
            <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
            <span>Файл (.docx / .pdf)</span>
            <input
              ref={docInputRef}
              disabled={busy || photoLoading || ocrLoading}
              type="file"
              accept=".docx,.pdf,.txt,.md,.csv,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleDocInputSelect}
              className="hidden"
            />
          </label>

          {onOpenDrawingPad && (
            <button
              type="button"
              disabled={busy || photoLoading || ocrLoading}
              onClick={onOpenDrawingPad}
              className="inline-flex items-center justify-center gap-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400 px-2.5 py-2 sm:py-1.5 rounded-xl font-medium transition"
              title="Нарисовать формулу, схему или дробь от руки"
            >
              <PenTool className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span>Нарисовать</span>
            </button>
          )}

          {photos.length === 0 && (
            <button
              type="button"
              disabled={busy || photoLoading || ocrLoading}
              onClick={loadDemoPhoto}
              className="inline-flex items-center justify-center gap-1 text-xs bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-100 px-2.5 py-2 sm:py-1.5 rounded-xl font-semibold transition"
              title={
                purpose === 'check'
                  ? 'Подставить пробный снимок рукописной тетради с ошибками для теста проверки'
                  : 'Подставить пробный снимок контрольной работы для теста ИИ-сканера'
              }
            >
              <FileImage className="w-3.5 h-3.5 shrink-0" />
              <span>{purpose === 'check' ? 'Демо-тетрадь' : 'Демо-фото'}</span>
            </button>
          )}
        </div>
      </div>

      {(environment.unsafeNativeMedia || cameraHelp) && <p role="status" className="text-xs leading-relaxed rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 p-3 text-amber-900 dark:text-amber-200">{IOS_CAMERA_HELP}</p>}
      {photoLoading && <p role="status" className="text-xs text-indigo-700 dark:text-indigo-300">Уменьшаем фото для телефона…</p>}
      {onChangePhotoMode && <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 p-3 space-y-2">
        <label htmlFor={`photo-mode-${purpose}`} className="block text-xs font-bold">Как передать фото нейросети</label>
        <select id={`photo-mode-${purpose}`} value={photoMode} disabled={busy || photoLoading || ocrLoading} onChange={(event) => onChangePhotoMode(event.target.value)} className="w-full min-w-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-xs text-slate-900 dark:text-white">
          <option value="auto">Авто: изображение, если модель поддерживает</option>
          <option value="vision">Само фото (Vision), без подмены на OCR</option>
          <option value="ocr">Только распознанный текст (OCR)</option>
        </select>
        <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">{maxVisionImages > 0 ? `Выбранная модель может получить само изображение: до ${maxVisionImages} фото за запрос. Vision учитывает рисунки и схемы, но может ошибаться.` : 'Выбранная модель не настроена для изображений. Для режима «Само фото» выберите Vision-модель; OCR передаёт только текст и может потерять рисунок.'} {photoMode === 'auto' && (localProvider ? 'Для Ollama без Vision OCR нужно выбрать явно: автоматической отправки фото в стороннее облако нет.' : 'В авто при превышении лимита изображений используется OCR.')} {photoMode === 'vision' && 'При ошибке фото не заменяется распознанным текстом.'}</p>
        <p className="text-[10px] text-slate-500 dark:text-slate-400">В Vision фото передаётся выбранному провайдеру. OCR — отдельная обработка, которая может использовать сторонние облачные сервисы, даже если язык обрабатывает Ollama.</p>
      </div>}

      {/* Imported Document Badge (with 1-click removal of its extracted text!) */}
      {importedDoc && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-900 dark:text-blue-200">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="truncate font-semibold">
              Текст загружен из документа: <b>{importedDoc.label}</b>
            </span>
          </div>
          <button
            type="button"
            onClick={handleRemoveImportedDoc}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-100/90 dark:bg-rose-900/50 text-rose-700 dark:text-rose-200 font-bold hover:bg-rose-200 transition"
            title="Удалить прикреплённый документ и его текст из поля ввода"
          >
            <X className="w-3 h-3" />
            <span>Убрать</span>
          </button>
        </div>
      )}

      {/* Multi-Photo Thumbnail Strip (shown when >= 2 photos attached) */}
      {photos.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          {photos.map((ph, idx) => {
            const isSelected = idx === safeIdx;
            return (
              <div
                key={ph.id}
                className={`relative shrink-0 rounded-xl border-2 p-1 transition flex items-center gap-1.5 ${
                  isSelected
                    ? 'border-indigo-600 bg-white dark:bg-slate-900 shadow-sm'
                    : 'border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/60 opacity-85 hover:opacity-100'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveIdx(idx);
                    setCropMode(false);
                  }}
                  className="flex items-center gap-1.5 text-left"
                >
                  <img
                    src={ph.uri}
                    alt={`Фото ${idx + 1}`}
                    className="w-11 h-11 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
                  />
                  <div className="pr-1">
                    <div className="text-[11px] font-extrabold text-slate-800 dark:text-slate-200">
                      Снимок {idx + 1}
                    </div>
                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                      {ph.text ? '✓ Прочитано' : 'Готово'}
                    </div>
                  </div>
                </button>

                <div className="flex flex-col gap-0.5 pr-0.5">
                  <div className="flex items-center gap-0.5">
                    {idx > 0 && (
                      <button
                        type="button"
                        onClick={() => movePhotoOrder(idx, -1)}
                        className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                        title="Переместить раньше"
                      >
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                    )}
                    {idx < photos.length - 1 && (
                      <button
                        type="button"
                        onClick={() => movePhotoOrder(idx, 1)}
                        className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                        title="Переместить позже"
                      >
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeletePhotoAt(idx)}
                    className="p-0.5 rounded hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-500 self-end"
                    title="Удалить это фото и его распознанный текст"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Active Photo Workspace */}
      {currentPhoto && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2.5">
          {/* Image Manipulation Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleRotate90}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Повернуть
              </button>

              {!cropMode ? (
                <button
                  type="button"
                  onClick={() => setCropMode(true)}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium"
                >
                  <Crop className="w-3.5 h-3.5" />
                  Обрезать
                </button>
              ) : (
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={confirmCrop}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Готово
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropMode(false)}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Notebook Paper Enhancement Filters */}
              <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px] font-medium">
                {[
                  { id: 'original', label: 'Оригинал' },
                  { id: 'desk_shadow', label: 'Чёткость' },
                  { id: 'remove_grid', label: 'Убрать клетку' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleSwitchFilter(f.id)}
                    className={`px-2 py-0.5 rounded-md transition ${
                      currentPhoto.filterMode === f.id
                        ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-white shadow-xs font-bold'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => handleRunVisionOcr(false)}
                disabled={ocrLoading || busy || photoLoading || photoMode === 'vision'}
                className="flex-1 sm:flex-initial justify-center inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold transition shadow-sm"
                title="Прочитать рукописный или печатный текст и формулы с текущего фото"
              >
                {ocrLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ScanText className="w-3.5 h-3.5" />
                )}
                <span>
                  {ocrLoading
                    ? 'Читаем...'
                    : photos.length > 1
                    ? `Прочитать снимок ${safeIdx + 1}`
                    : 'Прочитать текст с фото'}
                </span>
              </button>

              {photos.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRunVisionOcr(true)}
                  disabled={ocrLoading || busy || photoLoading || photoMode === 'vision'}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold transition shadow-sm"
                  title="Распознать все прикреплённые фотографии подряд"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Все ({photos.length})</span>
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  photos.length > 1 ? handleDeletePhotoAt(safeIdx) : handleClearAllPhotos()
                }
                className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition"
                title={
                  photos.length > 1
                    ? `Удалить снимок ${safeIdx + 1} и его распознанный текст`
                    : 'Удалить фото и убрать его текст из поля ввода'
                }
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {cropMode && (
            <div className="text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-3 py-1.5 rounded-lg font-medium">
              Выделите пальцем или мышкой нужную задачу на фото и нажмите <b>«Готово»</b>.
            </div>
          )}

          {/* Image display + crop overlay */}
          <div
            ref={imgContainerRef}
            onMouseDown={startCropDrag}
            onMouseMove={moveCropDrag}
            onMouseUp={endCropDrag}
            onTouchStart={startCropDrag}
            onTouchMove={moveCropDrag}
            onTouchEnd={endCropDrag}
            style={cropMode ? { touchAction: 'none' } : undefined}
            className={`relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900/5 max-h-80 flex items-center justify-center select-none ${
              cropMode ? 'cursor-crosshair' : ''
            }`}
          >
            <img
              src={currentPhoto.uri}
              alt="Снимок задания"
              draggable={false}
              className="max-h-80 w-auto object-contain pointer-events-none"
            />
            {cropMode && (
              <div
                style={{
                  left: `${cropBox.x * 100}%`,
                  top: `${cropBox.y * 100}%`,
                  width: `${cropBox.w * 100}%`,
                  height: `${cropBox.h * 100}%`,
                }}
                className="absolute border-2 border-emerald-400 bg-emerald-400/15 shadow-[0_0_0_9999px_rgba(15,23,42,0.52)] pointer-events-none"
              />
            )}
          </div>

          {ocrMessage && (
            <div className="flex items-center justify-between gap-2 text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800">
              <div className="flex items-center gap-2 min-w-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="truncate">{ocrMessage}</span>
              </div>
              {ocrLoading && (
                <button
                  type="button"
                  onClick={handleCancelVisionOcr}
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-200 font-bold hover:bg-rose-200 transition"
                >
                  <X className="w-3 h-3" />
                  <span>Стоп</span>
                </button>
              )}
            </div>
          )}

          {ocrLoading && <p className="text-[10px] text-slate-500">Показываем этап распознавания. Точный процент готовности нейросеть не сообщает.</p>}
          {ocrError && (
            <div className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-800">
              {ocrError}
            </div>
          )}

          {currentPhoto.text && (
            <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 p-2.5 space-y-1">
              <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                <span>
                  ✓ Распознано со снимка {photos.length > 1 ? `№${safeIdx + 1}` : ''}{' '}
                  {currentPhoto.engine ? `(${currentPhoto.engine})` : ''}:
                </span>
                {photos.length > 1 && (
                  <button
                    type="button"
                    onClick={handleClearAllPhotos}
                    className="text-rose-600 dark:text-rose-400 hover:underline font-semibold"
                  >
                    Удалить все фото ({photos.length})
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap line-clamp-3">
                {currentPhoto.text}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
