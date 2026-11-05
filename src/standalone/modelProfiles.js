// Editorial UI profiles, NOT measured benchmarks or promises about live gateways.
const profiles = {
  'builtin:qwen-3.5': { description: 'Универсальный помощник для разбора задач, объяснений и одного фото: может рассматривать схемы и рисунки, а не только извлекать текст.', ratings: [4, 3, 4] },
  'builtin:qwen-2.5-vl': { description: 'Компактный визуальный помощник для одного снимка, формул и несложных задач. Сложные рассуждения лучше перепроверять.', ratings: [3, 4, 3] },
  'gemini:gemini-2.5-flash': { description: 'Универсальный вариант с упором на быстрые объяснения и работу с изображениями.', ratings: [4, 4, 4] },
  'gemini:gemini-2.5-flash-lite': { description: 'Облегчённый вариант для коротких вопросов и простых задач; сложные условия требуют дополнительной проверки.', ratings: [3, 5, 3] },
  'gemini:gemini-2.0-flash': { description: 'Предыдущее поколение Flash для текста и фото. Перед использованием проверьте доступность этой модели у провайдера.', ratings: [3, 4, 3] },
  'gemini:gemini-2.5-pro': { description: 'Вариант для более сложных рассуждений и разбора условий; ответ может занимать больше времени.', ratings: [5, 2, 5] },
  'openrouter:google/gemma-4-31b-it:free': { description: 'Универсальный визуальный профиль: объяснения, текстовые задания и снимки. Реальная доступность определяется каталогом OpenRouter.', ratings: [4, 3, 4] },
  'openrouter:google/gemma-4-26b-a4b-it:free': { description: 'Более лёгкий универсальный профиль для текста и изображений, с акцентом на скорость.', ratings: [3, 4, 3] },
  'openrouter:nvidia/nemotron-3.5-super-vl:free': { description: 'Визуальный профиль для разбора условий, формул и рисунков. Проверяйте мелкие детали изображения.', ratings: [4, 3, 4] },
  'openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': { description: 'Компактный мультимодальный профиль: текст, фото и пошаговые объяснения.', ratings: [3, 4, 3] },
  'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free': { description: 'Текстовый профиль для сложных рассуждений. Само изображение в этом варианте не передаётся: для фото нужен OCR либо Vision-модель.', ratings: [5, 2, 4] },
};

export const RATINGS_NOTE = 'Условная шкала 1–5 для ориентира, не результаты бенчмарка. Скорость и качество зависят от задачи, нагрузки и квот. Пустые кружки с «нет оценки» не означают слабую модель.';

export function getModelProfile(provider, model, entry = null) {
  const router = (provider === 'builtin' && ['auto', 'pollinations', '', undefined].includes(model)) ||
    (provider === 'openrouter' && (!model || model === 'openrouter/free')) || (provider === 'gemini' && model === 'auto');
  if (router) return {
    description: provider === 'builtin' && model === 'pollinations'
      ? 'Облачный маршрутизатор для текста: внутреннюю модель выбирает Pollinations. Фото сначала распознаются отдельно. Работа без ключа зависит от правил сервиса.'
      : 'Выбирает доступный вариант автоматически. Мощность, скорость и понимание меняются вместе с выбранной моделью; фиксированную оценку дать нельзя.',
    ratings: [null, null, null], variable: true,
  };
  if (profiles[`${provider}:${model}`]) return { ...profiles[`${provider}:${model}`], variable: false };
  return {
    description: provider === 'custom'
      ? 'Ваша модель Ollama / OpenAI-совместимого API. Возможности зависят от точного имени, размера, квантования и компьютера. Название само по себе не подтверждает качество или поддержку фото.'
      : (String(entry?.description || '').slice(0, 350) || 'Дополнительная модель провайдера. Поддержка фото указана по каталогу; сопоставимых оценок мощности, скорости и понимания пока нет.'),
    ratings: [null, null, null], variable: false,
  };
}
