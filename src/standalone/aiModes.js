import policy from '../../shared/ai-features.json';
export const REASONING_LEVELS = policy.reasoning;
const catalog = new Map();
export const normalizeReasoning = (value) => typeof value === 'string' && Object.hasOwn(REASONING_LEVELS, value) ? value : 'off';
export function rememberReasoningCapabilities(entries) {
  for (const entry of entries || []) if (typeof entry?.id === 'string') {
    const supported = entry.reasoning?.supported_efforts;
    catalog.set(entry.id, Array.isArray(supported) ? supported.filter((s) => Object.hasOwn(REASONING_LEVELS, s)) : []);
  }
}
export function reasoningInfo(provider, model, value = 'medium') {
  const level = normalizeReasoning(value);
  const native = provider === 'gemini' && ['auto','gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.5-pro'].includes(model || 'gemini-2.5-flash')
    || provider === 'openrouter' && catalog.get(model)?.includes(level);
  return { level, native: Boolean(native), kind: native ? 'native' : 'prompt', label: native ? 'параметр API модели' : 'инструкция о тщательности проверки' };
}
export function reasoningPrompt(value) {
  const level = normalizeReasoning(value);
  return level === 'off' ? '' : `\nПРОВЕРКА ОТВЕТА · ${REASONING_LEVELS[level].label}: ${REASONING_LEVELS[level].instruction}\n${policy.reasoningSafety}`;
}
export function geminiThinkingConfig(model, level, tutor = false) {
  if (normalizeReasoning(level) === 'off' || !reasoningInfo('gemini', model, level).native) return {};
  const budget = REASONING_LEVELS[level].budget;
  return { thinkingConfig: { thinkingBudget: budget, includeThoughts: false }, maxOutputTokens: budget + (tutor ? 1500 : 4096) };
}
