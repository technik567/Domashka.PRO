// Optional end-to-end UI QA. Built HTML + real migration SQL in PGlite;
// HTTP Auth/Storage are fixtures, NOT a live Supabase or a physical phone.
// Run after build:standalone. Install playwright-core in .cache/browser (or set
// PLAYWRIGHT_MODULE to its index.mjs); set CHROMIUM_PATH to a headless Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const { chromium } = await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE || '.cache/browser/node_modules/playwright-core/index.mjs')));
const db = new PGlite();
const results = []; const pageErrors = []; const unexpected = []; const httpCalls = [];
let browser; let server; let queue = Promise.resolve();
const serial = (work) => { const next = queue.catch(() => {}).then(work); queue = next; return next; };
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const ok = (value, label) => { assert.ok(value, label); results.push(label); console.log(`PASS ${label}`); };
const as = async (actor, work) => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [actor.id, JSON.stringify({ sub: actor.id, session_id: actor.session, role: 'authenticated' })]);
  await db.exec('set role authenticated');
  try { return await work(); } finally { await db.exec('reset role'); }
};
const rpc = (actor, name, args = {}) => as(actor, async () => {
  assert.match(name, /^domashka_[a-z_]+$/);
  const entries = Object.entries(args); for (const [key] of entries) assert.match(key, /^[a-z_]+$/);
  const values = entries.map(([key, val]) => ['doc_value','payload','documents','legacy_stats'].includes(key) && val !== null ? JSON.stringify(val) : val);
  return (await one(`select public.${name}(${entries.map(([key], i) => `${key} => $${i+1}`).join(',')}) as result`, values)).result;
});
const actors = new Map(); const tokens = new Map(); const photos = new Map();
const password = 'browser-fixture-only';
const url = 'https://browser-fixture.supabase.co';
let latestAttempt;
async function issueSession(actor) {
  const user = { ...actor, session: randomUUID() };
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [user.session,user.id]);
  const jwt = [ { alg:'none',typ:'JWT' }, { sub:user.id,session_id:user.session,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600 } ]
    .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.') + '.fixture-not-a-real-token';
  tokens.set(jwt,user);
  return { access_token:jwt,refresh_token:randomUUID(),token_type:'bearer',expires_in:3600,user:authUser(user) };
}
function authUser(user) { return { id:user.id,email:user.email,aud:'authenticated',role:'authenticated',
  email_confirmed_at:new Date().toISOString(),created_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{name:user.name} }; }
