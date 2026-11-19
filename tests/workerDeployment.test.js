import {afterEach, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {assertProductionBranch, verifyWorkerBuild, run, OUTPUT, WORKER_NAME} from '../scripts/deploy_worker.mjs';

const roots=[];
const env={WORKERS_CI:'1',WORKERS_CI_BRANCH:'main',WORKERS_CI_COMMIT_SHA:'a'.repeat(40)};
const publicConfig={url:'https://fixtureproject.supabase.co',publishableKey:'sb_publishable_fixture1234567890',siteUrl:'auto',captchaSiteKey:'public-captcha-fixture-123'};
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'domashka-worker-test-'));roots.push(root);
  const config={name:WORKER_NAME,compatibility_date:'2026-11-05',workers_dev:true,preview_urls:false,keep_vars:true,assets:{directory:OUTPUT,not_found_handling:'none'}};
  fs.writeFileSync(path.join(root,'wrangler.json'),JSON.stringify(config));
  fs.writeFileSync(path.join(root,'cloudflare.public.json'),JSON.stringify(publicConfig));
  const output=path.join(root,OUTPUT);fs.mkdirSync(output,{recursive:true});
  const standalone='<html><script>window.__STANDALONE_BUILD__ = true;</script></html>';
  fs.writeFileSync(path.join(output,'Domashka_PRO.html'),standalone);
  fs.writeFileSync(path.join(output,'index.html'),standalone.replace('</script>','</script>\n  <script>window.__DOMASHKA_CLOUD__ = '+JSON.stringify(publicConfig)+';</script>'));
  fs.writeFileSync(path.join(output,'_headers'),"/*\n  Content-Security-Policy: object-src 'none'\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n");
  const manifestFile=path.join(root,'.cache/worker-build-manifest.json');
  const seal=()=>{
    const files=Object.fromEntries(fs.readdirSync(output).filter(name=>fs.statSync(path.join(output,name)).isFile()).map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(output,name))).digest('hex')]));
    fs.writeFileSync(manifestFile,JSON.stringify({version:1,worker:WORKER_NAME,output:OUTPUT,files}));
  };
  seal();return{root,output,config,manifestFile,seal};
}
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe('existing Worker deployment guard — no real deployments',()=>{
  it.each([{}, {...env,WORKERS_CI:'0'}, {...env,WORKERS_CI_BRANCH:'arena/test'}, {...env,WORKERS_CI_BRANCH:'refs/heads/main'}, {...env,WORKERS_CI_BRANCH:''}, {...env,WORKERS_CI_COMMIT_SHA:'not-a-commit'}])('rejects a missing/non-production build context before calling Wrangler (%j)',bad=>{
    const spawn=vi.fn();expect(()=>run({args:[],env:bad,spawn,root:'/never-read-repository'})).toThrow();expect(spawn).not.toHaveBeenCalled();
  });
  it('allows main with an explicit Workers Builds commit; dry run needs no credential or CI context',()=>{
    expect(()=>assertProductionBranch(env)).not.toThrow();expect(()=>assertProductionBranch({},true)).not.toThrow();
  });
  it('validates a separately built cloud entry and local downloadable HTML',()=>{
    const f=fixture();expect(verifyWorkerBuild(f.root)).toEqual({directory:f.output,files:3});
  });
  it('rejects a different Worker, root upload or unexpected backend configuration',()=>{
    const f=fixture();
    for(const patch of [{name:'wrong-worker'},{assets:{directory:'.',not_found_handling:'none'}},{main:'server.js'},{routes:['other.example/*']},{preview_urls:true}]){
      fs.writeFileSync(path.join(f.root,'wrangler.json'),JSON.stringify({...f.config,...patch}));expect(()=>verifyWorkerBuild(f.root)).toThrow(/существующий Worker/);
    }
  });
  it('rejects an extra file, a missing file or any change after preparation',()=>{
    const f=fixture();fs.writeFileSync(path.join(f.output,'.env'),'private');expect(()=>verifyWorkerBuild(f.root)).toThrow(/Список файлов/);fs.unlinkSync(path.join(f.output,'.env'));
    fs.appendFileSync(path.join(f.output,'index.html'),'changed');expect(()=>verifyWorkerBuild(f.root)).toThrow(/изменились/);fs.unlinkSync(path.join(f.output,'_headers'));expect(()=>verifyWorkerBuild(f.root)).toThrow(/Список файлов/);
  });
  it('rejects unsafe manifest paths and symlinks, without following them',()=>{
    const f=fixture();const manifest=JSON.parse(fs.readFileSync(f.manifestFile));manifest.files['../secret']='0'.repeat(64);fs.writeFileSync(f.manifestFile,JSON.stringify(manifest));expect(()=>verifyWorkerBuild(f.root)).toThrow(/Список файлов/);
    f.seal();fs.symlinkSync(path.join(f.root,'cloudflare.public.json'),path.join(f.output,'linked'));expect(()=>verifyWorkerBuild(f.root)).toThrow(/символическая ссылка/);
  });
  it('rejects a plain Vite/standalone index even if someone regenerates hashes',()=>{
    const f=fixture();fs.writeFileSync(path.join(f.output,'index.html'),'<script src="/src/main.jsx"></script>');f.seal();expect(()=>verifyWorkerBuild(f.root)).toThrow(/облачной версией/);
  });
  it('rejects missing security headers and a download contaminated with cloud configuration',()=>{
    const f=fixture();const headers=fs.readFileSync(path.join(f.output,'_headers'));fs.writeFileSync(path.join(f.output,'_headers'),'');f.seal();expect(()=>verifyWorkerBuild(f.root)).toThrow(/заголовки/);
    fs.writeFileSync(path.join(f.output,'_headers'),headers);fs.copyFileSync(path.join(f.output,'index.html'),path.join(f.output,'Domashka_PRO.html'));f.seal();expect(()=>verifyWorkerBuild(f.root)).toThrow(/Автономный/);
  });
  it('rejects secrets, replaced public configuration or additional fields',()=>{
    const f=fixture();for(const patch of [{publishableKey:'sb_secret_never_publish'},{serviceRole:'never-publish'},{captchaSiteKey:'different-public-sitekey'}]){
      fs.writeFileSync(path.join(f.root,'cloudflare.public.json'),JSON.stringify({...publicConfig,...patch}));expect(()=>verifyWorkerBuild(f.root)).toThrow();
    }
  });
  it('does not echo malformed JSON or its potential secret content in an error',()=>{
    const f=fixture(),spawn=vi.fn();
    fs.writeFileSync(path.join(f.root,'cloudflare.public.json'),'{"PRIVATE_SENTINEL":"sb_secret_sensitive');
    try { run({args:['--dry-run'],env:{},root:f.root,spawn}); throw new Error('should have refused malformed input'); }
    catch(error) { expect(error.message).toMatch(/некорректный JSON/);expect(error.message).not.toMatch(/PRIVATE_SENTINEL|sb_secret_sensitive/); }
    expect(spawn).not.toHaveBeenCalled();
  });
  it.each(['wrangler.json','cloudflare.public.json','.cache/worker-build-manifest.json'])('refuses a non-object JSON document in %s',name=>{
    const f=fixture();fs.writeFileSync(path.join(f.root,name),'null');expect(()=>verifyWorkerBuild(f.root)).toThrow(/Конфигурация|конфигурация|манифест/);
  });
  it('rejects a symlinked manifest or assets directory',()=>{
    const f=fixture();const moved=path.join(f.root,'old-manifest.json');fs.renameSync(f.manifestFile,moved);fs.symlinkSync(moved,f.manifestFile);
    expect(()=>verifyWorkerBuild(f.root)).toThrow(/Манифест/);fs.unlinkSync(f.manifestFile);fs.renameSync(moved,f.manifestFile);
    const elsewhere=path.join(f.root,'old-assets');fs.renameSync(f.output,elsewhere);fs.symlinkSync(elsewhere,f.output);
    expect(()=>verifyWorkerBuild(f.root)).toThrow(/отдельной готовой сборки/);
  });
  it('dry run uses the locked local CLI with --dry-run, never a downloaded npx binary',()=>{
    const f=fixture(),spawn=vi.fn(()=>({status:0}));expect(run({args:['--dry-run'],env:{},root:f.root,spawn})).toBe(0);
    const [binary,args,options]=spawn.mock.calls[0];expect(binary).toBe(process.execPath);expect(args).toContain('--dry-run');expect(args).toContain(path.join(f.root,'node_modules/wrangler/bin/wrangler.js'));expect(args).toContain(WORKER_NAME);expect(options.env.WRANGLER_SEND_METRICS).toBe('false');
  });
  it('main deployment propagates a failure without retrying or switching target',()=>{
    const f=fixture(),spawn=vi.fn(()=>({status:7}));expect(run({args:[],env,root:f.root,spawn})).toBe(7);expect(spawn).toHaveBeenCalledTimes(1);expect(spawn.mock.calls[0][1]).not.toContain('--dry-run');
  });
  it('refuses extra CLI flags and reports process startup/timeout failure',()=>{
    const f=fixture(),spawn=vi.fn(()=>({error:new Error('failed')}));expect(()=>run({args:['--name','other'],env,root:f.root,spawn})).toThrow(/флаг/);expect(spawn).not.toHaveBeenCalled();expect(()=>run({args:['--dry-run'],env:{},root:f.root,spawn})).toThrow(/не завершил/);expect(spawn).toHaveBeenCalledTimes(1);
  });
});
