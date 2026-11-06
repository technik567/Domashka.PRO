import { PUBLIC_DEMOS } from './publicModelCatalog';

export const BUILTIN_MODELS = [
  { id: 'auto', name: 'Автовыбор · доступный бесплатный шлюз', description: 'Резервирование между прежними Qwen/Pollinations. Новые публичные демо выбираются вручную и не расходуют квоту в фоне.' },
  { id: 'qwen-3.5', name: 'Qwen 3.5 Omni', description: 'Разбор текста и одного изображения напрямую. При ошибке шлюз не подменяется.' },
  { id: 'pollinations', name: 'Pollinations · облачный маршрутизатор', description: 'Модель выбирает сервис Pollinations. Доступность без ключа зависит от его правил и лимитов.' },
  { id: 'qwen-2.5-vl', name: 'Qwen 2.5 VL', description: 'Текст и одно изображение напрямую; подходит для несложных задач с фото.' },
  ...PUBLIC_DEMOS,
];

export function getModelLabel(settings) {
  if (settings.provider === 'openrouter') return `OpenRouter · ${settings.openrouterModel || 'openrouter/free'}`;
  if (settings.provider === 'gemini') return `Gemini · ${settings.geminiModel || 'gemini-2.5-flash'}`;
  if (settings.provider === 'custom') return `Локально · ${settings.customModel || 'Ollama'}`;
  return BUILTIN_MODELS.find((m) => m.id === settings.builtinModel)?.name || 'Бесплатный ИИ · Автовыбор';
}

export const DEFAULT_OPENROUTER_FREE_MODELS = [
  {
    id: 'openrouter/free',
    name: 'Авто-роутер бесплатных моделей OpenRouter (Текст + Фото)',
    vision: true,
    badge: 'Рекомендуется',
  },
  {
    id: 'google/gemma-4-31b-it:free',
    name: 'Google Gemma 4 31B (free) — Текст + Фото тетради/доски',
    vision: true,
    badge: 'Фото + Русский',
  },
  {
    id: 'nvidia/nemotron-3.5-super-vl:free',
    name: 'NVIDIA Nemotron 3.5 Super VL (free) — Чтение формул и чертежей',
    vision: true,
    badge: 'Vision 1M',
  },
  {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    name: 'NVIDIA Nemotron 3 Nano Omni Reasoning (free) — Рассуждения + Фото',
    vision: true,
    badge: 'Reasoning + Фото',
  },
  {
    id: 'google/gemma-4-26b-a4b-it:free',
    name: 'Google Gemma 4 26B Fast (free) — Быстрые ответы + Фото',
    vision: true,
    badge: 'Быстрая',
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'NVIDIA Nemotron 3 Ultra 550B (free) — Сложные задачи ЕГЭ/Олимпиад',
    vision: false,
    badge: '550B Флагман',
  },
  {
    id: 'thinkingmachines/inkling:free',
    name: 'Thinking Machines Inkling (free) — Универсальная + Фото',
    vision: true,
    badge: '1M Контекст',
  },
];

export const DEFAULT_GEMINI_MODELS = [
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    vision: true,
    badge: 'Хит для фото',
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    vision: true,
    badge: 'Макс. лимит',
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    vision: true,
    badge: 'Текст + Фото',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    vision: true,
    badge: 'Профи',
  },
];
