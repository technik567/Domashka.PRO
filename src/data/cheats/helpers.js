export function stageForGrade(g) {
  if (g <= 2) return '1-2';
  if (g <= 4) return '3-4';
  if (g <= 6) return '5-6';
  if (g === 7) return '7';
  if (g === 8) return '8';
  if (g === 9) return '9';
  return '10-11';
}

export function makeSubjectSheets(subject, rawList) {
  return rawList.map((item, idx) => {
    const [minG, maxG, gradesLabel, title, tags, content, customPrompt] = item;
    return {
      id: `v3-${subject}-${minG}-${idx + 1}`,
      gradeOrder: minG,
      minGrade: minG,
      maxGrade: maxG,
      stageId: stageForGrade(minG),
      subject,
      grades: gradesLabel,
      title,
      tags,
      samplePrompt:
        customPrompt ||
        `Разбери понятный школьный пример для ${minG} класса по теме «${title}» и покажи пошаговое решение как в тетради.`,
      content,
    };
  });
}
