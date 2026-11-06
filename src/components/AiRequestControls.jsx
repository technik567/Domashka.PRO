import React from 'react';
import { BrainCircuit, Globe2 } from 'lucide-react';
import { REASONING_LEVELS, normalizeReasoning, reasoningInfo } from '../standalone/aiModes';
import { searchAvailability } from '../standalone/webSearch';
import { getActiveAuthPayload } from '../api';

export const DEFAULT_REQUEST_MODES = Object.freeze({ reasoning: 'off', webSearch: false, searchQuery: '' });
export default function AiRequestControls({ settings, value, onChange, disabled = false, tutorOnly = false }) {
  const current = { ...DEFAULT_REQUEST_MODES, ...value };
  const level = normalizeReasoning(current.reasoning);
  const auth = getActiveAuthPayload(settings);
  const info = reasoningInfo(auth.provider, auth.model, level === 'off' ? 'medium' : level);
  const search = searchAvailability(tutorOnly);
  const button = 'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed';
  const active = 'border-indigo-500 bg-indigo-600 text-white shadow-sm';
  const inactive = 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200';
  const set = (patch) => onChange({ ...current, ...patch });
  return <section data-tour="ai-tools" aria-label="Режимы ответа ИИ" className="space-y-2 min-w-0">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={disabled} aria-pressed={level !== 'off'} className={`${button} ${level !== 'off' ? active : inactive}`}
        onClick={() => set({ reasoning: level === 'off' ? 'medium' : 'off' })}><BrainCircuit size={15} />Рассуждение</button>
      {level !== 'off' && <label className="text-xs"><span className="sr-only">Глубина рассуждения</span><select disabled={disabled} value={level} onChange={(e) => set({ reasoning: e.target.value })} className="rounded-xl border border-indigo-300 bg-white dark:bg-slate-900 dark:text-white p-2 text-xs">
        {Object.entries(REASONING_LEVELS).map(([id,item]) => <option key={id} value={id}>{item.label}</option>)}
      </select></label>}
      <button type="button" disabled={disabled || !search.available} aria-pressed={Boolean(current.webSearch && search.available)} title={search.reason}
        className={`${button} ${current.webSearch && search.available ? active : inactive}`} onClick={() => set({ webSearch: !current.webSearch })}><Globe2 size={15} />Поиск</button>
    </div>
    {level !== 'off' && <p className="text-[11px] leading-relaxed text-indigo-800 dark:text-indigo-200">
      {info.native ? 'Запросим уровень через API модели. Ответ может быть медленнее и расходовать больше токенов; гарантий правильности нет.' : 'У этого канала нет подтверждённой настройки thinking. Уровень задаёт тщательность проверки в инструкции модели, а не скрытый бюджет рассуждения.'}
    </p>}
    {!search.available && <p className="text-[11px] text-slate-500 dark:text-slate-400">{search.reason}</p>}
    {current.webSearch && search.available && <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/70 dark:bg-sky-950/30 p-3 space-y-1.5">
      <label className="block text-xs font-bold text-sky-900 dark:text-sky-200">Поисковая фраза
        <input value={current.searchQuery} disabled={disabled} maxLength={300} onChange={(e) => set({ searchQuery: e.target.value })} placeholder="Например: официальный источник закон Ома" className="mt-1 w-full min-w-0 p-2 rounded-lg border border-sky-200 dark:border-sky-700 bg-white dark:bg-slate-900 text-base font-normal" />
      </label>
      <p className="text-[11px] text-sky-900 dark:text-sky-200">В Tavily отправится только эта фраза, без фото, истории, имени профиля и AI-ключей. Не вписывайте пароли и личные данные. Поиск начнётся вместе с отправкой задания; затем выдержки получит выбранная модель.</p>
      <p className="text-[11px] text-slate-600 dark:text-slate-400">Бесплатная квота ограничена. Нет источников или сервер не настроен — будет ошибка, а не выдуманный «результат поиска».</p>
    </div>}
  </section>;
}
