import { assertAiAllowed, getCurrentAccount, subscribeAccounts } from './accounts';
import { cloudConfigured } from '../cloud/bridge';
import { isTutorModeEnabled, subscribeParentalControl } from './parentalControl';
import { raceFirstSuccess, linkAbortSignals, fetchAbortable, fetchWithTimeout, withAbort, abortableDelay } from './network';
import { callQwen35Gateway, callQwen25Gateway } from './legacyGateways';
import { readPublicDemoJson, readPublicDemoStream, PublicDemoError } from './publicDemos';

// Explicit OCR is distinct from sending the original photo to the selected
// Vision model. Retain the existing OCR routes, but bound every transport and
// never accept a partial Gradio response or claim immunity to network failures.
export const OCR_QWEN_TIMEOUT_MS = 60_000;

const TESSERACT_FASTLY_SCRIPT = 'https://fastly.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
const TESSERACT_FASTLY_WORKER = 'https://fastly.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js';
const TESSERACT_FASTLY_CORE = 'https://fastly.jsdelivr.net/npm/tesseract.js-core@5';
const TESSDATA_FASTLY_LANG = 'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast';

let tesseractLoadPromise = null;

function canUseServerProxy() {
  if (typeof window === 'undefined') return false;
  if (window.__STANDALONE_BUILD__ || cloudConfigured()) return false;
  const proto = window.location?.protocol || '';
  return proto === 'http:' || proto === 'https:';
}

function throwIfUserAborted(signal) {
  if (signal?.aborted) {
    const err = new Error('Сканирование фото остановлено.');
    err.name = 'AbortError';
    throw err;
  }
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось прочитать изображение. Попробуйте JPG или PNG.'));
    img.src = src;
  });
}

export function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Ошибка чтения файла с устройства'));
    reader.readAsDataURL(file);
  });
}

/** Load a bounded photo via a temporary blob URL, without retaining the full base64 original. */
export async function preparePhotoFile(file, options = {}) {
  if (!file || file.size > 18 * 1024 * 1024) throw new Error('Фото слишком большое (до 18 МБ). Уменьшите снимок или сохраните его как JPG; на телефоне лучше не использовать 48 Мп/ProRAW.');
  const url = URL.createObjectURL(file);
  try {
    return await transformImageCanvas(url, { filterMode: 'original', maxDim: 1650, ...options });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Resize, rotate, crop, and enhance a homework photo on an HTML5 Canvas.
 * filterMode:
 *   - 'original'    : clean natural photo (best for Vision LLMs)
 *   - 'desk_shadow' : gentle contrast boost & desk shadow removal without breaking pen strokes
 *   - 'remove_grid' : suppresses blue/violet squared notebook grid lines while preserving dark ink
 */
export async function transformImageCanvas(
  dataUri,
  {
    rotateDeg = 0,
    cropRect = null, // { x, y, w, h } normalized 0..1
    filterMode = 'original',
    maxDim = 1650,
    jpegQuality = 0.88,
  } = {}
) {
  const img = await loadImageElement(dataUri);

  const sx = cropRect ? Math.max(0, Math.round(cropRect.x * img.width)) : 0;
  const sy = cropRect ? Math.max(0, Math.round(cropRect.y * img.height)) : 0;
  const sw = cropRect ? Math.max(16, Math.round(cropRect.w * img.width)) : img.width;
  const sh = cropRect ? Math.max(16, Math.round(cropRect.h * img.height)) : img.height;

  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const dw = Math.max(16, Math.round(sw * scale));
  const dh = Math.max(16, Math.round(sh * scale));

  const normRot = ((rotateDeg % 360) + 360) % 360;
  const swapAxes = normRot === 90 || normRot === 270;

  const canvas = document.createElement('canvas');
  canvas.width = swapAxes ? dh : dw;
  canvas.height = swapAxes ? dw : dh;

  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: filterMode !== 'original' });
    if (!ctx) throw new Error('Браузеру не хватило памяти для фото. Уменьшите снимок или откройте сайт в Safari/Chrome.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (normRot !== 0) {
      ctx.rotate((normRot * Math.PI) / 180);
    }
    ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    if (filterMode !== 'original') {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;

      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];

        if (filterMode === 'remove_grid') {
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const isLightBlueGrid = b > r + 18 && b > 140 && lum > 122;
          const isPaleMarginLine = r > b + 32 && r > 170 && lum > 135;

          if (isLightBlueGrid || isPaleMarginLine || lum > 205) {
            d[i] = 255;
            d[i + 1] = 255;
            d[i + 2] = 255;
          } else {
            const dark = Math.max(0, Math.min(255, (lum - 52) * 1.48));
            const out = dark < 145 ? Math.max(0, dark * 0.58) : 255;
            d[i] = out;
            d[i + 1] = out;
            d[i + 2] = out;
          }
        } else if (filterMode === 'desk_shadow') {
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          let v;
          if (lum > 192) {
            v = 255;
          } else if (lum < 75) {
            v = Math.max(0, Math.round(lum * 0.55));
          } else {
            v = Math.max(0, Math.min(255, Math.round((lum - 65) * 1.95)));
          }
          d[i] = v;
          d[i + 1] = v;
          d[i + 2] = v;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    const encoded = canvas.toDataURL('image/jpeg', jpegQuality);
    if (!encoded.startsWith('data:image/')) throw new Error('Не удалось обработать фото: уменьшите снимок.');
    return encoded;
  } finally { canvas.width = canvas.height = 0; img.onload = img.onerror = null; img.src = ''; }
}

