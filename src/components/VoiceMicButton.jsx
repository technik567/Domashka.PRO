import React, { useState, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';

export default function VoiceMicButton({ onTranscript, className = '' }) {
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState('');
  const recRef = useRef(null);

  const showTempHint = (msg) => {
    setHint(msg);
    setTimeout(() => setHint(''), 4500);
  };

  const toggleListen = () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      showTempHint('Голосовой ввод поддерживается в браузерах Chrome, Edge и Яндекс (по HTTP/HTTPS).');
      return;
    }

    if (listening && recRef.current) {
      recRef.current.stop();
      setListening(false);
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = 'ru-RU';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (ev) => {
        const text = ev?.results?.[0]?.[0]?.transcript || '';
        if (text.trim()) {
          onTranscript?.(text.trim());
          setHint('');
        }
      };
      rec.onerror = (ev) => {
        setListening(false);
        if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') {
          if (window.location.protocol === 'file:') {
            showTempHint(
              'Браузер отключает микрофон для локальных файлов file:// в целях безопасности. Введите текст или вставьте фото (Ctrl+V).'
            );
          } else {
            showTempHint('Разрешите доступ к микрофону в адресной строке браузера.');
          }
        } else if (ev?.error === 'no-speech') {
          showTempHint('Речь не услышана. Попробуйте сказать громче.');
        }
      };
      rec.onend = () => setListening(false);
      recRef.current = rec;
      setHint('');
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
      showTempHint('Не удалось запустить микрофон в этом режиме.');
    }
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggleListen}
        title="Надиктовать текст голосом"
        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border transition ${
          listening
            ? 'bg-rose-600 text-white border-rose-600 animate-pulse shadow-sm'
            : 'bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
        } ${className}`}
      >
        {listening ? (
          <MicOff className="w-3.5 h-3.5" />
        ) : (
          <Mic className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
        )}
        {listening ? 'Слушаю... (стоп)' : 'Голосом'}
      </button>
      {hint && (
        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-lg max-w-xs text-right">
          {hint}
        </span>
      )}
    </div>
  );
}
