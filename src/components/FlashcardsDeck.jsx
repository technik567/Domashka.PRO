import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, RefreshCw, Layers, X, Trophy, Eye } from 'lucide-react';
import MarkdownMath from './MarkdownMath';
import VoiceMicButton from './VoiceMicButton';
import { beginFlashcardCheck, answerFlashcardCheck } from '../standalone/flashcardCheck';
export { buildFlashcardsFromSheets } from '../standalone/flashcardContent.js';

const button = 'px-4 py-3 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed';
export default function FlashcardsDeck({ cards = [], deckTitle = 'Умные карточки на 5 минут', onClose }) {
  const initialQueue = useMemo(() => [...new Map(cards.map((card, i) => [card.id || i, card])).values()], [cards]);
  const [queue, setQueue] = useState(initialQueue);
  const [mastered, setMastered] = useState(0); const [repeats, setRepeats] = useState(0); const [earned, setEarned] = useState(0);
  const [flipped, setFlipped] = useState(false); const [check, setCheck] = useState(null); const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const counted = useRef(new Set());
  const request = useRef(0); const inFlight = useRef(false); const input = useRef(null);
  function clearCheck() { request.current++; inFlight.current = false; setBusy(false); setCheck(null); setAnswer(''); setResult(null); setError(''); setFlipped(false); }
  function restart() { clearCheck(); setQueue(initialQueue); setMastered(0); setRepeats(0); setEarned(0); }
  useEffect(() => { restart(); return () => { request.current++; }; }, [initialQueue]);
  useEffect(() => { if (check?.id && !busy && !result?.finished) input.current?.focus(); }, [check?.id, busy]);
  useEffect(() => {
    if (!onClose) return;
    const close = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  const current = queue[0]; const total = initialQueue.length;
  async function know() {
    if (!current || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setFlipped(false);
    const ticket = ++request.current;
    try { const next = await beginFlashcardCheck(current); if (ticket === request.current) { setCheck(next); setResult(null); setAnswer(''); } }
    catch (err) { if (ticket === request.current) setError(err.message); }
    finally { if (ticket === request.current) { inFlight.current = false; setBusy(false); } }
  }
  async function submit(event) {
    event.preventDefault();
    if (!check?.id || inFlight.current || result?.finished) return;
    inFlight.current = true; setBusy(true); setError(''); const ticket = request.current;
    try {
      const next = await answerFlashcardCheck(check.id, answer);
      if (ticket !== request.current) return;
      setResult(next);
      if (next.correct && !counted.current.has(check.id)) { counted.current.add(check.id); setMastered((n) => n + 1); setEarned((n) => n + next.awarded); }
    } catch (err) { if (ticket === request.current) setError(err.message); }
    finally { if (ticket === request.current) { inFlight.current = false; setBusy(false); } }
  }
  function repeat() {
    clearCheck(); setRepeats((n) => n + 1);
    setQueue(([first, ...rest]) => { rest.splice(Math.min(rest.length, 3), 0, first); return rest; });
  }
  function next() { clearCheck(); setQueue((items) => items.slice(1)); }
  const content = <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-xl">
    <header className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-start justify-between gap-3">
      <div><h3 className="font-extrabold flex items-center gap-2"><Layers className="w-5 h-5 text-indigo-600 shrink-0" />{deckTitle}</h3>
        <p className="text-xs text-slate-500 mt-1">Проверено: {mastered} из {total} · За этот проход: +{earned} XP</p></div>
      {onClose && <button type="button" onClick={onClose} aria-label="Закрыть карточки" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>}
    </header>
    <div className="h-1.5 bg-slate-100 dark:bg-slate-800" aria-hidden="true"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${total ? (total - queue.length) / total * 100 : 0}%` }} /></div>
    <div className="p-4 sm:p-6 space-y-4">
      {!total ? <p className="text-sm text-slate-500 text-center py-8">Для выбранного фильтра пока нет карточек — выберите другой предмет или класс.</p>
        : !current ? <div className="text-center py-6 space-y-4">
          <Trophy className="w-12 h-12 mx-auto text-emerald-600" /><h4 className="text-xl font-extrabold">Стопка пройдена!</h4>
          <p className="text-sm">Подтверждено ответом: {mastered} из {total}. Повторений: {repeats}.<br />Действительно начислено: <b>+{earned} XP</b>.</p>
          <p className="text-xs text-slate-500">За повторную проверку той же карточки XP не начисляется. Перезапуск не сбрасывает историю наград.</p>
          <button type="button" onClick={restart} className={`${button} bg-indigo-600 text-white`}>Пройти стопку ещё раз</button>
        </div> : check ? <div className="space-y-4">
          <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 p-4 bg-indigo-50/50 dark:bg-indigo-950/30">
            <p className="text-xs font-bold text-indigo-600 dark:text-indigo-300 mb-2">Короткая проверка · {current.topic}</p>
            <p className="text-sm whitespace-pre-wrap leading-relaxed" data-testid="flashcard-question">{check.question}</p>
          </div>
          {check.unavailable ? <button type="button" onClick={next} className={`${button} bg-slate-100 dark:bg-slate-800`}>Продолжить без XP</button> : <form onSubmit={submit} className="space-y-3">
            <label className="block text-sm font-semibold">Короткий ответ
              <input ref={input} value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={200} required autoComplete="off" disabled={busy || result?.finished}
                className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-base" placeholder="Число, слово или короткая фраза" />
            </label>
            <div className="flex flex-wrap justify-between gap-3 items-start">
              {!result?.finished && <button disabled={busy || !answer.trim()} className={`${button} bg-emerald-600 text-white`}><Check className="w-4 h-4 inline mr-1" />{busy ? 'Проверяем…' : 'Проверить ответ'}</button>}
              <VoiceMicButton key={check.id} disabled={busy || result?.finished} onTranscript={(text) => setAnswer(text.slice(0, 200))} />
            </div>
            <p className="text-[11px] text-slate-500">Микрофон необязателен. Можно печатать или диктовать клавиатурой; перед отправкой исправьте распознанный текст. Это короткая тренировка, не экзамен.</p>
          </form>}
          {result && <div role="status" className={`p-3 rounded-xl text-sm ${result.correct ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200' : 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200'}`}>
            {result.correct ? result.awarded ? `Верно! +${result.awarded} XP.` : 'Верно! Награда за эту карточку уже была получена — повторных XP нет.'
              : result.finished ? `Проверка закончена без XP. Ответ в карточке: ${result.expected || 'повторите правило'}.`
              : `Пока не совпало. Попыток осталось: ${result.remaining}. XP не начислен.`}
          </div>}
          {result?.correct ? <button type="button" onClick={next} className={`${button} bg-indigo-600 text-white`}>Следующая карточка</button>
            : !check.unavailable && <button type="button" onClick={repeat} disabled={busy} className={`${button} bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200`}>Повторить правило без XP</button>}
        </div> : <>
          <button type="button" onClick={() => setFlipped((value) => !value)} disabled={busy} aria-label={flipped ? 'Вернуть вопрос' : 'Показать правило'}
            className={`w-full text-left min-h-[220px] rounded-2xl border-2 p-5 ${flipped ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/25' : 'border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/30'}`}>
            <span className="flex justify-between text-[11px] font-bold mb-4 gap-2"><span>{flipped ? 'ОТВЕТ / ПРАВИЛО' : 'ВОПРОС / ТЕРМИН'}</span><span className="text-slate-500">{current.gradeLabel}</span></span>
            <div className="text-sm sm:text-base overflow-x-auto"><MarkdownMath content={flipped ? current.back : current.front} /></div>
            <span className="flex items-center justify-center gap-1 mt-5 text-xs text-indigo-600 dark:text-indigo-300"><Eye className="w-4 h-4" />{flipped ? 'Вернуть вопрос' : 'Показать правило'}</span>
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" disabled={busy} onClick={repeat} className={`${button} bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200`}><RefreshCw className="inline w-4 h-4 mr-1" />Повторить ещё</button>
            <button type="button" disabled={busy} onClick={know} className={`${button} bg-emerald-600 text-white`}>{busy ? 'Готовим проверку…' : 'Знаю — проверить'}</button>
          </div>
          <button type="button" disabled={busy} onClick={next} className="block mx-auto text-xs text-slate-500 underline">Пропустить без XP</button>
          <p className="text-[11px] text-slate-500">«Знаю» открывает короткое задание по теме. +4 XP только за правильный ответ, один раз за карточку.</p>
        </>}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    </div>
  </section>;
  return onClose ? <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={deckTitle}>
    <div className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto rounded-2xl">{content}</div>
  </div> : content;
}
