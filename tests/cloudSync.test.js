import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { DocumentSync } from '../src/cloud/documentSync';
import { EMPTY_STATS, SYNC_PREFS, assertDocument } from '../src/cloud/schema';
import { validateCloudConfig, loginEmail } from '../src/cloud/client';
import { createPhotoStore } from '../src/cloud/photos';

const uid = '11111111-1111-4111-8111-111111111111';
const key = 'pref/domashka_diary_tasks_v21';
const row = (value = '[]', version = 1, extra = {}) => ({ user_id: uid, key, value, version, deleted: value === null, mutation_id: crypto.randomUUID(), ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise,resolve,reject }; };
function engine(overrides = {}) {
  return new DocumentSync({ uid, persist: vi.fn(async () => {}),
    sendDocument: vi.fn(async (key, op) => ({ ...row(op.value,op.baseVersion+1), key, ok:true, mutation_id:op.id })),
    sendActivity: vi.fn(async (event) => ({ ...EMPTY_STATS, version:1, xp:event.gain })), ...overrides });
}
beforeEach(() => { delete window.__DOMASHKA_CLOUD__; });

describe('durable cloud document synchronization', () => {
  it('queues a change durably before sending it and accepts only the matching receipt', async () => {
    const sync=engine(); sync.put(key,'[{"id":"one"}]'); await sync.flush();
    expect(sync.persist).toHaveBeenCalled(); expect(sync.sendDocument).toHaveBeenCalledTimes(1);
    expect(sync.status().pending).toBe(0); expect(sync.read(key)).toContain('one');
    expect(sync.rows[key].version).toBe(1);
  });
  it('retains an offline outbox across a browser reload', async () => {
    let saved; const sync=engine({ persist:async (data) => { saved=data; }, sendDocument:async () => { throw new Error('offline'); } });
    sync.put(key,'[{"id":"offline"}]'); await expect(sync.flush()).rejects.toThrow('offline');
    expect(sync.status().pending).toBe(1);
    const restored=engine({ cached:saved }); await restored.flush(); expect(restored.read(key)).toContain('offline'); expect(restored.status().pending).toBe(0);
  });
  it('clears a lost-response mutation only after finding its receipt on the server', async () => {
    const sync=engine(); sync.put(key,'[1]'); const id=sync.pending[key].id;
    sync.ingest([row('[1]',1,{mutation_id:id})],{boot:true}); await sync.durable();
    expect(sync.status().pending).toBe(0); expect(sync.read(key)).toBe('[1]');
  });
  it('acknowledges identical initial defaults from another device without a fake conflict', async () => {
    const sync=engine({sendDocument:async () => ({conflict:true,remote:row('[]',1)})});
    sync.put(key,'[]'); await sync.flush();
    expect(sync.status()).toMatchObject({pending:0,conflicts:[],incoming:0});
    expect(sync.rows[key].version).toBe(1); expect(sync.read(key)).toBe('[]');
    sync.put(key,'[1]'); expect(sync.pending[key].baseVersion).toBe(1);
  });
  it('recovers identical values with different receipts after reload', async () => {
    const sync=engine(); sync.put(key,'[]'); sync.ingest([row('[]',2)],{boot:true}); await sync.durable();
    expect(sync.status()).toMatchObject({pending:0,conflicts:[]}); expect(sync.rows[key].version).toBe(2);
  });
  it('does not acknowledge a newer edit when the old in-flight value matches another device', async () => {
    const gate=deferred(); const send=vi.fn(async () => { await gate.promise; return {conflict:true,remote:row('[]',1)}; });
    const sync=engine({sendDocument:send}); sync.put(key,'[]'); const job=sync.flush();
    await vi.waitFor(() => expect(send).toHaveBeenCalled()); sync.put(key,'[1]'); gate.resolve(); await job;
    expect(sync.read(key)).toBe('[1]'); expect(sync.pending[key].baseVersion).toBe(0);
    expect(sync.conflicts[key].value).toBe('[]');
  });
  it('stages incoming values instead of overwriting a mounted editor', async () => {
    const sync=engine(); sync.ingest([row('[1]')],{boot:true}); sync.ingest([row('[2]',2)]);
    expect(sync.read(key)).toBe('[1]'); expect(sync.status().incoming).toBe(1);
    sync.put(key,'[3]'); expect(sync.pending[key].baseVersion).toBe(1);
    sync.sendDocument=async () => ({conflict:true,remote:row('[2]',2)}); await sync.flush();
    expect(sync.read(key)).toBe('[3]'); expect(sync.conflicts[key].value).toBe('[2]');
  });
  it('explicitly keeps the local version with a new CAS base, not a blind overwrite', async () => {
    const sync=engine(); sync.ingest([row('[1]')],{boot:true}); sync.put(key,'[3]'); sync.ingest([row('[2]',2)]);
    await sync.resolve(key,'local'); expect(sync.read(key)).toBe('[3]'); expect(sync.rows[key].version).toBe(3);
    expect(sync.status().conflicts).toEqual([]);
  });
  it('explicitly accepts a remote tombstone and persists the choice', async () => {
    const sync=engine(); sync.ingest([row('[1]')],{boot:true}); sync.put(key,'[3]'); sync.ingest([row(null,2)]);
    await sync.resolve(key,'remote'); expect(sync.read(key)).toBeNull(); expect(sync.status().pending).toBe(0);
    expect(engine({cached:sync.snapshot()}).read(key)).toBeNull();
  });
  it('does not cache an invalid version-zero row when accepting a missing remote record', async () => {
    const sync=engine(); sync.ingest([row('[1]')],{boot:true}); sync.put(key,'[3]'); sync.ingest([],{boot:true});
    expect(sync.conflicts[key].version).toBe(0); await sync.resolve(key,'remote');
    expect(() => engine({cached:sync.snapshot()})).not.toThrow(); expect(sync.read(key)).toBeNull();
  });
  it('keeps newer local typing while an earlier version is in flight', async () => {
    const gate=deferred(); const sync=engine({sendDocument:async (key,op) => { await gate.promise; return {...row(op.value,1),ok:true,mutation_id:op.id}; }});
    sync.put(key,'[1]'); const flushing=sync.flush(); await vi.waitFor(() => expect(sync.status().saving).toBe(true));
    await new Promise((r) => setTimeout(r,0)); sync.put(key,'[2]'); gate.resolve(); await flushing;
    expect(sync.read(key)).toBe('[2]'); expect(sync.pending[key].baseVersion).toBe(1);
    expect(sync.status().pending).toBe(1);
  });
  it('serializes IndexedDB snapshots so an old slow write cannot clobber a newer edit', async () => {
    const gate=deferred(); const snapshots=[]; const sync=engine({persist:async (data) => { if(!snapshots.length) await gate.promise; snapshots.push(data); }});
    sync.put(key,'[1]'); await Promise.resolve(); sync.put(key,'[2]'); gate.resolve(); await sync.durable();
    expect(snapshots.at(-1).pending[key].value).toBe('[2]'); expect(sync.status().cachePending).toBe(false);
  });
  it('surfaces a synchronous cache failure, retries, and never falsely labels offline data durable', async () => {
    const sync=engine({persist:() => { throw new Error('quota'); }}); sync.put(key,'[1]');
    await expect(sync.durable()).rejects.toThrow('quota'); expect(sync.status().cachePending).toBe(true);
    sync.persist=async () => {}; await sync.durable(); expect(sync.status().cacheError).toBe('');
  });
  it('can save online even if device persistence failed, without hiding the cache error', async () => {
    const sync=engine({persist:async () => { throw new Error('quota'); }}); sync.put(key,'[1]'); await sync.flush();
    expect(sync.status().pending).toBe(0); expect(sync.status().cacheError).toBe('quota');
  });
  it('refuses mixed owners, unsupported keys and malformed receipts', async () => {
    const sync=engine(); expect(() => sync.ingest([row('[]',1,{user_id:'other'})])).toThrow(/другого/);
    expect(() => engine({cached:{format:1,uid:'other'}})).toThrow(/другому/);
    expect(() => sync.put('pref/domashka_accounts_v4','{}')).toThrow();
    sync.put(key,'[1]'); sync.sendDocument=async () => ({...row('[1]'),ok:true,user_id:'other'});
    await expect(sync.flush()).rejects.toThrow(/не подтвердил/); expect(sync.status().pending).toBe(1);
  });
  it('freezes an in-flight save after account change and preserves its original outbox', async () => {
    const gate=deferred(); let active=true; const sync=engine({ assertActive:() => { if(!active) throw new Error('changed'); },
      sendDocument:async (_key,op) => { await gate.promise; return {...row(op.value),ok:true,mutation_id:op.id}; } });
    sync.put(key,'[1]'); const flushing=sync.flush(); await new Promise((r) => setTimeout(r,0)); active=false; gate.resolve();
    await expect(flushing).rejects.toThrow('changed'); expect(sync.status().pending).toBe(1);
    expect(() => sync.put(key,'[2]')).toThrow('changed');
  });
  it('deduplicates stable task events and displays confirmed, not speculative XP', async () => {
    const sync=engine(); sync.activity('homework_done',10,'task-a'); sync.activity('homework_done',10,'task-a');
    expect(sync.getStats()).toMatchObject({xp:0,pendingActivities:1}); await sync.flush();
    expect(sync.getStats()).toMatchObject({xp:10,pendingActivities:0}); sync.activity('homework_done',10,'task-a');
    expect(sync.status().pending).toBe(0);
    const otherDevice=engine(); otherDevice.activity('homework_done',10,'task-a');
    expect(Object.keys(otherDevice.events)[0]).toBe(sync.receipts[0]);
  });
  it('keeps an event if the server did not return valid statistics', async () => {
    const sync=engine({sendActivity:async () => null}); sync.activity('solve',15);
    await expect(sync.flush()).rejects.toThrow(/не подтвердил/); expect(sync.status().pending).toBe(1);
  });
  it('never rolls statistics back when older responses arrive later', () => {
    const sync=engine(); sync.setStats({...EMPTY_STATS,version:3,xp:12}); sync.setStats({...EMPTY_STATS,version:2,xp:8}); expect(sync.getStats().xp).toBe(12);
  });
  it('rejects tampered cache events before making a network call', () => {
    expect(() => engine({cached:{format:1,uid,events:{oops:{id:'oops',kind:'solve',gain:99999}}}})).toThrow(/кэша/);
  });
  it('fresh boot uses authoritative rows, including a database restore with older revisions', () => {
    const sync=engine(); sync.ingest([row('[9]',9)],{boot:true}); sync.ingest([row('[2]',2)],{boot:true}); expect(sync.read(key)).toBe('[2]');
  });
});

