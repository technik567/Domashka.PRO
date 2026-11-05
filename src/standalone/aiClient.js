import { assertAiAllowed, subscribeAccounts } from './accounts';
import { requestOpenRouter, OPENROUTER_TIMEOUT_MS } from './openRouterStream';
import { normalizeCustomEndpoint, describeCustomNetworkError, isLoopbackHost } from './customConnection';
import { getBrowserEnvironment } from './browserEnvironment';
import { normalizePhotos, choosePhotoPlan, withOpenAiImages } from './photoPayload';
import {
  solveAlgebraJS,
  solveFractionsJS,
  solveGcdLcmJS,
  solveChemistryJS,
  convertPhysicsSiJS,
  autoVerifyMathJS,
} from './exactSolvers';
import { recognizeHomeworkPhoto } from './visionEngine';
import {
  runLocalExpressCheck,
  buildOfflineTeacherCheckMarkdown,
} from './localDraftPreCheck';
import { CHEAT_SHEETS } from '../data/referenceData';

import { BUILTIN_MODELS, DEFAULT_OPENROUTER_FREE_MODELS, DEFAULT_GEMINI_MODELS } from './modelCatalog';
import { isTutorModeEnabled, subscribeParentalControl } from './parentalControl';
import { buildTutorSystemPrompt, offlineTutorReply } from './tutorPolicy';
import { fetchWithTimeout, linkAbortSignals, abortableDelay } from './network';
export { DEFAULT_OPENROUTER_FREE_MODELS, DEFAULT_GEMINI_MODELS } from './modelCatalog';

export const SUBJECT_NAMES = {
  auto: 'Автоопределение предмета',
  math: 'Математика / Алгебра',
  geometry: 'Геометрия',
  russian: 'Русский язык',
  literature: 'Литература и сочинения',
  physics: 'Физика',
  chemistry: 'Химия',
  informatics: 'Информатика (Python / КуМир / Логика)',
  english: 'Английский язык',
  history: 'История России и Всеобщая история',
  social: 'Обществознание',
  biology: 'Биология',
  geography: 'География',
  world: 'Окружающий мир (1–4 класс)',
  project: 'Индивидуальный проект / Лабораторная работа',
};

const EXAM_GOAL_LABELS = {
  fgos: 'Школьный урок по ФГОС',
  vpr: 'Подготовка к ВПР',
  oge: 'Подготовка к ОГЭ (9 класс)',
  ege: 'Подготовка к ЕГЭ (10–11 класс)',
  olymp: 'Олимпиадный / углублённый уровень',
};

const CHECK_TYPE_PROMPTS = {
  general:
    'Универсальная проверка работы: орфография, пунктуация, грамматика, фактическая точность, вычисления и соответствие условию задания.',
  math_step:
    'Пошаговая проверка математики / физики / химии: проверь правильность записи «Дано» и перевода в СИ, рабочие формулы, знаки при раскрытии скобок и переносе слагаемых, вычисления, ОДЗ и единицы измерения.',
  essay_oge:
    'Проверка сочинения ОГЭ (задание 13.1 / 13.2 / 13.3): проверь объём (норма ≥ 70 слов), тезис, наличие 2 аргументов-примеров и вывода, абзацное членение, речевые, грамматические, орфографические и пунктуационные нормы ФИПИ.',
  essay_ege:
    'Проверка итогового или экзаменационного сочинения ЕГЭ (К1–К10 ФИПИ): проверь объём (≥ 150 слов), формулировку позиции автора, комментарий с примерами-иллюстрациями и смысловой связью, собственную позицию с обоснованием и грамотность.',
};

// Precomputed 16x16 white PNG bytes for non-Cloudflare Qwen2.5-VL text-mode fallback
const BLANK_16X16_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFUlEQVR4nGP8//8/AzWAiSTVIxx1AA5xAx/73812AAAAAElFTkSuQmCC';

let cachedOrModels = DEFAULT_OPENROUTER_FREE_MODELS;
let cachedOrTs = 0;

function canUseServerProxy() {
  if (typeof window === 'undefined') return false;
  if (window.__STANDALONE_BUILD__) return false;
  const proto = window.location?.protocol || '';
  return proto === 'http:' || proto === 'https:';
}

function throwIfUserAborted(signal) {
  if (signal?.aborted) {
    const err = new Error('Запрос остановлен.');
    err.name = 'AbortError';
    throw err;
  }
}

export async function fetchFreeModelsBrowser(force = false) {
  const now = Date.now();
  if (!force && now - cachedOrTs < 600000) {
    return { openrouter_free: cachedOrModels, gemini_free: DEFAULT_GEMINI_MODELS, catalogSource: 'cached' };
  }
  try {
    const res = await fetchWithTimeout('https://openrouter.ai/api/v1/models', {}, 6500);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.data)) throw new Error('Некорректный каталог моделей');
    const list = [DEFAULT_OPENROUTER_FREE_MODELS[0]];
    const seen = new Set(['openrouter/free']);
    for (const m of json.data) {
      const id = String(m.id || '');
      if (!id || seen.has(id) || /content-safety|guard|lyria/.test(id)) continue;
      const price = m.pricing || {};
      const free = (price.prompt != null && price.completion != null && Number(price.prompt) === 0 && Number(price.completion) === 0) ||
        (id.endsWith(':free') && Number(price.prompt || 0) === 0 && Number(price.completion || 0) === 0);
      if (!free) continue;
      const arch = m.architecture || {};
      const vision = (arch.input_modalities || []).includes('image') || String(arch.modality || '').includes('image');
      list.push({ id, name: m.name || id, description: String(m.description || '').slice(0, 350), vision, badge: vision ? 'Текст + Фото' : 'Только текст' });
      seen.add(id);
    }
    cachedOrModels = [list[0], ...list.slice(1).sort((a, b) => Number(b.vision) - Number(a.vision) || a.name.localeCompare(b.name))];
    cachedOrTs = now;
    return { openrouter_free: cachedOrModels, gemini_free: DEFAULT_GEMINI_MODELS, catalogSource: 'live' };
  } catch {
    return {
      openrouter_free: cachedOrModels, gemini_free: DEFAULT_GEMINI_MODELS, catalogSource: 'fallback',
      catalogWarning: 'Не удалось обновить каталог. Показан сохранённый список; доступность и бесплатные лимиты проверяются провайдером при запросе.',
    };
  }
}

