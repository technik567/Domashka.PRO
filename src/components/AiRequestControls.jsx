import React from 'react';
import { BrainCircuit, Globe2 } from 'lucide-react';
import { REASONING_LEVELS, normalizeReasoning } from '../standalone/aiModes';
import { searchAvailability } from '../standalone/webSearch';

export const DEFAULT_REQUEST_MODES = Object.freeze({ reasoning:'auto', webSearch:'auto' });
export default function AiRequestControls({ value, onChange, disabled=false, tutorOnly=false, compact=false }) {
  const current={...DEFAULT_REQUEST_MODES,...value},level=normalizeReasoning(current.reasoning),search=searchAvailability(tutorOnly);
  const internet=(current.webSearch===true||current.webSearch==='auto')&&search.available;
  // Legacy searchQuery is deliberately not carried forward. Local rules use
  // the ordinary task; users never need a second search field.
  const set=patch=>onChange({reasoning:level,webSearch:internet?'auto':false,...patch});
  return <section data-tour="ai-tools" aria-label="Режимы ответа ИИ" className="request-controls">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={disabled} aria-pressed={level!=='off'} className={`study-chip ${level!=='off'?'active':''}`} onClick={()=>set({reasoning:level==='off'?'auto':'off'})}><BrainCircuit size={15}/>{compact?'Подумать':'Рассуждение'}</button>
      {!compact&&level!=='off'&&<label><span className="sr-only">Глубина рассуждения</span><select aria-label="Глубина рассуждения" disabled={disabled} value={level} onChange={e=>set({reasoning:e.target.value})} className="study-select"><option value="auto">Авто</option>{Object.entries(REASONING_LEVELS).map(([id,item])=><option key={id} value={id}>{item.label}</option>)}</select></label>}
      <button type="button" disabled={disabled||!search.available} aria-pressed={internet} title={search.reason} className={`study-chip ${internet?'active':''}`} onClick={()=>set({webSearch:internet?false:'auto'})}><Globe2 size={15}/>Интернет: {internet?'авто':'выкл.'}</button>
    </div>
    {!compact&&<p className="study-muted">{level==='off'?'Один ответ без дополнительного проверочного прохода.':level==='low'?'Краткий ответ и проверка в одном запросе.':level==='auto'?'Глубина подбирается по задаче: короткий ответ или до двух проверочных запросов.':'Средний — один проверочный запрос; высокий — два, второй другим способом. Это медленнее и расходует квоту, но не гарантирует правильность.'} Интернет: локальные правила выделяют тему и при необходимости ищут до вызова модели. Это эвристика, не понимание ИИ. Фото, черновик и история не идут в поиск. Не вводите личные данные.</p>}
    {!search.available&&<p className="study-muted">{search.reason}</p>}
  </section>;
}
