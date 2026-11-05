import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

const parentPassword = 'Parent_test_password_42';
const childPassword = 'Child_test_password_42';
async function fresh() { vi.resetModules(); return import('../src/standalone/accounts'); }
async function firstParent(accounts, overrides = {}) {
  const challenge = accounts.issueParentChallenge();
  return accounts.createAccount({ role: 'parent', login: 'parent', name: 'Тестовый родитель', password: parentPassword,
    challengeId: challenge.id, challengeAnswer: String(Math.sqrt(challenge.square)), ...overrides });
}
async function family() {
  let accounts = await fresh(); await firstParent(accounts); accounts = await fresh();
  const parent = accounts.getCurrentAccount();
  const child = await accounts.createAccount({ role: 'child', login: 'student', name: 'Тестовый ученик', password: childPassword, age: 15, grade: 9 });
  return { accounts, parent, child };
}
// A new module instance models a separate page/tab. The previously returned service
// keeps its original boot session, exactly as a real second tab would.
async function signIn(login, password) {
  const entering = await fresh(); await entering.loginAccount(login, password); return fresh();
}
beforeEach(() => { vi.resetModules(); sessionStorage.clear(); vi.stubGlobal('indexedDB', new IDBFactory()); });

describe('local family authentication', () => {
  it('requires the parent challenge and cannot register a first child', async () => {
    const accounts = await fresh();
    await expect(accounts.createAccount({ role: 'child', login: 'student', password: childPassword, name: 'Ученик' })).rejects.toThrow(/Сначала.*родительский/);
    const challenge = accounts.issueParentChallenge();
    await expect(accounts.createAccount({ role: 'parent', login: 'parent', password: parentPassword, name: 'Родитель', challengeId: challenge.id, challengeAnswer: '-1' })).rejects.toThrow(/математический вопрос/);
    expect(accounts.getAccountGate().configured).toBe(false);
  });
  it('keeps simultaneous challenge instances valid (including StrictMode initializers)', async () => {
    const accounts = await fresh(); const challenge = accounts.issueParentChallenge(); accounts.issueParentChallenge();
    await accounts.createAccount({ role: 'parent', login: 'parent', name: 'Родитель', password: parentPassword,
      challengeId: challenge.id, challengeAnswer: String(Math.sqrt(challenge.square)) });
    expect(accounts.getAccountGate().configured).toBe(true);
  });
  it('locks malformed sessions, invitations and an empty stored registry', async () => {
    const { accounts } = await family(); const original = localStorage.getItem(accounts.ACCOUNTS_KEY);
    for (const patch of [{ sessions: [{ id: 'bad' }] }, { invitations: [{ childId: 'bad' }] }, { accounts: [] }, { revision: -1 }]) {
      localStorage.setItem(accounts.ACCOUNTS_KEY, JSON.stringify({ ...JSON.parse(original), ...patch }));
      expect(accounts.getAccountGate()).toMatchObject({ configured: true, account: null });
      expect(accounts.getAccountGate().error).toContain('повреждена');
    }
  });
  it('hashes passwords with individual salts and never returns hashes or passwords to UI', async () => {
    const { accounts, parent, child } = await family();
    const stored = JSON.parse(localStorage.getItem(accounts.ACCOUNTS_KEY));
    expect(stored.accounts).toHaveLength(2);
    expect(stored.accounts.every((a) => a.auth.hash.length === 64 && a.auth.salt.length === 32 && a.auth.iterations === 310000)).toBe(true);
    expect(stored.accounts[0].auth.salt).not.toBe(stored.accounts[1].auth.salt);
    expect(JSON.stringify(stored)).not.toContain(parentPassword); expect(JSON.stringify(stored)).not.toContain(childPassword);
    expect(parent.auth).toBeUndefined(); expect(child.auth).toBeUndefined();
    expect(JSON.stringify(accounts.getAccountGate())).not.toContain(stored.accounts[0].auth.hash);
  });
  it('requires the legacy guardian password even when adding a new family', async () => {
    const legacy = await import('../src/standalone/parentalControl'); await legacy.setTutorModeEnabled(true, 'Legacy_guardian_42');
    const accounts = await import('../src/standalone/accounts');
    await expect(firstParent(accounts, { legacyPassword: 'wrong' })).rejects.toThrow(/Неверный/);
    expect(accounts.getAccountGate().configured).toBe(false);
    await firstParent(accounts, { legacyPassword: 'Legacy_guardian_42' });
    expect(JSON.parse(localStorage.getItem('domashka_parental_control_v1')).enabled).toBe(true);
  });
  it('treats a corrupted account registry as locked, not as an empty family', async () => {
    const accounts = await fresh(); localStorage.setItem(accounts.ACCOUNTS_KEY, '{corrupt');
    expect(accounts.getAccountGate()).toMatchObject({ configured: true, account: null });
    expect(accounts.getAccountGate().error).toContain('повреждена');
    await expect(firstParent(accounts)).rejects.toThrow(/повреждена/);
  });
  it('rejects quota failures rather than claiming the account was created', async () => {
    const accounts = await fresh(); const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === accounts.ACCOUNTS_KEY) throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    });
    await expect(firstParent(accounts)).rejects.toThrow(/Не удалось сохранить/);
    expect(localStorage.getItem(accounts.ACCOUNTS_KEY)).toBeNull();
  });
  it('rate limits repeated wrong passwords and supports correct login after the delay', async () => {
    await family(); const entering = await fresh();
    for (let i = 0; i < 5; i++) await expect(entering.loginAccount('parent', 'wrong')).rejects.toThrow(/Неверный/);
    await expect(entering.loginAccount('parent', parentPassword)).rejects.toThrow(/Подождите/);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31000);
    await entering.loginAccount('PARENT', parentPassword);
    const next = await fresh(); expect(next.getCurrentAccount().login).toBe('parent');
  });
  it('an authenticated child cannot create a parent or edit protected settings', async () => {
    await family(); const childAccounts = await signIn('student', childPassword);
    const challenge = childAccounts.issueParentChallenge();
    await expect(childAccounts.createAccount({ role: 'parent', login: 'bypass', name: 'Bypass', password: parentPassword,
      challengeId: challenge.id, challengeAnswer: String(Math.sqrt(challenge.square)) })).rejects.toThrow(/родительский аккаунт/);
    const parental = await import('../src/standalone/parentalControl');
    expect(parental.getParentalStatus()).toMatchObject({ enabled: true, managed: true });
    await expect(parental.setTutorModeEnabled(false, childPassword)).rejects.toThrow(/Режим ученика меняет родитель/);
    const api = await import('../src/api'); expect(() => api.saveAiSettings({ provider: 'custom' })).toThrow(/Настройки ИИ для ученика/);
    expect(api.saveStudentProfile({ grade: 1 }).grade).toBe(9);
  });
  it('password change keeps role/links and revokes the old credential and old session', async () => {
    const { accounts, child } = await family();
    const childAccounts = await signIn('student', childPassword);
    await childAccounts.changeAccountPassword(childPassword, 'Changed_child_password_42');
    const next = await fresh(); expect(next.getCurrentAccount()).toMatchObject({ id: child.id, role: 'child', parentIds: [accounts.WORKSPACE_ID] });
    await expect(next.loginAccount('student', childPassword)).rejects.toThrow(/Неверный/);
    expect(accounts.getCurrentAccount().role).toBe('parent');
  });
  it('logout revokes all sessions for that account without erasing study data', async () => {
    const { accounts } = await family();
    const savedSession = sessionStorage.getItem('domashka_session_v4');
    localStorage.setItem(accounts.workspaceKey('private-data'), 'keep');
    accounts.logoutAccount(); expect(accounts.getCurrentAccount()).toBeNull();
    sessionStorage.setItem('domashka_session_v4', savedSession);
    const next = await fresh(); expect(next.getAccountGate()).toMatchObject({ configured: true, account: null });
    expect(localStorage.getItem(accounts.workspaceKey('private-data'))).toBe('keep');
  });
});

