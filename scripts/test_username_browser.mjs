// Built HTML under hosted CSP. HTTP Auth/CAPTCHA responses are explicit fixtures;
// this checks the real browser UI, NOT live Supabase/Turnstile or physical iOS.
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE || '.cache/browser/node_modules/playwright-core/index.mjs')));
const checks=[],calls=[],unexpected=[],errors=[];
const ok=(value,label)=>{assert.ok(value,label);checks.push(label);console.log('PASS '+label);};
const cfg={url:'https://username-fixture.supabase.co',publishableKey:'sb_publishable_username_fixture_only_0123456789',siteUrl:'https://username-fixture.workers.dev/',captchaSiteKey:'public-fixture-key'};
const marker='<script>window.__STANDALONE_BUILD__ = true;</script>';
const html=fs.readFileSync('Domashka_PRO.html','utf8').replace(marker,marker+`<script>window.__DOMASHKA_CLOUD__ = ${JSON.stringify(cfg)};</script>`);
const headers=Object.fromEntries(fs.readFileSync('.cache/browser-site/_headers','utf8').split('\n').filter(l=>l.startsWith('  ')).map(l=>{const at=l.indexOf(':');return[l.slice(0,at).trim(),l.slice(at+1).trim()];}));
const codes=Array.from({length:10},(_,i)=>(0xABC000+i).toString(16).padStart(32,'0').toUpperCase().match(/.{8}/g).join('-'));
const used=new Set();let loseResponse=false;
const server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...headers});res.end(html);});
await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));const base=`http://localhost:${server.address().port}/`;let browser;
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/tmp/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx=await browser.newContext({viewport:{width:320,height:900},acceptDownloads:true});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());if(u.hostname==='localhost') return route.continue();
    if(u.hostname==='challenges.cloudflare.com' && u.pathname.endsWith('/api.js')) return route.fulfill({contentType:'application/javascript',body:"window.turnstile={render:function(el,opts){setTimeout(function(){opts.callback('fixture-token');},0);return 'fixture';},remove:function(){}};"});
    if(u.hostname==='username-fixture.supabase.co' && u.pathname==='/functions/v1/account-access') {
      const body=req.postDataJSON();calls.push(body);const cors={'access-control-allow-origin':'*','cache-control':'no-store'};
      if(body.action==='register') return route.fulfill({json:{ok:true,login:body.login,codes,remaining:10},headers:cors});
      if(body.action==='recover') {
        const index=codes.findIndex(c=>c.replaceAll('-','')===body.code);
        if(index<0 || used.has(index)) return route.fulfill({status:400,json:{error:'Неверный логин или резервный код; код мог быть использован или заменён.'},headers:cors});
        used.add(index);if(loseResponse) return route.abort('failed');
        return route.fulfill({json:{ok:true,remaining:10-used.size},headers:cors});
      }
    }
    unexpected.push(req.url());return route.abort('blockedbyclient');
  });
  const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(base);await page.getByRole('button',{name:'Позже',exact:true}).click();
  await page.getByRole('button',{name:'Я родитель: регистрация'}).click();
  await page.getByLabel('Логин родителя',{exact:true}).fill('Mobile_Parent');await page.getByLabel('Имя родителя').fill('Тестовый родитель');
  await page.getByLabel('Новый пароль',{exact:true}).fill('Fixture-password-123');await page.getByLabel('Повторите пароль').fill('Fixture-password-123');
  const question=page.getByLabel('Ответ на вопрос для родителя');const square=await question.evaluate(el=>Number(el.parentElement.textContent.match(/√(\d+)/)[1]));await question.fill(String(Math.sqrt(square)));
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Зарегистрироваться',exact:true}).click();
  const panel=page.getByRole('region',{name:'10 резервных кодов'});await panel.waitFor();
  ok(await panel.getByRole('listitem').count()===10 && calls[0].action==='register' && !('email' in calls[0]),'registration uses a username and shows all ten codes together');
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'ten-code screen fits a 320px viewport without horizontal overflow');
  const rawStorage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage},url:location.href}));
  ok(!codes.some(c=>rawStorage.includes(c)) && !rawStorage.includes('Fixture-password-123'),'backup codes/password are absent from browser storage and URL');
  ok(await panel.getByRole('button',{name:/перейти ко входу/}).isDisabled(),'continuation requires explicit acknowledgement, not just download');
  const downloadPromise=page.waitForEvent('download');await panel.getByRole('button',{name:'Скачать 10 кодов (.txt)'}).click();const download=await downloadPromise;
  await download.saveAs('.cache/username-backup-fixture.txt');const txt=fs.readFileSync('.cache/username-backup-fixture.txt','utf8');
  ok(codes.every(c=>txt.includes(c)) && txt.includes('mobile_parent') && !txt.includes('Fixture-password-123'),'TXT contains all ten codes and the login, never the password');
  await page.screenshot({path:'.cache/username-320-fixture.png',fullPage:true});
  await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:/перейти ко входу/}).click();
  ok(await page.getByText(codes[0],{exact:true}).count()===0,'acknowledgement discards the one-time display');
  async function recover(code) {
    await page.getByRole('button',{name:'Забыли пароль?',exact:true}).click();await page.getByLabel('Логин родителя',{exact:true}).fill('mobile_parent');await page.getByLabel('Одноразовый резервный код').fill(code);
    await page.getByLabel('Новый пароль',{exact:true}).fill('New-fixture-123');await page.getByLabel('Повторите пароль').fill('New-fixture-123');await page.getByRole('button',{name:'Восстановить по коду'}).click();
  }
  await recover(codes[0]);await page.getByText(/осталось кодов: 9/).waitFor();
  ok(used.size===1 && calls.filter(c=>c.action==='recover').length===1,'one recovery consumes one fixture code and reports nine remaining');
  await recover(codes[0]);await page.getByRole('alert').filter({hasText:/Неверный логин или резервный код/}).waitFor();
  ok(used.size===1,'reused code is refused without consuming another');
  loseResponse=true;await recover(codes[1]);await page.getByRole('alert').filter({hasText:/сначала.*войти|сначала проверьте вход/i}).waitFor();
  ok(calls.filter(c=>c.action==='recover').length===3,'lost response is not retried automatically and gives safe follow-up instructions');
  ok(errors.length===0 && unexpected.length===0,'built username UI has no uncaught errors or unexpected external calls');
  console.log(JSON.stringify({checks:checks.length,mutations:calls.length,errors,unexpected},null,2));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
