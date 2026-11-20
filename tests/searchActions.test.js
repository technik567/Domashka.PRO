import {describe,it,expect,vi} from 'vitest';
import {parseSearchAction} from '../src/standalone/searchActions';
import {runAnswerWorkflow} from '../src/standalone/workflow';
import {generateAiBrowser} from '../src/standalone/aiClient';
import {searchExcerpts} from '../src/standalone/webSearch';
import {marked} from 'marked';
import config from '../shared/legacy-gateways.json';

const action = queries => '```domashka-search\n' + JSON.stringify({search:true,queries}) + '\n```';
const result = text => ({text,used:'Выбранная модель'});
const sources = query => ({provider:'Tavily',fetchedAt:new Date().toISOString(),query,results:[{title:'Официальный источник',url:'https://example.org/source',content:'Подтверждённая поисковая выдержка.'}]});
const topic = 'Найди источники о фотосинтезе.';
const run = (request, search, options={}, messages=[{role:'user',content:'Два плюс два'}]) => runAnswerWorkflow({options:{webSearch:'auto',reasoning:'off',...options},messages,systemPrompt:'ПРАВИЛА УЧИТЕЛЯ',request,search});
const sse = text => new Response(text,{headers:{'Content-Type':'text/event-stream'}});
const json = data => new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});

describe('legacy action detection is rejection-only, not a search permission',()=>{
  it.each(['2 + 2 = 4','Обычное объяснение без JSON.','{"answer":4}','```json\n{"items":[1,2,3]}\n```','Пример кода: {"search":true,"queries":["не выполнять"]}'])('does not require an ordinary answer to be JSON: %s',text=>{
    expect(parseSearchAction(text)).toBeNull();
  });
  it('recognises reserved controls and bare/CRLF JSON without executing them',()=>{
    expect(parseSearchAction(action(['закон Ома']))).toEqual({search:true,queries:['закон Ома']});
    expect(parseSearchAction(action(['закон Ома','закон Ома']).replaceAll('\n','\r\n'),2).queries).toEqual(['закон Ома']);
    expect(parseSearchAction('{"search":true,"queries":["закон Ома"]}').search).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    action(['один'])+'\nИ ещё пояснение', 'Сначала пояснение\n'+action(['один']),
    action(['один'])+'\n'+action(['два']), '```domashka-search\n{"search":true,"queries":["один"]}',
    '{"search":false,"queries":[]}', '{"search":true,"queries":[]}',
    '{"search":true,"queries":["один","два"]}', '{"search":true,"queries":["abc"],"url":"https://other.example"}',
    '{"search":true,"queries":', action(['x'.repeat(5000)]), action(['child@example.org']), action(['password: PRIVATE_SENTINEL']),
  ])('rejects malformed/private/control-only output without guessing a query',text=>{
    expect(()=>parseSearchAction(text)).toThrow();
  });
});

