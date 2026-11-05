import policy from '../../shared/tutor-policy.json';

export function buildTutorSystemPrompt({ grade = 8, subject = 'школьный предмет' } = {}) {
  const g = Math.max(1, Math.min(11, Number(grade) || 8));
  return policy.instruction
    .replace('{grade}', String(g))
    .replace('{subject}', String(subject))
    .replace('{ageRules}', g <= 4 ? policy.primary : g <= 9 ? policy.middle : policy.senior);
}

// Never use the exact solver/ready-made cheat-sheet fallback in tutor mode.
export function offlineTutorReply(messages = []) {
  const isFollowup = messages.some((message) => message.role === 'assistant');
  return {
    text: isFollowup
      ? 'Облачный репетитор сейчас недоступен, поэтому я пока не могу проверить твой шаг. Сверь его с условием и вспомни правило, которое использовал. Как можно проверить этот шаг самостоятельно?'
      : 'Облачный репетитор сейчас недоступен. Начнём самостоятельно: прочитай условие и отдели то, что уже известно, от того, что нужно найти или объяснить. Что требуется сделать в этом задании?',
    used: 'Локальная учебная подсказка (без проверки ИИ)',
  };
}

export function tutorFollowupQuestion(action, grade) {
  const prompts = {
    board_prep: 'Задай один вопрос на понимание, как у доски. Не подсказывай ответ: дождись моей попытки.',
    similar_task: `Предложи одну небольшую похожую задачу для ${grade} класса. Только условие и один наводящий вопрос, без решения и ответа.`,
    simpler: 'Объясни правило текущего шага проще и задай один наводящий вопрос. Не решай задание за меня.',
    explain_rules: 'Помоги вспомнить правило для моего текущего шага. Дай одну подсказку без готового ответа.',
    next_hint: 'Дай одну следующую подсказку, но не вычисляй результат за меня.',
  };
  return prompts[action];
}
