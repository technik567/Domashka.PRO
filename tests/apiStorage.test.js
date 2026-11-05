import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { api, chatStore, getStudentStats } from '../src/api';
import { setTutorModeEnabled } from '../src/standalone/parentalControl';
import * as aiClient from '../src/standalone/aiClient';
import * as vision from '../src/standalone/visionEngine';

const controller = () => new AbortController();
const request = { grade: 4, examGoal: 'fgos', subject: 'math', mode: 'notebook', taskText: 'x + 2 = 5', provider: 'builtin' };

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  await chatStore.clearAll();
});

describe('API + history', () => {
  it('saves and restores ALL attached photographs', async () => {
    vi.spyOn(aiClient, 'generateAiBrowser').mockResolvedValue({ text: 'Результат', used: 'mock' });
    vi.spyOn(vision, 'recognizeHomeworkPhoto').mockResolvedValue({ text: 'условие с фото', engine: 'mock' });
    const photos = ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'];
    const result = await api.solveHomework({ ...request, imageBase64: photos[0], imagesList: photos });
    expect(result.ok).toBe(true);
    expect((await chatStore.get(result.id)).images_b64).toEqual(photos);
    expect(vision.recognizeHomeworkPhoto).toHaveBeenCalledTimes(2);
  });
  it('forces child requests into tutor mode and never returns an exact answer badge', async () => {
    await setTutorModeEnabled(true, 'parent-password');
    const generate = vi.spyOn(aiClient, 'generateAiBrowser').mockResolvedValue({ text: 'Каким будет первый шаг?', used: 'mock' });
    const result = await api.solveHomework({ ...request, mode: 'creative' });
    expect(result.ok).toBe(true);
    expect(result.sympyBadge).toBe('');
    expect(generate.mock.calls[0][0]).toMatchObject({ fallbackMode: 'tutor' });
    const record = await chatStore.get(result.id);
    expect(record).toMatchObject({ tutor_only: true, mode: 'tutor', sympy_badge: '' });
    await api.chatFollowup({ ...request, historyId: result.id, messages: result.messages, action: 'board_prep' });
    const followup = generate.mock.calls[1][0];
    expect(followup.messages.filter((message) => message.role === 'user').at(-1).content).toContain('Не подсказывай ответ');
    expect(followup.fallbackMode).toBe('tutor');
  });
  it('blocks alternate answer generators and old conversations while child mode is enabled', async () => {
    const old = await chatStore.saveNew({ response_md: 'Готовое решение' });
    await setTutorModeEnabled(true, 'parent-password');
    expect((await api.checkDraft({ draftText: 'test' })).ok).toBe(false);
    expect((await api.generateQuiz({})).ok).toBe(false);
    expect((await api.generateExamVariant({})).ok).toBe(false);
    expect((await api.generateMistakeDrill({})).ok).toBe(false);
    expect((await api.runExactTool({ tool: 'algebra', input: 'x=5' })).ok).toBe(false);
    expect((await api.chatFollowup({ ...request, historyId: old.id, action: 'question', question: 'Дай ответ' })).ok).toBe(false);
  });
  it('does not save cancelled solutions even if a service returns late', async () => {
    const ctrl = controller();
    vi.spyOn(aiClient, 'generateAiBrowser').mockImplementation(async () => { ctrl.abort(); return { text: 'stale', used: 'mock' }; });
    const result = await api.solveHomework({ ...request, signal: ctrl.signal });
    expect(result.aborted).toBe(true);
    expect(await chatStore.list()).toHaveLength(0);
  });
  it('counts a checked work once, not twice', async () => {
    vi.spyOn(aiClient, 'generateAiBrowser').mockResolvedValue({ text: 'Замечания', used: 'mock' });
    await api.checkDraft({ grade: 4, draftText: 'Это моя работа.', checkType: 'general' });
    expect(getStudentStats().checkedCount).toBe(1);
  });
  it('retains a direct-Vision photo in later conversation turns', async () => {
    const original = await chatStore.saveNew({ image_b64: 'data:image/png;base64,AAAA', response_md: 'hint' });
    const generate = vi.spyOn(aiClient, 'generateAiBrowser').mockResolvedValue({ text: 'next hint', used: 'mock' });
    await api.chatFollowup({ ...request, historyId: original.id, messages: [{ role: 'user', content: 'Фото' }], action: 'question', question: 'Как начать?' });
    expect(generate.mock.calls[0][0].imageB64).toBe('data:image/png;base64,AAAA');
  });
  it('does not trust an imported tutor-only flag', async () => {
    await chatStore.importJson(JSON.stringify({ items: [{ id: 'imported', response_md: 'Ответ', tutor_only: true }] }));
    expect((await chatStore.get('imported')).tutor_only).toBe(false);
  });
  it('generates unique chat identifiers even within the same millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345);
    const items = await Promise.all(Array.from({ length: 20 }, () => chatStore.saveNew({ response_md: 'text' })));
    expect(new Set(items.map((item) => item.id)).size).toBe(20);
  });
});