export function buildSystemPrompt(grade, examGoal, subject, mode, mathHint = '') {
  if (mode === 'tutor') return buildTutorSystemPrompt({ grade, subject: SUBJECT_NAMES[subject] || subject });
  const subjLabel = SUBJECT_NAMES[subject] || 'Школьный предмет';
  const goalLabel = EXAM_GOAL_LABELS[examGoal] || 'Школьный урок по ФГОС';
  const g = Number(grade) || 8;

  let ageRules = '';
  if (g <= 4) {
    ageRules =
      `Ученик учится в ${g}-м классе (начальная школа РФ). ` +
      `СТРОГО ЗАПРЕЩЕНО использовать методы старших классов: системы уравнений с x и y, отрицательные числа, дискриминант, тригонометрию! ` +
      `Для текстовых задач делай «Краткую запись» и решай строго ПО ДЕЙСТВИЯМ с понятными пояснениями к каждому действию: \`1) 15 + 8 = 23 (шт.) — во второй коробке\`, и полный \`Ответ:\`. Объясняй тепло и просто!`;
  } else if (g <= 6) {
    ageRules =
      `Ученик учится в ${g}-м классе (5–6 класс ФГОС РФ). ` +
      `Используй только методы 5–6 класса: обыкновенные и десятичные дроби, пропорции, проценты, НОД/НОК, линейные уравнения с одной переменной x.`;
  } else if (g <= 9) {
    ageRules =
      `Ученик учится в ${g}-м классе (основная школа РФ, цель: ${goalLabel}). ` +
      `Строго соблюдай школьную программы РФ для этого класса и требования оформления ВПР/ОГЭ.`;
  } else {
    ageRules =
      `Ученик учится в ${g}-м классе (старшая школа РФ, цель: ${goalLabel}). ` +
      `Давай глубокий разбор с учётом критериев ФИПИ (профильный/базовый уровень, развёрнутая часть ЕГЭ, ОДЗ, строгие обоснования).`;
  }

  const formattingRules = `
ПРАВИЛА РОССИЙСКОГО ШКОЛЬНОГО ОФОРМЛЕНИЯ (ФГОС):
1. Физика и расчётные задачи по Химии: обязательно выделяй разделы \`**Дано:**\`, \`**СИ:**\` (ВНИМАНИЕ: в физике ВСЕГДА переводи несистемные единицы в основные единицы СИ: км/ч → м/с, мин и ч → с, г и т → кг, см и км → м, см² → м², кПа → Па, кДж → Дж!), \`**Найти:**\`, \`**Решение:**\` (сначала запиши общие рабочие формулы в буквенном виде, вырази искомую величину и только потом подставляй числа!) и \`**Ответ:**\`.
2. Геометрия: \`**Дано:**\`, \`**Найти:**\` / \`**Доказать:**\`, описание чертежа, \`**Решение:**\` со ссылками на теоремы и признаки, \`**Ответ:**\`.
3. Русский язык: соблюдай школьный канон разборов: (1) фонетический с транскрипцией и подсчётом букв и звуков; (2) морфемный; (3) морфологический в пунктах I, II, III; (4) синтаксический с характеристикой в скобках и схемой \`[ — = ]\`.
4. Информатика: при необходимости приводи код на **КуМир** (Робот, Чертёжник: \`алг\`, \`нач\`, \`кон\`, \`нц пока ... кц\`) и/или **Python** в стиле ОГЭ/ЕГЭ.
5. Формулы: записывай в LaTeX только через \`$...$\` и \`$$...$$\`.`;

  let modeRules = '';
  if (mode === 'notebook') {
    modeRules =
      `РЕЖИМ: «КАК В ТЕТРАДЬ (ЧИСТОВИК ФГОС)».\n` +
      `Сначала выведи \`## 📓 Запись в тетрадь\` (готовый чистовик по школьным правилам без лишней воды), затем \`## 💡 Пояснение (если спросит учитель)\` (3–5 понятных пунктов).`;
  } else if (mode === 'step_by_step') {
    modeRules =
      `РЕЖИМ: «ПОШАГОВЫЙ РАЗБОР».\n` +
      `Разбери задание шаг за шагом (\`Шаг 1\`, \`Шаг 2\`...), объясни правило и укажи \`⚠️ Частая ловушка\`. В конце дай чёткий \`**Ответ:**\`.`;
  } else if (mode === 'tutor') {
    modeRules =
      `РЕЖИМ: «УМНЫЙ РЕПЕТИТОР (БЕЗ СПОЙЛЕРОВ ОТВЕТА)».\n` +
      `НЕ ПИШИ готовый финальный ответ сразу! Помоги понять условие, напомни правило для 1-го шага и задай один дружелюбный наводящий вопрос ученику.`;
  } else {
    modeRules =
      `РЕЖИМ: «СОЧИНЕНИЕ / ТАБЛИЦА / ПРОЕКТ / ЛАБОРАТОРНАЯ».\n` +
      `Напиши живую, грамотную работу ученика ${g} класса (сочинение с абзацами и подсчётом слов, аккуратную Markdown-таблицу или вывод к лабораторной «Цель → Наблюдения → Вывод»).`;
  }

  const hintBlock = mathHint
    ? `\nСПРАВКА ОТ ТОЧНОГО МАТЕМАТИЧЕСКОГО ЯДРА (для самопроверки): ${mathHint}\n`
    : '';

  return (
    `Ты — «Домашка.ПРО», лучший в России школьный ИИ-помощник и опытный учитель (1–11 класс).\n` +
    `Предмет: ${subjLabel}.\n${ageRules}\n${formattingRules}\n${modeRules}\n${hintBlock}` +
    `Пиши на грамотном русском языке и тщательно перепроверяй вычисления.`
  );
}

export function buildCheckerPrompt(grade, examGoal, checkTypeOrSubject = 'general') {
  const goalLabel = EXAM_GOAL_LABELS[examGoal] || 'Школьный урок по ФГОС';
  const checkFocus =
    CHECK_TYPE_PROMPTS[checkTypeOrSubject] ||
    SUBJECT_NAMES[checkTypeOrSubject] ||
    CHECK_TYPE_PROMPTS.general;

  return (
    `Ты — доброжелательный, чуткий и внимательный российский школьный учитель (${grade} класс, ориентир: ${goalLabel}).\n` +
    `Фокус проверки: ${checkFocus}\n` +
    `ВАЖНО ДЛЯ ФОТОГРАФИЙ ТЕТРАДИ: если работа прочитана с фото тетради или листа, ученик часто переписывает сначала само условие/упражнение, а ниже пишет своё решение, ответ или текст диктанта. Внимательно проверь ВСЕ записи, вычисления, орфографию и пунктуацию ученика! Никогда не отвечай, что в сообщении «только задача без решения», если присутствуют записи, уравнения, вычисления или предложения ученика.\n` +
    `Проверь черновик / решение / сочинение ученика строго по следующей структуре:\n\n` +
    `## 📊 Предварительная оценка и разбор\n` +
    `- Примерная оценка по 5-балльной шкале (а для ОГЭ/ЕГЭ также примерные баллы по критериям ФИПИ) + искренняя похвала за то, что сделано верно.\n\n` +
    `## 🔍 Найденные ошибки и недочёты\n` +
    `Оформи в виде понятной Markdown-таблицы:\n` +
    `| Фрагмент ученика | Тип ошибки | Как правильно и почему (правило) |\n` +
    `|---|---|---|\n` +
    `Если ошибок вообще нет — обязательно напиши это и похвали ученика!\n\n` +
    `## ✨ Исправленный чистовик в тетрадь\n` +
    `Напиши аккуратный, полностью исправленный вариант работы (для ${grade} класса). Математические формулы пиши через \`$...$\` и \`$$...$$\`.`
  );
}