/**
 * Sanity check: extracted text must contain real Cyrillic/Latin/digit content
 * AND must NOT be an API/ZeroGPU error message disguised as output.
 */
function hasMeaningfulText(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const cleaned = raw.trim();
  if (cleaned.length < 2) return false;
  const low = cleaned.toLowerCase();
  if (
    low.startsWith('[error]') ||
    low.includes('exceeded your zerogpu') ||
    low.includes('quota exceeded') ||
    low.includes('please upload an image') ||
    low.includes('organization_restricted') ||
    low.includes('error code:')
  ) {
    return false;
  }
  return /[а-яёa-z0-9]{2,}/iu.test(cleaned) || /\d+\s*[+\-*/=^]\s*\d+/.test(cleaned);
}

function cleanVisionOutput(raw) {
  if (!raw) return '';
  let text = String(raw).trim();
  const fenced = text.match(/^```(?:markdown|latex|text|plain)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) {
    text = fenced[1].trim();
  }
  return text;
}

async function tryServerProxyOcr(imageDataUri, purpose, signal) {
  const response = await fetchWithTimeout('/api/vision-ocr', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: imageDataUri, purpose: purpose === 'check' ? 'check' : 'solve' }),
  }, 150000, signal);
  if (!response.ok) throw new Error(`Сервер OCR: HTTP ${response.status}. Повтора из браузера нет.`);
  const data = await response.json();
  if (!data?.ok || !hasMeaningfulText(data.text)) throw new Error('Сервер OCR не вернул распознанный текст. Повтора из браузера нет.');
  return { text: cleanVisionOutput(data.text), engine: data.engine || 'Серверный ИИ-сканер' };
}

async function tryQwenVision(call, image, purpose, externalSignal) {
  const prompt = purpose === 'check'
    ? 'Дословно перепиши весь рукописный и печатный текст, примеры, формулы и вычисления ученика с этого фото. НЕ ИСПРАВЛЯЙ ошибки ученика — перепиши ровно как в тетради! Выведи только распознанный текст без комментариев.'
    : 'Дословно перепиши весь текст задания, числа, уравнения и формулы с этого фото. Выведи ТОЛЬКО распознанный текст задания без решения и вступлений.';
  const { signal, cleanup } = linkAbortSignals(externalSignal, OCR_QWEN_TIMEOUT_MS);
  try {
    const result = await call('Перепиши изображение дословно, без решения и комментариев.', [{role:'user',content:prompt}], signal, image);
    const text = cleanVisionOutput(result.text);
    if (!hasMeaningfulText(text)) throw new PublicDemoError('empty');
    return { text, engine: result.used + ' · OCR' };
  } finally { cleanup(); }
}

/**
 * Tier 1B: OCR.space Neural Engine 2 (CORS: *, ~1.5s, preserves exact student mistakes)
 */
async function tryOcrSpaceNeural(dataUri, externalSignal, delayMs = 0) {
  if (delayMs > 0) {
    await abortableDelay(delayMs, externalSignal);
    throwIfUserAborted(externalSignal);
  }
  const { signal, cleanup } = linkAbortSignals(externalSignal, 9500);
  try {
    let uploadUri = dataUri;
    if (uploadUri.length > 1250000) {
      uploadUri = await transformImageCanvas(dataUri, { maxDim: 1280, jpegQuality: 0.76 });
    }
    const form = new FormData();
    form.append('apikey', 'helloworld');
    form.append('base64Image', uploadUri);
    form.append('language', 'rus');
    form.append('OCREngine', '2');
    form.append('scale', 'true');
    form.append('isTable', 'true');
    form.append('detectOrientation', 'true');

    const resp = await fetchWithTimeout('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: form, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    }, 9500, signal);
    if (!resp.ok) throw new Error(`OCR.space HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.IsErroredOnProcessing) {
      throw new Error(String(json.ErrorMessage || 'OCR processing error'));
    }
    const parsed = (json.ParsedResults || [])
      .map((r) => (r.ParsedText || '').trim())
      .filter(Boolean)
      .join('\n')
      .trim();

    if (!hasMeaningfulText(parsed)) throw new Error('Empty OCR.space result');
    return {
      text: parsed,
      engine: 'Neural Cloud OCR v2 (текст и числа)',
    };
  } finally {
    cleanup();
  }
}

