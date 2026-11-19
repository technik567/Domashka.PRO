import React, { useEffect, useState } from 'react';
import { BrainCircuit, Check, Circle, Loader2, Octagon, TriangleAlert } from 'lucide-react';

export default function WorkflowPanel({ status, workflow, busy = false, advanced = false, onCancel }) {
  const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{if(!busy)return;const start=Date.now();setElapsed(0);const timer=setInterval(()=>setElapsed(Date.now()-start),1000);return()=>clearInterval(timer);},[busy]);
  const trail=(workflow?.trail || status?.trail || []).slice(0,24);
  const seconds=Math.floor((workflow?.elapsedMs ?? Math.max(elapsed,status?.elapsedMs||0))/1000);
  const label=busy ? status?.message || 'Подготавливаю ответ…' : 'Ход работы';
  return <section className="work-panel" aria-label="Ход работы ИИ">
    <div className="work-panel-heading"><span className="work-panel-icon">{busy?<Loader2 size={17} className="animate-spin"/>:<BrainCircuit size={17}/>}</span>
      <span role="status" aria-live="polite" className="min-w-0 flex-1">{label}</span><span className="work-time">{seconds} с</span>
      {busy&&onCancel&&<button type="button" onClick={onCancel} className="study-icon-button" aria-label="Остановить ответ"><Octagon size={16}/></button>}
    </div>
    <details className="work-details" key={busy?'active':'finished'} open={busy && advanced || undefined}>
      <summary>{busy?'Что происходит':'Посмотреть этапы'}{workflow&&` · поисков: ${workflow.searches}, проверок: ${workflow.verified}`}</summary>
      {trail.length>0 ? <ol className="work-trail">{trail.map((entry)=><li key={entry.id} data-state={entry.state}>
        {entry.state==='done'?<Check size={14}/>:entry.state==='warning'?<TriangleAlert size={14}/>:<Circle size={13}/>}
        <div><p>{entry.message}</p>{advanced&&entry.query&&<p className="work-query">Запрос: {entry.query}</p>}</div>
      </li>)}</ol> : <p className="work-note">{status?.message || 'Ожидаем подтверждённые этапы выполнения.'}</p>}
      <p className="work-note">Это события приложения, не скрытые мысли модели. Проверочный проход может ошибаться. «Остановить» отменяет ожидание и дальнейшие действия, но не гарантирует остановку уже принятого сервером запроса.</p>
    </details>
  </section>;
}