function normalizeLatex(text) {
  return (text || '')
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `$$${m}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => `$${m}$`);
}

function splitDataUri(dataUri) {
  if (dataUri.startsWith('data:')) {
    const [head, b64] = dataUri.split(',');
    const m = head.match(/data:([^;]+);base64/);
    return { mime: m ? m[1] : 'image/jpeg', b64 };
  }
  return { mime: 'image/jpeg', b64: dataUri };
}

function blankPngBlob() {
  const bstr = atob(BLANK_16X16_PNG_B64);
  const u8 = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i += 1) u8[i] = bstr.charCodeAt(i);
  return new Blob([u8], { type: 'image/png' });
}

async function callServerProxyAi({
  provider, apiKey, model, systemPrompt, messages, images = [], ocrText, purpose,
  photoMode = 'auto', customVision = false, tutorOnly = false, tutorGrade = 8, tutorSubject = 'auto', signal,
}) {
  const res = await fetchWithTimeout('/api/ai-generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider, apiKey: provider === 'custom' ? '' : apiKey || '', model: model || '', systemPrompt, messages,
      images, imageBase64: images[0] || null, ocrText: ocrText || '', purpose: purpose || 'solve', photoMode,
      tutorOnly, tutorGrade, tutorSubject,
      supportsVision: getPhotoCapability({ provider, model, customVision }).maxImages > 0,
    }),
  }, provider === 'custom' ? 135000 : provider === 'openrouter' ? OPENROUTER_TIMEOUT_MS + 15000 : 30000, signal);
  let data;
  try { data = await res.json(); } catch { throw new Error('Python API недоступен по этому адресу. Статический хостинг/GitHub Pages не запускает сервер Ollama.'); }
  if (!res.ok || !data?.ok || !String(data.text || '').trim()) throw new Error(data?.error || `Сервер ИИ: HTTP ${res.status}, пустой ответ.`);
  return { text: normalizeLatex(data.text), used: data.used || 'ИИ через Python-сервер',
    extractedPhotoText: data.extractedPhotoText || ocrText || '', visionEngineLabel: data.visionEngineLabel || '' };
}

async function callOpenRouterBrowser(apiKey, model, systemPrompt, messages, images, onStatus, signal) {
  const result = await requestOpenRouter({ apiKey, model: model || 'openrouter/free',
    messages: [{ role: 'system', content: systemPrompt }, ...withOpenAiImages(messages, images || [])],
    tutor: systemPrompt.includes('ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА РЕПЕТИТОРА'), signal, onStatus });
  return { ...result, text: normalizeLatex(result.text) };
}

async function callGeminiBrowser(apiKey, model, systemPrompt, messages, imageB64, onStatus, signal) {
  const contents = messages.map((m, idx) => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts = [];
    if (m.content) parts.push({ text: m.content });
    if (imageB64?.length && idx === messages.map((m) => m.role).lastIndexOf('user')) {
      if (!parts.length) parts.push({ text: 'Рассмотри изображения и помоги с заданием.' });
      for (const image of imageB64) {
        const { mime, b64 } = splitDataUri(image);
        parts.push({ inline_data: { mime_type: mime, data: b64 } });
      }
    }
    return { role, parts };
  });

  const candidates = model === 'auto'
    ? ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
    : [model || 'gemini-2.5-flash'];

  let lastErr = '';
  for (const cand of candidates) {
    throwIfUserAborted(signal);
    try {
      onStatus?.({ stage: 'cloud', message: `Google Gemini (${cand}) анализирует задание...` });
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${cand}:generateContent?key=${encodeURIComponent(
        apiKey.trim()
      )}`;
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: { temperature: 0.35, maxOutputTokens: systemPrompt.includes('ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА РЕПЕТИТОРА') ? 1500 : 4096 },
          }),
        },
        22000,
        signal
      );
      if (res.ok) {
        const data = await res.json();
        const partsOut = data?.candidates?.[0]?.content?.parts || [];
        const txt = partsOut.map((p) => p.text || '').join('');
        if (txt.trim()) {
          return { text: normalizeLatex(txt), used: `Google Gemini (${cand})` };
        }
      } else if (res.status === 400 || res.status === 403) {
        const bodyTxt = await res.text();
        if (bodyTxt.includes('API_KEY_INVALID')) {
          throw new Error('Неверный API-ключ Google Gemini. Проверьте ключ в Настройках ИИ.');
        }
        lastErr = `HTTP ${res.status}`;
      } else {
        lastErr = `HTTP ${res.status}`;
      }
    } catch (e) {
      if (e?.name === 'AbortError' && signal?.aborted) throw e;
      if (String(e.message || '').includes('Неверный API-ключ')) throw e;
      lastErr = e.message;
    }
  }
  throw new Error(`Ошибка соединения с Google Gemini (${lastErr}). Проверьте интернет.`);
}