describe('cloud configuration and storage boundaries', () => {
  const valid={url:'https://exampleproject.supabase.co',publishableKey:'sb_publishable_1234567890abcdef123456',siteUrl:'https://school.pages.dev/'};
  it('allows only public client configuration and explicitly excludes GitHub Pages for password transactions', () => {
    expect(validateCloudConfig(valid).url).toBe(valid.url);
    for(const patch of [{publishableKey:'sb_secret_1234567890abcdef'},{serviceRole:'bad'},{url:'https://evil.test'},{siteUrl:'https://school.github.io/app/'}]) expect(() => validateCloudConfig({...valid,...patch})).toThrow();
    const privileged=`e30.${btoa('{"role":"service_role"}')}.signature`; expect(() => validateCloudConfig({...valid,publishableKey:privileged})).toThrow();
  });
  it('accepts parent usernames, legacy emails and full child logins, never raw internal addresses', () => {
    expect(loginEmail(' Parent@Example.com ')).toBe('parent@example.com');
    expect(loginEmail('anna.012345abcdef')).toBe('anna.012345abcdef@children.domashka.invalid');
    expect(loginEmail(' Anna ')).toBe('anna@parents.domashka.invalid');
    for(const login of ['ab','child@children.domashka.invalid','anna@parents.domashka.invalid','a.b','../anna']) expect(() => loginEmail(login)).toThrow();
  });
  it('whitelists the nine study preferences, not accounts, secrets, drafts or statistics', () => {
    expect(SYNC_PREFS).toHaveLength(9);
    for(const bad of ['domashka_accounts_v4','domashka_pro_ai_settings_v2','domashka_parental_control_v1','domashka_pro_student_stats_v21','domashka_family_answer_draft_v4_1']) expect(() => assertDocument(`pref/${bad}`,'{}')).toThrow();
  });
  it('persists separate user/project envelopes and clears only the selected workspace', async () => {
    vi.resetModules(); vi.stubGlobal('indexedDB',new IDBFactory());
    const cache=await import('../src/cloud/cache'); const a={uid,format:1,pending:{one:'local'}};
    await cache.saveCloudCache(uid,a,'project-a'); await cache.saveCloudCache(uid,{...a,pending:{two:'other'}},'project-b');
    expect((await cache.loadCloudCache(uid,'project-a')).pending).toEqual(a.pending);
    await cache.clearCloudCache(uid,'project-a'); expect(await cache.loadCloudCache(uid,'project-a')).toBeNull();
    expect((await cache.loadCloudCache(uid,'project-b')).pending).toEqual({two:'other'});
  });
});

