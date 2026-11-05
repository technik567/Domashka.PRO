import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Play, Pause, Eye, EyeOff, RotateCcw, Mic2, Clock } from 'lucide-react';

function cleanMarkdownForSpeechAndStudy(md) {
  if (!md) return '';
  return String(md)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
    .replace(/\\cdot/g, '·')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/^\s*\|[\s|-]+(?::[\s|-]+)*\|\s*$/gm, '')
    .replace(/\|/g, ' — ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function TeleprompterModal({ open, onClose, markdown = '', title = 'Подготовка к устному ответу и заучивание' }) {
  const scrollBoxRef = useRef(null);
  const [maskLevel, setMaskLevel] = useState(0); // 0 = full, 1 = hide every 3rd long word, 2 = first-letter Trainer
  const [revealedKeys, setRevealedKeys] = useState({});
  const [fontSize, setFontSize] = useState(20);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!open) {
      setPlaying(false);
      return;
    }
    setRevealedKeys({});
  }, [open, markdown, maskLevel]);

  useEffect(() => {
    if (!open || !playing) return undefined;
    const id = setInterval(() => {
      const el = scrollBoxRef.current;
      if (!el) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
        setPlaying(false);
        return;
      }
      el.scrollTop += 0.9 * speed;
    }, 35);
    return () => clearInterval(id);
  }, [open, playing, speed]);

  const paragraphs = useMemo(() => {
    const cleaned = cleanMarkdownForSpeechAndStudy(markdown);
    if (!cleaned) return [];
    return cleaned
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
  }, [markdown]);

  const stats = useMemo(() => {
    const words = paragraphs.join(' ').match(/[а-яёa-z0-9]+/giu) || [];
    const totalWords = words.length;
    const sec = Math.max(5, Math.round((totalWords / 115) * 60));
    const minPart = Math.floor(sec / 60);
    const secPart = sec % 60;
    return {
      words: totalWords,
      timeLabel: minPart > 0 ? `~${minPart} мин ${secPart} сек` : `~${secPart} сек`,
    };
  }, [paragraphs]);

  if (!open) return null;

  const toggleWordReveal = (key) => {
    setRevealedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-fade-up">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <Mic2 className="w-5 h-5 text-amber-300 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-extrabold text-sm sm:text-base truncate">{title}</h3>
              <div className="text-[11px] text-indigo-100 flex items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Устный ответ: {stats.timeLabel} ({stats.words} слов)
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Controls Bar */}
        <div className="px-3 sm:px-5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Memorization mode */}
          <div className="flex flex-wrap items-center gap-1">
            {[
              { id: 0, label: '📖 Весь текст', icon: Eye },
              { id: 1, label: '🧠 Учить (-35% слов)', icon: EyeOff },
              { id: 2, label: '🔥 По 1-й букве', icon: EyeOff },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMaskLevel(m.id)}
                className={`px-2.5 py-1.5 rounded-lg font-bold transition ${
                  maskLevel === m.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Scroll & Font Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className={`px-3 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 transition ${
                playing
                  ? 'bg-amber-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{playing ? 'Пауза' : 'Суфлёр'}</span>
            </button>

            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-semibold"
              title="Скорость прокрутки"
            >
              <option value={0.6}>0.6× медленно</option>
              <option value={1}>1× обычно</option>
              <option value={1.6}>1.6× бодро</option>
              <option value={2.2}>2.2× быстро</option>
            </select>

            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setFontSize((s) => Math.max(15, s - 2))}
                className="px-2 py-1 font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                A-
              </button>
              <button
                type="button"
                onClick={() => setFontSize((s) => Math.min(30, s + 2))}
                className="px-2 py-1 font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border-l border-slate-200 dark:border-slate-700"
              >
                A+
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setRevealedKeys({});
                if (scrollBoxRef.current) scrollBoxRef.current.scrollTop = 0;
              }}
              className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
              title="В начало"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {maskLevel > 0 && (
          <div className="px-4 py-1.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60 text-[11px] text-amber-800 dark:text-amber-300 font-medium">
            💡 Вспомните скрытые слова вслух! Нажмите на любое скрытое слово, чтобы подсмотреть его.
          </div>
        )}

        {/* Scrollable Study Canvas */}
        <div
          ref={scrollBoxRef}
          style={{ fontSize: `${fontSize}px` }}
          className="flex-1 overflow-y-auto p-5 sm:p-8 space-y-5 leading-relaxed text-slate-900 dark:text-slate-100 font-medium"
        >
          {paragraphs.map((para, pIdx) => {
            if (maskLevel === 0) {
              return <p key={pIdx}>{para}</p>;
            }
            const tokens = para.split(/(\s+)/);
            let wordCounter = 0;
            return (
              <p key={pIdx}>
                {tokens.map((tok, tIdx) => {
                  if (/^\s+$/.test(tok)) return tok;
                  const cleanAlpha = tok.replace(/[^а-яёa-z0-9]/giu, '');
                  if (cleanAlpha.length < 4) return tok;
                  wordCounter += 1;
                  const shouldMask =
                    maskLevel === 2 ? wordCounter % 2 === 1 : wordCounter % 3 === 0;
                  if (!shouldMask) return tok;

                  const key = `${pIdx}_${tIdx}`;
                  if (revealedKeys[key]) {
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleWordReveal(key)}
                        className="inline px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 underline decoration-dotted"
                      >
                        {tok}
                      </button>
                    );
                  }

                  const hint =
                    maskLevel === 2
                      ? `${tok.slice(0, 1)}${'•'.repeat(Math.min(6, Math.max(3, cleanAlpha.length - 1)))}`
                      : '•'.repeat(Math.min(7, Math.max(4, cleanAlpha.length)));

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleWordReveal(key)}
                      className="inline-block px-2 py-0.5 mx-0.5 rounded-lg bg-indigo-100 dark:bg-indigo-950/90 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700 font-mono text-[0.85em] hover:bg-indigo-200 transition"
                      title="Нажмите, чтобы открыть слово"
                    >
                      {hint}
                    </button>
                  );
                })}
              </p>
            );
          })}
        </div>
      </div>
    </div>
  );
}