async function callCustomLocalBrowser(baseUrl, apiKey, model, systemPrompt, messages, images, onStatus, signal) {
  const endpoint = normalizeCustomEndpoint(baseUrl);
  const environment = getBrowserEnvironment();
  const url = new URL(endpoint);
  if (environment.protocol === 'https:' && url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new Error('HTTPS-сайт не может надёжно обращаться к HTTP API в локальной сети. Используйте HTTPS API либо режим «Через Python-сервер» на своём сайте; отключать защиту браузера не нужно.');
  }
  onStatus?.({ stage: 'cloud', message: `Подключаемся к ${model || 'Ollama'}. Первая загрузка модели может занять до двух минут…` });
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  let res;
  try {
    res = await fetchWithTimeout(endpoint, { method: 'POST', headers, body: JSON.stringify({
      model: model || 'qwen2.5:7b', stream: false,
      messages: [{ role: 'system', content: systemPrompt }, ...withOpenAiImages(messages, images)],
      temperature: 0.35, max_tokens: systemPrompt.includes('ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА РЕПЕТИТОРА') ? 900 : 4000,
    }) }, 120000, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(describeCustomNetworkError(error, baseUrl, environment));
  }
  if (!res.ok) {
    if (res.status === 404) throw new Error('Ollama/API: HTTP 404. Проверьте адрес /v1/chat/completions и точное имя установленной модели (ollama list / ollama pull).');
    if (res.status === 401 || res.status === 403) throw new Error(`Ollama/API: HTTP ${res.status}. Проверьте ключ, права и OLLAMA_ORIGINS для origin этого сайта.`);
    throw new Error(`Ollama/API: HTTP ${res.status}. ${images.length ? 'Проверьте, поддерживает ли выбранная модель изображения и OpenAI-формат image_url.' : 'Проверьте журнал сервера, доступную память и установленную модель.'}`);
  }
  let data;
  try { data = await res.json(); } catch { throw new Error('API вернул не JSON. Нужен OpenAI-совместимый endpoint /v1/chat/completions, а не страница сайта.'); }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('API ответил, но текст ответа отсутствует. Проверьте модель и OpenAI-совместимый формат сервера.');
  return { text: normalizeLatex(content), used: `Ollama / свой API (${model || 'Ollama'})` };
}

function photoBlob(dataUri) {
  const { mime, b64 } = splitDataUri(dataUri);
  const bytes = Uint8Array.from(atob(b64), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

/**
 * Gateway 0: Official Qwen3.5-Omni Cloud API on non-Cloudflare AWS (~4-7s, unlimited, zero 45s limit!)
 */
async function callQwen35OmniGateway(systemPrompt, messages, signal, imageB64 = null) {
  const { signal: linkedSignal, cleanup } = linkAbortSignals(signal, 19000);
  const spaceHost = 'https://qwen-qwen3-5-omni-offline-demo.hf.space';
  try {
    const priorHistory = messages.slice(0, -1).slice(-6).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || ''),
    }));
    const lastPrompt = String(messages[messages.length - 1]?.content || 'Помоги выполнить задание.');

    let imageDescriptor = null;
    if (imageB64) {
      const form = new FormData();
      const blob = photoBlob(imageB64);
      form.append('files', blob, blob.type === 'image/png' ? 'homework.png' : 'homework.jpg');
      const upload = await fetch(`${spaceHost}/gradio_api/upload`, { method: 'POST', body: form, signal: linkedSignal });
      if (!upload.ok) throw new Error(`Qwen3.5 upload HTTP ${upload.status}`);
      const paths = await upload.json();
      if (!paths?.[0]) throw new Error('Нет пути загруженного фото Qwen3.5');
      imageDescriptor = { path: paths[0], meta: { _type: 'gradio.FileData' } };
    }
    const callResp = await fetch(`${spaceHost}/gradio_api/call/chat_predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [lastPrompt, null, imageDescriptor, null, priorHistory, systemPrompt || '', 0.35, 0.85, 20],
      }),
      signal: linkedSignal,
    });
    if (!callResp.ok) throw new Error(`Qwen3.5 HTTP ${callResp.status}`);
    const { event_id: eventId } = await callResp.json();
    if (!eventId) throw new Error('Missing Qwen3.5 event_id');

    const sseResp = await fetch(`${spaceHost}/gradio_api/call/chat_predict/${eventId}`, {
      signal: linkedSignal,
    });
    if (!sseResp.ok) throw new Error(`Qwen3.5 SSE HTTP ${sseResp.status}`);
    const lines = (await sseResp.text()).split('\n');
    let out = '';
    for (let i = 0; i < lines.length; i += 1) {
      const ln = lines[i].trim();
      if (ln === 'event: error') throw new Error('Qwen3.5 SSE error');
      if (ln === 'event: complete' && i + 1 < lines.length) {
        const nxt = lines[i + 1].trim();
        if (nxt.startsWith('data:')) {
          const arr = JSON.parse(nxt.slice(5).trim());
          const hist = Array.isArray(arr) ? arr[4] : null;
          if (Array.isArray(hist) && hist.length > 0) {
            const c = hist[hist.length - 1]?.content;
            out = Array.isArray(c)
              ? c.map((b) => (typeof b === 'string' ? b : b?.text || '')).join('\n')
              : String(c || '');
          }
          break;
        }
      }
    }
    out = out.trim();
    if (!out || out.toLowerCase().startsWith('[error]')) {
      throw new Error('Empty Qwen3.5 output');
    }
    return { text: normalizeLatex(out), used: 'Qwen 3.5 Omni (облачный шлюз)' };
  } finally {
    cleanup();
  }
}

/**
 * Gateway A: Pollinations OpenAI (10.5s strict AbortController timeout — never hangs on DPI stall!)
 */
async function callPollinationsGateway(systemPrompt, messages, signal) {
  const res = await fetchWithTimeout(
    'https://text.pollinations.ai/openai',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai',
        messages: [{ role: 'system', content: systemPrompt }, ...messages.slice(-8)],
        temperature: 0.35,
        seed: Math.floor(Math.random() * 100000),
      }),
    },
    10500,
    signal
  );
  if (!res.ok) {
    throw new Error(`Pollinations HTTP ${res.status}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  if (!content.trim()) throw new Error('Empty Pollinations content');
  return { text: normalizeLatex(content), used: 'Pollinations (облачный маршрутизатор)' };
}

/**
 * Gateway B: Non-Cloudflare AWS Qwen2.5-VL-7B-Instruct (/qwen_vl_inference, 17s strict timeout).
 * Bypasses Cloudflare 16KB throttling on Russian ISPs completely!
 */
async function callQwenAwsGateway(systemPrompt, messages, signal, imageB64 = null) {
  const { signal: linkedSignal, cleanup } = linkAbortSignals(signal, 17500);
  const spaceHost = 'https://developer0hye-qwen2-5-vl-7b-instruct.hf.space';
  try {
    const form = new FormData();
    const blob = imageB64 ? photoBlob(imageB64) : blankPngBlob();
    form.append('files', blob, blob.type === 'image/png' ? 'homework.png' : 'homework.jpg');
    const upResp = await fetch(`${spaceHost}/gradio_api/upload`, {
      method: 'POST',
      body: form,
      signal: linkedSignal,
    });
    if (!upResp.ok) throw new Error(`Qwen upload HTTP ${upResp.status}`);
    const upArr = await upResp.json();
    const remotePath = Array.isArray(upArr) ? upArr[0] : null;
    if (!remotePath) throw new Error('No Qwen upload path');

    const convo = messages
      .slice(-12)
      .map((m) => `${m.role === 'assistant' ? 'Учитель' : 'Ученик'}: ${m.content || ''}`)
      .join('\n\n');
    const combinedPrompt =
      (imageB64 ? 'Рассмотри само изображение, включая схемы и рисунки.\n\n' : 'Игнорируй пустой белый фон.\n\n') +
      `[Инструкция школьного учителя]:\n${systemPrompt}\n\n${convo}`;

    const callResp = await fetch(`${spaceHost}/gradio_api/call/qwen_vl_inference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [{ path: remotePath, meta: { _type: 'gradio.FileData' } }, combinedPrompt],
      }),
      signal: linkedSignal,
    });
    if (!callResp.ok) throw new Error(`Qwen call HTTP ${callResp.status}`);
    const { event_id: eventId } = await callResp.json();
    if (!eventId) throw new Error('Missing Qwen event_id');

    const sseResp = await fetch(`${spaceHost}/gradio_api/call/qwen_vl_inference/${eventId}`, {
      signal: linkedSignal,
    });
    if (!sseResp.ok) throw new Error(`Qwen SSE HTTP ${sseResp.status}`);
    const sseText = await sseResp.text();
    const lines = sseText.split('\n');
    let out = '';
    for (let i = 0; i < lines.length; i += 1) {
      const ln = lines[i].trim();
      if (ln === 'event: error') throw new Error('Qwen SSE error');
      if (ln === 'event: complete' && i + 1 < lines.length) {
        const nxt = lines[i + 1].trim();
        if (nxt.startsWith('data:')) {
          const parsed = JSON.parse(nxt.slice(5).trim());
          out = String(Array.isArray(parsed) ? parsed[0] || '' : parsed || '').trim();
          break;
        }
      }
    }
    if (!out || out.toLowerCase().includes('exceeded your zerogpu') || out.toLowerCase().startsWith('[error]')) {
      throw new Error('Invalid Qwen output');
    }
    return { text: normalizeLatex(out), used: 'Qwen 2.5 VL (облачный шлюз)' };
  } finally {
    cleanup();
  }
}

/**
 * Built-in Zero-Key Multi-Gateway Browser Engine:
 * Races Pollinations (10.5s timeout) and Non-Cloudflare AWS Qwen2.5 (17.5s timeout, 1.1s stagger)
 * in parallel so neither Cloudflare DPI blocks nor 45s rate limits ever freeze the student!
 */
async function callBuiltinFreeBrowser(
  systemPrompt, messages, onStatus, fallbackMode = 'solve', fallbackMeta = {}, signal,
  model = 'auto', allowLocalFallback = true, imageB64 = null
) {
  throwIfUserAborted(signal);
  const selected = model || 'auto';
  if (!BUILTIN_MODELS.some((m) => m.id === selected)) throw new Error('Неизвестная облачная модель. Выберите её заново в настройках.');
  const gateways = {
    'qwen-3.5': callQwen35OmniGateway,
    pollinations: callPollinationsGateway,
    'qwen-2.5-vl': callQwenAwsGateway,
  };
  onStatus?.({ stage: 'thinking', message: fallbackMode === 'tutor' ? 'Репетитор готовит одну подсказку...' : 'Выбранная нейросеть разбирает задание...' });
  if (selected !== 'auto') {
    try { return await gateways[selected](systemPrompt, messages, signal, imageB64); }
    catch (error) {
      throwIfUserAborted(signal);
      throw new Error(`Модель ${BUILTIN_MODELS.find((m) => m.id === selected).name} недоступна. Попробуйте позже или выберите другую модель. (${error.message})`);
    }
  }

  const raceController = new AbortController();
  const onParentAbort = () => raceController.abort();
  signal?.addEventListener('abort', onParentAbort, { once: true });
  const delayed = async (fn, delay) => {
    await abortableDelay(delay, raceController.signal);
    return fn(systemPrompt, messages, raceController.signal, imageB64);
  };
  try {
    const tasks = [delayed(callQwen35OmniGateway, 0), delayed(callQwenAwsGateway, imageB64 ? 1200 : 2500)];
    if (!imageB64) tasks.push(delayed(callPollinationsGateway, 1200));
    return await Promise.any(tasks);
  } catch {
    throwIfUserAborted(signal);
  } finally {
    raceController.abort();
    signal?.removeEventListener('abort', onParentAbort);
  }
  if (imageB64) throw new Error('Не удалось передать фото выбранным Vision-шлюзам. Попробуйте позже, смените модель или явно выберите OCR; изображение не было подменено текстом.');
  if (!allowLocalFallback) throw new Error('Облачное соединение не установлено. Локальный ответ не считается проверкой связи.');
  if (fallbackMode === 'tutor') return offlineTutorReply(messages);
  if (fallbackMode === 'check') {
    const express = runLocalExpressCheck({
      conditionText: fallbackMeta.conditionText || '', draftText: fallbackMeta.draftText || '',
      checkType: fallbackMeta.checkType || 'general', grade: fallbackMeta.grade || 8,
    });
    return { text: buildOfflineTeacherCheckMarkdown(express, fallbackMeta), used: 'Локальный экспресс-проверщик (автономный режим)' };
  }
  const localAttempt = tryOfflineFallbackSolve(messages.at(-1)?.content || '', fallbackMeta.grade || 8, fallbackMeta.subject || 'auto');
  if (localAttempt) return { text: localAttempt, used: 'Автономная база знаний и решатель Домашка.ПРО' };
  throw new Error('Бесплатные облачные шлюзы недоступны. Проверьте сеть или выберите другого провайдера в настройках ИИ.');
}

/**
 * Semantic stemmer & matcher over exact JS solvers + all 700 built-in school cheat sheets!
 */
function tryOfflineFallbackSolve(text, grade = 8, subject = 'auto') {
  if (!text) return null;
  const offlineNote =
    `\n\n---\n> 💡 *Ответ подготовлен автономным модулем «Домашка.ПРО» (облачные шлюзы сейчас недоступны в вашей сети или открыт офлайн-просмотр). Для живого диалога с нейросетью откройте онлайн-версию сайта или подключите бесплатный ключ Google Gemini в «Настройках ИИ».*`;

  // 1. Equations with x / y
  const eqMatch = text.match(/([0-9xXyY+\-*/^()\s²³]{3,}=[0-9xXyY+\-*/^()\s²³\-]{1,})/);
  if (eqMatch && /[xXyY]/.test(eqMatch[1])) {
    const alg = solveAlgebraJS(eqMatch[1].trim(), 'solve');
    if (alg.ok) return alg.markdown + offlineNote;
  }

  // 2. Fractions arithmetic (e.g. 3/4 + 5/6)
  const fracMatch = text.match(/(\d+\s*\/\s*\d+\s*[+\-*/:]\s*\d+\s*\/\s*\d+)/);
  if (fracMatch) {
    const fr = solveFractionsJS(fracMatch[1]);
    if (fr.ok) return fr.markdown + offlineNote;
  }

  // 3. GCD / LCM (НОД / НОК)
  if (/(?:нод|нок|gcd|lcm)/i.test(text)) {
    const nums = text.match(/\d+/g);
    if (nums && nums.length >= 2) {
      const gl = solveGcdLcmJS(nums.slice(0, 4).join(', '));
      if (gl.ok) return gl.markdown + offlineNote;
    }
  }

  // 4. Chemical equation balancing / molar mass
  if (/[A-Z][a-z]?\d*\s*\+\s*[A-Z]/.test(text) && /[=→]|->/.test(text)) {
    const chem = solveChemistryJS(text);
    if (chem.ok) return chem.markdown + offlineNote;
  }

  // 5. Physics SI unit conversion
  const si = convertPhysicsSiJS(text);
  if (si.ok && si.markdown.includes('$')) {
    return si.markdown + offlineNote;
  }

  // 6. Smart Curriculum Topic Match across all 700 built-in ФГОС Cheat Sheets!
  const tokens = String(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^а-яa-z0-9]+/i)
    .filter((w) => w.length >= 3 && !['реши', 'помоги', 'объясни', 'задание', 'задача', 'правило', 'такое', 'какие', 'класс', 'тетрадь'].includes(w))
    .map((w) => (w.length >= 6 ? w.slice(0, Math.max(4, w.length - 2)) : w));

  if (tokens.length > 0 && Array.isArray(CHEAT_SHEETS)) {
    const scored = [];
    for (const cs of CHEAT_SHEETS) {
      const hayTitle = `${cs.title || ''} ${cs.tags || ''}`.toLowerCase().replace(/ё/g, 'е');
      const hayBody = `${cs.content || ''}`.toLowerCase().replace(/ё/g, 'е');
      let score = 0;
      for (const tk of tokens) {
        if (hayTitle.includes(tk)) score += 5;
        else if (hayBody.includes(tk)) score += 1.5;
      }
      if (subject && subject !== 'auto' && cs.subject === subject) score += 2.5;
      if (grade >= (cs.minGrade || 1) && grade <= (cs.maxGrade || 11)) score += 1;
      if (score >= 4.5) scored.push({ cs, score });
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored.length > 0) {
      const top = scored.slice(0, 2).map((s) => s.cs);
      const blocks = top.map(
        (c) => `### 📚 ${c.title} (${c.minGrade}–${c.maxGrade} класс)\n\n${c.content}`
      );
      return (
        `## 📓 Разбор по школьному справочнику ФГОС\n\n` +
        blocks.join('\n\n---\n\n') +
        offlineNote
      );
    }
  }

  return null;
}

