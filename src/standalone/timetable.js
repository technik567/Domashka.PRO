export const MAX_LESSONS = 9;
export const DEFAULT_BELLS = Object.freeze({
  firstStart: '08:30', lessonMin: 45, lessonCount: 9,
  breaks: Object.freeze([10, 15, 20, 15, 10, 10, 10, 10]),
});

function boundedInteger(value, fallback, min, max) {
  const n = value === '' || value === null ? NaN : Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

// Old seven-period configurations keep all their values; new slots are appended.
export function normalizeBells(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  return {
    firstStart: /^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.firstStart) ? cfg.firstStart : DEFAULT_BELLS.firstStart,
    lessonMin: boundedInteger(cfg.lessonMin, 45, 15, 90),
    lessonCount: boundedInteger(cfg.lessonCount, MAX_LESSONS, 1, MAX_LESSONS),
    breaks: Array.from({ length: MAX_LESSONS - 1 }, (_, i) =>
      boundedInteger(Array.isArray(cfg.breaks) ? cfg.breaks[i] : undefined, DEFAULT_BELLS.breaks[i], 0, 60)),
  };
}

export function normalizeTimetable(raw, defaults, subjectIds) {
  return Object.fromEntries(Object.entries(defaults).map(([day, original]) => {
    const source = Array.isArray(raw?.[day]) ? raw[day] : original;
    return [day, Array.from({ length: MAX_LESSONS }, (_, i) => subjectIds.includes(source[i]) ? source[i] : '')];
  }));
}

export function buildBellRows(raw) {
  const cfg = normalizeBells(raw);
  const [h, m] = cfg.firstStart.split(':').map(Number);
  let current = h * 60 + m;
  const format = (total) => `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  return Array.from({ length: cfg.lessonCount }, (_, i) => {
    const start = current;
    const end = start + cfg.lessonMin;
    const breakAfter = i < cfg.lessonCount - 1 ? cfg.breaks[i] : 0;
    current = end + breakAfter;
    return { num: i + 1, start, end, startStr: format(start), endStr: format(end), breakAfter };
  });
}
