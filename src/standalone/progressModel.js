const PHASES = { prepare: 0, search: 0.5, vision: 1, thinking: 2, cloud: 2, queue: 2, streaming: 2, format: 3, saving: 3, done: 4 };

// Provider calls have no measurable completion percentage or ETA. Only real
// lifecycle events change the checklist; elapsed time is a separate stopwatch.
export function buildProgressSteps(status, hasPhoto) {
  const phase = PHASES[status?.stage] ?? 0;
  const steps = [
    { id: 'prepare', phase: 0, label: 'Подготовка условия и настроек' },
    ...(status?.stage === 'search' ? [{ id:'search', phase:0.5, label:'Получение источников из интернета' }] : []),
    ...(hasPhoto ? [{ id: 'vision', phase: 1, label: status?.photoInputUsed === 'vision' ? 'Подготовка фото для Vision' : 'Подготовка / OCR фотографий' }] : []),
    { id: 'answer', phase: 2, label: 'Получение ответа нейросети' },
    { id: 'save', phase: 3, label: 'Обработка и сохранение результата' },
  ];
  return steps.map((step) => {
    const done = step.phase < phase || (step.phase === phase && status?.progress === 100 && status?.estimated === false);
    return { ...step, done, active: step.phase === phase && !done };
  });
}

export function ocrProgressLabel(info, index = 0, total = 1) {
  const count = Math.max(1, Math.trunc(Number(total) || 1));
  const position = Math.max(1, Math.min(count, Math.trunc(Number(index) || 0) + 1));
  return `${count > 1 ? `Фото ${position} из ${count} · ` : ''}${info?.message || (info?.stage === 'done' ? 'Текст получен' : 'Распознаём текст и формулы…')}`;
}