export function isKnownOpenRouterVisionModel(modelId) {
  const known = cachedOrModels.find((entry) => entry.id === modelId);
  if (known) return Boolean(known.vision);
  const m = String(modelId || 'openrouter/free').toLowerCase();
  if (!m || m === 'openrouter/free') return true;
  if (m.includes('ultra-550b') || m.includes('deepseek-r1') || m.includes('deepseek-chat')) return false;
  return (
    m.includes('gemma-4') ||
    m.includes('gemma-3') ||
    m.includes('-vl') ||
    m.includes('vision') ||
    m.includes('omni') ||
    m.includes('inkling') ||
    m.includes('pixtral') ||
    m.includes('gemini') ||
    m.includes('gpt-4o') ||
    m.includes('claude-3')
  );
}

export function getPhotoCapability({ provider = 'builtin', model, customVision = false } = {}) {
  if (provider === 'gemini') return { maxImages: 4 };
  if (provider === 'openrouter') return { maxImages: isKnownOpenRouterVisionModel(model) ? 4 : 0 };
  if (provider === 'custom') return { maxImages: customVision === true ? 4 : 0 };
  return { maxImages: ['auto', 'qwen-3.5', 'qwen-2.5-vl', '', undefined].includes(model) ? 1 : 0 };
}

export async function generateAiBrowser(options) {
  assertAiAllowed();
  const locked = isTutorModeEnabled();
  const tutorOnly = locked || options.fallbackMode === 'tutor';
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener('abort', onAbort, { once: true });
  const stopAccounts = subscribeAccounts(() => { try { assertAiAllowed(); } catch { controller.abort(); } });
  const unsubscribe = subscribeParentalControl(() => {
    if (isTutorModeEnabled() !== locked) controller.abort();
  });
  try {
    const provider = options.provider || 'builtin';
    if (!['builtin', 'openrouter', 'gemini', 'custom'].includes(provider)) throw new Error('Неизвестный провайдер ИИ.');
    if (['openrouter', 'gemini'].includes(provider) && !options.apiKey?.trim()) {
      throw new Error(`Для ${provider === 'openrouter' ? 'OpenRouter' : 'Google Gemini'} нужен ваш API-ключ. Добавьте его или выберите режим «Без ключа».`);
    }
    const normalized = (options.messages || []).filter((m) => ['user', 'assistant'].includes(m.role))
      .map((m) => ({ role: m.role, content: String(m.content || '') }));
    // Keep the original task plus the three most recent exchanges, not an ever-growing transcript.
    const messages = tutorOnly && normalized.length > 7 ? [normalized[0], ...normalized.slice(-6)] : normalized;
    if (!messages.length) throw new Error('Сообщение пустое.');
    const result = await generateAiRequest({
      ...options, provider, messages, tutorOnly,
      systemPrompt: tutorOnly ? buildTutorSystemPrompt({
        grade: options.fallbackMeta?.grade,
        subject: SUBJECT_NAMES[options.fallbackMeta?.subject] || options.fallbackMeta?.subject,
      }) : options.systemPrompt,
      fallbackMode: tutorOnly ? 'tutor' : options.fallbackMode,
      signal: controller.signal,
    });
    throwIfUserAborted(controller.signal);
    options.onStatus?.({ stage: 'format', message: 'Ответ получен. Обрабатываем результат…' });
    return result;
  } finally {
    stopAccounts();
    unsubscribe();
    options.signal?.removeEventListener('abort', onAbort);
  }
}