async function gradioOcr(host, name, data, timeout, externalSignal) {
  const { signal, cleanup } = linkAbortSignals(externalSignal, timeout);
  const request = (url, init = {}) => fetchAbortable(url, { ...init, credentials:'omit', redirect:'error', referrerPolicy:'no-referrer' }, signal);
  try {
    const base = `${host}/gradio_api/call/${name}`;
    const session = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const submitted = await readPublicDemoJson(await request(base, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({data,session_hash:session}) }), signal);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(submitted?.event_id || '')) throw new PublicDemoError('protocol');
    const text = cleanVisionOutput(await readPublicDemoStream(await request(`${base}/${submitted.event_id}`), signal));
    if (!hasMeaningfulText(text)) throw new PublicDemoError('empty');
    return text;
  } finally { cleanup(); }
}
async function tryGlmOcrVision(image, signal) {
  return { text:await gradioOcr('https://prithivmlmods-glm-ocr-demo.hf.space', 'run_router', ['Text',image,2048,30],10000,signal), engine:'GLM-OCR (ИИ-сканер формул)' };
}
async function tryNanonetsOcrVision(image, signal) {
  return { text:await gradioOcr('https://prithivmlmods-multimodal-ocr3.hf.space', 'run_ocr',
    ['Nanonets-OCR2-3B','Перепиши весь русский и английский текст, числа и формулы с этого изображения без изменений.',image,1500,0.2,0.9,50,1.1,30],10500,signal), engine:'Nanonets-OCR2 (ИИ-зрение)' };
}

/**
 * Hard-timed non-Cloudflare loader for Tesseract.js (Fastly CDN, 7s timeout).
 */
