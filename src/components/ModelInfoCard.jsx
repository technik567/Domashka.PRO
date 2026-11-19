import React from 'react';
import { getModelProfile, RATINGS_NOTE } from '../standalone/modelProfiles';

const dimensions = [
  { label: 'Мощность', color: 'bg-violet-500', hint: 'Условная пригодность для сложных задач.' },
  { label: 'Скорость', color: 'bg-emerald-500', hint: 'Больше кружков — ожидается более быстрый ответ, не замер задержки сервиса.' },
  { label: 'Понимание', color: 'bg-sky-500', hint: 'Условная пригодность для контекста и объяснений, не объективное измерение интеллекта.' },
];

export default function ModelInfoCard({ provider, model, entry, showNote = true, profile: providedProfile }) {
  const profile = providedProfile || getModelProfile(provider, model, entry);
  return <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 p-3 space-y-2.5 min-w-0">
    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300 break-words">{profile.description}</p>
    <div className="grid gap-1.5">
      {dimensions.map((dimension, index) => {
        const score = profile.ratings[index];
        const text = score == null ? (profile.variable ? 'зависит от выбора' : 'нет оценки') : `${score}/5`;
        return <div key={dimension.label} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" title={dimension.hint} aria-label={`${dimension.label}: ${text}`}>
          <span className="w-[85px] font-semibold text-slate-700 dark:text-slate-200">{dimension.label}</span>
          <span aria-hidden="true" className="inline-flex gap-1">{Array.from({ length: 5 }, (_, dot) => <span key={dot} className={`w-2.5 h-2.5 rounded-full border ${score != null && dot < score ? `${dimension.color} border-transparent` : 'bg-transparent border-slate-300 dark:border-slate-600'}`} />)}</span>
          <span className="text-slate-500 dark:text-slate-400">{text}</span>
        </div>;
      })}
    </div>
    {profile.sourceUrl && <div className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400 space-y-1">
      <p className="font-semibold">{profile.maxImages ? 'Текст + одно фото напрямую' : 'Только текст · для фото нужен OCR'}</p>
      <p>Публичное демо Hugging Face · без ключа и внешнего аккаунта, в пределах анонимной квоты. Есть очередь; доступ не гарантирован.</p>
      <a href={profile.sourceUrl} target="_blank" rel="noreferrer" className="underline break-all">Площадка: {profile.sourceName}</a>
    </div>}
    {showNote && <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">{RATINGS_NOTE}</p>}
  </div>;
}
