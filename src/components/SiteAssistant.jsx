import ModelInfoCard from './ModelInfoCard';
import { getModelProfile } from '../standalone/modelProfiles';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, CircleHelp, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { getManagedChild, assertAiAllowed } from '../standalone/accounts';
import { findHelpTopics, HELP_TOPICS, redactHelpInput } from '../standalone/helpKnowledge';
import { askSiteHelp, getHelpModel } from '../standalone/siteHelp';
import { SITE_HELP_MODEL } from '../standalone/qwenSiteHelp';
import MarkdownMath from './MarkdownMath';
import AiThinkingCard from './AiThinkingCard';

export default function SiteAssistant({ page = 'solver', onNavigate, onReplayTour, allowRemote = true }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState(''); const [messages, setMessages] = useState([]);
  const [model, setModel] = useState(SITE_HELP_MODEL.id);
  const [status, setStatus] = useState(null), [error,setError] = useState('');
  const [busy,setBusy] = useState(false), [used,setUsed] = useState('');
  const panel = useRef(null), input = useRef(null), trigger = useRef(null), request = useRef(null), transcript = useRef(null);
  const child = getManagedChild(); const selected = allowRemote ? getHelpModel(model) : { id: '', note: '' };
  let canUseAi = allowRemote && Boolean(selected.id); let policyMessage = selected.note;
  try { if (canUseAi) assertAiAllowed(); } catch (err) { canUseAi = false; policyMessage = err.message; }
  const close = () => { request.current?.abort(); request.current = null; setBusy(false); setStatus(null); setOpen(false); setMessages([]); setQuestion(''); setError(''); setUsed(''); trigger.current?.focus(); };
  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const keyboard = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const nodes = Array.from(panel.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]') || []);
        const pos = nodes.indexOf(document.activeElement);
        if (event.shiftKey && pos <= 0) { event.preventDefault(); nodes.at(-1)?.focus(); }
        else if (!event.shiftKey && (pos === -1 || pos === nodes.length-1)) { event.preventDefault(); nodes[0]?.focus(); }
      }
    };
    document.addEventListener('keydown',keyboard);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown',keyboard); };
  }, [open]);
  useEffect(() => { if (messages.length) transcript.current?.scrollIntoView({ block:'nearest', behavior:'smooth' }); }, [messages.length]);
  const helperProfile = selected.id === SITE_HELP_MODEL.id
    ? { description: 'Крупная Qwen3-VL-235B помогает разбираться в функциях сайта. Здесь только текст. Публичное демо может отвечать медленно или быть недоступно; анонимный inference не гарантирован.', ratings: [5,1,5] }
    : { ...getModelProfile('builtin',selected.id || 'auto'), sourceUrl: undefined };
  const suggestions = findHelpTopics(question);
  const topics = suggestions.length ? suggestions : HELP_TOPICS.filter((t) => ['cloud','register','cards','charts'].includes(t.id));
  async function submit(event) {
    event.preventDefault(); if (request.current || !question.trim() || !canUseAi) return;
    const ctrl = new AbortController(); request.current = ctrl; setBusy(true); setError(''); setUsed('');
    const clean = redactHelpInput(question); const turns = messages.slice(-4);
    setStatus({ stage:'prepare', message:'Подбираем публичную справку. Личные документы не читаем…' });
    try {
      const answer = await askSiteHelp({ question: clean, history: turns, model, page, signal: ctrl.signal, onStatus: (s) => { if (request.current === ctrl) setStatus(s); } });
      if (request.current !== ctrl) return;
      setMessages([...turns, { role:'user',content:answer.question },{ role:'assistant',content:answer.text }]); setUsed(answer.used); setQuestion('');
    } catch (err) { if (request.current === ctrl && err.name !== 'AbortError') setError(err.message); }
    finally { if (request.current === ctrl) { request.current = null; setBusy(false); setStatus(null); } }
  }
  return <>
    <button ref={trigger} type="button" data-tour="help-trigger" aria-label="Помощь по сайту" aria-expanded={open} onClick={() => setOpen(true)}
      className="no-print fixed z-40 right-3 bottom-20 md:bottom-5 sm:right-5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-900/20 border border-indigo-400 px-3 py-3 inline-flex items-center gap-2 font-bold text-xs"><CircleHelp size={21} /><span className="hidden sm:inline">Помощь по сайту</span></button>
    {open && createPortal(<div className="no-print fixed inset-0 z-[90] bg-slate-950/50 p-2 sm:p-5 flex justify-end items-end sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section ref={panel} role="dialog" aria-modal="true" aria-label="Помощник по сайту" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-3xl shadow-2xl w-full sm:max-w-xl flex flex-col overflow-hidden border border-indigo-200 dark:border-indigo-800" style={{ height:'min(850px,calc(100dvh - 24px))' }}>
        <header className="p-4 sm:p-5 flex items-start gap-3 border-b border-slate-200 dark:border-slate-800 bg-indigo-50 dark:bg-indigo-950/40"><div className="rounded-xl bg-indigo-600 text-white p-2.5"><MessageCircle size={22} /></div><div className="min-w-0 flex-1"><h2 className="font-black text-base">Помощник по сайту</h2><p className="text-xs text-slate-500 mt-0.5">Справка без сети + бесплатный ИИ по запросу</p></div><button type="button" aria-label="Закрыть помощника" onClick={close} className="p-2 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900"><X size={19} /></button></header>
        <div className="p-4 sm:p-5 overflow-y-auto min-h-0 flex-1 space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-xs space-y-2">
            <p>Помощник объясняет функции, но не видит вашу тетрадь, фото, список семьи и сеанс, не меняет настройки и не выполняет действия за вас. История этого окна очищается при закрытии.</p>
            {onReplayTour && <button type="button" onClick={() => { close(); onReplayTour(); }} className="font-bold text-indigo-700 dark:text-indigo-300 underline inline-flex gap-1.5 items-center"><Sparkles size={15} />Показать обучение</button>}
          </div>
          {allowRemote && <details className="text-xs rounded-xl border border-slate-200 dark:border-slate-700 p-3"><summary className="cursor-pointer font-semibold">О модели помощника: описание и условные рейтинги</summary><div className="mt-2"><ModelInfoCard profile={helperProfile} /></div></details>}
          <section aria-label="Локальная справка" className="space-y-2"><h3 className="font-bold text-xs uppercase tracking-wider text-indigo-600 dark:text-indigo-300 flex gap-2"><BookOpen size={15} />Из инструкции · не ответ ИИ</h3>
            {topics.map((topic) => <details key={topic.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-xs"><summary className="cursor-pointer font-bold">{topic.title}</summary><p className="leading-relaxed mt-2 text-slate-600 dark:text-slate-300">{topic.body}</p>
              {onNavigate && <button type="button" className="font-bold mt-2 text-indigo-600 dark:text-indigo-300" onClick={() => { close(); onNavigate(topic.section); }}>Открыть раздел</button>}
            </details>)}
          </section>
          {messages.map((m,i) => <div key={i} className={`rounded-2xl p-3 text-sm ${m.role === 'user' ? 'bg-indigo-50 dark:bg-indigo-950/40 ml-5' : 'bg-slate-50 dark:bg-slate-800/60 mr-2'}`}><p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">{m.role === 'user' ? 'Ваш вопрос' : 'Ответ ИИ · перепроверьте по справке'}</p><MarkdownMath disableLinks content={m.content} /></div>)}
          {used && <p className="text-[11px] text-slate-500">{used}. Это публичное демо, не гарантия доступности и не сравнительный бенчмарк.</p>}
          {busy && <AiThinkingCard title="Помощник отвечает по справке…" status={status} onCancel={() => { request.current?.abort(); request.current = null; setBusy(false); setStatus(null); }} />}
          {error && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-200">{error}<p className="mt-2 text-xs">Автоматического повтора и перехода на платный канал нет. Локальная справка выше остаётся доступной.</p></div>}
          <div ref={transcript} />
        </div>
        <form onSubmit={submit} className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2 bg-white dark:bg-slate-900">
          {!child && allowRemote && <label className="block text-[11px] text-slate-500">Бесплатная модель помощника<select disabled={busy} value={model} onChange={(e) => setModel(e.target.value)} className="block w-full mt-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 p-2 text-xs"><option value={SITE_HELP_MODEL.id}>Qwen3-VL-235B · крупная, может отвечать медленно</option><option value="gemma-3-12b">Google Gemma 3 12B · другое публичное демо</option></select></label>}
          {!allowRemote ? <p className="text-xs text-amber-700 dark:text-amber-300">До входа доступна локальная справка. Сетевой ИИ включается после входа с учётом родительских ограничений.</p> : policyMessage && <p className="text-xs text-slate-500">{policyMessage}</p>}
          <label className="block"><span className="sr-only">Вопрос о сайте</span><textarea ref={input} rows={2} maxLength={4000} disabled={busy} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Как перенести данные с телефона?" className="w-full resize-y max-h-40 rounded-xl border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-slate-950 p-3 text-base outline-none focus:ring-2 focus:ring-indigo-500" /></label>
          <div className="flex gap-2 items-center"><p className="text-[10px] leading-relaxed text-slate-500 flex-1">Только вопрос и фрагменты публичной справки уйдут в демо. Оно может журналировать запросы. Не пишите пароли, ключи и личные данные.</p><button type="submit" disabled={busy || !question.trim() || !canUseAi} className="inline-flex gap-2 items-center rounded-xl bg-indigo-600 text-white p-3 font-bold text-xs disabled:opacity-40"><Send size={16} />Спросить ИИ</button></div>
        </form>
      </section>
    </div>,document.body)}
  </>;
}
