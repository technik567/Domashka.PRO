// Runs the REAL migration SQL on PostgreSQL (PGlite), not a mocked JS policy.
// Auth/Storage infrastructure tables and JWT claims are fixtures: this does not
// certify a deployed GoTrue/SMTP/Storage service. No network, keys or real users.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { CHEAT_SHEETS } from '../src/data/referenceData.js';
import { buildFlashcardsFromSheets, buildFlashcardChecks, flashcardKey, normalizeFlashcardAnswer } from '../src/standalone/flashcardContent.js';

const db = new PGlite(); let checks = 0;
const ok = (condition, label) => { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); };
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0];
async function as(user, action, role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [user?.id || '', JSON.stringify(user ? { sub: user.id, session_id: user.session, role } : { role })]);
  await db.exec(`set role ${role}`);
  try { return await action(); } finally { await db.exec('reset role'); }
}
async function rpc(user, name, args = []) {
  const json = { domashka_save_document: [1], domashka_write_homework: [3], domashka_import_workspace: [1,2] }[name] || [];
  args = args.map((value, index) => value !== null && json.includes(index) ? JSON.stringify(value) : value);
  return as(user, async () => (await one(`select public.${name}(${args.map((_,i) => `$${i+1}`).join(',')}) as result`, args)).result);
}
async function denied(label, action) {
  let error; try { await action(); } catch (err) { error = err; }
  ok(Boolean(error), label); return error;
}
async function parent(label, confirmed = true) {
  const user = { id: randomUUID(), session: randomUUID() };
  await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,$3,$4)", [user.id, `${label}@example.test`, confirmed ? new Date().toISOString() : null, { name: label, time_zone: 'Asia/Yekaterinburg' }]);
  await db.query('insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())', [user.session,user.id]);
  return user;
}
async function child(owner, label) {
  const user = { id: randomUUID(), session: randomUUID() };
  const ticket = await rpc(owner,'domashka_admin_ticket',['create_child',null,label]);
  const { family_code } = await one('select family_code from public.domashka_profiles where id=$1',[owner.id]);
  await db.query('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values($1,$2,now(),$3,$4)',
    [user.id,`${label}.${family_code}@children.domashka.invalid`,{ domashka_role:'child',domashka_parent:owner.id,domashka_login:label,domashka_create_ticket:ticket },{ name:label,grade:5,age:11 }]);
  await db.query('insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())',[user.session,user.id]);
  return { ...user, ticket, fullLogin: `${label}.${family_code}` };
}
async function save(user, key, value, version = 0, id = randomUUID()) { return rpc(user,'domashka_save_document',[key,value,version,id]); }
try {
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,encrypted_password text default '',email_confirmed_at timestamptz,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');
    create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default now());
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text);
    alter table storage.objects enable row level security;
    grant usage on schema auth,storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;`);
  for (const file of fs.readdirSync(new URL('../supabase/migrations/',import.meta.url)).sort()) {
    await db.exec(fs.readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  }
  const p = await parent('parent-one'); const other = await parent('other-family'); const p2 = await parent('second-parent');
  const c = await child(p,'student'); const unrelated = await child(other,'stranger');
  ok((await rpc(c,'domashka_get_family')).account.role === 'child','child is created by a server ticket, not public metadata');
  await denied('anonymous cannot invoke the family RPC',() => as(null,() => db.query('select public.domashka_get_family()'),'anon'));
  await denied('anonymous cannot select profiles',() => as(null,() => db.query('select * from public.domashka_profiles'),'anon'));
  await denied('unconfirmed parent cannot use the database',async () => rpc(await parent('unconfirmed',false),'domashka_get_family'));
  await denied('forged/nonexistent Auth session is rejected',() => rpc({ ...p,session:randomUUID() },'domashka_get_family'));
  ok((await as(c,() => db.query('select id from public.domashka_profiles'))).rows.every((r) => r.id === c.id),'child sees only their own profile');
  ok((await as(p,() => db.query('select id from public.domashka_profiles'))).rows.length === 2,'parent sees self and linked child, not another family');
  await denied('child cannot promote themselves with a table UPDATE',() => as(c,() => db.query("update public.domashka_profiles set role='parent' where id=$1",[c.id])));
  await denied('child cannot alter their policy through a parent RPC',() => rpc(c,'domashka_update_child',[c.id,10,16,false,true,false,1,'auto']));
  await denied('stranger parent cannot alter this child',() => rpc(other,'domashka_update_child',[c.id,10,16,false,true,false,1,'auto']));
  await denied('direct family link insertion is forbidden',() => as(other,() => db.query('insert into public.domashka_family_links values($1,$2)',[other.id,c.id])));
  await db.query("update auth.users set raw_user_meta_data=raw_user_meta_data||'{\"role\":\"parent\",\"tutorOnly\":false}'::jsonb where id=$1",[c.id]);
  ok((await rpc(c,'domashka_get_family')).account.role==='child','user-editable Auth metadata cannot change the app role');
  await denied('reserved child address cannot self-register as a parent',() => db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[randomUUID(),'fake@children.domashka.invalid',{name:'Fake'}]));
  await denied('service-created child without a parent authorization ticket is rejected',() => db.query('insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4)',[randomUUID(),'fake@children.domashka.invalid',{domashka_role:'child',domashka_parent:p.id,domashka_login:'fake'},{name:'Fake',grade:5,age:11}]));
  await denied('private questions cannot be selected by a child',() => as(c,() => db.query('select answers from domashka_private.card_questions')));
  await denied('private helper cannot be called to mint XP',() => as(c,() => db.query("select domashka_private.bump_stats($1,'quiz_correct',999)",[c.id])));
  await denied('direct statistics UPDATE is forbidden',() => as(c,() => db.query('update public.domashka_stats set xp=999999 where user_id=$1',[c.id])));

  const key='pref/domashka_diary_tasks_v21'; const mutation=randomUUID();
  const first=await save(c,key,JSON.stringify([{id:'task',done:false}]),0,mutation);
  ok(first.ok && first.version===1,'first document is written at version 1');
  const replay=await save(c,key,'[]',0,mutation);
  ok(replay.replayed && replay.version===1 && JSON.parse(replay.value).length===1,'lost response replay does not overwrite or advance a revision');
  const conflict=await save(c,key,'[]',0);
  ok(conflict.conflict && JSON.parse(conflict.remote.value).length===1,'stale second device receives the competing version');
  const independent=await save(c,'pref/domashka_cheat_bookmarks_v21','["a"]');
  ok(independent.ok,'independent sections can save without a whole-workspace overwrite');
  const deleted=await save(c,key,null,1);
  ok(deleted.deleted && deleted.version===2,'deletion keeps a versioned tombstone');
  ok((await save(c,key,'[]',1)).conflict,'a stale editor cannot resurrect a deleted section silently');
  await denied('null expected version cannot bypass CAS',() => save(c,key,'[]',null));
  await denied('credential registry is not a sync document',() => save(c,'pref/domashka_accounts_v4','{}'));
  await denied('API keys are not a sync document',() => save(c,'pref/domashka_pro_ai_settings_v2','{"key":"not-a-real-key"}'));
  await denied('unsupported tombstone key is rejected too',() => save(c,'pref/domashka_accounts_v4',null));
  await denied('invalid JSON preference cannot poison the family summary',() => save(c,'pref/domashka_subject_grades_v22','not json'));
  await denied('oversized document is rejected',() => save(c,'chat/big',{id:'big',response_md:'x'.repeat(500001)}));
  await save(c,'chat/private',{id:'private',response_md:'child private notebook'});
  ok((await as(p,() => db.query('select * from public.domashka_documents where user_id=$1',[c.id]))).rows.length===0,'parent does not gain access to the child private notebook');
  ok((await as(other,() => db.query('select * from public.domashka_documents'))).rows.length===0,'other family cannot read private documents');
  ok(Array.isArray((await rpc(p,'domashka_child_summary',[c.id])).tasks),'parent has a narrow planner/marks/statistics summary');
  await denied('unrelated parent cannot use the summary RPC',() => rpc(other,'domashka_child_summary',[c.id]));

  const work=randomUUID(); const workOp=randomUUID();
  const assignment={subject:'math',title:'Fractions',instructions:'Explain one half',due:'2026-11-30'};
  const assign=await rpc(p,'domashka_write_homework',['assign',work,c.id,assignment,0,workOp]);
  ok(assign.version===1 && assign.status==='assigned','parent assigns a server-backed task to their own child');
  ok((await rpc(p,'domashka_write_homework',['assign',work,c.id,assignment,0,workOp])).version===1,'assignment request is idempotent');
  await denied('stranger cannot assign to this child',() => rpc(other,'domashka_write_homework',['assign',randomUUID(),c.id,assignment,0,randomUUID()]));
  await denied('child cannot assign homework',() => rpc(c,'domashka_write_homework',['assign',randomUUID(),c.id,assignment,0,randomUUID()]));
  await denied('unrelated student cannot read this homework',() => rpc(unrelated,'domashka_get_homework',[work]));
  await denied('parent cannot submit as the student',() => rpc(p,'domashka_write_homework',['submit',work,null,{answer:'parent answer'},1,randomUUID()]));
  const submit=await rpc(c,'domashka_write_homework',['submit',work,null,{answer:'My explanation'},1,randomUUID()]);
  ok(submit.status==='submitted' && submit.version===2,'only the assigned student submits');
  await denied('child cannot self-accept',() => rpc(c,'domashka_write_homework',['review',work,null,{accepted:true},2,randomUUID()]));
  await denied('stale homework version cannot overwrite a new answer',() => rpc(c,'domashka_write_homework',['submit',work,null,{answer:'old'},1,randomUUID()]));
  await denied('foreign photo path cannot be attached as the student',() => rpc(c,'domashka_write_homework',['submit',work,null,{answer:'',image:{__cloud_photo:1,path:`${p.id}/private/${'a'.repeat(64)}.jpeg`}},2,randomUUID()]));
  const accepted=await rpc(p,'domashka_write_homework',['review',work,null,{accepted:true,comment:'Good',mark:'5'},2,randomUUID()]);
  ok(accepted.status==='accepted' && accepted.review.byId===p.id,'parent review is authoritative and attributed');
  await denied('accepted work cannot be silently replaced by the student',() => rpc(c,'domashka_write_homework',['submit',work,null,{answer:'replace'},3,randomUUID()]));
  await denied('return for revision needs feedback',() => rpc(p,'domashka_write_homework',['review',work,null,{accepted:false,comment:''},3,randomUUID()]));

  const hash='b'.repeat(64); const privatePath=`${p.id}/private/${hash}.jpeg`; const familyPath=`${c.id}/family/${c.id}/${hash}.jpeg`;
  await as(p,() => db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)', ['domashka-photos',privatePath,p.id]));
  await as(c,() => db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)', ['domashka-photos',familyPath,c.id]));
  ok((await one("select public from storage.buckets where id='domashka-photos'")).public===false,'photo bucket is private');
  ok((await as(c,() => db.query('select name from storage.objects'))).rows.every((r) => r.name!==privatePath),'child cannot read parent private photos');
  ok((await as(p,() => db.query('select name from storage.objects'))).rows.some((r) => r.name===familyPath),'linked parent can read family submission photos');
  ok((await as(other,() => db.query('select name from storage.objects'))).rows.length===0,'unrelated family cannot read any photos');
  await denied('child cannot upload to another user private folder',() => as(c,() => db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['domashka-photos',`${other.id}/private/${hash}.png`,c.id])));
  ok((await as(p,() => db.query('update storage.objects set name=$1 where name=$2 returning id',['changed',privatePath]))).rows.length===0,'immutable photos have no client UPDATE policy');
  ok((await as(p,() => db.query('delete from storage.objects where name=$1 returning id',[privatePath]))).rows.length===0,'client cannot delete photos referenced by another record/device');
  const importedPhoto=`${c.id}/private/${'c'.repeat(64)}.jpeg`;
  ok((await as(p,() => db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3) returning id',['domashka-photos',importedPhoto,p.id]))).rows.length===1,'parent can import a private photo for their own child');
  ok((await as(c,() => db.query('select name from storage.objects'))).rows.some((r) => r.name===importedPhoto),'child can read their imported photo');

  const bad=await rpc(p2,'domashka_accept_link',['invalid-code']);
  ok(Boolean(bad.error) && (await one('select attempts from domashka_private.invite_attempts where user_id=$1',[p2.id])).attempts===1,'invalid invite attempts persist instead of rolling back');
  const invite=await rpc(p,'domashka_create_link',[c.id]);
  ok((await rpc(p2,'domashka_accept_link',[invite])).childId===c.id,'second parent can join only with a valid invitation');
  ok(Boolean((await rpc(other,'domashka_accept_link',[invite])).error),'invitation cannot be reused by a third party');
  ok((await as(p2,() => db.query('select name from storage.objects'))).rows.every((r) => r.name!==importedPhoto),'linked second parent does not gain private notebook photo access');
  const revokedLinkTicket=await rpc(p2,'domashka_admin_ticket',['reset_child',c.id,null]);
  await rpc(p,'domashka_revoke_link',[c.id,p2.id]);
  await denied('Auth transaction rechecks parent link after the Edge authorization step',() => db.query("update auth.users set encrypted_password='must-not-save',raw_app_meta_data=raw_app_meta_data||jsonb_build_object('domashka_reset_ticket',$2::text) where id=$1",[c.id,revokedLinkTicket]));
  await denied('revoked parent loses homework access',() => rpc(p2,'domashka_get_homework',[work]));
  await denied('last parent link cannot be removed',() => rpc(p,'domashka_revoke_link',[c.id,p.id]));

  const card=buildFlashcardsFromSheets(CHEAT_SHEETS,100000).find((item) => item.id==='g3-math-motion-units-b-4');
  const check=await rpc(c,'domashka_begin_card',[flashcardKey(card)]);
  ok(Boolean(check.id) && !('answers' in check),'challenge returns a nonce and question, not accepted answers');
  await denied('other student cannot answer someone else nonce',() => rpc(unrelated,'domashka_answer_card',[check.id,'120']));
  const wrong=await rpc(c,'domashka_answer_card',[check.id,'wrong']);
  ok(!wrong.correct && wrong.awarded===0 && wrong.remaining===2,'wrong answer grants zero XP');
  const correct=await rpc(c,'domashka_answer_card',[check.id,'  СТО ДВАДЦАТЬ! ']);
  ok(correct.correct && correct.awarded===4 && correct.stats.xp===4,'dictated number is checked and rewarded on the server');
  const checkedAgain=await rpc(c,'domashka_answer_card',[check.id,'120']);
  ok(checkedAgain.awarded===4 && checkedAgain.stats.xp===4,'answer retry returns its receipt without double XP');
  const newAttempt=await rpc(c,'domashka_begin_card',[flashcardKey(card)]);
  const repeated=await rpc(c,'domashka_answer_card',[newAttempt.id,'120']);
  ok(repeated.correct && repeated.awarded===0 && repeated.stats.xp===4,'restarted deck cannot farm the same card');
  const failed=await rpc(c,'domashka_begin_card',[flashcardKey(card)]);
  for(let i=0;i<3;i++) await rpc(c,'domashka_answer_card',[failed.id,'wrong']);
  const lateCorrect=await rpc(c,'domashka_answer_card',[failed.id,'120']);
  ok(lateCorrect.finished && !lateCorrect.correct && lateCorrect.awarded===0,'three failed attempts close the nonce permanently');
  const expired=await rpc(c,'domashka_begin_card',[flashcardKey(card)]);
  await db.query("update domashka_private.card_attempts set expires_at=now()-interval '1 minute' where id=$1",[expired.id]);
  await denied('expired nonce cannot mint XP',() => rpc(c,'domashka_answer_card',[expired.id,'120']));
  const corpus=buildFlashcardsFromSheets(CHEAT_SHEETS,100000);
  ok(corpus.every((item) => buildFlashcardChecks(item).length>0),'every generated reference flashcard has a check');
  for (const text of [' ЁЛОЧНОГО. ','одна тысяча','ноль целых пять десятых','минус две целых пять сотых','020.500','−0,00','минус ноль','001.10']) {
    const canonical=await one('select domashka_private.normalize_answer($1) as value',[text]);
    ok(canonical.value===normalizeFlashcardAnswer(text),`SQL/browser normalization: ${text}`);
  }

  const event=randomUUID(); const stats1=await rpc(c,'domashka_record_activity',[event,'solve',15]);
  const stats2=await rpc(c,'domashka_record_activity',[event,'solve',15]);
  ok(stats1.xp===19 && stats2.xp===19 && stats2.solvedCount===1,'activity outbox receipts are idempotent across devices');
  await denied('negative XP is rejected',() => rpc(c,'domashka_record_activity',[randomUUID(),'solve',-1]));
  await denied('arbitrary activity amount is rejected',() => rpc(c,'domashka_record_activity',[randomUUID(),'solve',999999]));
  const legacy=[{key:'pref/domashka_timetable_v30',value:'{"mon":["math"]}'}];
  await denied('child cannot import unverified XP as verified progress',() => rpc(c,'domashka_import_workspace',[c.id,legacy,{xp:500}]));
  const migration=await rpc(p,'domashka_import_workspace',[c.id,legacy,{xp:500,solvedCount:2}]);
  ok(migration.added===1 && migration.stats.importedXp===500 && migration.stats.xp===519,'parent-approved legacy XP is separate from new earned XP');
  const skipped=await rpc(p,'domashka_import_workspace',[c.id,legacy,null]);
  ok(skipped.added===0 && skipped.skipped===1,'retrying import does not replace existing content');
  await denied('legacy statistics cannot be imported twice',() => rpc(p,'domashka_import_workspace',[c.id,[],{xp:500}]));
  await denied('stranger cannot import into this child',() => rpc(other,'domashka_import_workspace',[c.id,legacy,null]));
  const before=(await one('select count(*) as n from public.domashka_documents where user_id=$1',[p.id])).n;
  await denied('mixed valid/credential import rolls back entirely',() => rpc(p,'domashka_import_workspace',[p.id,[...legacy,{key:'pref/domashka_accounts_v4',value:'{}'}],null]));
  ok((await one('select count(*) as n from public.domashka_documents where user_id=$1',[p.id])).n===before,'failed import leaves no partially inserted credentials or preferences');

  const cp=await one('select version from public.domashka_profiles where id=$1',[c.id]);
  await rpc(p,'domashka_update_child',[c.id,6,12,true,false,true,cp.version,'gemma-3-12b']);
  await denied('disabled child cannot read family data with an old JWT',() => rpc(c,'domashka_get_family'));
  await denied('disabled child cannot save an outbox with an old JWT',() => save(c,'pref/domashka_pro_theme_v3','dark'));
  ok((await as(c,() => db.query('select * from storage.objects'))).rows.length===0,'disabled child loses private photo reads');
  await rpc(p,'domashka_update_child',[c.id,6,12,true,true,false,cp.version+1,'gemma-3-12b']);
  ok((await rpc(c,'domashka_get_family')).account.policy.freeModel==='gemma-3-12b','parent-selected free model is server-backed without any API key');
  await denied('stale parent form cannot overwrite controls',() => rpc(p,'domashka_update_child',[c.id,1,6,false,true,false,cp.version,'auto']));
  const ticket=await rpc(p,'domashka_admin_ticket',['reset_child',c.id,null]);
  await db.query("update auth.users set encrypted_password='new-test-password-hash',raw_app_meta_data=raw_app_meta_data||jsonb_build_object('domashka_reset_ticket',$2::text) where id=$1",[c.id,ticket]);
  await denied('password reset invalidates the old app session even before JWT expiry',() => rpc(c,'domashka_get_family'));
  c.session=randomUUID(); await db.query('insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())',[c.session,c.id]);
  ok((await rpc(c,'domashka_get_family')).account.id===c.id,'new Auth session after reset can access the same progress');
  await rpc(c,'domashka_revoke_session');
  await denied('app logout revokes a still-unexpired bearer session',() => rpc(c,'domashka_get_family'));
  const ephemeral=await child(p,'temporary');
  ok(!(await one('select raw_app_meta_data as data from auth.users where id=$1',[ephemeral.id])).data.domashka_create_ticket,'consumed admin ticket is not kept in child Auth metadata');
  await db.query('delete from auth.users where id=$1',[ephemeral.id]);
  await denied('one-use ticket cannot recreate a deleted child',() => db.query('insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4)',[randomUUID(),`${ephemeral.fullLogin}@children.domashka.invalid`,{domashka_role:'child',domashka_parent:p.id,domashka_login:'temporary',domashka_create_ticket:ephemeral.ticket},{name:'Temporary',grade:5,age:11}]));
  const delayedTicket=await rpc(p,'domashka_admin_ticket',['create_child',null,'delayed']);
  const pcode=(await one('select family_code from public.domashka_profiles where id=$1',[p.id])).family_code;
  await rpc(p,'domashka_rotate_sessions',[p.id]);
  await denied('otherwise-valid unused ticket is rejected after parent session rotation',() => db.query('insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4)',[randomUUID(),`delayed.${pcode}@children.domashka.invalid`,{domashka_role:'child',domashka_parent:p.id,domashka_login:'delayed',domashka_create_ticket:delayedTicket},{name:'Delayed',grade:5,age:11}]));
  console.log(`\nCloud SQL: ${checks} assertions passed. Auth/Storage/SMTP are fixtures, not a live deployment.`);
} catch (error) { console.error('Cloud SQL FAILED:',error.message,'code:',error.code || 'assertion',error.where || ''); console.error(error.stack?.split('\n').filter((line) => !line.includes('node_modules')).slice(0,5).join('\n')); process.exitCode=1; } finally { await db.close(); }
