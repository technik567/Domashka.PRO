import policy from '../../shared/ai-features.json';
export const REASONING_LEVELS = policy.reasoning;
const catalog = new Map();
export const normalizeReasoning = (value) => value === 'auto' || typeof value === 'string' && Object.hasOwn(REASONING_LEVELS, value) ? value : 'off';
export function resolveReasoning(value, task = '', hasPhoto = false) {
  const requested = normalizeReasoning(value);
  if (requested !== 'auto') return requested;
  // Bounded local routing, not a claim that task difficulty is known exactly.
  // No extra classification request or hidden spending just to choose a depth.
  if (/олимпиад|докажи|доказать|граничн|нескольк.*способ|противореч/i.test(task) || String(task).length > 1800) return 'high';
  if (hasPhoto || /реши|уравнен|задач|провер|почему|сравни|объясни/i.test(task) || String(task).length > 220) return 'medium';
  return 'low';
}
export function rememberReasoningCapabilities(entries) {
  for (const entry of entries || []) if (typeof entry?.id === 'string') {
    const supported = entry.reasoning?.supported_efforts;
    catalog.set(entry.id, Array.isArray(supported) ? supported.filter((s) => Object.hasOwn(REASONING_LEVELS, s)) : []);
  }
}
export function reasoningInfo(provider, model, value = 'medium') {
  const level = resolveReasoning(value);
  const native = provider === 'builtin' && /^qwen3-(?:8b|14b|30b-a3b|32b|235b-a22b)-demo$/.test(model || '')
    || provider === 'gemini' && ['auto','gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.5-pro'].includes(model || 'gemini-2.5-flash')
    || provider === 'openrouter' && catalog.get(model)?.includes(level);
  return { level, native: Boolean(native), kind: native ? 'native' : 'prompt', label: native ? 'параметр API модели' : 'инструкция о тщательности проверки' };
}
export function reasoningPrompt(value) {
  const level = resolveReasoning(value);
  return level === 'off' ? '' : `\nПРОВЕРКА ОТВЕТА · ${REASONING_LEVELS[level].label}: ${REASONING_LEVELS[level].instruction}\n${policy.reasoningSafety}`;
}
export function geminiThinkingConfig(model, level, tutor = false) {
  level = resolveReasoning(level);
  if (level === 'off' || !reasoningInfo('gemini', model, level).native) return {};
  const budget = REASONING_LEVELS[level].budget;
  return { thinkingConfig: { thinkingBudget: budget, includeThoughts: false }, maxOutputTokens: budget + (tutor ? 1500 : 4096) };
}
