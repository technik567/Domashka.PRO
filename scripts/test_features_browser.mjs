// Actual built HTML, strict hosted CSP, explicit mocked AI. No live inference.
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const {chromium}=await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE || '.cache/browser/node_modules/playwright-core/index.mjs')));
const checks=[],requests=[],unexpected=[],errors=[];
const ok=(v,label)=>{assert.ok(v,label);checks.push(label);console.log('PASS '+label);};
const markdown='## Учебный пример\n\n| x | y |\n|---|---|\n| 1 | 1 |\n| 2 | 4 |\n\n$y=x^2$\n\n```domashka-chart\n'+JSON.stringify({type:'function',title:'Парабола — учебный пример',expression:'x^2',domain:[-5,5]})+'\n```\n\n```chart\n'+JSON.stringify({type:'bar',title:'Исходные данные примера',labels:['А','Б'],values:[-2,4]})+'\n```\n\n<img src="https://not-requested.example/pixel">\n\n![не загружать](https://not-requested.example/image)';
const headers=Object.fromEntries(fs.readFileSync('.cache/browser-site/_headers','utf8').split('\n').filter((l)=>l.startsWith('  ')).map((l)=>{const at=l.indexOf(':');return[l.slice(0,at).trim(),l.slice(at+1).trim()];}));
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...headers});res.end(fs.readFileSync('Domashka_PRO.html'));});
await new Promise(r=>server.listen(0,'0.0.0.0',r)); const base=`http://localhost:${server.address().port}/`;
let browser;
try {
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/tmp/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
 await ctx.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()); if(u.hostname==='localhost') return route.continue();
  requests.push({url:req.url(),method:req.method(),body:req.postData()});
  if(u.hostname==='text.pollinations.ai') return route.fulfill({json:{choices:[{message:{content:markdown}}]},headers:{'access-control-allow-origin':'*'}});
  if(u.hostname==='qwen-qwen3-vl-235b-a22b-instruct-demo.hf.space') {
   if(req.method()==='POST') return route.fulfill({json:{event_id:u.pathname.endsWith('/add_text')?'add':'predict'},headers:{'access-control-allow-origin':'*'}});
   const data=u.pathname.endsWith('/add') ? [[['public prompt',null]]] : [[['public prompt','Откройте **Семья**. Это подсказка по публичной справке. [неактивная ссылка](https://unknown.example)']]];
   return route.fulfill({contentType:'text/event-stream',body:`event: complete\ndata: ${JSON.stringify(data)}\n\n`,headers:{'access-control-allow-origin':'*'}});
  }
  unexpected.push(req.url()); return route.abort('blockedbyclient');
 });
 const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(base);await page.getByRole('button',{name:'Начать обучение'}).click();
 await page.locator('.tour-highlight').waitFor();ok(await page.locator('[data-onboarding-highlight="true"]').count()===1,'first tour highlights a real rendered element');
 for(let i=0;i<5;i++) await page.getByRole('button',{name:'Далее',exact:true}).click();
 await page.locator('[data-tour="help-trigger"][data-onboarding-highlight="true"]').waitFor();
 await page.getByRole('button',{name:'Помощь по сайту'}).click();await page.getByRole('dialog',{name:'Помощник по сайту'}).waitFor();
 ok(await page.locator('[data-tour-layer]').count()===0 && requests.length===0,'actual highlighted Help button completes tour without an AI request');
 await page.getByRole('button',{name:'Закрыть помощника'}).click();await page.reload();
 ok(await page.getByRole('dialog',{name:'Знакомство с Домашка.ПРО'}).count()===0,'completed tutorial stays dismissed on reload for this workspace');
 await page.locator('#chat-builtin-model').selectOption('pollinations');
 await page.getByRole('button',{name:'Рассуждение',exact:true}).click();await page.getByRole('combobox',{name:'Глубина рассуждения'}).selectOption('high');
 ok(await page.getByRole('button',{name:'Поиск',exact:true}).isDisabled(),'secretless local build explains disabled real search');
 await page.locator('[data-tour="task-input"]').fill('Покажи график y=x^2 и таблицу. PRIVATE_HOMEWORK_SENTINEL');
 await page.locator('form').filter({has:page.locator('[data-tour="task-input"]')}).locator('button[type="submit"]').click();
 await page.locator('.ai-chart').nth(1).waitFor();
 ok(await page.locator('.ai-chart svg').count()===2 && await page.locator('.md-content .katex').count()>0,'graphs, table and math render from a real mocked response under hosted CSP');
 const sent=JSON.parse(requests.find(r=>r.url.includes('pollinations')).body);ok(JSON.stringify(sent).includes('ПРОВЕРКА ОТВЕТА') && JSON.stringify(sent).includes('domashka-chart'),'reasoning and graphics reach the selected model transport');
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать график SVG'}).first().click();const download=await downloadPromise;await download.saveAs('.cache/answer-graph.svg');
 const svg=fs.readFileSync('.cache/answer-graph.svg','utf8');ok(svg.includes('<svg') && !/onload=|<script|<image/i.test(svg),'SVG download contains the sanitized local plot');
 await page.pdf({path:'.cache/answer-graphs.pdf',format:'A4',printBackground:true});ok(fs.statSync('.cache/answer-graphs.pdf').size>10000,'print CSS produces a nonempty PDF with the rendered answer');
 await page.getByRole('button',{name:'Помощь по сайту'}).click();await page.getByRole('textbox',{name:'Вопрос о сайте'}).fill('Где менять класс ребёнка?');
 await page.getByRole('button',{name:'Спросить ИИ'}).click();await page.getByText(/Это подсказка по публичной справке/).waitFor();
 const helpRequests=requests.filter(r=>r.url.includes('qwen-qwen3-vl-235b'));ok(helpRequests.length===4 && !JSON.stringify(helpRequests).includes('PRIVATE_HOMEWORK_SENTINEL'),'help uses its own two-stage session and does not send the main homework');
 ok(await page.getByRole('dialog',{name:'Помощник по сайту'}).locator('a[href="https://unknown.example"]').count()===0,'model-generated helper links cannot trigger arbitrary navigation');
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Помощь по сайту'}).click();ok(await page.getByText(/Это подсказка по публичной справке/).count()===0,'closing the helper clears its transient dialogue');
 await page.setViewportSize({width:320,height:760});ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'helper is within a 320px viewport');
 await page.screenshot({path:'.cache/features-help-mobile.png'});await page.getByRole('button',{name:'Закрыть помощника'}).click();
 ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'answer charts and controls do not overflow a 320px page');
 await page.locator('.ai-chart').first().scrollIntoViewIfNeeded();await page.screenshot({path:'.cache/features-charts-mobile.png'});
 ok(errors.length===0,'no uncaught browser errors');ok(unexpected.length===0,'no unexpected requests, including injected remote images');
 console.log(`Features browser: ${checks.length} checks; ${requests.length} mocked model requests. NOT live inference / physical iPhone.`);
} finally {
 fs.writeFileSync('.cache/features-browser-results.json',JSON.stringify({checks,requests,unexpected,errors},null,2));await browser?.close();await new Promise(r=>server.close(r));
}