function ensureTesseractLoaded() {
  if (typeof window !== 'undefined' && window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }
  if (tesseractLoadPromise) return tesseractLoadPromise;

  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TESSERACT_FASTLY_SCRIPT;
    script.async = true;
    script.crossOrigin = 'anonymous';

    const timer = setTimeout(() => {
      tesseractLoadPromise = null;
      try {
        script.remove();
      } catch {
        // ignore
      }
      reject(new Error('Таймаут загрузки локального модуля Tesseract'));
    }, 7500);

    script.onload = () => {
      clearTimeout(timer);
      if (window.Tesseract) {
        resolve(window.Tesseract);
      } else {
        tesseractLoadPromise = null;
        reject(new Error('Модуль Tesseract не инициализировался'));
      }
    };
    script.onerror = () => {
      clearTimeout(timer);
      tesseractLoadPromise = null;
      try {
        script.remove();
      } catch {
        // ignore
      }
      reject(new Error('Нет доступа к CDN локального распознавания'));
    };
    document.head.appendChild(script);
  });

  return tesseractLoadPromise;
}

/**
 * Tier 3: Local Browser Tesseract.js on non-Cloudflare Fastly + GitHub Fastly 4.0.0_fast (1.6 MB)
 * Enforces a strict 16-second wall-clock Promise.race timeout with worker.terminate() cleanup!
 */
async function tryLocalTesseractOcr(dataUri, onProgress, externalSignal) {
  throwIfUserAborted(externalSignal);
  const Tesseract = await ensureTesseractLoaded();
  throwIfUserAborted(externalSignal);

  const enhancedUri = await transformImageCanvas(dataUri, {
    filterMode: 'desk_shadow',
    maxDim: 1550,
    jpegQuality: 0.9,
  });
  throwIfUserAborted(externalSignal);

  let workerRef = null;
  let finished = false;
  let timeoutId = null;

  const terminate = worker => { try { Promise.resolve(worker?.terminate()).catch(() => {}); } catch { /* already closed */ } };
  const cleanupWorker = () => {
    if (timeoutId) clearTimeout(timeoutId);
    const w = workerRef; workerRef = null;
    // A broken worker shutdown must not defeat Stop or the OCR deadline.
    terminate(w);
  };

  const onUserAbort = () => {
    finished = true;
    cleanupWorker();
  };
  externalSignal?.addEventListener('abort', onUserAbort, { once: true });

  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        finished = true;
        cleanupWorker();
        reject(
          new Error(
            'Превышено время ожидания чтения фото (возможно, провайдер ограничивает загрузку словаря). Введите условие текстом или явно выберите другую модель для фото.'
          )
        );
      }, 16000);
    });

    const recognizePromise = (async () => {
      const worker = await Tesseract.createWorker('rus+eng', 1, {
        workerPath: TESSERACT_FASTLY_WORKER,
        corePath: TESSERACT_FASTLY_CORE,
        langPath: TESSDATA_FASTLY_LANG,
        workerBlobURL: true,
        errorHandler: () => {},
        logger: (m) => {
          if (typeof m.progress === 'number') {
            const pct = Math.round(m.progress * 100);
            if (m.status === 'recognizing text') {
              onProgress?.({
                stage: 'ocr_fallback',
                progress: 78 + Math.round(pct * 0.2),
                message: 'Локальный сканер читает строки…',
              });
            } else if (m.status?.includes('loading') || m.status?.includes('initializing')) {
              onProgress?.({
                stage: 'ocr_fallback',
                progress: 70 + Math.round(pct * 0.08),
                message: 'Подготовка быстрого русскоязычного словаря…',
              });
            }
          }
        },
      });
      if (finished) {
        terminate(worker);
        throw new DOMException('Сканирование завершено.', 'AbortError');
      }
      workerRef = worker;
      throwIfUserAborted(externalSignal);

      const {
        data: { text },
      } = await worker.recognize(enhancedUri);
      await cleanupWorker();

      const cleaned = (text || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n')
        .trim();

      if (!hasMeaningfulText(cleaned)) {
        throw new Error(
          'На снимке не удалось разобрать чёткие буквы или цифры. Попробуйте обрезать лишний фон кнопкой «Обрезать» или напишите краткое условие текстом.'
        );
      }
      return {
        text: cleaned,
        engine: 'Локальный OCR-сканер браузера (rus+eng)',
      };
    })();

    return await withAbort(Promise.race([recognizePromise, timeoutPromise]), externalSignal);
  } finally {
    finished = true;
    externalSignal?.removeEventListener('abort', onUserAbort);
    await cleanupWorker();
  }
}