describe('workspace isolation and family control', () => {
  it('separates settings, notes, bookmarks and IndexedDB chats for parent and children', async () => {
    const { accounts, child } = await family();
    const parentStore = await import('../src/standalone/storageEngine');
    parentStore.safeStorage.setItem('domashka_cheat_bookmarks_v21', '["parent-only"]');
    await parentStore.chatStore.saveNew({ task_text: 'Parent private task', response_md: 'Parent secret' });
    const originalDb = accounts.workspaceDbName();
    await accounts.loginAccount('student', childPassword);
    const childAccounts = await fresh(); const childStore = await import('../src/standalone/storageEngine');
    expect(childAccounts.workspaceDbName()).not.toBe(originalDb); expect(childAccounts.WORKSPACE_ID).toBe(child.id);
    expect(childStore.safeStorage.getItem('domashka_cheat_bookmarks_v21')).toBeNull(); expect(await childStore.chatStore.list()).toEqual([]);
    parentStore.safeStorage.setItem('late-draft', 'late parent callback');
    expect(childStore.safeStorage.getItem('late-draft')).toBeNull();
    await expect(parentStore.chatStore.saveNew({ response_md: 'late answer' })).rejects.toMatchObject({ name: 'AbortError' });
    await childStore.chatStore.saveNew({ task_text: 'Child task', response_md: 'Child answer' });
    expect((await childStore.chatStore.list()).map((x) => x.task_text)).toEqual(['Child task']);
  });
  it('inherits AI settings only on explicit permission and enforces the parent-set grade', async () => {
    const { accounts, child } = await family();
    const parentApi = await import('../src/api'); parentApi.saveAiSettings({ provider: 'openrouter', openrouterKey: 'test-parent-key-not-real' });
    let childAccounts = await signIn('student', childPassword); let api = await import('../src/api');
    expect(api.loadAiSettings().provider).toBe('builtin');
    accounts.updateChild(child.id, { ...child, tutorOnly: true, allowAi: true, shareAiSettings: true });
    childAccounts = await signIn('student', childPassword); api = await import('../src/api');
    expect(api.loadAiSettings()).toMatchObject({ provider: 'openrouter', openrouterKey: 'test-parent-key-not-real' });
    localStorage.setItem(childAccounts.workspaceKey('domashka_pro_student_profile_v2'), '{"grade":1}');
    expect(api.loadStudentProfile().grade).toBe(9);
  });
  it('parent policy updates revoke active child sessions and cancel an in-flight request', async () => {
    const { accounts, child } = await family(); await signIn('student', childPassword);
    const { generateAiBrowser } = await import('../src/standalone/aiClient');
    vi.stubGlobal('fetch', vi.fn((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))));
    const checked = expect(generateAiBrowser({ provider: 'openrouter', apiKey: 'test-key', model: 'test/model', systemPrompt: 'Учитель', messages: [{ role: 'user', content: 'Подсказка' }] })).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); expect(fetch).toHaveBeenCalledTimes(1);
    accounts.updateChild(child.id, { ...child, tutorOnly: true, allowAi: false });
    window.dispatchEvent(new StorageEvent('storage', { key: accounts.ACCOUNTS_KEY }));
    await checked;
    const next = await signIn('student', childPassword); expect(() => next.assertAiAllowed()).toThrow(/отключил ИИ/);
    const client = await import('../src/standalone/aiClient'); fetch.mockClear();
    await expect(client.generateAiBrowser({ provider: 'builtin', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/отключил ИИ/);
    const vision = await import('../src/standalone/visionEngine'); await expect(vision.recognizeHomeworkPhoto('data:image/png;base64,AA==')).rejects.toThrow(/отключил ИИ/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks disabled accounts and resets a child password only with a guardian password', async () => {
    const { accounts, child } = await family();
    await expect(accounts.resetChildPassword(child.id, 'wrong', 'New_child_password_42')).rejects.toThrow(/Неверный/);
    await accounts.resetChildPassword(child.id, parentPassword, 'New_child_password_42');
    const login = await fresh(); await expect(login.loginAccount('student', childPassword)).rejects.toThrow(/Неверный/);
    accounts.updateChild(child.id, { ...child, tutorOnly: true, allowAi: true, disabled: true });
    await expect(login.loginAccount('student', 'New_child_password_42')).rejects.toThrow(/заблокирован/);
  });
  it('only grants a second parent access using an explicit, single-use invitation', async () => {
    const { accounts, child } = await family();
    const challenge = accounts.issueParentChallenge();
    const second = await accounts.createAccount({ role: 'parent', login: 'parent2', name: 'Второй родитель', password: parentPassword,
      parentPassword, challengeId: challenge.id, challengeAnswer: String(Math.sqrt(challenge.square)) });
    const other = await signIn('parent2', parentPassword); expect(other.getChildren()).toEqual([]);
    expect(() => other.getChildStudySummary(child.id)).toThrow(/не привязан/);
    const code = accounts.createLinkCode(child.id); other.linkChild(code);
    expect(other.getChildren()[0].id).toBe(child.id); expect(() => other.linkChild(code)).toThrow(/Код не найден/);
    accounts.revokeChildLink(child.id, second.id); expect(other.getChildren()).toEqual([]);
    expect(() => accounts.revokeChildLink(child.id, accounts.WORKSPACE_ID)).toThrow(/хотя бы один/);
  });
  it('copies legacy data with photos without deleting originals or copying keys', async () => {
    const guestStore = await import('../src/standalone/storageEngine');
    const original = await guestStore.chatStore.saveNew({ task_text: 'Старая тетрадь', response_md: 'Old', image_b64: 'data:image/png;base64,AA==' });
    localStorage.setItem('domashka_diary_tasks_v21', '[{"id":"old-task","text":"Legacy task"}]');
    localStorage.setItem('domashka_pro_ai_settings_v2', '{"openrouterKey":"legacy-private-key"}');
    const { accounts, child } = await family(); const migration = await import('../src/standalone/legacyMigration');
    expect(await migration.copyLegacyWorkspace(child.id)).toMatchObject({ copiedChats: 1 });
    expect((await migration.copyLegacyWorkspace(child.id)).copiedChats).toBe(0);
    expect(localStorage.getItem('domashka_diary_tasks_v21')).toContain('Legacy task');
    expect(localStorage.getItem(accounts.workspaceKeyFor(child.id, 'domashka_pro_ai_settings_v2'))).toBeNull();
    await signIn('student', childPassword); const childStore = await import('../src/standalone/storageEngine');
    expect(await childStore.chatStore.get(original.id)).toMatchObject({ task_text: 'Старая тетрадь', image_b64: 'data:image/png;base64,AA==' });
  });
});

describe('assignment, submission, review and authorization', () => {
  it.each(['indexedDB', 'localStorage'])('persists the full workflow through %s and rejects unrelated children', async (mode) => {
    if (mode === 'localStorage') vi.stubGlobal('indexedDB', undefined);
    const { accounts, child } = await family();
    await accounts.createAccount({ role: 'child', login: 'other', name: 'Другой ученик', password: childPassword, age: 9, grade: 3 });
    const parentTasks = await import('../src/standalone/familyHomework');
    const assignment = await parentTasks.assignHomework({ childId: child.id, subject: 'math', title: 'Проверочная', instructions: 'Покажи решение', due: '2026-11-10' });
    await signIn('other', childPassword); const unrelatedTasks = await import('../src/standalone/familyHomework');
    expect(await unrelatedTasks.listHomework()).toEqual([]);
    await expect(unrelatedTasks.submitHomework(assignment.id, { answer: 'чужой ответ' }, assignment.version)).rejects.toThrow(/недоступно/);
    await signIn('student', childPassword); const childTasks = await import('../src/standalone/familyHomework');
    expect(await childTasks.listHomework()).toHaveLength(1);
    await expect(childTasks.reviewHomework(assignment.id, { accepted: true }, assignment.version)).rejects.toThrow(/родител|Сначала ученик/);
    const submitted = await childTasks.submitHomework(assignment.id, { answer: 'Моя попытка', image: 'data:image/png;base64,AA==' }, assignment.version);
    expect(submitted.status).toBe('submitted');
    expect((await parentTasks.listHomework())[0].submission).toMatchObject({ image: '', hasImage: true });
    expect((await parentTasks.getHomework(assignment.id)).submission.image).toBe('data:image/png;base64,AA==');
    await expect(unrelatedTasks.getHomework(assignment.id)).rejects.toThrow(/недоступно/);
    const photoArchive = JSON.parse(await parentTasks.exportHomework('', [assignment.id]));
    expect(photoArchive.items[0].submission.image).toBe('data:image/png;base64,AA==');
    expect(JSON.parse(await parentTasks.exportHomework('', ['not-an-assignment'])).items).toEqual([]);
    await expect(parentTasks.reviewHomework(assignment.id, { accepted: true, mark: 5 }, assignment.version)).rejects.toThrow(/изменилась/);
    const revision = await parentTasks.reviewHomework(assignment.id, { accepted: false, comment: 'Проверь второй шаг', mark: 3 }, submitted.version);
    expect(revision.status).toBe('revision');
    const again = await childTasks.submitHomework(assignment.id, { answer: 'Исправленная попытка' }, revision.version);
    const accepted = await parentTasks.reviewHomework(assignment.id, { accepted: true, comment: 'Верно', mark: 5 }, again.version);
    expect(accepted).toMatchObject({ status: 'accepted', review: { mark: 5, comment: 'Верно' } });
    await expect(childTasks.submitHomework(assignment.id, { answer: 'Изменение' }, accepted.version)).rejects.toThrow(/уже принята/);
    const archive = JSON.parse(await parentTasks.exportHomework()); expect(archive.items[0].submission.text).toBe('Исправленная попытка');
    await expect(childTasks.deleteHomework(assignment.id, accepted.version)).rejects.toThrow(/Удаление.*родител/);
    await parentTasks.deleteHomework(assignment.id, accepted.version); expect(await childTasks.listHomework()).toEqual([]);
  });
  it('does not pretend an assignment is saved when fallback storage is full', async () => {
    vi.stubGlobal('indexedDB', undefined); const { child } = await family(); const homework = await import('../src/standalone/familyHomework');
    await homework.listHomework(); const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === 'domashka_family_homework_v4') throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    });
    await expect(homework.assignHomework({ childId: child.id, subject: 'math', title: 'Задание', instructions: 'Текст' })).rejects.toThrow(/Не удалось сохранить/);
    expect(await homework.listHomework()).toEqual([]);
  });
});
