export const SYNC_PREFS = Object.freeze([
  'domashka_pro_student_profile_v2', 'domashka_pro_theme_v3', 'domashka_cheat_bookmarks_v21',
  'domashka_diary_tasks_v21', 'domashka_subject_grades_v22', 'domashka_grade_round_frac_v22',
  'domashka_timetable_v30', 'domashka_bells_v30', 'domashka_mistake_bank_v32',
]);
export const isSyncPreference = (key) => SYNC_PREFS.includes(key);
export const isDocumentKey = (key) => typeof key === 'string' && (key.startsWith('pref/') && isSyncPreference(key.slice(5)) || /^chat\/[A-Za-z0-9_-]{1,128}$/.test(key));
export const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
export function assertDocument(key, value) {
  if (!isDocumentKey(key)) throw new Error('Этот тип данных не входит в синхронизацию.');
  if (value === null) return;
  if (key.startsWith('pref/')) {
    if (typeof value !== 'string') throw new Error('Повреждён раздел настроек.');
    if (key !== 'pref/domashka_pro_theme_v3') JSON.parse(value);
  } else if (!value || typeof value !== 'object' || String(value.id) !== key.slice(5) || typeof value.response_md !== 'string') {
    throw new Error('Повреждена запись тетради.');
  }
}
export const EMPTY_STATS = Object.freeze({ xp: 0, earnedXp: 0, importedXp: 0, legacyImported: false,
  solvedCount: 0, checkedCount: 0, quizCorrect: 0, streakDays: 0, lastActiveDate: '', version: 0 });

export function assertServerStats(stats) {
  if (!stats || ['xp','solvedCount','checkedCount','quizCorrect','version'].some((key) => !Number.isSafeInteger(stats[key]) || stats[key] < 0)) throw new Error('Сервер не подтвердил учебную статистику. Очередь сохранена.');
}
