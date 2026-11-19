// Real PostgreSQL tests for code consumption/rotation. Auth tables are fixtures;
// explicitly reproduce GoTrue's multi-statement admin-create/admin-update order.
import { randomUUID, randomBytes, createHash } from 'node:crypto';

export async function testUsernameRecovery({ db, as, rpc, one, ok, denied }) {
  const service = (name,args=[]) => as(null,async () => (await one(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`,args)).result,'service_role');
  const hashes = () => Array.from({length:10},() => createHash('sha256').update(randomBytes(16)).digest('hex'));
  async function create(login) {
    const codes=hashes(); const ticket=await service('domashka_register_ticket',[login,codes]);
    const user={id:ticket.userId,session:randomUUID(),login,codes,ticket:ticket.ticket};
    await db.exec('begin');
    try {
      // Auth inserts provider metadata before applying admin app_metadata and
      // email_confirm. A simplified single INSERT would miss this contract.
      await db.query('insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4)',
        [user.id,`${login}@parents.domashka.invalid`,{provider:'email'},{name:login}]);
      await db.query('update auth.users set raw_app_meta_data=$2 where id=$1',[user.id,{provider:'email',domashka_role:'parent',domashka_auth:'username',domashka_login:login}]);
      await db.query('update auth.users set email_confirmed_at=clock_timestamp() where id=$1',[user.id]);
      await db.exec('commit');
    } catch(error) { await db.exec('rollback'); throw error; }
    await db.query('insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())',[user.session,user.id]);
    return user;
  }
  async function authReset(user,ticket,kind='domashka_recovery_ticket') {
    await db.exec('begin');
    try {
      // Admin update: hash update and logout precede app_metadata in one tx.
      await db.query('update auth.users set encrypted_password=$2 where id=$1',[user.id,`fixture-hash-${randomUUID()}`]);
      await db.query('delete from auth.sessions where user_id=$1',[user.id]);
      await db.query('update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object($2::text,$3::text) where id=$1',[user.id,kind,ticket]);
      await db.exec('commit');
    } catch(error) { await db.exec('rollback'); throw error; }
  }
  async function fresh(user) {
    user.session=randomUUID(); await db.query('insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())',[user.session,user.id]);
  }
  const alice=await create('backup_parent'); const bob=await create('other_backup');
  ok((await rpc(alice,'domashka_get_family')).account.login === 'backup_parent','username parent profile exposes a login, not a synthetic email');
  ok((await rpc(alice,'domashka_backup_status')).remaining===10,'registration creates exactly ten unused codes');
  const stored=await one('select array_agg(code_hash order by position) as hashes from domashka_private.backup_codes where user_id=$1',[alice.id]);
  ok(JSON.stringify(stored.hashes)===JSON.stringify(alice.codes),'only validated hashes are persisted with stable code positions');
  const metadata=(await one('select raw_app_meta_data from auth.users where id=$1',[alice.id])).raw_app_meta_data;
  ok(!JSON.stringify(metadata).includes(alice.codes[0]) && !metadata.domashka_registration_ticket,'Auth metadata contains neither codes/hashes nor registration capabilities');
  ok((await one('select code_hashes from domashka_private.account_tickets where id=$1',[alice.ticket])).code_hashes===null,'registration ticket discards its temporary code hashes');
  for(const role of ['anon','authenticated']) {
    await denied(`${role} cannot read backup hashes`,()=>as(alice,()=>db.query('select * from domashka_private.backup_codes'),role));
    await denied(`${role} cannot read password-transaction receipts`,()=>as(alice,()=>db.query('select * from domashka_private.account_password_changes'),role));
    await denied(`${role} cannot mint a registration ticket`,()=>as(alice,()=>db.query('select public.domashka_register_ticket($1,$2)',['injected',hashes()]),role));
    await denied(`${role} cannot bypass CAPTCHA by requesting a recovery ticket`,()=>as(alice,()=>db.query('select public.domashka_recovery_ticket($1,$2)',[alice.login,alice.codes[0]]),role));
    await denied(`${role} cannot replace codes with a direct RPC`,()=>as(alice,()=>db.query('select public.domashka_replace_backup_codes($1,$2,$3,$4)',[alice.id,alice.session,alice.session,hashes()]),role));
  }
  await denied('public registration cannot forge a reserved parent identity',()=>db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[randomUUID(),'forged@parents.domashka.invalid',{domashka_auth:'username',name:'forged'}]));
  await denied('uppercase/noncanonical parent login cannot get a ticket',()=>service('domashka_register_ticket',['CAPITALS',hashes()]));
  await denied('duplicate code hashes are refused',()=>service('domashka_register_ticket',['duplicates',Array(10).fill('a'.repeat(64))]));
  await denied('nine hashes are not a ten-code set',()=>service('domashka_register_ticket',['nine_codes',hashes().slice(0,9)]));
  await denied('plaintext-shaped codes are not hashes',()=>service('domashka_register_ticket',['raw_codes',Array.from({length:10},(_,i)=>'ABCD-'+i)]));
  const expired=await service('domashka_register_ticket',['expired_ticket',hashes()]);
  await db.query("update domashka_private.account_tickets set expires_at=now()-interval '1 minute' where id=$1",[expired.ticket]);
  await denied('expired registration authorization cannot create an account',()=>db.query('insert into auth.users(id,email) values($1,$2)',[expired.userId,'expired_ticket@parents.domashka.invalid']));
  await denied('technical parent identity cannot be changed with an email update',()=>db.query('update auth.users set email=$2 where id=$1',[alice.id,'takeover@example.test']));
  await denied('wrong code receives no authorization',()=>service('domashka_recovery_ticket',[alice.login,'0'.repeat(64)]));
  await denied('another parent cannot use this code',()=>service('domashka_recovery_ticket',[bob.login,alice.codes[0]]));
  const first=await service('domashka_recovery_ticket',[alice.login,alice.codes[0]]);
  const parallel=await service('domashka_recovery_ticket',[alice.login,alice.codes[0]]);
  const distinct=await service('domashka_recovery_ticket',[alice.login,alice.codes[1]]);
  ok((await rpc(alice,'domashka_backup_status')).remaining===10,'requesting a ticket does not consume a code');
  await denied('metadata alone cannot consume a code without a password update in the same transaction',()=>db.query('update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object(\'domashka_recovery_ticket\',$2::text) where id=$1',[alice.id,first.ticket]));
  await authReset(alice,first.ticket);
  const oldSession={...alice};
  await denied('recovery revokes access for the previous session',()=>rpc(oldSession,'domashka_get_family'));
  await fresh(alice);
  ok((await rpc(alice,'domashka_backup_status')).remaining===9,'one reset consumes exactly one of ten codes');
  const before=(await one('select encrypted_password from auth.users where id=$1',[alice.id])).encrypted_password;
  await denied('two previously authorized requests cannot use the same code twice',()=>authReset(alice,parallel.ticket));
  ok((await one('select encrypted_password from auth.users where id=$1',[alice.id])).encrypted_password===before,'failed repeat rolls back the actual password update');
  ok((await rpc(alice,'domashka_backup_status')).remaining===9,'failed repeat also rolls back logout/session epoch changes');
  await denied('a racing different code cannot apply against a superseded password epoch',()=>authReset(alice,distinct.ticket));
  ok((await one('select used_at from domashka_private.backup_codes where user_id=$1 and position=2',[alice.id])).used_at===null,'losing a concurrent reset does not destroy its unused code');
  await denied('used code cannot authorize a new request',()=>service('domashka_recovery_ticket',[alice.login,alice.codes[0]]));
  const second=await service('domashka_recovery_ticket',[alice.login,alice.codes[1]]);
  await authReset(alice,second.ticket); await fresh(alice);
  ok((await rpc(alice,'domashka_backup_status')).remaining===8,'a second forgotten password uses the next code, without rotating the other eight');
  const removed=(await one('select raw_app_meta_data from auth.users where id=$1',[alice.id])).raw_app_meta_data;
  ok(!removed.domashka_recovery_ticket,'consumed recovery capability is stripped from Auth metadata');
  // A successful ordinary password change leaves codes intact, and its tx
  // receipt cannot be reused in a later separate metadata-only transaction.
  await db.query("update auth.users set encrypted_password='ordinary-fixture-hash' where id=$1",[alice.id]);
  await fresh(alice); const third=await service('domashka_recovery_ticket',[alice.login,alice.codes[2]]);
  await denied('transaction receipts cannot authorize a later transaction',()=>db.query('update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object(\'domashka_recovery_ticket\',$2::text) where id=$1',[alice.id,third.ticket]));
  ok((await rpc(alice,'domashka_backup_status')).remaining===8,'ordinary password changes preserve unused codes');
  const newHashes=hashes();
  await denied('rapid repeated rotation is throttled',()=>service('domashka_replace_backup_codes',[alice.id,alice.session,alice.session,newHashes]));
  await db.query("update domashka_private.backup_codes set created_at=clock_timestamp()-interval '2 minutes' where user_id=$1",[alice.id]);
  await denied('a foreign proof session cannot rotate codes',()=>service('domashka_replace_backup_codes',[alice.id,alice.session,bob.session,newHashes]));
  await service('domashka_replace_backup_codes',[alice.id,alice.session,alice.session,newHashes]);
  ok((await rpc(alice,'domashka_backup_status')).remaining===10,'password-authenticated rotation installs exactly ten new codes');
  await denied('every old unused code is revoked on rotation',()=>service('domashka_recovery_ticket',[alice.login,alice.codes[3]]));
  await denied('tickets issued before rotation do not survive it',()=>authReset(alice,third.ticket));
  const final=await service('domashka_recovery_ticket',[alice.login,newHashes[0]]); await authReset(alice,final.ticket); await fresh(alice);
  ok((await rpc(alice,'domashka_backup_status')).remaining===9,'newly rotated codes work');
  for (let i=1;i<10;i++) { const next=await service('domashka_recovery_ticket',[alice.login,newHashes[i]]); await authReset(alice,next.ticket); await fresh(alice); }
  ok((await rpc(alice,'domashka_backup_status')).remaining===0,'all ten independent codes can be used exactly once');
  await denied('an exhausted set cannot reset the password again',()=>service('domashka_recovery_ticket',[alice.login,newHashes[9]]));
  await db.query('update public.domashka_profiles set disabled=true where id=$1',[bob.id]);
  await denied('backup codes cannot bypass an account block',()=>service('domashka_recovery_ticket',[bob.login,bob.codes[0]]));
  // Real child creation sequence also uses a preallocated server-authorized ID.
  const ct=await rpc(alice,'domashka_admin_ticket',['create_child',null,'sequence_child']);
  const family=(await rpc(alice,'domashka_get_family')).account.familyCode;
  const child={id:ct,session:randomUUID()};
  await db.query('insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4)',[ct,`sequence_child.${family}@children.domashka.invalid`,{provider:'email'},{name:'Sequence child',age:10,grade:4}]);
  await db.query('update auth.users set raw_app_meta_data=$2,email_confirmed_at=now() where id=$1',[ct,{domashka_role:'child',domashka_parent:alice.id,domashka_login:'sequence_child'}]);
  await db.query('insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())',[child.session,child.id]);
  ok((await rpc(child,'domashka_get_family')).account.role==='child','GoTrue metadata-after-insert sequence creates a child, never a parent');
  await denied('children cannot view parent recovery status',()=>rpc(child,'domashka_backup_status'));
  const reset=await rpc(alice,'domashka_admin_ticket',['reset_child',child.id,null]); await authReset(child,reset,'domashka_reset_ticket'); await fresh(child);
  ok((await rpc(child,'domashka_get_family')).account.id===child.id,'parent child-password reset works with GoTrue multi-statement ordering');
  for(let i=0;i<5;i++) await service('domashka_account_rate',['register','1'.repeat(64),'2'.repeat(64)]);
  await denied('public registration has an atomic per-login attempt cap',()=>service('domashka_account_rate',['register','3'.repeat(64),'2'.repeat(64)]));
  for(let i=0;i<10;i++) await service('domashka_account_rate',['recover','4'.repeat(64),'5'.repeat(64)]);
  await denied('public recovery has an atomic per-login attempt cap',()=>service('domashka_account_rate',['recover','6'.repeat(64),'5'.repeat(64)]));
}