async function generateAiRequest({
  provider, apiKey, model, customBaseUrl, customTransport = 'direct', customVision = false,
  systemPrompt, messages, imageB64, images, photoMode = 'auto', ocrText, onStatus,
  fallbackMode = 'solve', fallbackMeta = {}, tutorOnly = false, allowLocalFallback = true, signal,
}) {
  throwIfUserAborted(signal);
  const key = (apiKey || '').trim();
  const photos = normalizePhotos(images, imageB64);
  const photoInputUsed = choosePhotoPlan(photos, photoMode, getPhotoCapability({ provider, model, customVision }));
  const nativePhotos = photoInputUsed === 'vision' ? photos : [];
  let resolvedOcrText = photoInputUsed === 'vision' ? '' : String(ocrText || '').trim();
  let visionEngineLabel = '';
  const purpose = fallbackMode === 'check' ? 'check' : 'solve';
  if (provider === 'custom' && customTransport === 'server' && !canUseServerProxy()) {
    throw new Error('Режим «Через Python-сервер» работает только в серверной версии Домашка.ПРО, не в HTML Viewer, скачанном HTML или GitHub Pages. Запустите server.py и откройте его сайт; либо выберите прямое подключение к доступному API.');
  }
  if (provider === 'custom' && !['direct', 'server'].includes(customTransport)) throw new Error('Выберите способ подключения к Ollama заново.');
  if (provider === 'custom' && photos.length && photoMode === 'auto' && photoInputUsed !== 'vision') {
    throw new Error('Для Ollama без Vision фото не отправляется в облачный OCR автоматически. Выберите мультимодальную модель и включите поддержку изображений либо явно выберите режим OCR (он может передать фото сторонним сервисам).');
  }
  if (photoInputUsed === 'ocr' && !resolvedOcrText) {
    const pageTexts = [];
    for (let index = 0; index < photos.length; index += 1) {
      const rec = await recognizeHomeworkPhoto(photos[index], { purpose, signal, onProgress: (info) => onStatus?.({
        stage: 'vision', progress: Math.floor((index + Math.min(99, info?.progress || 0) / 100) / photos.length * 100), estimated: true, photoInputUsed: 'ocr', message: `OCR: фото ${index + 1} из ${photos.length}. ${info?.message || 'Модель получит распознанный текст, а не изображение.'}`,
      }) });
      if (!rec?.text?.trim()) throw new Error(`Не удалось прочитать фото ${index + 1}. Выберите режим «Само фото» с Vision-моделью или исправьте снимок.`);
      pageTexts.push(photos.length > 1 ? `[Фото ${index + 1}]:\n${rec.text}` : rec.text);
      if (rec.engine) visionEngineLabel = rec.engine;
      onStatus?.({ stage: 'vision', progress: Math.floor((index + 1) / photos.length * 100), estimated: false, photoInputUsed: 'ocr', message: `Прочитано фото: ${index + 1} из ${photos.length}.` });
    }
    resolvedOcrText = pageTexts.join('\n\n');
  }
  const workingMsgs = messages.map((message) => ({ ...message }));
  if (resolvedOcrText) {
    const index = workingMsgs.map((m) => m.role).lastIndexOf('user');
    if (index >= 0) workingMsgs[index].content += `\n\n[${purpose === 'check' ? 'Записи ученика' : 'Задание'}, распознанные с фото — OCR]:\n${resolvedOcrText}`;
  }
  if (nativePhotos.length) {
    systemPrompt += '\nРассмотри сами приложенные изображения: рисунки, графики, схемы и пространственные связи, а не только текст. Если детали неразборчивы, уточни их; не выдумывай. Соблюдай все правила выбранного учебного режима.';
    onStatus?.({ stage: 'vision', photoInputUsed: 'vision', progress: 100, estimated: false, message: `Подготовлены фото (${nativePhotos.length}) для Vision-модели, без предварительного OCR…` });
  }
  const finish = (out) => ({ ...out, extractedPhotoText: resolvedOcrText, visionEngineLabel,
    photoInputUsed, photoCount: photos.length });

  if (canUseServerProxy() && (provider !== 'custom' || customTransport === 'server')) {
    onStatus?.({ stage: 'cloud', photoInputUsed, message: provider === 'custom'
      ? 'Ollama через ваш Python-сервер. Первая загрузка модели может занять до двух минут…'
      : nativePhotos.length ? 'Передаём само фото модели через сервер…' : 'ИИ готовит ответ…' });
    try {
      const out = await callServerProxyAi({ provider, apiKey: key, model, systemPrompt, messages,
        images: nativePhotos, ocrText: resolvedOcrText, photoMode: nativePhotos.length ? 'vision' : 'ocr', purpose,
        customVision, tutorOnly, tutorGrade: fallbackMeta.grade, tutorSubject: fallbackMeta.subject, signal });
      return finish(out);
    } catch (error) {
      throwIfUserAborted(signal);
      // A selected local transport never silently switches to the phone's localhost or a cloud provider.
      if (provider === 'openrouter' || provider === 'gemini') throw error;
      if (provider === 'custom') {
        if (error?.name === 'TimeoutError') throw new Error('Истекло ожидание Python-сервера (135 секунд). Проверьте Ollama и загрузку модели на компьютере.');
        if (error instanceof TypeError || /failed to fetch|load failed|networkerror/i.test(error?.message || '')) throw new Error('Не удалось связаться с вашим Python-сервером. Проверьте, что server.py работает и страница открыта с его адреса. GitHub Pages и скачанный HTML не предоставляют этот API.');
        throw error;
      }
    }
  }
  let out;
  if (provider === 'openrouter') out = await callOpenRouterBrowser(key, model || 'openrouter/free', systemPrompt, workingMsgs, nativePhotos, onStatus, signal);
  else if (provider === 'gemini') out = await callGeminiBrowser(key, model || 'gemini-2.5-flash', systemPrompt, workingMsgs, nativePhotos, onStatus, signal);
  else if (provider === 'custom') out = await callCustomLocalBrowser(customBaseUrl, key, model, systemPrompt, workingMsgs, nativePhotos, onStatus, signal);
  else out = await callBuiltinFreeBrowser(systemPrompt, workingMsgs, onStatus, fallbackMode,
    { ...fallbackMeta, draftText: (fallbackMeta.draftText || '') + (resolvedOcrText ? `\n${resolvedOcrText}` : '') },
    signal, model || 'auto', allowLocalFallback, nativePhotos[0] || null);
  return finish(out);
}

// ==================== Interactive AI Quiz & Flashcard Generator ====================
const OFFLINE_QUIZ_BANK = {
  math: [
    {
      q: 'Чему равен дискриминант уравнения $x^2 - 5x + 6 = 0$?',
      options: ['$D = 1$', '$D = 49$', '$D = -1$', '$D = 25$'],
      correct: 0,
      explain: 'По формуле $D = b^2 - 4ac = (-5)^2 - 4 \\cdot 1 \\cdot 6 = 25 - 24 = 1$.',
    },
    {
      q: 'Представьте в виде степени произведение $a^4 \\cdot a^3$:',
      options: ['$a^{12}$', '$a^7$', '$a^1$', '$2a^7$'],
      correct: 1,
      explain: 'При умножении степеней с одинаковым основанием показатели складываются: $4 + 3 = 7$.',
    },
    {
      q: 'Сколько будет $\\frac{3}{4} + \\frac{1}{8}$?',
      options: ['$\\frac{4}{12}$', '$\\frac{7}{8}$', '$\\frac{5}{8}$', '$1$'],
      correct: 1,
      explain: 'Приводим к общему знаменателю $8$: $\\frac{6}{8} + \\frac{1}{8} = \\frac{7}{8}$.',
    },
    {
      q: 'Товар стоил 1000 руб., его цену снизили на 15%. Какова новая цена?',
      options: ['850 руб.', '985 руб.', '800 руб.', '1150 руб.'],
      correct: 0,
      explain: '15% от 1000 руб. — это $1000 \\cdot 0{,}15 = 150$ руб. Вычитаем: $1000 - 150 = 850$ руб.',
    },
    {
      q: 'Сумма смежных углов всегда равна:',
      options: ['$90^\\circ$', '$180^\\circ$', '$360^\\circ$', '$120^\\circ$'],
      correct: 1,
      explain: 'По теореме планиметрии сумма двух смежных углов равна развёрнутому углу $180^\\circ$.',
    },
  ],
  russian: [
    {
      q: 'В каком слове в корне пишется буква **А**?',
      options: ['заг..рать (под солнцем)', 'прик..снуться', 'возл..жить', 'р..стение'],
      correct: 3,
      explain: 'В корнях -РАСТ-/-РАЩ-/-РОС- перед СТ и Щ пишется А (рАстение). А в «загорать» без ударения пишется О!',
    },
    {
      q: 'Укажите слово с непроизносимой согласной **В**:',
      options: ['уча..ствовать', 'чу..ствовать', 'опас..ный', 'чудес..ный'],
      correct: 1,
      explain: 'Словарное слово «чуВствовать» пишется с буквой В, а в слове «участвовать» (участие) буквы В нет!',
    },
    {
      q: 'В каком варианте **НЕ** со словом пишется раздельно?',
      options: ['(не)настная погода', '(не)выучив правило', '(не)брежный почерк', '(не)годовать'],
      correct: 1,
      explain: 'НЕ с глаголами и деепричастиями («не выучив») пишется раздельно (кроме слов, не употребляющихся без НЕ).',
    },
    {
      q: 'Сколько Н пишется в слове: «Задача реше(..)а верно»?',
      options: ['Одна буква Н (решена)', 'Две буквы НН (решенна)', 'Зависит от контекста', 'Через дефис'],
      correct: 0,
      explain: 'В кратких страдательных причастиях («решена», «написана», «сделана») ВСЕГДА пишется одна буква Н!',
    },
    {
      q: 'Как правильно пишется подчинительный союз причины?',
      options: ['потомучто', 'потому-что', 'потому что', 'по тому что (всегда)'],
      correct: 2,
      explain: 'Составной союз причины «потому что» пишется в два слова без дефиса.',
    },
  ],
  physics: [
    {
      q: 'Переведите скорость $72\\text{ км/ч}$ в систему СИ ($\\text{м/с}$):',
      options: ['$20\\text{ м/с}$', '$25\\text{ м/с}$', '$12\\text{ м/с}$', '$259{,}2\\text{ м/с}$'],
      correct: 0,
      explain: 'Чтобы перевести км/ч в м/с, делим на $3{,}6$: $72 : 3{,}6 = 20\\text{ м/с}$.',
    },
    {
      q: 'По какой формуле вычисляется закон Ома для участка цепи?',
      options: ['$I = U \\cdot R$', '$I = \\frac{U}{R}$', '$R = I \\cdot U$', '$U = \\frac{I}{R}$'],
      correct: 1,
      explain: 'Сила тока прямо пропорциональна напряжению и обратно пропорциональна сопротивлению: $I = \\frac{U}{R}$.',
    },
    {
      q: 'Единица измерения давления в системе СИ — это:',
      options: ['Ньютон (Н)', 'Джоуль (Дж)', 'Паскаль (Па)', 'Ватт (Вт)'],
      correct: 2,
      explain: 'Давление $p = \\frac{F}{S}$ измеряется в Паскалях ($1\\text{ Па} = 1\\text{ Н/м}^2$).',
    },
    {
      q: 'Кинетическая энергия тела массы $m$, движущегося со скоростью $v$, равна:',
      options: ['$E_k = mgh$', '$E_k = \\frac{mv^2}{2}$', '$E_k = mv$', '$E_k = F \\cdot s$'],
      correct: 1,
      explain: 'Кинетическая энергия движения вычисляется по формуле $E_k = \\frac{mv^2}{2}$.',
    },
    {
      q: 'Как перевести массу $250\\text{ г}$ в систему СИ?',
      options: ['$2{,}5\\text{ кг}$', '$0{,}25\\text{ кг}$', '$0{,}025\\text{ кг}$', '$2500\\text{ кг}$'],
      correct: 1,
      explain: 'В $1\\text{ кг} = 1000\\text{ г}$, поэтому $250 : 1000 = 0{,}25\\text{ кг}$.',
    },
  ],
};

