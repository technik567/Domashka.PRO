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
    expect(vision.recognizeHomeworkPhoto).not.toHaveBeenCalled();
    expect(aiClient.generateAiBrowser.mock.calls[0][0].images).toEqual(photos);
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
  it.each(['auto', 'vision'])('does not inject stale OCR math into a native-image %s request', async (photoMode) => {
    const generate = vi.spyOn(aiClient, 'generateAiBrowser').mockResolvedValue({ text: 'Вижу рисунок', used: 'mock', photoInputUsed: 'vision' });
    const result = await api.solveHomework({ ...request, taskText: '', imagesList: ['data:image/png;base64,AAAA'], photoMode, ocrText: 'x = 1234' });
    expect(result.ok).toBe(true); expect(result.sympyBadge).toBe('');
    expect(generate.mock.calls[0][0].systemPrompt).not.toContain('1234');
    expect(generate.mock.calls[0][0].ocrText).toBe('');
  });
  it('round-trips all native images and mode through backup and strict follow-up', async () => {
    const photos = ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'];
    const generate = vi.spyOn(aiClient, 'generateAiBrowser').mockResolvedValue({ text: 'Подсказка', used: 'mock', photoInputUsed: 'vision' });
    const solved = await api.solveHomework({ ...request, imagesList: photos, photoMode: 'vision' });
    expect(solved.photoInputUsed).toBe('vision');
    const backup = await chatStore.exportJson();
    await chatStore.clearAll(); await chatStore.importJson(backup);
    const restored = await chatStore.get(solved.id);
    expect(restored).toMatchObject({ images_b64: photos, photo_mode: 'vision', photo_input_used: 'vision' });
    // An incidental OCR field must not cause a saved diagram to disappear from native follow-ups.
    await chatStore.update(solved.id, { ocr_text: 'старое распознавание' });
    await api.chatFollowup({ ...request, historyId: solved.id, messages: solved.messages, action: 'question', question: 'А второй рисунок?' });
    expect(generate.mock.calls.at(-1)[0]).toMatchObject({ images: photos, photoMode: 'vision' });
  });
  it('saves native images and mode for draft checking, not just solving', async () => {
    const photos = ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'];
    vi.spyOn(aiClient, 'generateAiBrowser').mockResolvedValue({ text: 'Комментарий к схеме', used: 'mock', photoInputUsed: 'vision' });
    const checked = await api.checkDraft({ grade: 6, conditionText: 'Проверь схему', imagesList: photos, photoMode: 'vision', checkType: 'general' });
    expect(checked.ok).toBe(true);
    expect(await chatStore.get(checked.id)).toMatchObject({ images_b64: photos, photo_mode: 'vision', photo_input_used: 'vision' });
  });
  it('refuses to downgrade a saved Vision conversation to a text-only gateway', async () => {
    const original = await chatStore.saveNew({ images_b64: ['data:image/png;base64,AAAA'], photo_input_used: 'vision', photo_mode: 'auto', response_md: 'Подсказка' });
    const ocr = vi.spyOn(vision, 'recognizeHomeworkPhoto');
    const result = await api.chatFollowup({ ...request, model: 'pollinations', historyId: original.id, messages: [{ role: 'user', content: 'Схема' }], action: 'question', question: 'Что дальше?' });
    expect(result.ok).toBe(false); expect(result.error).toContain('не настроена');
    expect(fetch).not.toHaveBeenCalled(); expect(ocr).not.toHaveBeenCalled();
  });
  it('normalizes untrusted photo-mode fields during import', async () => {
    await chatStore.importJson(JSON.stringify({ items: [{ id: 'bad-photo-mode', response_md: 'Ответ', photo_mode: 'unexpected', photo_input_used: '<script>' }] }));
    expect(await chatStore.get('bad-photo-mode')).toMatchObject({ photo_mode: 'auto', photo_input_used: 'none' });
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
