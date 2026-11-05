import React, { useEffect, useMemo, useState } from 'react';
import {
  RotateCcw,
  Check,
  RefreshCw,
  Layers,
  Sparkles,
  X,
  Trophy,
  Eye,
} from 'lucide-react';
import MarkdownMath from './MarkdownMath';
import { recordStudentActivity } from '../api';

/**
 * Extracts crisp Question <-> Answer flashcards from one or more CheatSheet objects!
 */
export function buildFlashcardsFromSheets(sheets, maxCards = 18) {
  const list = Array.isArray(sheets) ? sheets : sheets ? [sheets] : [];
  const cards = [];

  for (const sheet of list) {
    if (!sheet?.content) continue;
    const lines = String(sheet.content).split(/\r?\n/);
    let extractedForSheet = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // 1. Bullet item: - **Front:** Back  OR  - **Front** — Back
      const bulletMatch = line.match(/^[-*•]\s+\*\*([^*]+)\*\*\s*[:—–-]?\s*(.+)$/);
      if (bulletMatch) {
        const frontTerm = bulletMatch[1].replace(/:$/, '').trim();
        const backDef = bulletMatch[2].trim();
        if (frontTerm && backDef) {
          cards.push({
            id: `${sheet.id}-b-${extractedForSheet}`,
            topic: sheet.title,
            gradeLabel: `${sheet.minGrade}–${sheet.maxGrade} кл.`,
            front: `**${frontTerm}**\n\n*(Из темы: «${sheet.title}»)*`,
            back: backDef,
          });
          extractedForSheet += 1;
          continue;
        }
      }

      // 2. Markdown table row: | Col1 | Col2 | ...
      if (line.startsWith('|') && line.endsWith('|') && !/^\|[\s\-:|]+\|$/.test(line)) {
        const cells = line
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        if (cells.length >= 2) {
          const c0 = cells[0].replace(/\*\*/g, '').trim();
          const low0 = c0.toLowerCase();
          if (
            c0 &&
            cells[1] &&
            !['название', 'формула', 'величина', 'падеж', 'термин', 'правило', 'функция', 'время'].includes(low0)
          ) {
            cards.push({
              id: `${sheet.id}-t-${extractedForSheet}`,
              topic: sheet.title,
              gradeLabel: `${sheet.minGrade}–${sheet.maxGrade} кл.`,
              front: `**${cells[0]}**\n\n*(Тема: «${sheet.title}»)*`,
              back: cells.slice(1).join(' — '),
            });
            extractedForSheet += 1;
          }
        }
      }
    }

    // Fallback: whole compact cheat sheet as 1 summary card
    if (extractedForSheet === 0) {
      cards.push({
        id: `${sheet.id}-full`,
        topic: sheet.title,
        gradeLabel: `${sheet.minGrade}–${sheet.maxGrade} кл.`,
        front: `Вспомните правило / формулу:\n\n### ${sheet.title}`,
        back: sheet.content,
      });
    }

    if (cards.length >= maxCards) break;
  }

  return cards.slice(0, maxCards);
}

