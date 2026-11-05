import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import katex from 'katex';
import TimetableAndBells from '../src/components/TimetableAndBells';
import AiThinkingCard from '../src/components/AiThinkingCard';
import CheatSheets from '../src/components/CheatSheets';
import { DEFAULT_BELLS, buildBellRows, normalizeBells, normalizeTimetable } from '../src/standalone/timetable';
import { buildProgressSteps, ocrProgressLabel } from '../src/standalone/progressModel';
import { CHEAT_SHEETS, SUBJECTS } from '../src/data/referenceData';
import { cheatCoverage, filterCheatScope, sheetMatchesGrade, subjectsForGrade } from '../src/data/cheatCurriculum';

describe('nine lessons and independent breaks', () => {
  it('migrates seven-slot schedules without losing values', () => {
    const result = normalizeTimetable({ mon: ['math', 'russian', '', '', '', '', 'math'] }, { mon: [] }, ['math', 'russian']);
    expect(result.mon).toHaveLength(9); expect(result.mon[6]).toBe('math'); expect(result.mon.slice(7)).toEqual(['', '']);
    expect(normalizeBells({ firstStart: '09:15', breaks: [0, 2, 3, 4, 5, 6] })).toMatchObject({ firstStart: '09:15', lessonCount: 9, breaks: [0, 2, 3, 4, 5, 6, 10, 10] });
  });
  it('validates corrupted preferences and preserves zero-length breaks', () => {
    const cfg = normalizeBells({ firstStart: '66:99', lessonCount: 40, lessonMin: NaN, breaks: [0, -10, 200, 'bad', null, 1.7] });
    expect(cfg).toMatchObject({ firstStart: '08:30', lessonCount: 9, lessonMin: 45 });
    expect(cfg.breaks).toEqual([0, 0, 60, 15, 10, 2, 10, 10]);
    expect(normalizeBells({ breaks: {} }).breaks).toEqual(DEFAULT_BELLS.breaks);
    expect(buildBellRows({ firstStart: '23:40', lessonMin: 45, lessonCount: 1 })[0].endStr).toBe('00:25');
  });
  it('each break changes only subsequent lessons, including the ninth', () => {
    const original = buildBellRows(DEFAULT_BELLS);
    for (let index = 0; index < 8; index++) {
      const breaks = [...DEFAULT_BELLS.breaks]; breaks[index] += 7;
      const next = buildBellRows({ ...DEFAULT_BELLS, breaks });
      for (let lesson = 0; lesson < 9; lesson++) expect(next[lesson].start - original[lesson].start).toBe(lesson > index ? 7 : 0);
    }
  });
  it('edits and persists all eight breaks in the real timetable', () => {
    const view = render(<TimetableAndBells />);
    expect(screen.getByLabelText('Количество уроков').value).toBe('9');
    expect(screen.getAllByRole('spinbutton')).toHaveLength(8);
    fireEvent.change(screen.getByLabelText('Перемена после 1-го урока'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Перемена после 8-го урока'), { target: { value: '30' } });
    expect(screen.getByText('09:20 – 10:05')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Количество уроков'), { target: { value: '7' } });
    expect(screen.getAllByRole('spinbutton')).toHaveLength(6);
    fireEvent.change(screen.getByLabelText('Количество уроков'), { target: { value: '9' } });
    expect(screen.getByLabelText('Перемена после 8-го урока').value).toBe('30');
    view.unmount(); render(<TimetableAndBells />);
    expect(screen.getByLabelText('Перемена после 1-го урока').value).toBe('5');
    expect(screen.getByLabelText('Перемена после 8-го урока').value).toBe('30');
  });
});

describe('honest progress phases', () => {
  it('time can never complete the model or saving stages', () => {
    const steps = buildProgressSteps({ stage: 'cloud' }, false, 10000000);
    expect(steps.map((s) => [s.id, s.done, s.percent])).toEqual([['prepare', true, 100], ['answer', false, 90], ['save', false, 0]]);
    expect(steps[1].estimated).toBe(true);
  });
  it('OCR reports only its active progress; saving starts only on an event', () => {
    const steps = buildProgressSteps({ stage: 'vision', progress: 50, estimated: false }, true, 5000);
    expect(steps.find((s) => s.id === 'vision')).toMatchObject({ percent: 50, active: true, done: false, estimated: false });
    expect(steps.find((s) => s.id === 'answer').percent).toBe(0);
    expect(buildProgressSteps({ stage: 'format' }, false).at(-1)).toMatchObject({ active: true, done: false });
    expect(buildProgressSteps({ stage: 'done' }, true).every((s) => s.done && s.percent === 100)).toBe(true);
  });
  it('marks a completed photo phase only on a genuine completion event', () => {
    expect(buildProgressSteps({ stage: 'vision', progress: 100, estimated: false }, true)[1]).toMatchObject({ done: true, percent: 100 });
    expect(buildProgressSteps({ stage: 'vision', progress: 100, estimated: true }, true)[1]).toMatchObject({ done: false, percent: 99 });
    expect(ocrProgressLabel({ stage: 'cloud', progress: 42 }, 1, 4)).toMatch(/^≈35% всех фото/);
    expect(ocrProgressLabel({ stage: 'done', progress: 100 }, 0, 4)).toMatch(/^25% всех фото/);
    expect(ocrProgressLabel({ stage: 'done', progress: 100 }, 3, 4)).toMatch(/^100% всех фото/);
  });
  it('the displayed checklist cannot tick everything during a long request', () => {
    vi.useFakeTimers(); const view = render(<AiThinkingCard status={{ stage: 'cloud', message: 'Waiting' }} />);
    act(() => vi.advanceTimersByTime(120000));
    expect(screen.getByTestId('progress-answer').dataset.state).toBe('active');
    expect(screen.getByTestId('progress-save').dataset.state).toBe('pending');
    expect(within(screen.getByTestId('progress-answer')).getByRole('progressbar').getAttribute('aria-valuenow')).not.toBe('100');
    expect(screen.getByText(/оценка ожидания, не внутренний прогресс/)).toBeTruthy();
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('strict grade reference and curriculum coverage', () => {
  it.each(Array.from({ length: 11 }, (_, i) => i + 1))('filters every selected grade, including %s, without out-of-range cards', (grade) => {
    const mine = filterCheatScope(CHEAT_SHEETS, { grade, gradeFilter: 'my' });
    const explicit = filterCheatScope(CHEAT_SHEETS, { grade: 8, gradeFilter: String(grade) });
    expect(mine.length).toBeGreaterThan(0); expect(explicit).toEqual(mine);
    expect(mine.every((s) => sheetMatchesGrade(s, grade) && subjectsForGrade(grade).includes(s.subject))).toBe(true);
  });
  it('keeps grade, subject and bookmarks scoped together', () => {
    const math = filterCheatScope(CHEAT_SHEETS, { grade: 9, subject: 'math' });
    expect(math.every((s) => s.subject === 'math' && s.minGrade <= 9 && s.maxGrade >= 9)).toBe(true);
    const id = math[0].id;
    expect(filterCheatScope(CHEAT_SHEETS, { gradeFilter: 'bookmarks', bookmarks: [id], subject: 'physics' })).toEqual([]);
  });
  it('has at least 25 distinct cards in all 106 applicable grade/subject pairs', () => {
    const coverage = cheatCoverage(CHEAT_SHEETS);
    expect(coverage.flatMap((row) => Object.values(row.subjects))).toHaveLength(106);
    for (const row of coverage) for (const [subject, count] of Object.entries(row.subjects)) {
      expect(count, `${row.grade}/${subject}`).toBeGreaterThanOrEqual(25);
    }
    expect(coverage[0].subjects.chemistry).toBeUndefined(); expect(coverage[10].subjects.world).toBeUndefined();
    expect(CHEAT_SHEETS).toHaveLength(1263);
  });
  it('adds real nonempty notes without duplicate IDs or cloned contents and with valid math', () => {
    expect(new Set(CHEAT_SHEETS.map((s) => s.id)).size).toBe(CHEAT_SHEETS.length);
    const added = CHEAT_SHEETS.filter((s) => s.id.startsWith('v4-'));
    expect(added).toHaveLength(563); expect(new Set(added.map((s) => s.content)).size).toBe(added.length);
    let formulas = 0;
    for (const sheet of added) {
      expect(SUBJECTS.some((s) => s.id === sheet.subject)).toBe(true);
      expect(sheet.minGrade).toBeLessThanOrEqual(sheet.maxGrade);
      expect(sheet.content.length).toBeGreaterThan(70);
      expect(sheet.content).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
      for (const formula of sheet.content.matchAll(/\$([^$]+)\$/g)) {
        expect(() => katex.renderToString(formula[1], { throwOnError: true, strict: 'error' }), sheet.id).not.toThrow(); formulas++;
      }
    }
    expect(formulas).toBe(250);
  });
  it('does not silently widen a failed grade/subject search; widening requires a click', () => {
    render(<CheatSheets grade={9} />);
    expect(screen.getByRole('heading', { name: /9 класс · выбранные/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Физика.*\(/ }));
    fireEvent.change(screen.getByPlaceholderText(/Поиск: падежи/), { target: { value: 'Правило незнакомых растений и грибов' } });
    expect(screen.queryByRole('button', { name: 'Правило незнакомых растений и грибов' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Искать по всем классам и предметам' }));
    expect(screen.getByRole('button', { name: 'Правило незнакомых растений и грибов' })).toBeTruthy();
  });
});
