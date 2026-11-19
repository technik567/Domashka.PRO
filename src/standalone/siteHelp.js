import { generateAiBrowser } from './aiClient';
import { getCurrentAccount, getManagedChild, getInheritedAiSettings, assertAiAllowed, subscribeAccounts } from './accounts';
import { isTutorModeEnabled, subscribeParentalControl } from './parentalControl';
import { cloudConfigured } from '../cloud/bridge';
import { buildSiteHelpPrompt, redactHelpInput } from './helpKnowledge';
import { callQwenSiteHelp, SITE_HELP_MODEL } from './qwenSiteHelp';

export function getHelpModel(preferred = SITE_HELP_MODEL.id) {
  if (getManagedChild()) {
    const settings = getInheritedAiSettings();
    if (settings?.provider && settings.provider !== 'builtin') return { id: '', note: 'Помощник не использует личные платные ключи родителя. Пока доступна локальная справка; бесплатный канал выбирает родитель.' };
    return { id: settings?.builtinModel || 'auto', note: 'Используется бесплатная модель, выбранная родителем. Помощник не меняет эти настройки.' };
  }
  return { id: preferred === 'gemma-3-12b' ? preferred : SITE_HELP_MODEL.id, note: '' };
}
export async function askSiteHelp({ question, history = [], page, model, signal, onStatus }) {
  assertAiAllowed();
  const identity = getCurrentAccount()?.id || 'guest'; const tutor = isTutorModeEnabled();
  const selected = getHelpModel(model); if (!selected.id) throw new Error(selected.note);
  const controller = new AbortController(); const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  function check() {
    assertAiAllowed();
    if (identity !== (getCurrentAccount()?.id || 'guest') || tutor !== isTutorModeEnabled() || getHelpModel(model).id !== selected.id) throw new DOMException('Аккаунт или ограничения изменились.', 'AbortError');
    if (controller.signal.aborted) throw new DOMException('Запрос остановлен.', 'AbortError');
  }
  const stopAccounts = subscribeAccounts(() => { try { check(); } catch { abort(); } });
  const stopPolicy = subscribeParentalControl(() => { try { check(); } catch { abort(); } });
  const clean = redactHelpInput(question).trim();
  try {
    if (!clean) throw new Error('Напишите вопрос о сайте.'); check();
    const messages = [...history.slice(-4).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: redactHelpInput(m.content) })), { role: 'user', content: clean }];
    const systemPrompt = buildSiteHelpPrompt(clean, { role: getCurrentAccount()?.role, page, cloudMode: cloudConfigured(), tutorOnly: tutor });
    const result = selected.id === SITE_HELP_MODEL.id
      ? await callQwenSiteHelp({ systemPrompt, messages, signal: controller.signal, onStatus })
      : await generateAiBrowser({ provider: 'builtin', model: selected.id, apiKey: '', systemPrompt, messages, siteHelp: true, helpPage: page,
        allowLocalFallback: false, signal: controller.signal, onStatus, fallbackMode: 'help' });
    check(); return { ...result, question: clean };
  } finally { stopAccounts(); stopPolicy(); signal?.removeEventListener('abort', abort); }
}
