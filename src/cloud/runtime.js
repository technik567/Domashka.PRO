import { createClient } from '@supabase/supabase-js';
import { installCloudDriver } from './bridge.js';
import { getCloudClient, getCloudConfig, cloudError, cloudFetch, cloudAuthLink, checkCloudEnvironment, claimCloudTab, releaseCloudTab } from './client.js';
import { loadCloudCache, saveCloudCache, clearCloudCache } from './cache.js';
import { DocumentSync } from './documentSync.js';
import { createPhotoStore } from './photos.js';
import { clone, isSyncPreference } from './schema.js';
import { normalizeFlashcardAnswer, flashcardKey } from '../standalone/flashcardContent.js';

function emit(listeners) { for (const listener of listeners) { try { listener(); } catch { /* independent subscribers */ } } }
function tokenClaims(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); } catch { return {}; }
}
const tokenUser = (token) => tokenClaims(token).sub;
const homeworkShape = (row) => ({ id: row.id, childId: row.child_id, authorId: row.author_id, authorName: row.author_name,
  title: row.title, instructions: row.instructions, subject: row.subject, due: row.due || '', status: row.status,
  createdAt: Date.parse(row.created_at), updatedAt: Date.parse(row.updated_at), version: row.version,
  review: row.review, submission: row.submission ? { ...row.submission, image: '', hasImage: Boolean(row.submission.image && row.submission.image !== '') } : null });

