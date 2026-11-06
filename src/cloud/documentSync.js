import { assertDocument, clone, EMPTY_STATS, assertServerStats } from './schema.js';
import { flashcardKey } from '../standalone/flashcardContent.js';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function eventUuid(key) {
  const hex = flashcardKey({ front: 'activity', back: key }) + flashcardKey({ front: key, back: 'activity' });
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// Per-document compare-and-swap, a durable outbox and explicit conflict choices.
// Never replace a mounted editor with a background snapshot. Incoming rows wait
// for a deliberate reload; a stale editor still submits its OLD base version.
export class DocumentSync {
  constructor({ uid, cached, persist, sendDocument, sendActivity, assertActive = () => {}, notify = () => {} }) {
    if (cached && (cached.uid !== uid || cached.format !== 1)) throw new Error('Кэш принадлежит другому аккаунту или имеет неизвестный формат.');
    this.uid = uid; this.persist = persist; this.sendDocument = sendDocument; this.sendActivity = sendActivity;
    this.assertActive = assertActive; this.notify = notify;
    this.rows = clone(cached?.rows || {}); this.pending = clone(cached?.pending || {});
    this.events = clone(cached?.events || {}); this.receipts = clone(cached?.receipts || []);
    this.stats = { ...EMPTY_STATS, ...cached?.stats };
    this.incoming = {}; this.conflicts = {}; this.error = ''; this.cacheError = ''; this.flushing = null;
    this.saveRevision = 0; this.savedRevision = 0; this.savingCache = null;
    for (const [key, row] of Object.entries(this.rows)) { if (row.user_id && row.user_id !== uid) throw new Error('Кэш другого пользователя.'); assertDocument(key, row.deleted ? null : row.value); if (!Number.isSafeInteger(row.version) || row.version < 1) throw new Error('Повреждена версия кэша.'); }
    for (const [key, pending] of Object.entries(this.pending)) { assertDocument(key, pending.value); if (!Number.isSafeInteger(pending.baseVersion) || pending.baseVersion < 0 || !/^[a-f0-9-]{36}$/.test(pending.id)) throw new Error('Повреждена очередь изменений.'); }
    for (const [id, event] of Object.entries(this.events)) if (id !== event.id || !/^[a-f0-9-]{36}$/.test(id) || !['solve','check','quiz','quiz_correct','homework_done'].includes(event.kind) || !Number.isSafeInteger(event.gain) || event.gain < 0 || event.gain > 240) throw new Error('Повреждены события кэша.');
    if (!Array.isArray(this.receipts) || this.receipts.some((id) => !/^[a-f0-9-]{36}$/.test(id))) throw new Error('Повреждены квитанции кэша.');
  }
  snapshot() { return clone({ format: 1, uid: this.uid, rows: this.rows, pending: this.pending, events: this.events, receipts: this.receipts.slice(-2000), stats: this.stats }); }
  changed() { this.notify(); }
  save() {
    this.saveRevision++; this.changed();
    if (this.savingCache) return this.savingCache;
    this.savingCache = (async () => {
      try {
        while (this.savedRevision < this.saveRevision) {
          const revision = this.saveRevision; const snapshot = this.snapshot(); await Promise.resolve().then(() => this.persist(snapshot));
          this.savedRevision = revision; this.cacheError = '';
        }
      } catch (error) { this.cacheError = error.message; }
      finally { this.savingCache = null; this.changed(); }
    })();
    return this.savingCache;
  }
  async durable() { await this.save(); if (this.cacheError) throw new Error(this.cacheError); }
  read(key) {
    if (Object.hasOwn(this.pending, key)) return clone(this.pending[key].value);
    const row = this.rows[key]; return !row || row.deleted ? null : clone(row.value);
  }
  put(key, value) {
    this.assertActive(); assertDocument(key, value);
    if (equal(this.read(key), value)) return false;
    const previous = this.pending[key];
    this.pending[key] = { id: crypto.randomUUID(), baseVersion: previous?.baseVersion ?? this.rows[key]?.version ?? 0,
      value: clone(value), changedAt: Date.now() };
    this.error = ''; this.save(); return true;
  }
  listKeys(prefix = '') { return [...new Set([...Object.keys(this.rows), ...Object.keys(this.pending)])].filter((key) => key.startsWith(prefix) && this.read(key) !== null); }
  ingest(remoteRows, { boot = false } = {}) {
    this.assertActive();
    if (boot) {
      const present = new Set(remoteRows.map((row) => row.key));
      for (const key of Object.keys(this.rows)) if (!present.has(key)) {
        if (this.pending[key]?.baseVersion > 0) this.conflicts[key] = { key, user_id: this.uid, version: 0, deleted: true, value: null };
        else if (!this.pending[key]) delete this.rows[key];
      }
    }
    for (const raw of remoteRows) {
      if (raw.user_id && raw.user_id !== this.uid) throw new Error('Сервер вернул данные другого аккаунта.');
      const row = clone(raw); assertDocument(row.key, row.deleted ? null : row.value);
      if (!Number.isSafeInteger(row.version) || row.version < 1) throw new Error('Некорректная версия сервера.');
      const key = row.key; const pending = this.pending[key];
      // Independently initialized defaults can have different operation IDs but
      // exactly the same content. Acknowledge them without a fake conflict;
      // mounted editors already show that value, so advancing its CAS is safe.
      if (pending && (row.mutation_id === pending.id || equal(pending.value, row.deleted ? null : row.value))) {
        this.rows[key] = row; delete this.pending[key]; delete this.conflicts[key]; delete this.incoming[key];
      } else if (pending && row.version !== pending.baseVersion) {
        this.conflicts[key] = row; // Keep BOTH versions, including remote deletions.
      } else if (!pending && (boot || row.version > (this.rows[key]?.version || 0))) {
        if (boot) this.rows[key] = row; else this.incoming[key] = row;
      }
    }
    this.save();
  }
  setStats(stats) {
    this.assertActive();
    assertServerStats(stats);
    if (Number(stats.version) >= this.stats.version) { this.stats = { ...EMPTY_STATS, ...clone(stats) }; this.save(); }
  }
  getStats() {
    // Only confirmed server XP is presented as earned. A timed-out receipt may
    // already be in the server total, so adding the outbox would double it.
    return { ...this.stats, pendingActivities: Object.keys(this.events).length };
  }

  activity(kind, gain, eventKey) {
    this.assertActive();
    if (!['solve', 'check', 'quiz', 'quiz_correct', 'homework_done'].includes(kind) || !Number.isSafeInteger(gain) || gain < 0 || gain > 240) throw new Error('Некорректное учебное событие.');
    const id = eventKey ? eventUuid(`${kind}:${eventKey}`) : crypto.randomUUID();
    if (!this.events[id] && !this.receipts.includes(id)) { this.events[id] = { id, kind, gain }; this.save(); }
    return this.getStats();
  }
  async flush() {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushInner(); this.changed();
    try { return await this.flushing; } finally { this.flushing = null; this.changed(); }
  }
  async flushInner() {
    this.assertActive(); this.error = '';
    try {
      // A failed local cache write is surfaced, but we may still save to the
      // authoritative server while online. Never claim durable offline saving.
      await this.save();
      for (const key of Object.keys(this.pending)) {
        if (this.conflicts[key]) continue;
        const operation = clone(this.pending[key]); if (!operation) continue;
        this.assertActive();
        const response = await this.sendDocument(key, operation);
        this.assertActive();
        if (response.conflict) {
          const remote = response.remote || { key, user_id: this.uid, version: 0, deleted: true, value: null };
          assertDocument(key, remote.deleted ? null : remote.value);
          if (remote.key !== key || remote.user_id && remote.user_id !== this.uid || !Number.isSafeInteger(remote.version) || remote.version < 0) throw new Error('Сервер вернул неверную конфликтующую версию.');
          // Compare the CURRENT pending value, not the in-flight snapshot: a
          // new edit made while sending must never be acknowledged by mistake.
          if (remote.version > 0 && this.pending[key] && equal(this.pending[key].value, remote.deleted ? null : remote.value)) {
            this.rows[key] = clone(remote); delete this.pending[key]; delete this.conflicts[key]; delete this.incoming[key];
          } else this.conflicts[key] = clone(remote);
          await this.save(); continue;
        }
        assertDocument(key, response.deleted ? null : response.value);
        if (!response.ok || response.version < 1 || !Number.isSafeInteger(response.version) || response.key !== key || response.user_id !== this.uid || response.mutation_id !== operation.id) throw new Error('Сервер не подтвердил сохранение.');
        this.rows[key] = clone(response); delete this.incoming[key];
        if (this.pending[key]?.id === operation.id) delete this.pending[key];
        else if (this.pending[key]) this.pending[key].baseVersion = response.version;
        await this.save();
      }
      for (const event of Object.values(this.events)) {
        this.assertActive(); const stats = await this.sendActivity(event); this.assertActive();
        assertServerStats(stats); delete this.events[event.id]; this.receipts.push(event.id); this.receipts = this.receipts.slice(-2000);
        this.setStats(stats); await this.save();
      }
      this.changed();
    } catch (error) { this.error = error.message; this.changed(); throw error; }
  }
  async resolve(key, choice, beforeApply = () => {}) {
    this.assertActive(); const remote = this.conflicts[key];
    if (!remote || !this.pending[key]) throw new Error('Конфликт уже изменился. Обновите список.');
    if (!['remote', 'local'].includes(choice)) throw new Error('Выберите одну из двух версий.');
    beforeApply(); // Runtime freezes mounted editors BEFORE changing their CAS base.
    if (remote.version > 0) this.rows[key] = clone(remote); else delete this.rows[key];
    if (choice === 'remote') delete this.pending[key];
    else this.pending[key] = { ...this.pending[key], id: crypto.randomUUID(), baseVersion: remote.version };
    delete this.conflicts[key]; delete this.incoming[key];
    await this.durable();
    if (choice === 'local') await this.flush();
  }
  status() {
    return { pending: Object.keys(this.pending).length + Object.keys(this.events).length,
      conflicts: Object.keys(this.conflicts), incoming: Object.keys(this.incoming).length,
      saving: Boolean(this.flushing), cachePending: this.savedRevision < this.saveRevision,
      error: this.error, cacheError: this.cacheError };
  }
}
