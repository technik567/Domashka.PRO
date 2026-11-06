import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, CheckCircle2, Camera, Clock, Zap, Lightbulb, X } from 'lucide-react';

import { buildProgressSteps } from '../standalone/progressModel';

const SCHOOL_FACTS = [
  'В задачах по физике всегда переводите км/ч в м/с делением на 3,6 (например: 72 км/ч = 20 м/с).',
  'В кратких страдательных причастиях («задача решена», «работа сдана») всегда пишется только одна буква Н!',
  'По теореме Виета для приведённого уравнения x² + px + q = 0 сумма корней равна −p, а произведение равно q.',
  'Площадь прямоугольника равна произведению длины и ширины. Перед вычислением выразите обе стороны в одинаковых единицах.',
  'Приставка с- неизменяемая: сделать, сдать. В приставках на -з/-с буква зависит от следующего согласного: разбить — расписать.',
  'Катет прямоугольного треугольника, лежащий против угла в 30°, равен половине гипотенузы.',
];

export default function AiThinkingCard({
  title = 'ИИ-учитель решает задание...',
  status = null,
  hasPhoto = false,
  modeLabel = '',
  onOpenSettings,
  onCancel,
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * SCHOOL_FACTS.length));

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 100);
    const tipTimer = setInterval(() => {
      setTipIdx((prev) => (prev + 1) % SCHOOL_FACTS.length);
    }, 5500);
    return () => {
      clearInterval(timer);
      clearInterval(tipTimer);
    };
  }, []);

  const sec = (elapsedMs / 1000).toFixed(1);
  const photoPlan = useRef(status?.photoInputUsed);
  if (status?.photoInputUsed) photoPlan.current = status.photoInputUsed;
  const steps = buildProgressSteps({ ...status, photoInputUsed: photoPlan.current }, hasPhoto);

  const isQueue = status?.stage === 'queue' && status?.waitTotal > 0;


  return (
    <div className="animate-fade-up relative overflow-hidden rounded-2xl border border-indigo-200 dark:border-indigo-800/70 bg-gradient-to-br from-white via-indigo-50/40 to-blue-50/60 dark:from-slate-900 dark:via-indigo-950/30 dark:to-slate-900 p-6 shadow-md">
      {/* Top Row: Animated Orb + Status Title + Stopwatch */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-4">
          <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 flex items-center justify-center text-white animate-orb">
              <Sparkles className="w-6 h-6" />
            </div>
            <span className="animate-float-1 absolute -top-1.5 -right-1 text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
              ∑
            </span>
            <span className="animate-float-2 absolute -bottom-1 -left-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700">
              Аа
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                {title}
              </h3>
              {modeLabel && (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                  {modeLabel}
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-indigo-700 dark:text-indigo-300 font-medium mt-0.5">
              {status?.message || 'Подготавливаем запрос…'}
            </p>
          </div>
        </div>

        <div className="self-start sm:self-center flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/90 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 shadow-sm">
            <Clock className="w-3.5 h-3.5 text-indigo-500 animate-spin" style={{ animationDuration: '4s' }} />
            {sec} сек
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/70 border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300 transition"
              title="Остановить ожидание"
            >
              <X className="w-3.5 h-3.5" />
              <span>Стоп</span>
            </button>
          )}
        </div>
      </div>

      {/* A real client cooldown, not a model completion estimate. */}
      {isQueue && (
        <div className="mb-5 p-3.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200 mb-2">
            <span>⏳ Пауза бесплатного канала: следующая попытка через {status.waitRemaining} сек</span>
          </div>
          {onOpenSettings && (
            <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] text-amber-800 dark:text-amber-300">
                Другой провайдер может быть доступнее. Скорость ответа не гарантируется.
              </span>
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition"
              >
                <Zap className="w-3 h-3" />
                Настройки ИИ
              </button>
            </div>
          )}
        </div>
      )}

      {/* Animated Step Checklist */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5">
        {steps.map((st) => {
          const isDone = st.done;
          const isCurrent = st.active;
          return (
            <div
              key={st.id}
              data-testid={`progress-${st.id}`}
              data-state={isDone ? 'done' : isCurrent ? 'active' : 'pending'}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                isDone
                  ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300'
                  : isCurrent
                  ? 'bg-white dark:bg-slate-800 border-indigo-300 dark:border-indigo-600 text-slate-900 dark:text-white shadow-sm'
                  : 'bg-slate-50/60 dark:bg-slate-800/40 border-slate-200/70 dark:border-slate-700/60 text-slate-400 dark:text-slate-500'
              }`}
            >
              {isDone ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : isCurrent ? (
                <span className="w-4 h-4 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin shrink-0" />
              ) : (
                <span className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 shrink-0" />
              )}
              <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
                <span className="leading-snug">{st.label}</span>
                <span className="shrink-0 text-[10px]">{isDone ? 'Готово' : isCurrent ? 'В работе' : 'Ожидание'}</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">
        Точный прогресс нейросеть не сообщает. Показываем текущий этап и прошедшее время, без процентов и обещанного срока.
        При Vision нейросеть анализирует само фото во время получения ответа, а не в отдельном OCR.
      </p>

      {/* Shimmer Notebook Preview Skeleton */}
      <div className="space-y-2.5 mb-5 px-1">
        <div className="h-3.5 w-2/5 rounded-full shimmer-line" />
        <div className="h-3 w-full rounded-full shimmer-line" />
        <div className="h-3 w-11/12 rounded-full shimmer-line" />
        <div className="h-3 w-3/4 rounded-full shimmer-line" />
      </div>

      {/* Rotating School Micro-Tip */}
      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-white/80 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/70 text-xs text-slate-600 dark:text-slate-300">
        <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-slate-800 dark:text-slate-100">Шпаргалка на 5+: </span>
          {SCHOOL_FACTS[tipIdx]}
        </div>
      </div>
    </div>
  );
}