async function backend(req) {
  const address = new URL(req.url()); const method = req.method();
  const body = method === 'POST' || method === 'PUT' ? (() => { try { return req.postDataJSON(); } catch { return {}; } })() : {};
  const actor = tokens.get((req.headers().authorization || '').replace(/^Bearer /,''));
  httpCalls.push(`${method} ${address.pathname}`);
  if (address.pathname === '/auth/v1/token') {
    const user = actors.get(body.email);
    if (!user || body.password !== password) return {status:400,json:{msg:'Invalid login credentials'}};
    return {json:await issueSession(user)};
  }
  if (!actor) return {status:401,json:{message:'fixture token required'}};
  if (address.pathname === '/auth/v1/user') return {json:authUser(actor)};
  if (address.pathname === '/auth/v1/logout') return {status:204,body:''};
  if (address.pathname.startsWith('/rest/v1/rpc/')) {
    const name = address.pathname.split('/').at(-1); const data = await rpc(actor,name,body || {});
    if (name === 'domashka_begin_card') latestAttempt = data.id;
    return {json:data};
  }
  if (address.pathname.startsWith('/rest/v1/')) {
    const table = address.pathname.split('/').at(-1);
    assert.ok(['domashka_documents','domashka_homework'].includes(table),`unexpected table ${table}`);
    const cols = address.searchParams.get('select') || '*'; assert.match(cols,/^[a-z_,*]+$/);
    const conditions = []; const params = [];
    for (const key of ['id','user_id','child_id','key']) {
      const filter = address.searchParams.get(key); if (!filter) continue;
      if (filter.startsWith('eq.')) { params.push(filter.slice(3)); conditions.push(`${key}=$${params.length}`); }
      else if (filter.startsWith('in.(')) {
        params.push(filter.slice(4,-1).split(',').map((s) => s.replace(/^"|"$/g,''))); conditions.push(`${key}=any($${params.length}::text[])`);
      } else throw Error(`Unsupported fixture filter ${key}`);
    }
    const order = table === 'domashka_documents' ? 'key' : 'created_at desc';
    const limit = Math.min(500,Math.max(0,Number(address.searchParams.get('limit') || 500)));
    const offset = Math.max(0,Number(address.searchParams.get('offset') || 0));
    const query = `select ${cols} from public.${table}${conditions.length ? ' where '+conditions.join(' and ') : ''} order by ${order} limit ${limit} offset ${offset}`;
    return {json:(await as(actor,() => db.query(query,params))).rows};
  }
  if (address.pathname.startsWith('/storage/v1/object/')) {
    const object = decodeURIComponent(address.pathname.replace(/^\/storage\/v1\/object\/(authenticated\/)?domashka-photos\//,''));
    if (method === 'POST') {
      if (photos.has(object)) return {status:409,json:{statusCode:'409',error:'Duplicate',message:'already exists'}};
      await as(actor,() => db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['domashka-photos',object,actor.id]));
      photos.set(object,{body:req.postDataBuffer(),contentType:req.headers()['content-type']});
      return {json:{Key:`domashka-photos/${object}`}};
    }
    const row = await as(actor,() => one('select name from storage.objects where name=$1',[object]));
    if (!row || !photos.has(object)) return {status:404,json:{message:'not found'}};
    return photos.get(object);
  }
  unexpected.push(`${method} ${address.pathname}`); return {status:501,json:{message:'unsupported fixture route'}};
}
async function context(options = {}) {
  const ctx = await browser.newContext(options); const state = {offline:false,ctx};
  await ctx.route('**/*',async (route) => {
    const request = route.request(); const address = new URL(request.url());
    if (address.protocol === 'file:' || address.hostname === 'localhost' || address.hostname === '127.0.0.1') return route.continue();
    if (address.origin !== url) { unexpected.push(request.url()); return route.abort('blockedbyclient'); }
    if (state.offline) return route.abort('internetdisconnected');
    try { const response = await serial(() => backend(request)); await route.fulfill({headers:{'access-control-allow-origin':'*','cache-control':'no-store'},...response}); }
    catch (error) { await route.fulfill({status:400,json:{message:error.message,code:error.code || 'fixture-error'}}); }
  });
  ctx.on('page',(page) => { page.on('pageerror',(error) => pageErrors.push(error.message)); page.on('dialog',(dialog) => dialog.accept()); page.setDefaultTimeout(12000); });
  return state;
}
async function login(state, base, name) {
  const page = await state.ctx.newPage(); await page.goto(base);
  await page.getByLabel('Почта родителя или полный логин ребёнка').fill(name);
  await page.getByLabel('Пароль',{exact:true}).fill(password);
  await page.getByRole('form',{name:'Облачный вход'}).getByRole('button',{name:'Войти',exact:true}).click();
  await page.getByRole('button',{name:'Дневник',exact:true}).waitFor(); return page;
}
const status = (page) => page.getByRole('complementary',{name:'Синхронизация аккаунта'});
async function sync(page) { await status(page).getByRole('button',{name:'Синхронизировать',exact:true}).click(); }
async function saved(page) { await status(page).getByText('Сохранено в облаке',{exact:true}).waitFor(); }
async function diary(page) { await page.getByRole('button',{name:'Дневник',exact:true}).click(); }
async function addTask(page,text) { await page.getByPlaceholder('Что задали?',{exact:false}).fill(text); await page.getByRole('button',{name:'Добавить',exact:true}).click(); }
async function reloadIncoming(page) { await status(page).getByRole('button',{name:'Обновить экран',exact:true}).click(); await page.getByRole('button',{name:'Дневник',exact:true}).waitFor(); }
async function cache(page) { return page.evaluate(() => new Promise((resolve,reject) => {
  const req=indexedDB.open('domashka_cloud_cache_v42',1); req.onerror=()=>reject(req.error);
  req.onsuccess=()=>{const db=req.result;const tx=db.transaction('workspaces');const r=tx.objectStore('workspaces').getAll();r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);};
})); }
try {
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,encrypted_password text default '',email_confirmed_at timestamptz,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');
    create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default now());
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text);
    alter table storage.objects enable row level security; grant usage on schema auth,storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;`);
  for (const file of fs.readdirSync('supabase/migrations').sort()) await db.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8'));
  const parent = {id:randomUUID(),session:randomUUID(),email:'parent@example.test',name:'QA родитель'};
  await db.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)',[parent.id,parent.email,{name:parent.name}]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[parent.session,parent.id]);
  const ticket = await rpc(parent,'domashka_admin_ticket',{action:'create_child',child:null,login:'student'});
  const {family_code:familyCode} = await one('select family_code from public.domashka_profiles where id=$1',[parent.id]);
  const child = {id:randomUUID(),email:`student.${familyCode}@children.domashka.invalid`,name:'QA ученик'};
  await db.query('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values($1,$2,now(),$3,$4)',
    [child.id,child.email,{domashka_role:'child',domashka_parent:parent.id,domashka_login:'student',domashka_create_ticket:ticket},{name:child.name,grade:5,age:11}]);
  actors.set(parent.email,parent); actors.set(child.email,child);
  const built = spawnSync('python3',['scripts/prepare_cloud.py','--output','.cache/browser-site'],{cwd:root,encoding:'utf8',env:{...process.env,
    DOMASHKA_SUPABASE_URL:url,DOMASHKA_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_browser_fixture_only_0123456789',DOMASHKA_SITE_URL:'https://domashka-fixture.pages.dev/',DOMASHKA_TURNSTILE_SITE_KEY:''}});
  assert.equal(built.status,0,built.stderr);
  const headers=Object.fromEntries(fs.readFileSync('.cache/browser-site/_headers','utf8').split('\n').filter((l)=>l.startsWith('  ')).map((l)=>{const at=l.indexOf(':');return [l.slice(0,at).trim(),l.slice(at+1).trim()];}));
  server=http.createServer((req,res)=>{const file=req.url==='/Domashka_PRO.html'?'Domashka_PRO.html':'index.html';res.writeHead(200,{'content-type':'text/html; charset=utf-8',...headers});res.end(fs.readFileSync(`.cache/browser-site/${file}`));});
  await new Promise((resolve)=>server.listen(0,'0.0.0.0',resolve)); const base=`http://localhost:${server.address().port}/`;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/tmp/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const desktop=await context({viewport:{width:1365,height:950}});
  const mobile=await context({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  const a=await login(desktop,base,child.email.split('@')[0]); const b=await login(mobile,base,child.email.split('@')[0]);
  ok(await a.getByText('QA ученик',{exact:true}).count()>0,'same child login opens independent desktop/mobile browser contexts');
  await diary(a); await diary(b); await saved(a); await saved(b);
  await addTask(a,'Общее задание с компьютера'); await saved(a); await sync(b);
  await status(b).getByRole('button',{name:'Обновить экран',exact:true}).waitFor();
  ok(await b.getByText('Общее задание с компьютера',{exact:true}).count()===0,'remote data is staged, not silently written into mounted editor');
  await reloadIncoming(b); await diary(b);
  ok(await b.getByText('Общее задание с компьютера',{exact:true}).isVisible(),'saved diary appears after explicit refresh on second context');
  mobile.offline=true; await addTask(b,'Телефон: несохранённая локальная версия');
  await status(b).getByRole('button',{name:'Скачать резервную копию изменений'}).waitFor();
  // Wait for actual IDB completion, not an arbitrary sleep.
  await b.waitForFunction(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('domashka_cloud_cache_v42');q.onsuccess=()=>r(q.result);});const rows=await new Promise(r=>{const q=db.transaction('workspaces').objectStore('workspaces').getAll();q.onsuccess=()=>r(q.result);});db.close();return rows.some(r=>JSON.stringify(r.pending).includes('Телефон: несохранённая'));});
  ok((await cache(b)).some((r)=>JSON.stringify(r.pending).includes('Телефон: несохранённая')),'backend outage keeps unsent diary in durable IndexedDB');
  await addTask(a,'Компьютер: новая серверная версия'); await saved(a);
  await b.reload(); await b.getByRole('heading',{name:'Облако пока недоступно'}).waitFor();
  ok((await cache(b)).some((r)=>JSON.stringify(r.pending).includes('Телефон: несохранённая')),'failed bootstrap does not erase old-account outbox');
  mobile.offline=false; await b.getByRole('button',{name:'Повторить',exact:true}).click();
  await status(b).getByText('Посмотреть различия',{exact:true}).click();
  ok((await status(b).innerText()).includes('Телефон: несохранённая') && (await status(b).innerText()).includes('Компьютер: новая серверная'),'reload recovers both competing versions instead of last-writer-wins');
  await status(b).getByRole('button',{name:'Выбрать облачную версию'}).click();
  await b.getByRole('heading',{name:'Рабочее пространство приостановлено'}).waitFor();
  const reload=b.getByRole('button',{name:'Обновить страницу',exact:true});
  await b.waitForFunction(()=>[...document.querySelectorAll('button')].some(el=>el.textContent==='Обновить страницу'&&!el.disabled));
  ok(await b.getByPlaceholder('Что задали?',{exact:false}).count()===0 && await reload.isEnabled(),'remote conflict choice unmounts stale editor and re-enables reload after cache commit');
  await reload.click(); await diary(b);
  ok(await b.getByText('Компьютер: новая серверная версия',{exact:true}).isVisible() && await b.getByText('Телефон: несохранённая локальная версия',{exact:true}).count()===0,'explicit cloud choice is durable after navigation');
  const second=await mobile.ctx.newPage(); await second.goto(base); await second.getByRole('heading',{name:'Облако пока недоступно'}).waitFor();
  ok(/вкладк/i.test(await second.locator('body').innerText()),'second editor tab is refused without a local-account fallback'); await second.close();
  await b.getByRole('button',{name:'Шпаргалки',exact:true}).click(); await b.getByRole('button',{name:'Учить по карточкам (5 мин)',exact:true}).click();
  await b.getByRole('button',{name:'Знаю — проверить',exact:true}).click(); await b.getByLabel('Короткий ответ',{exact:true}).fill('точно неверный ответ');
  await b.getByRole('button',{name:'Проверить ответ',exact:true}).click(); await b.getByText(/Пока не совпало/).waitFor();
  ok((await serial(()=>one('select xp from public.domashka_stats where user_id=$1',[child.id]))).xp===0,'wrong short answer earns zero XP through real SQL');
  const correct=(await serial(()=>one('select answers from domashka_private.card_attempts where id=$1',[latestAttempt]))).answers[0];
  await b.getByLabel('Короткий ответ',{exact:true}).fill(correct); await b.getByRole('button',{name:'Проверить ответ',exact:true}).click(); await b.getByText('Верно! +4 XP.',{exact:true}).waitFor();
  ok((await serial(()=>one('select xp from public.domashka_stats where user_id=$1',[child.id]))).xp===4,'checked answer earns four server-confirmed XP');
  await b.getByRole('button',{name:'Закрыть карточки',exact:true}).click(); await b.getByRole('button',{name:'Учить по карточкам (5 мин)',exact:true}).click();
  await b.getByRole('button',{name:'Знаю — проверить',exact:true}).click(); await b.getByLabel('Короткий ответ',{exact:true}).waitFor();
  const again=(await serial(()=>one('select answers from domashka_private.card_attempts where id=$1',[latestAttempt]))).answers[0];
  await b.getByLabel('Короткий ответ',{exact:true}).fill(again); await b.getByRole('button',{name:'Проверить ответ',exact:true}).click(); await b.getByText(/повторных XP нет/).waitFor();
  ok((await serial(()=>one('select xp from public.domashka_stats where user_id=$1',[child.id]))).xp===4,'reopened deck cannot farm the same card');
  await b.getByRole('button',{name:'Закрыть карточки',exact:true}).click();
  const parentCtx=await context({viewport:{width:1280,height:950}}); const p=await login(parentCtx,base,parent.email);
  await p.getByLabel('Название задания').fill('QA семейная работа'); await p.getByLabel('Условие и что нужно прислать').fill('Напиши короткий ответ и приложи тестовое фото.');
  await p.getByRole('button',{name:'Назначить домашку',exact:true}).click(); await p.getByText('QA семейная работа',{exact:true}).waitFor();
  await b.getByRole('button',{name:'Семья',exact:true}).first().click(); await sync(b); await b.getByLabel('Мой ответ',{exact:true}).fill('Короткий черновик ученика');
  await sync(b); ok(await b.getByLabel('Мой ответ',{exact:true}).inputValue()==='Короткий черновик ученика','family refresh does not wipe typed submission draft');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG9sAAAAASUVORK5CYII=','base64');
  await b.getByLabel('Прикрепить фото выполненной работы').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:png});
  await b.getByRole('button',{name:'Отправить родителю',exact:true}).click(); await b.getByRole('button',{name:'Обновить отправку',exact:true}).waitFor();
  await sync(p);
  // Family records advertise changes; loading them is explicit to preserve forms.
  await p.getByRole('region',{name:'Семейные домашние задания'}).getByRole('button',{name:'Обновить',exact:true}).click();
  await p.getByLabel('Комментарий родителя').fill('Проверено');
  await p.getByRole('button',{name:'Я проверил(а) новую версию — сохранить мой черновик',exact:true}).click();
  await p.getByRole('button',{name:'Показать фото работы',exact:true}).click();
  await p.getByRole('img',{name:'Фотография выполненной работы'}).waitFor();
  await p.getByRole('button',{name:'Принять',exact:true}).click();
  await p.getByRole('button',{name:'Принято',exact:true}).click(); await p.getByText('QA семейная работа',{exact:true}).waitFor();
  ok(photos.size>0 && (await serial(()=>one('select status from public.domashka_homework where title=$1',['QA семейная работа']))).status==='accepted','parent assigns, child submits private photo, parent reviews through real SQL');
  await b.getByText('Перенос и резервная копия учебных данных',{exact:true}).click();
  const transfer={type:'domashka-study-transfer',version:1,sourceName:'Локальная тестовая тетрадь',settings:{},stats:{xp:99},chats:[{id:'qa-import',title:'Импорт без секретов',response_md:'Тестовая запись',image_b64:`data:image/png;base64,${png.toString('base64')}`}]};
  await b.getByLabel('Выбрать файл переноса / восстановления').setInputFiles({name:'study.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(transfer))});
  await b.getByRole('button',{name:'Подтвердить перенос',exact:true}).click(); await b.getByText(/Добавлено: 1; пропущено: 0/).waitFor();
  const imported=await serial(()=>one("select value from public.domashka_documents where user_id=$1 and key='chat/qa-import'",[child.id]));
  ok(imported.value.title==='Импорт без секретов' && !JSON.stringify(imported.value).includes('data:image') && (await serial(()=>one('select xp from public.domashka_stats where user_id=$1',[child.id]))).xp===4,'explicit study import stores private photo reference and does not promote legacy child XP');
  await b.screenshot({path:'.cache/browser-cloud-mobile.png',fullPage:true});
  ok(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'390px mobile viewport has no horizontal page overflow');
  const local=await context(); const localPage=await local.ctx.newPage(); await localPage.goto(base+'Domashka_PRO.html');
  await localPage.getByRole('button',{name:'Настроить',exact:true}).click();
  await localPage.getByRole('heading',{name:'Сначала — аккаунт родителя',exact:true}).waitFor();
  ok(!await localPage.getByLabel('Почта родителя или полный логин ребёнка').count(),'downloadable HTML still opens local family registration, not cloud Auth');
  // Actual file:// entry point, with legacy randomUUID absence (study IDs only).
  const fileState=await context({viewport:{width:320,height:760}});
  await fileState.ctx.addInitScript(()=>{Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});});
  const filePage=await fileState.ctx.newPage(); await filePage.goto(pathToFileURL(path.join(root,'Domashka_PRO.html')).href);
  await filePage.locator('#chat-builtin-model').waitFor();
  const options=await filePage.locator('#chat-builtin-model option').allTextContents();
  ok(options.length===9 && options.some(t=>t.includes('Gemma')) && options.some(t=>t.includes('Meta')) && options.some(t=>t.includes('Mistral')),'file HTML preserves eight free models plus auto without external requests');
  await filePage.getByRole('button',{name:'Шпаргалки',exact:true}).click();
  await filePage.getByRole('button',{name:'Учить по карточкам (5 мин)',exact:true}).click();
  await filePage.getByRole('button',{name:'Знаю — проверить',exact:true}).click();
  const localQuestion=await filePage.getByTestId('flashcard-question').innerText();
  const localAnswer=(await serial(()=>one('select answers from domashka_private.card_questions where question=$1 limit 1',[localQuestion]))).answers[0];
  await filePage.getByLabel('Короткий ответ',{exact:true}).fill('неверно'); await filePage.getByRole('button',{name:'Проверить ответ',exact:true}).click();
  await filePage.getByText(/Пока не совпало/).waitFor();
  await filePage.getByLabel('Короткий ответ',{exact:true}).fill(localAnswer); await filePage.getByRole('button',{name:'Проверить ответ',exact:true}).click();
  await filePage.getByText('Верно! +4 XP.',{exact:true}).waitFor();
  ok(true,'file HTML checks answers locally even without native randomUUID');
  ok(await filePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'320px standalone viewport has no horizontal page overflow');
  ok(pageErrors.length===0,`no uncaught page errors (${pageErrors.join('; ')})`); ok(unexpected.length===0,`no unexpected external requests (${unexpected.join('; ')})`);
  console.log(`\nBrowser QA: ${results.length} checks; ${httpCalls.length} mocked HTTP calls; real SQL / fixture Auth+Storage. NOT live cloud / iPhone.`);
} catch (error) {
  if (browser) for (const [ci,ctx] of browser.contexts().entries()) for (const [pi,page] of ctx.pages().entries()) {
    try { fs.writeFileSync(`.cache/browser-failure-${ci}-${pi}.txt`,await page.locator('body').innerText()); await page.screenshot({path:`.cache/browser-failure-${ci}-${pi}.png`,fullPage:true}); } catch { /* page may be closing */ }
  }
  console.error('Page errors:',pageErrors,'Unexpected:',unexpected); throw error;
} finally {
  fs.mkdirSync('.cache',{recursive:true}); fs.writeFileSync('.cache/cloud-browser-results.json',JSON.stringify({checks:results,pageErrors,unexpected,httpCalls},null,2));
  await browser?.close(); if (server) await new Promise(resolve=>server.close(resolve)); await queue.catch(()=>{}); await db.close();
}
