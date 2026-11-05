// A shared card is stored once, with an explicit applicable grade interval; it is
// not cloned for each class. These are compact study notes, not official curricula.
export function makeStudyPack(subject, minGrade, maxGrade, source) {
  const stageId = minGrade <= 2 ? '1-2' : minGrade <= 4 ? '3-4' : minGrade <= 6 ? '5-6' : minGrade >= 10 ? '10-11' : String(minGrade);
  return source.trim().split('\n').filter((line) => line.trim()).map((line, index) => {
    const delimiter = line.indexOf(' | ');
    if (delimiter < 1) throw new Error(`Invalid reference row: ${subject}/${minGrade}/${index}`);
    const title = line.slice(0, delimiter).trim(); const body = line.slice(delimiter + 3).trim();
    if (body.length < 55) throw new Error(`Reference explanation too short: ${title}`);
    return { id: `v4-${subject}-${minGrade}-${index + 1}`, subject, minGrade, maxGrade, gradeOrder: minGrade, stageId,
      grades: minGrade === maxGrade ? `${minGrade} класс` : `${minGrade}–${maxGrade} классы`,
      title, tags: `${title} ${subject} ${minGrade} ${maxGrade}`, content: `### ${title}\n\n${body}`,
      samplePrompt: `Объясни тему «${title}» на понятном примере с учётом моего класса. Сначала предложи мне сделать один шаг самостоятельно.`,
    };
  });
}
