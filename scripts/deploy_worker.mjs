// Production deployment is an explicit Workers Builds step, never npm install
// or a test side effect. Only the already-existing Worker may be targeted.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const WORKER_NAME = 'gentle-fog-7c3b';
export const OUTPUT = '.cache/worker-site';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = message => { throw new Error(message); };
const parseJson = (text, label) => {
  try { return JSON.parse(text); }
  catch { fail(`${label}: некорректный JSON. Значение не выводится в журнал.`); }
};
const readJson = file => parseJson(fs.readFileSync(file, 'utf8'),path.basename(file));
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function assertProductionBranch(env, dryRun = false) {
  if (dryRun) return;
  if (env.WORKERS_CI !== '1') fail('Публикация разрешена только в Cloudflare Workers Builds. Для локальной проверки: npm run check:worker.');
  if (env.WORKERS_CI_BRANCH !== 'main') fail('Production-публикация разрешена только из main. Рабочая ветка не заменит действующий сайт.');
  if (!/^[a-f0-9]{40}$/i.test(env.WORKERS_CI_COMMIT_SHA || '')) fail('Workers Builds не передал корректный commit SHA; публикация остановлена.');
}

function listFiles(directory, prefix = '') {
  const files = [];
  for (const item of fs.readdirSync(directory, {withFileTypes:true})) {
    if (item.isSymbolicLink()) fail('В каталоге публикации обнаружена символическая ссылка. Пересоберите сайт.');
    const name = prefix + item.name;
    if (item.isDirectory()) files.push(...listFiles(path.join(directory,item.name), name + '/'));
    else if (item.isFile()) files.push(name);
    else fail('В каталоге публикации обнаружен не обычный файл.');
  }
  return files.sort();
}

export function verifyWorkerBuild(root = ROOT) {
  root = path.resolve(root);
  const config = readJson(path.join(root,'wrangler.json'));
  const allowed = ['$schema','name','compatibility_date','workers_dev','preview_urls','keep_vars','assets'];
  if (!isRecord(config) || !isRecord(config.assets) || Object.keys(config).some(key=>!allowed.includes(key)) || config.name !== WORKER_NAME ||
      config.workers_dev !== true || config.preview_urls !== false || config.keep_vars !== true ||
      config.assets?.directory !== OUTPUT || config.assets.not_found_handling !== 'none' ||
      Object.keys(config.assets).some(key=>!['directory','not_found_handling'].includes(key))) {
    fail('Конфигурация должна сохранять существующий Worker, его адрес и статический каталог.');
  }
  const directory = path.join(root,OUTPUT);
  if (!fs.existsSync(directory) || fs.realpathSync(directory) !== directory) fail('Нет отдельной готовой сборки. Сначала выполните npm run build:worker.');
  const manifestFile = path.join(root,'.cache/worker-build-manifest.json');
  if (fs.lstatSync(manifestFile).isSymbolicLink()) fail('Манифест не должен быть символической ссылкой.');
  const manifest = readJson(manifestFile);
  if (!isRecord(manifest) || manifest.version !== 1 || manifest.worker !== WORKER_NAME || manifest.output !== OUTPUT ||
      !isRecord(manifest.files)) fail('Некорректный манифест сборки.');
  const names = Object.keys(manifest.files).sort();
  if (!names.length || names.some(name=>name.startsWith('/') || /[\\\u0000-\u001f]/.test(name) || name.split('/').some(part=>!part || part==='.' || part==='..')) ||
      JSON.stringify(names) !== JSON.stringify(listFiles(directory))) fail('Список файлов отличается от сборки. Публикация лишних/устаревших файлов запрещена.');
  for (const name of names) if (!/^[a-f0-9]{64}$/.test(manifest.files[name]) || sha256(path.join(directory,name)) !== manifest.files[name]) fail('Файлы изменились после сборки. Выполните npm run build:worker заново.');
  const expected = readJson(path.join(root,'cloudflare.public.json'));
  const keys = ['url','publishableKey','siteUrl','captchaSiteKey'];
  if (!isRecord(expected) || Object.keys(expected).length !== keys.length || keys.some(key=>typeof expected[key]!=='string') ||
      !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(expected.url) || !/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(expected.publishableKey) ||
      expected.siteUrl !== 'auto' || !/^[A-Za-z0-9_-]{10,200}$/.test(expected.captchaSiteKey)) fail('Нужна только публичная конфигурация текущего Supabase и Site key, не административные секреты.');
  const html = fs.readFileSync(path.join(directory,'index.html'),'utf8');
  const match = html.match(/\n  <script>window\.__DOMASHKA_CLOUD__ = (.*?);<\/script>/);
  const actual = match && parseJson(match[1],'index.html');
  if (!isRecord(actual) || Object.keys(actual).length !== keys.length || keys.some(key=>actual[key]!==expected[key])) fail('index.html не является настроенной облачной версией.');
  const standalone = fs.readFileSync(path.join(directory,'Domashka_PRO.html'),'utf8');
  if (!standalone.includes('window.__STANDALONE_BUILD__ = true;') || standalone.includes('window.__DOMASHKA_CLOUD__ =') || html.replace(match[0],'') !== standalone) fail('Автономный HTML должен оставаться отдельной локальной копией без cloud config.');
  const headers = fs.readFileSync(path.join(directory,'_headers'),'utf8');
  if (!headers.includes("object-src 'none'") || !headers.includes('Cache-Control: no-store') || !headers.includes('Referrer-Policy: no-referrer')) fail('Не найдены обязательные заголовки безопасности.');
  return {directory, files:names.length};
}

export function run({args=process.argv.slice(2), env=process.env, root=ROOT, spawn=spawnSync} = {}) {
  if (args.some(arg=>arg!=='--dry-run')) fail('Разрешён только необязательный флаг --dry-run.');
  const dryRun = args.includes('--dry-run');
  assertProductionBranch(env,dryRun);
  const result = verifyWorkerBuild(root);
  console.log(`${dryRun?'Проверка без публикации':'Публикация'}: ${WORKER_NAME}, файлов: ${result.files}. Supabase не изменяется.`);
  const command = [path.join(root,'node_modules/wrangler/bin/wrangler.js'),'deploy','--config',path.join(root,'wrangler.json'),'--name',WORKER_NAME];
  if (dryRun) command.push('--dry-run','--outdir',path.join(root,'.cache/worker-dry-run'));
  const child = spawn(process.execPath,command,{cwd:root,stdio:'inherit',env:{...env,WRANGLER_SEND_METRICS:'false'},timeout:dryRun?60000:300000});
  if (child.error || child.signal || !Number.isInteger(child.status)) fail('Wrangler не завершил операцию. Проверьте журнал; автоматического повторного deploy нет.');
  return child.status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = run(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