export async function generatePracticeQuizBrowser({
  grade,
  subject,
  topic,
  provider,
  apiKey,
  model,
  customBaseUrl, customTransport, customVision,
  onStatus,
  signal,
}) {
  const subjName = SUBJECT_NAMES[subject] || 'Школьная программа';
  const cleanTopic = (topic || '').trim() || subjName;

  const sysPrompt =
    `Ты — опытный российский школьный методист (${grade} класс, предмет: ${subjName}).\n` +
    `Составь ровно 5 интересных проверочных вопросов по теме «${cleanTopic}» с 4 вариантами ответа.\n` +
    `Верни СТРОГО валидный JSON-массив без какого-либо лишнего текста до или после (можно формулы в $...$):\n` +
    `[{"q":"Текст вопроса","options":["Вариант А","Вариант Б","Вариант В","Вариант Г"],"correct":0,"explain":"Короткое понятное объяснение правила"}]`;

  try {
    const res = await generateAiBrowser({
      provider,
      apiKey,
      model,
      customBaseUrl, customTransport, customVision,
      systemPrompt: sysPrompt,
      messages: [{ role: 'user', content: `Тема тренировки (${grade} класс): ${cleanTopic}. Сгенерируй JSON из 5 вопросов.` }],
      onStatus,
      signal,
    });
    const raw = res.text || '';
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length >= 2 && parsed[0].q && Array.isArray(parsed[0].options)) {
        return {
          ok: true,
          questions: parsed.map((item) => ({
            q: String(item.q || ''),
            options: (item.options || []).slice(0, 4).map(String),
            correct: Math.max(0, Math.min(3, Number(item.correct) || 0)),
            explain: String(item.explain || ''),
          })),
          used: res.used,
        };
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError' && signal?.aborted) throw err;
    // Fall back to curated offline bank below
  }

  const bank =
    subject === 'russian' || subject === 'literature'
      ? OFFLINE_QUIZ_BANK.russian
      : subject === 'physics' || subject === 'chemistry'
      ? OFFLINE_QUIZ_BANK.physics
      : OFFLINE_QUIZ_BANK.math;

  return {
    ok: true,
    questions: bank,
    used: 'Встроенный тренировочный банк ФГОС',
  };
}

// ==================== Timed Short-Answer Exam Simulator (С/Р · ВПР · ОГЭ · ЕГЭ) ====================
const OFFLINE_EXAM_VARIANTS = {
  math: [
    {
      num: 1,
      prompt: 'Найдите значение выражения: $(3{,}6 - 1{,}2) : 0{,}4$. Запишите число.',
      answers: ['6', '6,0', '6.0'],
      hint: 'Сначала выполните вычитание в скобках, затем разделите на 0,4.',
      explain: '$3{,}6 - 1{,}2 = 2{,}4$. Далее делим: $2{,}4 : 0{,}4 = 24 : 4 = 6$.',
    },
    {
      num: 2,
      prompt: 'Решите уравнение: $5x - 12 = 18$. В ответ запишите корень уравнения.',
      answers: ['6'],
      hint: 'Перенесите $-12$ в правую часть с противоположным знаком.',
      explain: '$5x = 18 + 12 \\Rightarrow 5x = 30 \\Rightarrow x = 6$.',
    },
    {
      num: 3,
      prompt: 'Футболка стоила $800$ рублей. На распродаже цену снизили на $15\\%$. Сколько рублей стала стоить футболка?',
      answers: ['680'],
      hint: 'Найдите $15\\%$ от $800$ и вычтите из начальной цены.',
      explain: '$15\\%$ от $800$ руб. равны $800 \\cdot 0{,}15 = 120$ руб. Новая цена: $800 - 120 = 680$ руб.',
    },
    {
      num: 4,
      prompt: 'Найдите больший корень квадратного уравнения $x^2 - 7x + 10 = 0$.',
      answers: ['5'],
      hint: 'Используйте дискриминант $D = b^2 - 4ac$ или теорему Виета ($x_1 + x_2 = 7, x_1 \\cdot x_2 = 10$).',
      explain: 'По теореме Виета корни уравнения равны $2$ и $5$. Больший из них равен $5$.',
    },
    {
      num: 5,
      prompt: 'В прямоугольном треугольнике катеты равны $6$ и $8$. Найдите гипотенузу по теореме Пифагора.',
      answers: ['10'],
      hint: '$c^2 = a^2 + b^2$.',
      explain: '$c = \\sqrt{6^2 + 8^2} = \\sqrt{36 + 64} = \\sqrt{100} = 10$.',
    },
  ],
  russian: [
    {
      num: 1,
      prompt: 'Вставьте пропущенную букву и запишите слово целиком в начальной форме: **прик..снуться** (к тайне).',
      answers: ['прикоснуться'],
      hint: 'Чередующийся корень -КАС-/-КОС- зависит от суффикса -А- после корня.',
      explain: 'За корнем нет суффикса -А-, поэтому пишем букву **О**: прик**о**снуться.',
    },
    {
      num: 2,
      prompt: 'Запишите слово с правильным количеством букв Н: «Задача реше(..)а абсолютно верно». (Запишите только само слово).',
      answers: ['решена'],
      hint: 'Определите часть речи: краткое страдательное причастие.',
      explain: 'В кратких страдательных причастиях (*решена, написана, прочитана*) всегда пишется **одна буква Н**.',
    },
    {
      num: 3,
      prompt: 'Исправьте ошибку в приставке и запишите слово верно: **безшумный** (мотор).',
      answers: ['бесшумный'],
      hint: 'Посмотрите на звонкость/глухость согласного [ш] после приставки.',
      explain: 'Перед глухим согласным **Ш** на конце приставки пишется буква **С**: бе**с**шумный.',
    },
    {
      num: 4,
      prompt: 'На какую букву падает ударение в слове **звонит**? Запишите ударную гласную букву.',
      answers: ['и', 'звонит'],
      hint: 'Глагол на -ИТЬ.',
      explain: 'В личных формах глагола *звонить* ударение падает на окончание: звон**и́**т (ударная гласная **И**).',
    },
    {
      num: 5,
      prompt: 'Замените словосочетание **«деревянный стол»** (связь — согласование) синонимичным со связью **управление**.',
      answers: ['стол из дерева'],
      hint: 'Главное слово остаётся тем же, а зависимое становится существительным с предлогом.',
      explain: 'Согласование «деревянный стол» переходит в управление **«стол из дерева»**.',
    },
  ],
  physics: [
    {
      num: 1,
      prompt: 'Переведите скорость $54\\text{ км/ч}$ в систему СИ ($\\text{м/с}$). В ответ запишите только число.',
      answers: ['15'],
      hint: 'Разделите значение в км/ч на $3{,}6$.',
      explain: '$54 : 3{,}6 = 15\\text{ м/с}$.',
    },
    {
      num: 2,
      prompt: 'Напряжение на участке цепи $U = 12\\text{ В}$, сопротивление $R = 4\\text{ Ом}$. Чему равна сила тока $I$ (в Амперах)?',
      answers: ['3'],
      hint: 'Закон Ома для участка цепи: $I = U / R$.',
      explain: 'По закону Ома $I = \\frac{U}{R} = \\frac{12}{4} = 3\\text{ А}$.',
    },
    {
      num: 3,
      prompt: 'Тело массой $2\\text{ кг}$ движется со скоростью $4\\text{ м/с}$. Чему равна его кинетическая энергия (в Джоулях)?',
      answers: ['16'],
      hint: '$E_k = \\frac{m v^2}{2}$.',
      explain: '$E_k = \\frac{2 \\cdot 4^2}{2} = 16\\text{ Дж}$.',
    },
    {
      num: 4,
      prompt: 'Сила $60\\text{ Н}$ действует перпендикулярно на площадь $0{,}2\\text{ м}^2$. Найдите давление в Паскалях.',
      answers: ['300'],
      hint: '$p = F / S$.',
      explain: '$p = \\frac{60}{0{,}2} = 300\\text{ Па}$.',
    },
    {
      num: 5,
      prompt: 'Переведите массу $350\\text{ г}$ в килограммы (СИ). Запишите десятичную дробь.',
      answers: ['0,35', '0.35'],
      hint: 'Разделите на $1000$.',
      explain: '$350 : 1000 = 0{,}35\\text{ кг}$.',
    },
  ],
};