export default function FlashcardsDeck({
  cards = [],
  deckTitle = 'Умные карточки на 5 минут',
  onClose, // optional modal close handler
}) {
  const initialQueue = useMemo(() => cards.map((c, idx) => ({ ...c, _uid: `${c.id || idx}` })), [cards]);

  const [queue, setQueue] = useState(initialQueue);
  const [masteredCount, setMasteredCount] = useState(0);
  const [repeatCount, setRepeatCount] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    setQueue(initialQueue);
    setMasteredCount(0);
    setRepeatCount(0);
    setFlipped(false);
  }, [initialQueue]);

  const totalCards = initialQueue.length;
  const currentCard = queue[0] || null;

  const handleKnow = () => {
    if (!currentCard) return;
    setFlipped(false);
    setMasteredCount((n) => n + 1);
    recordStudentActivity('quiz_correct', 4);
    setQueue((prev) => prev.slice(1));
  };

  const handleRepeatLater = () => {
    if (!currentCard) return;
    setFlipped(false);
    setRepeatCount((n) => n + 1);
    setQueue((prev) => {
      if (prev.length <= 1) return [...prev];
      const [first, ...rest] = prev;
      // Re-insert 3 positions later (or at end) for spaced active recall
      const insertPos = Math.min(rest.length, 3);
      const next = [...rest];
      next.splice(insertPos, 0, first);
      return next;
    });
  };

  const handleRestart = () => {
    setQueue(initialQueue);
    setMasteredCount(0);
    setRepeatCount(0);
    setFlipped(false);
  };

  const progressPct = totalCards > 0 ? Math.round((masteredCount / totalCards) * 100) : 0;

  const content = (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3.5 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 text-white flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Layers className="w-5 h-5 text-amber-300 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-extrabold truncate">{deckTitle}</h3>
            <p className="text-[11px] text-indigo-100">
              Выучено: <b>{masteredCount}</b> из <b>{totalCards}</b> · Осталось в стопке: <b>{queue.length}</b>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleRestart}
            className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-bold inline-flex items-center gap-1 transition"
            title="Перемешать и начать сначала"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Сначала</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition"
              title="Закрыть карточки"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-1.5 bg-slate-100 dark:bg-slate-800 w-full">
        <div
          style={{ width: `${progressPct}%` }}
          className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300"
        />
      </div>

      {/* Body */}
      <div className="p-4 sm:p-6">
        {totalCards === 0 ? (
          <div className="text-center py-8 text-sm text-slate-500">
            Для выбранного фильтра пока нет карточек — выберите другой предмет или класс.
          </div>
        ) : !currentCard ? (
          <div className="text-center py-8 space-y-4 animate-fade-up">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
              <Trophy className="w-9 h-9" />
            </div>
            <div>
              <h4 className="text-xl font-extrabold text-slate-900 dark:text-white">
                Все {totalCards} карточек выучены!
              </h4>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                Повторений в процессе: <b>{repeatCount}</b> · Начислено <b>+{totalCards * 4} XP</b> в дневник успеха!
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleRestart}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 shadow-sm transition"
              >
                <RefreshCw className="w-4 h-4" />
                Пройти стопку ещё раз
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-bold transition"
                >
                  Готово
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Interactive Flip Card */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setFlipped((f) => !f)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  setFlipped((f) => !f);
                }
              }}
              className={`cursor-pointer select-none min-h-[220px] sm:min-h-[250px] rounded-2xl border-2 p-5 sm:p-7 flex flex-col justify-between transition-all ${
                flipped
                  ? 'border-emerald-400 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/25'
                  : 'border-indigo-200 dark:border-indigo-800/80 bg-gradient-to-br from-slate-50 to-indigo-50/40 dark:from-slate-800/80 dark:to-indigo-950/30 hover:border-indigo-400'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                <span
                  className={`px-2.5 py-0.5 rounded-full ${
                    flipped
                      ? 'bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200'
                      : 'bg-indigo-100 dark:bg-indigo-900/70 text-indigo-800 dark:text-indigo-200'
                  }`}
                >
                  {flipped ? '✓ ОТВЕТ / ПРАВИЛО' : '? ВОПРОС / ТЕРМИН'}
                </span>
                <span className="text-slate-400">{currentCard.gradeLabel}</span>
              </div>

              <div className="my-4 text-sm sm:text-base text-slate-900 dark:text-slate-100 overflow-x-auto">
                <MarkdownMath content={flipped ? currentCard.back : currentCard.front} />
              </div>

              <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 pt-2 border-t border-slate-200/70 dark:border-slate-700/60">
                <Eye className="w-3.5 h-3.5" />
                <span>{flipped ? 'Нажмите, чтобы вернуть вопрос' : 'Нажмите на карточку, чтобы проверить ответ'}</span>
              </div>
            </div>

            {/* Decision Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleRepeatLater}
                className="py-3 px-4 rounded-xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 text-amber-900 dark:text-amber-200 font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 transition active:scale-[0.99]"
              >
                <RefreshCw className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Повторить ещё</span>
              </button>

              <button
                type="button"
                onClick={handleKnow}
                className="py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/15 transition active:scale-[0.99]"
              >
                <Check className="w-4 h-4 shrink-0" />
                <span>Знаю! (+4 XP)</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (!onClose) return content;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-2xl animate-fade-up">{content}</div>
    </div>
  );
}
