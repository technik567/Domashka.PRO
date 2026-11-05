import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { getBrowserEnvironment, VOICE_FALLBACK_HELP } from '../standalone/browserEnvironment';

const ERRORS = {
  'not-allowed': 'Доступ к микрофону/распознаванию запрещён. Проверьте разрешение сайта и настройки речи в iOS.',
  'service-not-allowed': 'Браузер или HTML Viewer не разрешает сервис распознавания речи.',
  'audio-capture': 'Микрофон недоступен: проверьте разрешение и не занят ли он другим приложением.',
  'no-speech': 'Речь не услышана. Попробуйте ещё раз или используйте диктовку клавиатуры.',
  network: 'Сервис распознавания речи недоступен по сети. Это отдельный сервис браузера, не выбранная нейросеть.',
  'language-not-supported': 'Распознавание русского языка недоступно в этом браузере.',
};

export default function VoiceMicButton({ onTranscript, className = '', disabled = false }) {
  const [state, setState] = useState('idle');
  const [hint, setHint] = useState('');
  const [interim, setInterim] = useState('');
  const recognition = useRef(null);
  const onTranscriptRef = useRef(onTranscript);
  const startTimer = useRef(null);
  const stopping = useRef(false);
  onTranscriptRef.current = onTranscript;

  const stop = () => {
    const current = recognition.current;
    stopping.current = false;
    recognition.current = null; // invalidate callbacks BEFORE abort (some implementations fire synchronously)
    clearTimeout(startTimer.current);
    if (current) { current.onstart = current.onresult = current.onerror = current.onend = null; try { current.abort(); } catch { /* already stopped */ } }
  };

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') { stop(); setState('idle'); setInterim(''); }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => { stop(); document.removeEventListener('visibilitychange', onHidden); };
  }, []);
  useEffect(() => { if (disabled) { stop(); setState('idle'); setInterim(''); } }, [disabled]);

  const toggle = () => {
    if (recognition.current) {
      const current = recognition.current;
      stopping.current = true; setState('stopping'); clearTimeout(startTimer.current);
      startTimer.current = setTimeout(() => {
        if (recognition.current === current) { stop(); setState('idle'); setInterim(''); setHint('Браузер не подтвердил конец записи. ' + VOICE_FALLBACK_HELP); }
      }, 3000);
      try { current.stop(); } catch { stop(); setState('idle'); setInterim(''); }
      return;
    }
    const environment = getBrowserEnvironment();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (environment.unsafeNativeMedia || !environment.secure || !SpeechRecognition) {
      setHint((environment.unsafeNativeMedia ? 'В локальном iOS-просмотрщике прямой вызов микрофона отключён: он может быть недоступен или завершить приложение. ' : 'Этот браузер/способ запуска не поддерживает безопасный голосовой ввод кнопкой сайта. ') + VOICE_FALLBACK_HELP);
      return;
    }
    let current;
    try {
      current = new SpeechRecognition();
      recognition.current = current; stopping.current = false;
      current.lang = 'ru-RU';
      current.interimResults = true;
      current.continuous = false; // compatible with short mobile dictation; no background auto-restart
      current.maxAlternatives = 1;
      current.onstart = () => { if (recognition.current === current && !stopping.current) { clearTimeout(startTimer.current); setState('listening'); } };
      const deliveredFinals = new Set();
      current.onresult = (event) => {
        if (recognition.current !== current) return;
        let pending = '';
        const completed = [];
        for (let i = event.resultIndex || 0; i < event.results.length; i += 1) {
          const text = event.results[i]?.[0]?.transcript || '';
          if (event.results[i].isFinal) { if (!deliveredFinals.has(i)) { deliveredFinals.add(i); completed.push(text); } }
          else pending += text;
        }
        if (completed.join(' ').trim()) onTranscriptRef.current?.(completed.join(' ').trim());
        setInterim(pending.slice(0, 1000));
      };
      current.onerror = (event) => {
        if (recognition.current !== current) return;
        const message = event.error === 'aborted' ? '' : (ERRORS[event.error] || 'Не удалось распознать речь. Попробуйте диктовку клавиатуры.');
        stop(); setState('idle'); setInterim('');
        if (message) setHint(message + ' ' + VOICE_FALLBACK_HELP);
      };
      current.onend = () => {
        if (recognition.current !== current) return;
        recognition.current = null; stopping.current = false; current.onstart = current.onresult = current.onerror = current.onend = null; clearTimeout(startTimer.current); setState('idle'); setInterim('');
      };
      setHint(''); setInterim(''); setState('starting');
      startTimer.current = setTimeout(() => {
        if (recognition.current === current) { stop(); setState('idle'); setHint('Браузер не запустил распознавание. Проверьте разрешения. ' + VOICE_FALLBACK_HELP); }
      }, 15000);
      current.start();
    } catch {
      stop(); setState('idle'); setHint('Не удалось запустить распознавание речи. ' + VOICE_FALLBACK_HELP);
    }
  };

  return <div className="inline-flex flex-col items-end gap-1 max-w-full">
    <button type="button" disabled={disabled || state === 'stopping'} onClick={toggle} aria-pressed={state !== 'idle'} title="Надиктовать текст голосом"
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border transition disabled:opacity-50 ${state !== 'idle' ? 'bg-rose-600 text-white border-rose-600' : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'} ${className}`}>
      {state !== 'idle' ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
      {state === 'stopping' ? 'Завершаю…' : state === 'starting' ? 'Запуск… (стоп)' : state === 'listening' ? 'Слушаю… (стоп)' : 'Голосом'}
    </button>
    {interim && <span role="status" className="text-xs text-indigo-700 dark:text-indigo-300 max-w-sm break-words">{interim}</span>}
    {hint && <span role="status" className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 p-2.5 rounded-lg max-w-sm">{hint}</span>}
    {state !== 'idle' && <span className="text-[10px] text-slate-500 max-w-xs">Речь обрабатывает сервис браузера/ОС; может потребоваться интернет. Текст не отправляется в чат автоматически.</span>}
  </div>;
}