/**
 * Master recognition pipeline used by BOTH HomeworkSolver AND DraftChecker ("Проверь мою работу").
 * Existing OCR cascade with explicit per-route deadlines and account cancellation.
 */
export async function recognizeHomeworkPhoto(imageDataUri, optsOrCallback = {}) {
  assertAiAllowed();
  const options = typeof optsOrCallback === 'function' ? { onProgress: optsOrCallback } : optsOrCallback;
  const scope = getCurrentAccount()?.id || 'guest', policy = isTutorModeEnabled();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const unsubscribe = subscribeAccounts(() => { try { assertAiAllowed(); if ((getCurrentAccount()?.id || 'guest') !== scope) abort(); } catch { abort(); } });
  const stopPolicy = subscribeParentalControl(() => { if (isTutorModeEnabled() !== policy) abort(); });
  const { signal, cleanup } = linkAbortSignals(controller.signal, 180000);
  try {
    const result = await withAbort(recognizeHomeworkPhotoInternal(imageDataUri, { ...options, signal,
      onProgress: info => { if (!signal.aborted) options.onProgress?.(info); },
    }), signal);
    throwIfUserAborted(signal); assertAiAllowed(); return result;
  } catch (error) {
    if (signal.aborted && !controller.signal.aborted) throw new Error('Истекло общее ожидание OCR (3 минуты). Повтор автоматически не выполняется.');
    throw error;
  } finally { cleanup(); unsubscribe(); stopPolicy(); options.signal?.removeEventListener('abort', abort); }
}

async function recognizeHomeworkPhotoInternal(imageDataUri, optsOrCallback = {}) {
  const onProgress =
    typeof optsOrCallback === 'function' ? optsOrCallback : optsOrCallback?.onProgress;
  const purpose =
    typeof optsOrCallback === 'object' && optsOrCallback?.purpose
      ? optsOrCallback.purpose
      : 'solve';
  const signal = typeof optsOrCallback === 'object' ? optsOrCallback?.signal : undefined;

  if (!imageDataUri) {
    throw new Error('Сначала загрузите или сфотографируйте задание');
  }
  throwIfUserAborted(signal);

  onProgress?.({
    stage: 'preprocess',
    progress: 12,
    message: 'Подготавливаем чёткий снимок тетради для ИИ-сканера...',
  });

  const preparedDataUri = await transformImageCanvas(imageDataUri, {
    filterMode: 'original',
    maxDim: 1480,
    jpegQuality: 0.86,
  });
  throwIfUserAborted(signal);

  // Only the Python distribution uses this route; a static cloud site does not.
  if (canUseServerProxy()) {
    onProgress?.({
      stage: 'vision_server',
      progress: 30,
      message:
        purpose === 'check'
          ? 'Серверное ИИ-зрение считывает почерк и вычисления ученика...'
          : 'Серверное ИИ-зрение считывает задание и формулы...',
    });
    try {
      const r0 = await tryServerProxyOcr(preparedDataUri, purpose, signal);
      onProgress?.({ stage: 'done', progress: 100, message: `Прочитано (${r0.engine})` });
      return r0;
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) throw err;
      // The server may already have sent the photo: never duplicate its work.
      throw err;
    }
  }

  // 1. Existing Qwen + OCR.space race. A winner cancels the other local waits.
  onProgress?.({
    stage: 'vision_qwen',
    progress: 42,
    message:
      purpose === 'check'
        ? 'ИИ-зрение (Qwen2.5-VL) считывает почерк и записи в тетради...'
        : 'Облачный ИИ-сканер параллельно считывает текст и формулы с фото...',
  });
  try {
    const r1 = await raceFirstSuccess([
      (childSignal) => tryQwenVision(callQwen35Gateway, preparedDataUri, purpose, childSignal),
      (childSignal) => tryQwenVision(callQwen25Gateway, preparedDataUri, purpose, childSignal),
      (childSignal) => tryOcrSpaceNeural(preparedDataUri, childSignal, purpose === 'check' ? 1400 : 0),
    ], signal);
    onProgress?.({ stage: 'done', progress: 100, message: `Прочитано (${r1.engine})` });
    return r1;
  } catch {
    throwIfUserAborted(signal);
  }

  // 2. Parallel Secondary Non-Cloudflare Gradio OCR Race (GLM-OCR /run_router + Nanonets /run_ocr)
  onProgress?.({
    stage: 'vision_glm',
    progress: 62,
    message: 'Резервный нейросетевой сканер формул читает снимок...',
  });
  try {
    const r2 = await raceFirstSuccess([
      (childSignal) => tryGlmOcrVision(preparedDataUri, childSignal),
      (childSignal) => tryNanonetsOcrVision(preparedDataUri, childSignal),
    ], signal);
    onProgress?.({ stage: 'done', progress: 100, message: `Прочитано (${r2.engine})` });
    return r2;
  } catch {
    throwIfUserAborted(signal);
  }

  // 3. Local Tesseract with a separate bounded worker wait.
  onProgress?.({
    stage: 'ocr_fallback',
    progress: 72,
    message: 'Включаем встроенное локальное чтение в браузере (быстрый словарь)...',
  });
  const r3 = await tryLocalTesseractOcr(preparedDataUri, onProgress, signal);
  onProgress?.({ stage: 'done', progress: 100, message: `Прочитано (${r3.engine})` });
  return r3;
}