describe('private photo packing', () => {
  it('uses immutable content hashes, deduplicates repeated images and restores through authorized download', async () => {
    const upload=vi.fn(async () => {}); const download=vi.fn(async () => new Blob([Uint8Array.from([1,2,3])],{type:'image/jpeg'}));
    const store=createPhotoStore({uid,upload,download,assertActive:() => {}}); const image='data:image/jpeg;base64,AQID';
    const packed=await store.pack({image_b64:image,images_b64:[image]}); expect(upload).toHaveBeenCalledTimes(1);
    expect(packed.image_b64.path).toMatch(new RegExp(`^${uid}/private/[a-f0-9]{64}\\.jpeg$`));
    expect(JSON.stringify(packed)).not.toContain('AQID');
    expect((await store.unpack(packed)).image_b64).toBe(image); expect(download).toHaveBeenCalledTimes(1);
  });
  it('uses a separate family path for homework and rejects prototype/depth attacks', async () => {
    const store=createPhotoStore({uid,upload:async () => {},download:async () => {},assertActive:() => {}});
    expect((await store.pack('data:image/png;base64,AQID',{childId:uid})).path).toContain(`/family/${uid}/`);
    await expect(store.pack(JSON.parse('{"__proto__":{"bad":true}}'))).rejects.toThrow(/Недопустимое/);
    let nested={}; for(let n=0;n<18;n++) nested={nested}; await expect(store.pack(nested)).rejects.toThrow(/вложенная/);
  });
  it('cannot upload after an account transition', async () => {
    const upload=vi.fn(); const store=createPhotoStore({uid,upload,download:vi.fn(),assertActive:() => { throw new Error('changed'); }});
    await expect(store.pack('data:image/png;base64,AQID')).rejects.toThrow('changed'); expect(upload).not.toHaveBeenCalled();
  });
});
