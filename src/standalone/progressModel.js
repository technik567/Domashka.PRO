const PHASES = { prepare: 0, vision: 1, thinking: 2, cloud: 2, queue: 2, streaming: 2, format: 3, saving: 3, done: 4 };

// Time can animate ONLY the active phase, never complete a task or advance phases.
export function buildProgressSteps(status, hasPhoto, phaseElapsedMs = 0) {
  const phase = PHASES[status?.stage] ?? 0;
  const steps = [
    { id: 'prepare', phase: 0, label: 'Подготовка условия и настроек' },
    ...(hasPhoto ? [{ id: 'vision', phase: 1, label: status?.photoInputUsed === 'vision' ? 'Подготовка фото для Vision' : 'Подготовка / OCR фотографий' }] : []),
    { id: 'answer', phase: 2, label: 'Получение ответа нейросети' },
    { id: 'save', phase: 3, label: 'Обработка и сохранение результата' },
  ];
  return steps.map((step) => {
    const done = step.phase < phase || (step.phase === phase && status?.progress === 100 && status?.estimated === false);
    const active = step.phase === phase && !done;
    const reported = active && Number.isFinite(status?.progress) ? Math.max(0, Math.min(99, status.progress)) : null;
    // An asymptote, not a predicted deadline. Stop at 90% until a real completion event.
    const estimate = Math.min(90, Math.round(5 + 85 * (1 - Math.exp(-Math.max(0, phaseElapsedMs) / 55000))));
    return { ...step, done, active, percent: done ? 100 : active ? (reported ?? estimate) : 0,
      estimated: active && (reported === null || status?.estimated !== false) };
  });
}

// OCR adapters report phase weights, not a provider's internal model progress.
export function ocrProgressLabel(info, index = 0, total = 1) {
  const complete = info?.stage === 'done';
  const percent = complete ? 100 : Math.max(0, Math.min(99, Number(info?.progress) || 0));
  const overall = Math.floor(((index + percent / 100) / Math.max(1, total)) * 100);
  return `${complete ? '' : '≈'}${overall}%${total > 1 ? ' всех фото' : ''} · ${info?.message || 'Распознаём текст и формулы…'}`;
}