describe('independent local search precedes the FIRST generation',()=>{
  it.each([['off',1],['low',1],['medium',2],['high',3]])('auto search and internet off both cost %s/%s model passes',async(reasoning,calls)=>{
    const request=vi.fn(async()=>result('2 + 2 = 4')),search=vi.fn(async query=>sources(query));
    const skipped=await run(request,search,{reasoning});
    expect(request).toHaveBeenCalledTimes(calls);expect(search).not.toHaveBeenCalled();
    expect(skipped.workflow.calls).toBe(calls);expect(skipped.text).toContain('Интернет не использовался');expect(skipped.text).toContain('не моделью');
    for(const [args]of request.mock.calls){expect(args.systemPrompt).toContain('ПРАВИЛА УЧИТЕЛЯ');expect(args.allowLocalFallback).toBe(false);expect(args.systemPrompt).not.toContain('ИНТЕРНЕТ ПО НЕОБХОДИМОСТИ');}
    request.mockClear();const searched=await run(request,search,{reasoning,searchTaskText:topic});
    expect(request).toHaveBeenCalledTimes(calls);expect(search).toHaveBeenCalledTimes(1);
    expect(searched.workflow).toMatchObject({calls,searches:1,verified:calls-1});
    request.mockClear();const off=await run(request,search,{reasoning,webSearch:false});
    expect(request).toHaveBeenCalledTimes(calls);expect(off.text).not.toContain('Интернет не использовался');
  });
  it('keeps graphics, reasoning and native photo policy in the first real answer',async()=>{
    const request=vi.fn(async()=>({...result('Вижу график'),photoInputUsed:'vision',photoCount:1,extractedPhotoText:''}));
    const output=await run(request,vi.fn(),{graphics:true,reasoning:'low',images:[config.neutralImageDataUrl],photoMode:'vision',ocrText:'STALE_OCR'});
    expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][0]).toMatchObject({graphics:true,reasoning:'low',photoMode:'vision',images:[config.neutralImageDataUrl]});
    expect(output.extractedPhotoText).toBe('');expect(output.photoInputUsed).toBe('vision');
  });
  it('sends only the current local topic to search, never history/assistant output/photo/OCR/profile',async()=>{
    const request=vi.fn(async()=>result('Ответ по источнику [1].')),search=vi.fn(async query=>sources(query));
    const messages=[{role:'user',content:'PRIVATE_HISTORY child@example.org'}, {role:'assistant',content:action(['PRIVATE_MODEL_QUERY'])},{role:'user',content:topic}];
    const output=await run(request,search,{ocrText:'PRIVATE_OCR',images:[config.neutralImageDataUrl],fallbackMeta:{grade:8,subject:'PRIVATE_PROFILE'}},messages);
    expect(search.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]);
    expect(search).toHaveBeenCalledTimes(1);expect(search.mock.calls[0][0]).toBe('фотосинтезе');expect(JSON.stringify(search.mock.calls)).not.toMatch(/PRIVATE_|base64|grade/);
    expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][0].systemPrompt).toContain('ПОИСКОВЫЕ ДАННЫЕ');
    expect(request.mock.calls[0][0].messages).toEqual(messages);expect(output.text).toContain('Источники поиска');expect(output.text).not.toContain('Интернет не использовался');
  });
  it.each(['Найди источники к этому.', 'Найди источники о фотосинтезе. child@example.org'])('rejects vague/private local inputs before either network step',async searchTaskText=>{
    const request=vi.fn(),search=vi.fn();await expect(run(request,search,{searchTaskText})).rejects.toMatchObject({stage:'search-local'});
    expect(search).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
  });
  it.each(['',undefined])('does not mine a checker draft, OCR or generated photo prompt for a missing topic',async searchTaskText=>{
    const request=vi.fn(async()=>result('Проверка')),search=vi.fn();
    await run(request,search,{searchTaskText,fallbackMode:'check',ocrText:topic},[{role:'user',content:`**Черновик / решение ученика:**\n${topic}`}]);
    expect(search).not.toHaveBeenCalled();expect(request).toHaveBeenCalledTimes(1);
  });
  it('never treats the last assistant message as a fresh search task',async()=>{
    const request=vi.fn(async()=>result('Ответ')),search=vi.fn();
    await run(request,search,{},[{role:'user',content:'Прошлый вопрос'}, {role:'assistant',content:topic}]);expect(search).not.toHaveBeenCalled();
  });
  it.each([action(['не выполнять']),'{"search":false,"queries":[]}','{"search":true,"queries":[]}'])('never executes or repairs a model control when local rules skipped search',async text=>{
    const request=vi.fn(async()=>result(text)),search=vi.fn();
    await expect(run(request,search)).rejects.toMatchObject({stage:'answer'});expect(request).toHaveBeenCalledTimes(1);expect(search).not.toHaveBeenCalled();
  });
  it('retains actual sources after a FIRST-model refusal, not a fictitious previous successful generation',async()=>{
    const request=vi.fn().mockRejectedValue(Object.assign(new Error('PRIVATE_QUOTA_BODY'),{code:'quota'}));
    const search=vi.fn(async query=>sources(query));const output=await run(request,search,{searchTaskText:topic,reasoning:'high',images:[config.neutralImageDataUrl],photoMode:'vision',ocrText:'STALE_OCR'});
    expect(output).toMatchObject({sourcesOnly:true,photoInputUsed:'none',photoCount:0,extractedPhotoText:''});
    expect(output.text).toContain('Подтверждённая поисковая выдержка');expect(output.text).toContain('не ответ выбранной модели');expect(output.text).toContain('https://example.org/source');
    expect(output.used).toContain('ИИ-ответ не получен');expect(JSON.stringify(output)).not.toMatch(/PRIVATE_QUOTA_BODY|STALE_OCR/);
    expect(output.workflow).toMatchObject({calls:1,searches:1,verified:0});expect(request).toHaveBeenCalledTimes(1);
    expect(output.workflow.trail.filter(e=>e.stage==='answer')).toEqual([expect.objectContaining({state:'warning'})]);
  });
  it('does not let a post-search model action recurse into search',async()=>{
    const search=vi.fn(async query=>sources(query)),request=vi.fn(async()=>result(action(['новый поиск'])));
    const output=await run(request,search,{searchTaskText:topic,reasoning:'high'});expect(output.sourcesOnly).toBe(true);expect(request).toHaveBeenCalledTimes(1);expect(search).toHaveBeenCalledTimes(1);expect(output.text).not.toContain('domashka-search');
  });
  it('rejects recursive review controls without losing the preceding answer or faking a review',async()=>{
    const search=vi.fn(async query=>sources(query)),request=vi.fn().mockResolvedValueOnce(result('Ответ [1].')).mockResolvedValue(result(action(['не запускать'])));
    const output=await run(request,search,{searchTaskText:topic,reasoning:'high'});
    expect(output.sourcesOnly).toBeUndefined();expect(output.text).toContain('Ответ');expect(output.text).toContain('проверка не завершена');
    expect(output.workflow.verified).toBe(0);expect(request).toHaveBeenCalledTimes(2);expect(search).toHaveBeenCalledTimes(1);
  });
  it.each([null,{provider:'Tavily',fetchedAt:new Date().toISOString(),results:[]}])('validates actual sources before allowing any generation',async data=>{
    const request=vi.fn(),search=vi.fn(async()=>data);
    await expect(run(request,search,{searchTaskText:topic})).rejects.toMatchObject({stage:'search-1'});expect(request).not.toHaveBeenCalled();
  });
  it('a failed search cannot become a memory answer or invented excerpts',async()=>{
    const request=vi.fn(),search=vi.fn(async()=>{throw new Error('search unavailable');});
    await expect(run(request,search,{searchTaskText:topic})).rejects.toMatchObject({stage:'search-1'});expect(request).not.toHaveBeenCalled();
  });
  it('Stop during the first post-search answer never publishes sources-only or schedules a review',async()=>{
    const controller=new AbortController(),request=vi.fn(()=>new Promise(()=>{}));
    const pending=run(request,vi.fn(async query=>sources(query)),{searchTaskText:topic,reasoning:'high',signal:controller.signal});
    const stopped=expect(pending).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(1));controller.abort();await stopped;expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(['search-local','search-1','answer','complete'])('an immediate Stop from status %s prevents subsequent work/late acceptance',async stage=>{
    const controller=new AbortController(),request=vi.fn(async()=>result('Ответ')),search=vi.fn(async query=>sources(query));
    await expect(run(request,search,{searchTaskText:topic,signal:controller.signal,onStatus:s=>{if(s.stage===stage)controller.abort();}})).rejects.toMatchObject({name:'AbortError'});
    expect(search).toHaveBeenCalledTimes(['search-local','search-1'].includes(stage)?0:1);expect(request).toHaveBeenCalledTimes(stage==='complete'?1:0);
  });
  it('renders source-only excerpts as inert text, including GFM URLs/Markdown/HTML/math',()=>{
    const data=sources('учебный источник');data.results[0].content='![remote](https://evil.example/leak) <img src="https://evil.example/html"> [click](https://evil.example/) https://evil.example/plain $x$';
    const html=marked.parse(searchExcerpts(data));expect(html).not.toMatch(/<img|<a\s/i);
  });
});

