import React from 'react';
import { BUILTIN_MODELS } from '../standalone/modelCatalog';
import { isTutorModeEnabled } from '../standalone/parentalControl';
import ModelInfoCard from './ModelInfoCard';

export default function BuiltinModelPicker({ settings, onChange, disabled = false, tutorOnly = false, onOpenSettings }) {
  if (settings?.provider !== 'builtin') return null;
  const selected = settings.builtinModel || 'auto';
  return <section id="builtin-model-picker" aria-label="Бесплатная нейросеть для ответа" className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/30 p-3 space-y-2.5 scroll-mt-20">
    <div className="flex flex-wrap justify-between items-center gap-2">
      <label htmlFor="chat-builtin-model" className="text-xs sm:text-sm font-extrabold text-indigo-900 dark:text-indigo-200">Нейросеть для ответа · без ключа</label>
      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300">Облачный шлюз</span>
    </div>
    <select id="chat-builtin-model" disabled={disabled || tutorOnly} value={selected} onChange={(event) => {
      if (!tutorOnly && !disabled && !isTutorModeEnabled()) onChange?.({ ...settings, builtinModel: event.target.value });
    }} className="w-full min-w-0 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 p-2.5 text-xs sm:text-sm text-slate-900 dark:text-white disabled:opacity-60">
      {BUILTIN_MODELS.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
    </select>
    <ModelInfoCard provider="builtin" model={selected} />
    {tutorOnly ? <p className="text-xs text-emerald-800 dark:text-emerald-300">Модель меняет родитель после ввода пароля. <button type="button" onClick={onOpenSettings} className="underline font-bold">Настройки родителя</button></p>
      : <p className="text-[11px] text-slate-600 dark:text-slate-400">Выбор сохраняется и действует на следующие запросы. Только «Автовыбор» переключает шлюзы при ошибке.</p>}
    <details className="text-xs text-slate-600 dark:text-slate-300">
      <summary className="cursor-pointer font-semibold">Сравнить бесплатные варианты</summary>
      <div className="mt-2 grid sm:grid-cols-2 gap-2">{BUILTIN_MODELS.map((model) => <div key={model.id} className="min-w-0"><p className="font-bold mb-1">{model.name}</p><ModelInfoCard provider="builtin" model={model.id} showNote={false} /></div>)}</div>
    </details>
  </section>;
}
