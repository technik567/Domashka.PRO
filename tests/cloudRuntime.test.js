import { beforeEach, describe, expect, it, vi } from 'vitest';
const uid='11111111-1111-4111-8111-111111111111';
const sid='22222222-2222-4222-8222-222222222222';
const jwt=(sub=uid,session_id=sid) => `e30.${btoa(JSON.stringify({sub,session_id}))}.test-signature`;
const config={url:'https://exampleproject.supabase.co',publishableKey:'sb_publishable_0123456789abcdef012345',siteUrl:'https://example.pages.dev/'};
function fakeClient(session) {
  return {auth:{getSession:vi.fn(async () => ({data:{session}})),signOut:vi.fn(async () => ({error:null}))},
    rpc:vi.fn(() => ({setHeader:vi.fn(async () => ({data:{ok:true},error:null}))}))};
}
beforeEach(() => {vi.resetModules(); delete window.__DOMASHKA_CLOUD__;});

describe('immutable cloud runtime identity', () => {
  it('pins every RPC bearer to the captured account/session', async () => {
    window.__DOMASHKA_CLOUD__=config; const {CloudRuntime}=await import('../src/cloud/runtime');
    const client=fakeClient({user:{id:uid},access_token:jwt()}); const runtime=new CloudRuntime(uid,client,sid);
    await runtime.rpc('example',{value:'own data'});
    expect(client.rpc).toHaveBeenCalledWith('example',{value:'own data'});
    expect(client.rpc.mock.results[0].value.setHeader).toHaveBeenCalledWith('Authorization',`Bearer ${jwt()}`);
  });
  it('refuses a mismatched JWT subject even if cached user metadata still says the previous user', async () => {
    window.__DOMASHKA_CLOUD__=config; const {CloudRuntime}=await import('../src/cloud/runtime');
    const client=fakeClient({user:{id:uid},access_token:jwt('another-user')}); const runtime=new CloudRuntime(uid,client,sid);
    await expect(runtime.rpc('save')).rejects.toThrow(/Сеанс изменён/); expect(client.rpc).not.toHaveBeenCalled();
  });
  it('refuses a different session for the SAME user instead of resuming a stale mounted editor', async () => {
    window.__DOMASHKA_CLOUD__=config; const {CloudRuntime}=await import('../src/cloud/runtime');
    const client=fakeClient({user:{id:uid},access_token:jwt(uid,crypto.randomUUID())}); const runtime=new CloudRuntime(uid,client,sid);
    await expect(runtime.rpc('save')).rejects.toThrow(/Сеанс изменён/); expect(client.rpc).not.toHaveBeenCalled();
  });
  it('cannot logout and discard an unsent queue when flushing fails', async () => {
    window.__DOMASHKA_CLOUD__=config; const {CloudRuntime}=await import('../src/cloud/runtime');
    const client=fakeClient({user:{id:uid},access_token:jwt()}); const runtime=new CloudRuntime(uid,client,sid);
    runtime.flush=async () => {throw new Error('offline');};
    await expect(runtime.logoutAccount()).rejects.toThrow('offline'); expect(client.auth.signOut).not.toHaveBeenCalled(); expect(runtime.transitioning).toBe(false);
  });
  it('freezes editors BEFORE accepting remote data, not after a slow cache transaction', async () => {
    window.__DOMASHKA_CLOUD__=config; const {CloudRuntime}=await import('../src/cloud/runtime'); const {DocumentSync}=await import('../src/cloud/documentSync');
    const client=fakeClient({user:{id:uid},access_token:jwt()}); const runtime=new CloudRuntime(uid,client,sid);
    let finish; let slow=false;
    runtime.sync=new DocumentSync({uid,persist:async () => {if(slow) await new Promise((resolve) => {finish=resolve;});},assertActive:() => runtime.assertActive()});
    const key='pref/domashka_diary_tasks_v21'; const old={key,user_id:uid,value:'[1]',version:1};
    runtime.sync.ingest([old],{boot:true}); runtime.sync.put(key,'[2]'); runtime.sync.ingest([{...old,value:'[3]',version:2}]); await runtime.sync.durable();
    slow=true; const resolving=runtime.resolveConflict(key,'remote');
    expect(runtime.reloadRequired).toBe(true); expect(() => runtime.sync.put(key,'[4]')).toThrow(/версия/);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function')); finish(); await resolving;
    expect(runtime.sync.read(key)).toBe('[3]');
  });
  it('fails closed for child AI when parental policy has not been verified recently', async () => {
    window.__DOMASHKA_CLOUD__=config; const {CloudRuntime}=await import('../src/cloud/runtime');
    const runtime=new CloudRuntime(uid,fakeClient({user:{id:uid},access_token:jwt()}),sid);
    runtime.family={account:{role:'child'}}; runtime.lastPolicyCheck=Date.now()-46000;
    expect(() => runtime.verifyAiPolicy()).toThrow(/ограничения/); runtime.lastPolicyCheck=Date.now(); expect(() => runtime.verifyAiPolicy()).not.toThrow();
  });
});

describe('explicit study-data transfer', () => {
  it('does not include local credentials, sessions or AI keys in an exported study file', async () => {
    let accounts=await import('../src/standalone/accounts'); const challenge=accounts.issueParentChallenge();
    await accounts.createAccount({role:'parent',name:'Export parent',login:'parent',password:'Never_export_password',challengeId:challenge.id,challengeAnswer:String(Math.sqrt(challenge.square))});
    vi.resetModules(); const storage=await import('../src/standalone/storageEngine');
    storage.safeStorage.setItem('domashka_pro_ai_settings_v2','{"openrouterKey":"Never_export_AI_key"}');
    storage.safeStorage.setItem('domashka_diary_tasks_v21','[{"id":"study-task","text":"Read a chapter"}]');
    const {exportStudyWorkspace}=await import('../src/standalone/workspaceTransfer'); const result=await exportStudyWorkspace(); const json=JSON.stringify(result);
    expect(json).toContain('Read a chapter'); expect(json).not.toContain('Never_export'); expect(json).not.toMatch(/salt|password|session|token|openrouterKey/);
  });
  it('rejects credential documents disguised as a transfer and strips extra chat properties', async () => {
    const {parseStudyImport}=await import('../src/standalone/workspaceTransfer');
    expect(() => parseStudyImport(JSON.stringify({type:'domashka-study-transfer',version:1,settings:{domashka_accounts_v4:'{}'},chats:[]}))).toThrow();
    const result=parseStudyImport(JSON.stringify({items:[{id:'chat',response_md:'Study answer',password:'must-not-copy',messages:[{role:'system',content:'secret'},{role:'user',content:'question',apiKey:'no'}]}],stats:{xp:10}}));
    expect(JSON.stringify(result)).not.toMatch(/must-not-copy|apiKey|secret/); expect(result.chats).toBe(1); expect(result.stats.xp).toBe(10);
  });
  it('rejects duplicate IDs and someone else cloud-photo references', async () => {
    const {parseStudyImport}=await import('../src/standalone/workspaceTransfer');
    const item={id:'same',response_md:'note'};
    expect(() => parseStudyImport(JSON.stringify({items:[item,item]}))).toThrow(/повторяющиеся/);
    expect(() => parseStudyImport(JSON.stringify({items:[{...item,image_b64:{__cloud_photo:1,path:`${uid}/private/${'a'.repeat(64)}.jpeg`}}]}))).toThrow(/сами фото/);
  });
});
