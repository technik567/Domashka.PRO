// Default browsing coverage, not an official timetable. Schools may introduce subjects
// at different times (especially informatics, social studies and project work).
export const SUBJECT_GRADE_RANGES = {
  math: [1, 11], russian: [1, 11], literature: [1, 11], english: [2, 11],
  world: [1, 4], geometry: [7, 11], physics: [7, 11], chemistry: [8, 11],
  informatics: [5, 11], history: [5, 11], social: [6, 11], biology: [5, 11],
  geography: [5, 11], project: [1, 11],
};
export function subjectsForGrade(grade) {
  return Object.entries(SUBJECT_GRADE_RANGES).filter(([, [min, max]]) => grade >= min && grade <= max).map(([subject]) => subject);
}
export function sheetMatchesGrade(sheet, grade) {
  const n = Number(grade);
  return Number.isInteger(n) && n >= 1 && n <= 11 && n >= sheet.minGrade && n <= sheet.maxGrade;
}
export function sheetGradeLabel(sheet) {
  return sheet.minGrade === sheet.maxGrade ? `${sheet.minGrade} класс` : `${sheet.minGrade}–${sheet.maxGrade} классы`;
}
export function filterCheatScope(sheets, { gradeFilter = 'my', grade = 7, subject = 'all', bookmarks = [] } = {}) {
  return sheets.filter((sheet) => (subject === 'all' || sheet.subject === subject) &&
    (gradeFilter === 'all' ? true : gradeFilter === 'bookmarks' ? bookmarks.includes(sheet.id)
      : sheetMatchesGrade(sheet, gradeFilter === 'my' ? grade : gradeFilter) && subjectsForGrade(Number(gradeFilter === 'my' ? grade : gradeFilter)).includes(sheet.subject)));
}
export function cheatCoverage(sheets) {
  return Array.from({ length: 11 }, (_, i) => ({ grade: i + 1,
    subjects: Object.fromEntries(subjectsForGrade(i + 1).map((subject) => [subject,
      new Set(sheets.filter((s) => s.subject === subject && sheetMatchesGrade(s, i + 1)).map((s) => s.id)).size])),
  }));
}