/**
 * Generates realistic built-in demo images on HTML5 Canvas:
 *   - variant === 'solve' : Printed/board homework worksheet with 3 tasks (Algebra, Physics, Russian)
 *   - variant === 'check' : Student's squared notebook draft WITH intentional math & spelling errors to test DraftChecker!
 */
export function createDemoHomeworkDataUri(variant = 'solve') {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 920;
  canvas.height = 520;
  const ctx = canvas.getContext('2d');

  // Warm paper background
  ctx.fillStyle = '#fcfbf7';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Squared school grid
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.28)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 26) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Red school margin line on the right
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(canvas.width - 64, 0);
  ctx.lineTo(canvas.width - 64, canvas.height);
  ctx.stroke();

  if (variant === 'check') {
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Домашняя работа (черновик ученика)', 42, 62);

    ctx.font = '23px "Segoe UI", Arial, sans-serif';
    ctx.fillText('№ 1. Решите уравнение:  x^2 - 7x + 10 = 0', 42, 122);
    ctx.fillText('Решение:', 42, 166);
    ctx.fillText('D = (-7)^2 - 4 * 1 * 10 = 49 - 40 = 19', 42, 210);
    ctx.fillText('Ответ: корней целых нет.', 42, 254);

    ctx.fillText('№ 2. Русский язык (диктант):', 42, 330);
    ctx.fillText('Когда мы приехали на дачю шел сильный дождь.', 42, 378);
    ctx.fillText('Мы быстро зашли в деревяный дом.', 42, 424);
  } else {
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 27px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Самостоятельная работа — Вариант 1', 42, 66);

    ctx.fillStyle = '#1e293b';
    ctx.font = '23px "Segoe UI", Arial, sans-serif';
    ctx.fillText('1. Решите квадратное уравнение:  2x^2 - 7x + 3 = 0', 42, 138);
    ctx.fillText('2. Физика: Автомобиль проехал 108 км за 1,5 часа.', 42, 216);
    ctx.fillText('   Найдите среднюю скорость автомобиля в м/с (оформить Дано, СИ).', 42, 256);
    ctx.fillText('3. Русский язык: Вставьте пропущенные буквы и объясните правило:', 42, 338);
    ctx.fillText('   прик..снуться к тайне, выг..реть на солнце, ш..пот в ночи.', 42, 378);
  }

  return canvas.toDataURL('image/jpeg', 0.9);
}

export const DEMO_WORKSHEET_DATA_URI = '';
