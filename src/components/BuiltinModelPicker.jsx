import React from 'react';
import { BUILTIN_MODELS } from '../standalone/modelCatalog';
import { getPublicDemo } from '../standalone/publicModelCatalog';
import { isTutorModeEnabled } from '../standalone/parentalControl';
import ModelInfoCard from './ModelInfoCard';

export default function BuiltinModelPicker({ settings, onChange, disabled = false, tutorOnly = false, onOpenSettings, tools, compact = false, pickerId = 'builtin-model-picker', selectId = 'chat-builtin-model' }) {
  if (settings?.provider !== 'builtin') return null;
  const selected = settings.builtinModel || 'auto';
  const publicDemo = getPublicDemo(selected);
  const readOnly = disabled || tutorOnly || !onChange;
  if (compact) return <div className="compact-model-controls">
    {tools}
    <details data-tour="model-picker" id={pickerId} className="compact-model-picker"><summary>Модель: {selected==='auto'?'Авто':BUILTIN_MODELS.find(m=>m.id===selected)?.name || selected}</summary>
      <div className="compact-model-popover"><label htmlFor={selectId} className="block text-xs font-semibold mb-2">Нейросеть для ответа · без ключа</label>
        <select id={selectId} value={selected} disabled={readOnly} className="study-select w-full" onChange={e=>{if(!readOnly&&!isTutorModeEnabled())onChange?.({...settings,builtinModel:e.target.value});}}>
          <optgroup label="Основные подключения">{BUILTIN_MODELS.filter(m=>!m.experimental).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
          <optgroup label="Новые · экспериментальные демо">{BUILTIN_MODELS.filter(m=>m.experimental).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
        </select><ModelInfoCard provider="builtin" model={selected}/>
        <p className="study-muted">Публичные демо имеют лимиты. Доступность не гарантирована, автоматического обхода квот нет. {readOnly?'Модель меняет родитель.':''}</p>
      </div>
    </details>
  </div>;
  return <section data-tour="model-picker" id={pickerId} aria-label="Бесплатная нейросеть для ответа" className="study-model-panel space-y-2.5 scroll-mt-20">
    <div className="flex flex-wrap justify-between items-center gap-2">
      <label htmlFor={selectId} className="text-xs sm:text-sm font-extrabold text-indigo-900 dark:text-indigo-200">Нейросеть для ответа · без ключа</label>
      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300">{BUILTIN_MODELS.length - 1} вариантов + авто · есть лимиты</span>
    </div>
    <select id={selectId} disabled={readOnly} value={selected} onChange={(event) => {
      if (!readOnly && !isTutorModeEnabled()) onChange?.({ ...settings, builtinModel: event.target.value });
    }} className="w-full min-w-0 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 p-2.5 text-xs sm:text-sm text-slate-900 dark:text-white disabled:opacity-60">
      {BUILTIN_MODELS.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
    </select>
    {tools}
    <ModelInfoCard provider="builtin" model={selected} />
    {publicDemo && <p className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-2 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
      Задание и приложенное фото отправляются на выбранное публичное демо. Не отправляйте личные данные.
      {' '}GPU-квота Hugging Face общая для демо: смена модели её не обнуляет. «Проверить соединение» в настройках тоже расходует квоту.
      {' '}Демо заранее резервирует {publicDemo.gpuReservationSeconds} с GPU: при частично потраченной квоте даже короткий запрос может не запуститься.
      {' '}Автоматического повтора, входа в сервис или платного перехода нет.
    </p>}
    {tutorOnly || !onChange ? <p className="text-xs text-emerald-800 dark:text-emerald-300">Модель меняет родитель после ввода пароля. <button type="button" onClick={onOpenSettings} className="underline font-bold">Настройки родителя</button></p>
      : <p className="text-[11px] text-slate-600 dark:text-slate-400">Выбор сохраняется и действует на следующие запросы. Только «Автовыбор» переключает шлюзы при ошибке.</p>}
    <details className="text-xs text-slate-600 dark:text-slate-300">
      <summary className="cursor-pointer font-semibold">Сравнить бесплатные варианты</summary>
      <div className="mt-2 grid sm:grid-cols-2 gap-2">{BUILTIN_MODELS.map((model) => <div key={model.id} className="min-w-0"><p className="font-bold mb-1">{model.name}</p><ModelInfoCard provider="builtin" model={model.id} showNote={false} /></div>)}</div>
    </details>
  </section>;
}