export class CloudRuntime {
  constructor(uid, client, sessionId = null) {
    this.projectRef = new URL(getCloudConfig().url).hostname.split('.')[0];
    this.sessionId = sessionId; this.lastPolicyCheck = 0;
    this.uid = uid; this.client = client; this.sessionUid = uid; this.family = null; this.sync = null;
    this.blocked = ''; this.transitioning = false; this.reloadRequired = false; this.requestCount = 0;
    this.listeners = new Set(); this.accountListeners = new Set(); this.homeworkListeners = new Set();
    this.summaries = {}; this.summaryJobs = new Map(); this.watchedChild = ''; this.meta = null; this.refreshing = null;
    this.lastContact = 0; this.networkError = ''; this.saveTimer = null;
    this.photos = createPhotoStore({ uid, assertActive: () => this.assertActive(),
      upload: (path, bytes, type) => this.request(async (token) => {
        const result = await this.client.storage.from('domashka-photos').upload(path, bytes, { contentType: type, upsert: false, cacheControl: '0', headers: { Authorization: `Bearer ${token}` } });
        // Content-addressed immutable uploads are idempotent; an existing hash
        // is not permission to overwrite anything.
        if (result.error && !(String(result.error.statusCode) === '409' || result.error.code === 'Duplicate' || /already exists/i.test(result.error.message))) throw cloudError(result.error);
        return true;
      }),
      download: (path) => this.request(async (token) => {
        const result = await this.client.storage.from('domashka-photos').download(path, {}, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (result.error) throw cloudError(result.error); return result.data;
      }),
    });
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  subscribeAccounts(listener) { this.accountListeners.add(listener); return () => this.accountListeners.delete(listener); }
  subscribeHomework(listener) { this.homeworkListeners.add(listener); return () => this.homeworkListeners.delete(listener); }
  notify() { emit(this.listeners); }
  assertActive() {
    if (this.blocked || this.transitioning || this.sessionUid !== this.uid || this.reloadRequired) throw new DOMException(this.blocked || 'Аккаунт или версия изменены. Обновите страницу.', 'AbortError');
  }
  async request(action) {
    this.assertActive(); this.requestCount++; this.notify();
    try {
      const { data, error } = await this.client.auth.getSession(); this.assertActive();
      const session = data?.session;
      if (error || session?.user?.id !== this.uid || tokenUser(session.access_token) !== this.uid || this.sessionId && tokenClaims(session.access_token).session_id !== this.sessionId) {
        this.blocked = 'Сеанс изменён. Несохранённая очередь остаётся у прежнего аккаунта; войдите заново.';
        emit(this.accountListeners); throw new Error(this.blocked);
      }
      this.sessionId ||= tokenClaims(session.access_token).session_id;
      // Freeze the bearer per operation. A late fetch must NEVER use a new
      // account's bearer with the previous child's request body.
      const result = await action(session.access_token); this.assertActive();
      this.lastContact = Date.now(); this.networkError = ''; return result;
    } catch (error) { throw Object.assign(cloudError(error), { code: error.code }); }
    finally { this.requestCount--; this.notify(); }
  }
  async rpc(name, parameters = {}) {
    return this.request(async (token) => {
      const { data, error } = await this.client.rpc(name, parameters).setHeader('Authorization', `Bearer ${token}`);
      if (error) throw Object.assign(cloudError(error), { code: error.code });
      if (data?.error) throw new Error(data.error); return data;
    });
  }
  async query(table, columns = '*', configure = (query) => query) {
    return this.request(async (token) => {
      const { data, error } = await configure(this.client.from(table).select(columns)).setHeader('Authorization', `Bearer ${token}`);
      if (error) throw cloudError(error); return data || [];
    });
  }
  async documents(metadata = false) {
    const all = [];
    for (let start = 0; start < 6000; start += 500) {
      const rows = await this.query('domashka_documents', metadata ? 'user_id,key,version,deleted,mutation_id' : '*', (q) => q.order('key').range(start, start + 499));
      all.push(...rows); if (rows.length < 500) break;
    }
    return all;
  }
  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush().catch(() => {}); }, 650);
  }
  async boot() {
    const before = await this.rpc('domashka_sync_status');
    if (before.apiVersion !== 1 || !/^[a-f0-9]{32}$/.test(before.documentRevision)) throw new Error('Нужно обновить облачную базу приложения.');
    this.family = await this.rpc('domashka_get_family');
    if (this.family?.account?.id !== this.uid) throw new Error('Облако вернуло другое рабочее пространство.');
    const cached = await loadCloudCache(this.uid, this.projectRef); this.assertActive();
    this.sync = new DocumentSync({ uid: this.uid, cached,
      persist: (data) => saveCloudCache(this.uid, data, this.projectRef), assertActive: () => this.assertActive(), notify: () => this.notify(),
      sendDocument: async (key, op) => this.rpc('domashka_save_document', { doc_key: key,
        doc_value: await this.photos.pack(op.value), expected_version: op.baseVersion, operation_id: op.id }),
      sendActivity: (event) => this.rpc('domashka_record_activity', { event_id: event.id, kind: event.kind, gain: event.gain }),
    });
    this.sync.ingest(await this.documents(), { boot: true }); this.sync.stats = clone(this.family.stats); this.sync.save();
    await this.sync.durable();
    const after = await this.rpc('domashka_sync_status'); this.sync.setStats(after.stats);
    if (before.familyRevision !== after.familyRevision) await this.refreshFamily();
    // Keep the PRE-read document hash. Writes during pagination are discovered
    // next poll instead of being accidentally treated as already downloaded.
    this.meta = { ...after, documentRevision: before.documentRevision };
    await this.sync.durable();
    this.summaries = this.family.summaries || {}; this.lastPolicyCheck = Date.now();
  }
  start() {
    const { data: subscription } = this.client.auth.onAuthStateChange((_event, session) => {
      this.sessionUid = session?.user?.id || '';
      if (this.sessionUid !== this.uid || this.sessionId && tokenClaims(session?.access_token).session_id !== this.sessionId) {
        this.blocked = 'Вход изменён. Обновите страницу. Несохранённые изменения остались в кэше прежнего аккаунта.';
        emit(this.accountListeners); this.notify();
        if (!this.transitioning) this.sync.durable().then(releaseCloudTab).catch(() => this.notify());
      }
    });
    this.authSubscription = subscription.subscription;
    const refresh = () => { if (document.visibilityState !== 'hidden' && !this.blocked && !this.transitioning) this.refresh().catch(() => {}); };
    this.timer = setInterval(refresh, 15000);
    window.addEventListener('online', refresh); window.addEventListener('focus', refresh);
    const unload = (event) => { const state = this.sync.status(); if (state.pending || state.cachePending || this.requestCount) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('pagehide', () => { this.transitioning = true; }, { once: true });
    window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
    this.cleanup = () => { clearTimeout(this.saveTimer); clearInterval(this.timer); this.authSubscription.unsubscribe();
      window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); window.removeEventListener('beforeunload', unload); };
    this.scheduleSave();
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        await this.flush();
        const meta = await this.rpc('domashka_sync_status');
        if (meta.familyRevision !== this.meta?.familyRevision) await this.refreshFamily();
        this.sync.setStats(meta.stats);
        if (meta.homeworkRevision !== this.meta?.homeworkRevision) emit(this.homeworkListeners);
        if (this.watchedChild && meta.summaryRevision !== this.meta?.summaryRevision) await this.refreshChildSummary(this.watchedChild);
        this.lastPolicyCheck = Date.now();
        if (meta.documentRevision !== this.meta?.documentRevision) {
        const headers = await this.documents(true);
        const changed = headers.filter((row) => row.version > Math.max(this.sync.rows[row.key]?.version || 0,
          this.sync.incoming[row.key]?.version || 0, this.sync.conflicts[row.key]?.version || 0));
        for (let offset = 0; offset < changed.length; offset += 20) {
          const keys = changed.slice(offset, offset + 20).map((row) => row.key);
          this.sync.ingest(await this.query('domashka_documents', '*', (q) => q.in('key', keys)));
        }
        }
        this.meta = meta; this.networkError = '';
      } catch (error) {
        this.networkError = error.message;
        if (error.code === '42501') { this.blocked = error.message; emit(this.accountListeners); }
        this.notify(); throw error;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }
  async refreshFamily() {
    const next = await this.rpc('domashka_get_family');
    if (next?.account?.id !== this.uid) throw new Error('Неверный владелец семейного кабинета.');
    this.family = next; this.sync?.setStats(next.stats); emit(this.accountListeners); this.notify(); return next;
  }
  getCurrentAccount() { return this.blocked || this.transitioning || this.reloadRequired ? null : clone(this.family?.account || null); }
  getAccountGate() {
    return { configured: true, account: this.getCurrentAccount(), transitioning: this.transitioning,
      error: this.blocked || (this.reloadRequired ? 'Выбрана облачная версия. Обновите экран, чтобы не редактировать устаревшие данные.' : ''), accounts: this.family ? [this.family.account, ...this.family.children, ...this.family.parents].map(clone) : [] };
  }
  getChildren() { this.assertActive(); if (this.family.account.role !== 'parent') throw new Error('Нужен родительский аккаунт.'); return clone(this.family.children); }
  canManageChild(id) { return !this.blocked && this.family?.account.role === 'parent' && this.family.children.some((c) => c.id === id); }
  getChildStudySummary(id) { if (!this.canManageChild(id)) throw new Error('Ученик не привязан.'); return clone(this.summaries[id] || { stats: {}, tasks: [], grades: {} }); }
  async refreshChildSummary(id) {
    if (!this.canManageChild(id)) return;
    if (this.summaryJobs.has(id)) return this.summaryJobs.get(id);
    const job = this.rpc('domashka_child_summary', { child: id }).then((summary) => { this.summaries[id] = summary; emit(this.accountListeners); })
      .finally(() => this.summaryJobs.delete(id));
    this.summaryJobs.set(id, job); return job;
  }
  watchChildSummary(id) { this.watchedChild = id; this.refreshChildSummary(id).catch((err) => { this.networkError = err.message; this.notify(); }); return () => { if (this.watchedChild === id) this.watchedChild = ''; }; }
  verifyAiPolicy() {
    if (this.family.account.role === 'child' && Date.now() - this.lastPolicyCheck > 45000) throw new Error('Сначала нажмите «Синхронизировать»: нужно проверить актуальные ограничения родителя.');
  }
  getInheritedAiSettings() { return this.family?.account.role === 'child' ? { provider: 'builtin', builtinModel: this.family.account.policy.freeModel || 'auto', openrouterKey: '', geminiKey: '', customKey: '' } : null; }
  getPreference(key) { return this.sync.read(`pref/${key}`); }
  setPreference(key, value) { if (!isSyncPreference(key)) throw new Error('Настройка не синхронизируется.'); this.sync.put(`pref/${key}`, value); this.scheduleSave(); }
  getStudentStats() { return this.sync.getStats(); }
  recordStudentActivity(kind, gain, options = {}) { const result = this.sync.activity(kind, gain, options.eventKey); this.scheduleSave(); return result; }
  async putChat(record) { this.sync.put(`chat/${record.id}`, record); await this.sync.durable(); this.scheduleSave(); return clone(record); }
  async getChat(id) { return this.photos.unpack(this.sync.read(`chat/${id}`)); }
  listChats() { return this.sync.listKeys('chat/').map((key) => this.sync.read(key)); }
  async deleteChat(id) { this.sync.put(`chat/${id}`, null); await this.sync.durable(); this.scheduleSave(); return true; }
  async clearChats() { for (const key of this.sync.listKeys('chat/')) this.sync.put(key, null); await this.sync.durable(); this.scheduleSave(); }
  async exportChats() {
    const items = []; let size = 0;
    for (const item of this.listChats()) { const full = await this.getChat(item.id); size += JSON.stringify(full).length;
      if (size > 40000000) throw new Error('Экспорт с фото больше 40 МБ. Экспортируйте рабочее пространство без загрузки всех исходных фото или уменьшите тетрадь.'); items.push(full); }
    return JSON.stringify({ app: 'Домашка.ПРО', exportedAt: new Date().toISOString(), stats: this.getStudentStats(), items }, null, 2);
  }
  async flush() { this.assertActive(); clearTimeout(this.saveTimer); this.saveTimer = null; await this.sync.flush();
    const status = this.sync.status(); if (status.pending && !status.conflicts.length && !status.error) this.scheduleSave();
  }
  async requireSaved() {
    await this.flush(); const state = this.sync.status();
    if (state.pending || state.conflicts.length || state.cacheError) throw new Error('Сначала синхронизируйте изменения и разрешите конфликты. Можно скачать резервную копию; выход не удаляет очередь молча.');
    if (this.requestCount) throw new Error('Дождитесь завершения текущей облачной операции.');
  }
  async logoutAccount() {
    await this.requireSaved();
    this.transitioning = true; emit(this.accountListeners);
    const session = (await this.client.auth.getSession()).data.session;
    if (session?.user?.id !== this.uid || tokenUser(session.access_token) !== this.uid) throw new Error('Аккаунт изменён. Перезагрузите страницу.');
    const revoked = await this.client.rpc('domashka_revoke_session').setHeader('Authorization', `Bearer ${session.access_token}`);
    if (revoked.error) throw cloudError(revoked.error);
    const { error } = await this.client.auth.signOut({ scope: 'local' });
    // The app-side session is already revoked, even if GoTrue is unreachable.
    if (error) { this.blocked = 'Сеанс закрыт на сервере приложения. Перезагрузите страницу и войдите заново.'; throw cloudError(error); }
    await clearCloudCache(this.uid, this.projectRef);
    const prefix = `domashka_cloud_${this.projectRef}_${this.uid}::`;
    for (let i = localStorage.length - 1; i >= 0; i--) { const key = localStorage.key(i); if (key?.startsWith(prefix)) localStorage.removeItem(key); }
    this.cleanup?.(); releaseCloudTab();
  }
  async updateAppearance({ name, avatar, version }) {
    const result = await this.rpc('domashka_update_appearance', { new_name: name, new_avatar: avatar, expected_version: version ?? this.family.account.version });
    await this.refreshFamily(); return result;
  }
  async updateChild(id, patch) {
    const child = this.family.children.find((item) => item.id === id); if (!child) throw new Error('Ученик не привязан.');
    const result = await this.rpc('domashka_update_child', { child: id, new_grade: Number(patch.grade), new_age: Number(patch.age),
      new_tutor_only: Boolean(patch.tutorOnly), new_allow_ai: Boolean(patch.allowAi), new_disabled: Boolean(patch.disabled),
      expected_version: patch.version ?? child.version, new_free_model: patch.freeModel || child.policy.freeModel || 'auto' });
    await this.refreshFamily(); return result;
  }
  async admin(body) {
    const result = await this.request(async (token) => {
      const { data, error } = await this.client.functions.invoke('family-admin', { body, headers: { Authorization: `Bearer ${token}` } });
      if (error) {
        let detail; try { detail = await error.context?.json(); } catch { /* generic error */ }
        throw new Error(detail?.error || 'Функция семейных аккаунтов не ответила. Проверьте подключение и настройки владельца сайта.');
      }
      if (data?.error) throw new Error(data.error); return data;
    });
    await this.refreshFamily(); return result;
  }
  async createAccount(data) {
    if (data.role !== 'child') throw new Error('Другой родитель регистрируется со своей почтой и вводит код привязки.');
    const created = await this.admin({ action: 'create_child', login: data.login, password: data.password, name: data.name,
      avatar: data.avatar, grade: Number(data.grade), age: Number(data.age) });
    return this.family.children.find((child) => child.id === created.id) || created;
  }
  async resetChildPassword(id, parentPassword, password, captchaToken) {
    await this.admin({ action: 'reset_child', childId: id, parentPassword, password, captchaToken });
  }
  async changeAccountPassword(current, next, captchaToken) {
    if (next.trim().length < 8 || next.length > 128) throw new Error('Пароль: 8–128 символов.');
    await this.requireSaved(); const cfg = getCloudConfig();
    const verifier = createClient(cfg.url, cfg.publishableKey, { global: { fetch: cloudFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `domashka_verify_${crypto.randomUUID()}` } });
    try {
      const { data, error } = await verifier.auth.signInWithPassword({ email: this.family.account.role === 'child'
        ? `${this.family.account.login}@children.domashka.invalid` : this.family.account.login, password: current, options: { captchaToken } });
      if (error || data.user?.id !== this.uid) throw new Error('Текущий пароль не подтверждён.');
      this.assertActive(); await this.requireSaved();
      this.transitioning = true; emit(this.accountListeners);
      const result = await verifier.auth.updateUser({ password: next }); if (result.error) throw cloudError(result.error);
      // The Auth trigger invalidates every previous app session. Re-login is
      // deliberate (CAPTCHA tokens cannot be reused for a second sign-in).
      this.transitioning = true; emit(this.accountListeners); await this.client.auth.signOut({ scope: 'local' });
    } catch (error) { if (this.transitioning) { this.blocked = 'Смена пароля не подтверждена. Перезагрузите страницу и проверьте вход; при необходимости восстановите пароль.'; this.notify(); emit(this.accountListeners); } throw error; }
    finally { await verifier.auth.signOut({ scope: 'local' }); }
  }
  async createLinkCode(id) { return this.rpc('domashka_create_link', { child: id }); }
  async linkChild(code) { const result = await this.rpc('domashka_accept_link', { token: code }); await this.refreshFamily(); return this.family.children.find((child) => child.id === result.childId); }
  async revokeChildLink(childId, parentId) { await this.rpc('domashka_revoke_link', { child: childId, parent: parentId }); await this.refreshFamily(); }
  async beginFlashcardCheck(key) { return this.rpc('domashka_begin_card', { card_key: key }); }
  async answerFlashcardCheck(id, answer) {
    const result = await this.rpc('domashka_answer_card', { attempt_id: id, answer: normalizeFlashcardAnswer(answer) });
    this.sync.setStats(result.stats); return result;
  }
  async listHomework(childId = '') {
    const rows = [];
    for (let start = 0; start < 21000; start += 500) {
      const page = await this.query('domashka_homework', '*', (q) => {
        q = q.order('updated_at', { ascending: false }).order('id').range(start, start + 499);
        return childId ? q.eq('child_id', childId) : q;
      });
      rows.push(...page); if (page.length < 500) break;
    }
    return rows.map(homeworkShape);
  }
  async getHomework(id) { return this.photos.unpack(await this.rpc('domashka_get_homework', { work_id: id })); }
  async writeHomework(action, id, payload, version, childId = null) {
    this.assertActive();
    const operationKey = flashcardKey({ front: `${action}:${id}:${version}:${childId}`, back: JSON.stringify(payload) });
    const cacheKey = `domashka_cloud_${this.projectRef}_${this.uid}::homework_operations_v42`;
    let operations; try { operations = JSON.parse(localStorage.getItem(cacheKey) || '{}'); } catch { throw new Error('Повреждены квитанции семейных операций. Не очищайте данные; сохраните резервную копию.'); }
    if (!operations || Array.isArray(operations) || typeof operations !== 'object') throw new Error('Повреждены квитанции семейных операций.');
    const operationId = operations[operationKey] || crypto.randomUUID();
    const retained = Object.fromEntries([...Object.entries(operations), [operationKey, operationId]].slice(-500));
    const serialized = JSON.stringify(retained); localStorage.setItem(cacheKey, serialized);
    if (localStorage.getItem(cacheKey) !== serialized) throw new Error('Не удалось сохранить квитанцию операции на устройстве.');
    const safePayload = action === 'submit' ? await this.photos.pack(payload, { childId: this.uid }) : payload;
    const result = await this.rpc('domashka_write_homework', { action, work_id: id, child: childId, payload: safePayload,
      expected_version: version ?? 0, operation_id: operationId });
    emit(this.homeworkListeners); return result;
  }
  async resolveConflict(key, choice) {
    await this.sync.resolve(key, choice, () => { if (choice === 'remote') { this.reloadRequired = true; emit(this.accountListeners); this.notify(); } });
  }
  async reloadFromCloud() { await this.requireSaved(); this.reloadRequired = true; location.reload(); }
  status() { return { ...this.sync?.status(), error: this.blocked || this.networkError || this.sync?.status().error || '',
    lastContact: this.lastContact, requests: this.requestCount, reloadRequired: this.reloadRequired }; }
  backup() { return { type: 'domashka-cloud-recovery', format: 1, project: this.projectRef, exportedAt: new Date().toISOString(),
    workspace: this.sync.snapshot(), conflicts: clone(this.sync.conflicts), incoming: clone(this.sync.incoming) }; }
}

let bootPromise;
export function initializeCloud() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    await checkCloudEnvironment();
    const recovery = await cloudAuthLink(); const client = getCloudClient(); let recovered = recovery;
    const { data: authEvents } = client.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') recovered = true; });
    const { data, error } = await client.auth.getSession(); authEvents.subscription.unsubscribe(); if (error) throw cloudError(error);
    if (!data.session) return { mode: 'login' };
    if (recovered || location.hash.includes('type=recovery')) return { mode: 'recovery' };
    await claimCloudTab();
    const runtime = new CloudRuntime(data.session.user.id, client, tokenClaims(data.session.access_token).session_id);
    await runtime.boot(); installCloudDriver(runtime); runtime.start();
    return { mode: 'ready', runtime };
  })();
  return bootPromise;
}
