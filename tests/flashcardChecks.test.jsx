import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildFlashcardsFromSheets, buildFlashcardChecks, normalizeFlashcardAnswer, flashcardKey } from '../src/standalone/flashcardContent';
import { CHEAT_SHEETS } from '../src/data/referenceData';

const cards=buildFlashcardsFromSheets(CHEAT_SHEETS,100000);
const card=cards.find((item) => item.id==='g3-math-motion-units-b-4');
beforeEach(() => { vi.resetModules(); delete window.__DOMASHKA_CLOUD__; });

describe('short checked flashcards', () => {
  it('provides vetted checks for the entire bank and keys by content, not a reusable display id', () => {
    expect(cards).toHaveLength(1700); expect(cards.every((item) => buildFlashcardChecks(item).length)).toBe(true);
    expect(flashcardKey(card)).toBe(flashcardKey({...card,id:'other'}));
    expect(flashcardKey(card)).not.toBe(flashcardKey({...card,back:'Другой смысл'}));
  });
  it.each([[' сто двадцать! ','120'],['Ёлочка.','елочка'],['0,5','0.5'],['ноль целых пять десятых','0.5'],['одна тысяча','1000'], ['020.500','20.5'], ['минус ноль','0'], ['минус две целых пять сотых','-2.05']])('normalizes typed/dictated %s', (value,expected) => {
    expect(normalizeFlashcardAnswer(value)).toBe(expected);
  });
  it('does not award XP on opening or a wrong answer; grants once on success, including replay', async () => {
    const check=await import('../src/standalone/flashcardCheck'); const storage=await import('../src/standalone/storageEngine');
    const task=await check.beginFlashcardCheck(card); expect(task.answers).toBeUndefined(); expect(storage.getStudentStats().xp).toBe(0);
    expect(await check.answerFlashcardCheck(task.id,'wrong')).toMatchObject({correct:false,awarded:0,remaining:2});
    expect(await check.answerFlashcardCheck(task.id,'сто двадцать')).toMatchObject({correct:true,awarded:4});
    expect(await check.answerFlashcardCheck(task.id,'120')).toMatchObject({correct:true,awarded:4,replayed:true});
    const again=await check.beginFlashcardCheck(card); expect(await check.answerFlashcardCheck(again.id,'120')).toMatchObject({correct:true,awarded:0});
    expect(storage.getStudentStats()).toMatchObject({xp:4,quizCorrect:1});
  });
  it('does not consume a reward if the atomic claim+XP storage write fails', async () => {
    const check=await import('../src/standalone/flashcardCheck'); const storage=await import('../src/standalone/storageEngine');
    const task=await check.beginFlashcardCheck(card); const fail=vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => { throw new Error('quota'); });
    await expect(check.answerFlashcardCheck(task.id,'120')).rejects.toThrow(/сохранить/); expect(storage.getStudentStats().xp).toBe(0);
    fail.mockRestore(); expect(await check.answerFlashcardCheck(task.id,'120')).toMatchObject({awarded:4}); expect(storage.getStudentStats().xp).toBe(4);
  });
  it('serializes simultaneous correct answers for the same content', async () => {
    const check=await import('../src/standalone/flashcardCheck'); const storage=await import('../src/standalone/storageEngine');
    const one=await check.beginFlashcardCheck(card),two=await check.beginFlashcardCheck(card);
    const results=await Promise.all([check.answerFlashcardCheck(one.id,'120'),check.answerFlashcardCheck(two.id,'120')]);
    expect(results.map((x) => x.awarded).sort()).toEqual([0,4]); expect(storage.getStudentStats().xp).toBe(4);
  });
  it('ends after three incorrect attempts and expires stale attempts', async () => {
    const check=await import('../src/standalone/flashcardCheck'); const task=await check.beginFlashcardCheck(card);
    for(let n=0;n<3;n++) await check.answerFlashcardCheck(task.id,'wrong');
    expect(await check.answerFlashcardCheck(task.id,'120')).toMatchObject({correct:false,finished:true,awarded:0});
    const fresh=await check.beginFlashcardCheck(card); const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+600001);
    await expect(check.answerFlashcardCheck(fresh.id,'120')).rejects.toThrow(/устарела/); clock.mockRestore();
  });
  it('opens the short task from «Знаю» and only reports actually awarded XP', async () => {
    const Deck=(await import('../src/components/FlashcardsDeck')).default; const storage=await import('../src/standalone/storageEngine');
    render(<Deck cards={[card]} />); fireEvent.click(screen.getByRole('button',{name:/Знаю/}));
    const input=await screen.findByRole('textbox',{name:/ответ/i}); expect(storage.getStudentStats().xp).toBe(0);
    fireEvent.change(input,{target:{value:'wrong'}}); fireEvent.click(screen.getByRole('button',{name:/Проверить ответ/}));
    await waitFor(() => expect(screen.getByText(/Попыток осталось/)).toBeTruthy()); expect(storage.getStudentStats().xp).toBe(0);
    fireEvent.change(input,{target:{value:'сто двадцать'}}); fireEvent.click(screen.getByRole('button',{name:/Проверить ответ/}));
    await waitFor(() => expect(storage.getStudentStats().xp).toBe(4));
    expect(screen.getByText(/За этот проход: \+4 XP/)).toBeTruthy();
  });
  it('leaves no checked progress when the learner skips instead of answering', async () => {
    const Deck=(await import('../src/components/FlashcardsDeck')).default; const storage=await import('../src/standalone/storageEngine');
    render(<Deck cards={[card]} />); fireEvent.click(screen.getByRole('button',{name:/Пропустить/}));
    expect(screen.getByText(/Действительно начислено:/).textContent).toContain('+0 XP'); expect(storage.getStudentStats().xp).toBe(0);
  });
});

describe('other XP regressions', () => {
  it('does not reward toggling the same diary task repeatedly in React StrictMode', async () => {
    const Diary=(await import('../src/components/DiaryAndGrades')).default; const onEarnXp=vi.fn();
    render(<React.StrictMode><Diary grade={9} onEarnXp={onEarnXp} /></React.StrictMode>);
    const checkbox=screen.getAllByRole('checkbox')[0]; fireEvent.click(checkbox); fireEvent.click(checkbox); fireEvent.click(checkbox);
    expect(onEarnXp).toHaveBeenCalledTimes(1); expect(onEarnXp.mock.calls[0][1]).toMatch(/^diary:/);
  });
  it('counts activity on local calendar dates rather than UTC midnight', async () => {
    const storage=await import('../src/standalone/storageEngine');
    vi.spyOn(Date.prototype,'getFullYear').mockReturnValue(2026); vi.spyOn(Date.prototype,'getMonth').mockReturnValue(10); vi.spyOn(Date.prototype,'getDate').mockReturnValue(7);
    storage.recordStudentActivity('solve'); expect(storage.getStudentStats().lastActiveDate).toBe('2026-11-07');
  });
});