export async function generateExamVariantBrowser({
  grade,
  subject,
  examType = 'vpr', // 'sr' | 'vpr' | 'oge' | 'ege'
  topic = '',
  provider,
  apiKey,
  model,
  customBaseUrl, customTransport, customVision,
  onStatus,
  signal,
}) {
  const subjName = SUBJECT_NAMES[subject] || 'Математика';
  const examTitles = {
    sr: 'Самостоятельная работа (10 минут)',
    vpr: 'Всероссийская проверочная работа — ВПР (15 минут)',
    oge: 'Тренировочный мини-вариант ОГЭ (15 минут)',
    ege: 'Тренировочный мини-вариант ЕГЭ — тестовая часть (15 минут)',
  };
  const fmtTitle = examTitles[examType] || examTitles.vpr;
  const topicNote = topic.trim() ? `Особый упор на тему: «${topic.trim()}».` : 'Разнотипные задания по ключевым темам класса.';

  const sysPrompt =
    `Ты — опытный составитель школьных контрольных и КИМ ФИПИ (${grade} класс, предмет: ${subjName}, формат: ${fmtTitle}).\n` +
    `${topicNote}\n` +
    `Составь ровно 5 разнотипных заданий с КРАТКИМ однозначным ответом (как в бланке №1 ВПР/ОГЭ/ЕГЭ: одно число, десятичная дробь или короткое слово в нижнем регистре без лишних единиц измерения).\n` +
    `Верни СТРОГО валидный JSON-массив из 5 объектов без лишнего текста:\n` +
    `[{"num":1,"prompt":"Текст задания (формулы в $...$)","answers":["правильный ответ","допустимая форма с точкой"],"hint":"Короткая подсказка без спойлера","explain":"Пошаговое решение и правило"}]`;

  try {
    const res = await generateAiBrowser({
      provider,
      apiKey,
      model,
      customBaseUrl, customTransport, customVision,
      systemPrompt: sysPrompt,
      messages: [
        {
          role: 'user',
          content: `Сгенерируй мини-вариант (${fmtTitle}) из 5 заданий для ${grade} класса по предмету «${subjName}». ${topicNote}`,
        },
      ],
      onStatus,
      signal,
    });
    const jsonMatch = (res.text || '').match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length >= 3 && parsed[0].prompt) {
        return {
          ok: true,
          tasks: parsed.slice(0, 5).map((t, idx) => ({
            num: idx + 1,
            prompt: String(t.prompt || ''),
            answers: Array.isArray(t.answers) && t.answers.length
              ? t.answers.map((a) => String(a).trim())
              : [String(t.answer || '').trim()],
            hint: String(t.hint || 'Внимательно перечитайте условие и проверьте размерность.'),
            explain: String(t.explain || ''),
          })),
          used: res.used,
        };
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError' && signal?.aborted) throw err;
  }

  const fallbackTasks =
    subject === 'russian' || subject === 'literature'
      ? OFFLINE_EXAM_VARIANTS.russian
      : subject === 'physics' || subject === 'chemistry'
      ? OFFLINE_EXAM_VARIANTS.physics
      : OFFLINE_EXAM_VARIANTS.math;

  return {
    ok: true,
    tasks: fallbackTasks,
    used: 'Встроенный эталонный банк контрольных ФГОС/ФИПИ',
  };
}

export async function generateMistakeDrillBrowser({
  mistake,
  grade,
  provider,
  apiKey,
  model,
  customBaseUrl, customTransport, customVision,
  onStatus,
  signal,
}) {
  const subj = mistake?.subject || 'russian';
  const subjName = SUBJECT_NAMES[subj] || 'Школьный предмет';
  const sysPrompt =
    `Ты — заботливый школьный репетитор (${grade || mistake?.grade || 8} класс, ${subjName}).\n` +
    `Ученик допустил ошибку во фрагменте: «${mistake?.wrong || ''}».\n` +
    `Правило для закрепления: «${mistake?.rule || ''}».\n` +
    `Составь РОВНО 3 коротких тренировочных вопроса с 4 вариантами ответа специально на это правило, чтобы ученик закрепил его навсегда!\n` +
    `Верни СТРОГО валидный JSON-массив:\n` +
    `[{"q":"Вопрос","options":["А","Б","В","Г"],"correct":0,"explain":"Короткое объяснение"}]`;

  try {
    const res = await generateAiBrowser({
      provider,
      apiKey,
      model,
      customBaseUrl, customTransport, customVision,
      systemPrompt: sysPrompt,
      messages: [
        {
          role: 'user',
          content: `Составь 3 закрепляющих вопроса по правилу: ${mistake?.rule || mistake?.wrong}.`,
        },
      ],
      onStatus,
      signal,
    });
    const jsonMatch = (res.text || '').match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length >= 2 && parsed[0].q) {
        return {
          ok: true,
          questions: parsed.slice(0, 3).map((item) => ({
            q: String(item.q || ''),
            options: (item.options || []).slice(0, 4).map(String),
            correct: Math.max(0, Math.min(3, Number(item.correct) || 0)),
            explain: String(item.explain || ''),
          })),
          used: res.used,
        };
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError' && signal?.aborted) throw err;
  }

  // Offline 3-question fallback tailored to math vs Russian
  const fallbackPool =
    subj === 'math' || subj === 'physics'
      ? OFFLINE_QUIZ_BANK.math.slice(0, 3)
      : OFFLINE_QUIZ_BANK.russian.slice(0, 3);
  return {
    ok: true,
    questions: fallbackPool,
    used: 'Автономный тренажёр работы над ошибками',
  };
}

export { autoVerifyMathJS };