describe('reported phone models through the real browser adapter (fixture HTTP)',()=>{
  it.each(['pollinations','qwen-3.5','gemma-3-12b'])('%s accepts an ordinary reply in one generation with Internet auto',async model=>{
    let submits=0;
    fetch.mockImplementation(async(url,init={})=>{
      if(url.includes('pollinations')){submits++;return sse('data: {"choices":[{"delta":{"content":"2 + 2 = 4"},"finish_reason":"stop"}]}\n\n');}
      if(init.method==='POST'){submits++;return json({event_id:'fixture'});}
      return sse(`event: complete\ndata: ${JSON.stringify(model==='qwen-3.5'?[null,null,null,null,[{role:'assistant',content:'2 + 2 = 4'}]]:['2 + 2 = 4'])}\n\n`);
    });
    const output=await generateAiBrowser({provider:'builtin',model,webSearch:'auto',reasoning:'off',systemPrompt:'Учитель',messages:[{role:'user',content:'Два плюс два'}]});
    expect(submits).toBe(1);expect(output.text).toContain('2 + 2 = 4');expect(output.workflow).toMatchObject({calls:1,searches:0});expect(fetch.mock.calls.some(([url])=>url.includes('tavily')||url.includes('supabase'))).toBe(false);
  });
  it.each(['pollinations','qwen-3.5'])('%s can fail on its first request without discarding independently obtained sources',async model=>{
    let calls=0;const onStatus=vi.fn();
    fetch.mockImplementation(async(url,init={})=>{
      if(url==='https://api.tavily.com/search')return json({results:sources('фотосинтез').results});
      if(url==='https://text.pollinations.ai/openai'){calls++;return new Response('PRIVATE_PROVIDER_ERROR',{status:503});}
      if(url.includes('qwen3-5-omni')){
        if(init.method==='POST'){calls++;return json({event_id:'fixture'});}
        return sse('event: error\ndata: null\n\n');
      }
      throw new Error('Unexpected endpoint');
    });
    const output=await generateAiBrowser({provider:'builtin',model,webSearch:'auto',reasoning:'high',messages:[{role:'user',content:topic}],onStatus});
    expect(output.sourcesOnly).toBe(true);expect(calls).toBe(1);expect(fetch.mock.calls[0][0]).toBe('https://api.tavily.com/search');
    expect(fetch).toHaveBeenCalledTimes(model==='pollinations'?2:3);
    expect(onStatus.mock.calls.at(-1)[0]).toMatchObject({stage:'format',message:'Получены только поисковые выдержки. Готовим их к показу…'});
    expect(output.workflow).toMatchObject({calls:1,searches:1,verified:0});expect(JSON.stringify(output)).not.toContain('PRIVATE_PROVIDER_ERROR');
  });
  it('does not retry or switch selected Gemma after GPU refusal when rules skipped search',async()=>{
    fetch.mockImplementation(async(url,init={})=>init.method==='POST'?json({event_id:'fixture'}):sse('event: error\ndata: "You have exceeded your GPU quota"\n\n'));
    await expect(generateAiBrowser({provider:'builtin',model:'gemma-3-12b',webSearch:'auto',reasoning:'off',messages:[{role:'user',content:'Вопрос'}]})).rejects.toMatchObject({stage:'answer',code:'quota'});
    expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls.every(([url])=>url.includes('gemma-3-12b'))).toBe(true);
  });
});
