import {describe,it,expect,vi} from 'vitest';
import {parseSearchAction, searchActionPrompt} from '../src/standalone/searchActions';
import {runAnswerWorkflow} from '../src/standalone/workflow';
import {generateAiBrowser} from '../src/standalone/aiClient';
import {searchExcerpts} from '../src/standalone/webSearch';
import {marked} from 'marked';
import config from '../shared/legacy-gateways.json';

const action = queries => '```domashka-search\n' + JSON.stringify({search:true,queries}) + '\n```';
const result = text => ({text,used:'Выбранная модель'});
const sources = query => ({provider:'Tavily',fetchedAt:new Date().toISOString(),query,results:[{title:'Официальный источник',url:'https://example.org/source',content:'Подтверждённая поисковая выдержка.'}]});
const run = (request, search, options={}) => runAnswerWorkflow({options:{webSearch:'auto',reasoning:'off',...options},messages:[{role:'user',content:'Обычный вопрос PRIVATE_TASK'}],systemPrompt:'ПРАВИЛА УЧИТЕЛЯ',request,search});
const sse = text => new Response(text,{headers:{'Content-Type':'text/event-stream'}});
const json = data => new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});

describe('one generation: ordinary answer OR bounded search action',()=>{
  it.each(['2 + 2 = 4','Обычное объяснение без JSON.','{"answer":4}','```json\n{"items":[1,2,3]}\n```','Пример кода: {"search":true,"queries":["не выполнять"]}'])('does not turn an ordinary answer into a required planning pass: %s',text=>{
    expect(parseSearchAction(text)).toBeNull();
  });
  it('accepts a single reserved block, bare control JSON and CRLF; deduplicates before network',()=>{
    expect(parseSearchAction(action(['закон Ома']))).toEqual({search:true,queries:['закон Ома']});
    expect(parseSearchAction(action(['закон Ома','закон Ома']).replaceAll('\n','\r\n'),2).queries).toEqual(['закон Ома']);
    expect(parseSearchAction('{"search":true,"queries":["закон Ома"]}').search).toBe(true);
  });
  it.each([
    action(['один'])+'\nИ ещё пояснение',
    'Сначала пояснение\n'+action(['один']),
    action(['один'])+'\n'+action(['два']),
    '```domashka-search\n{"search":true,"queries":["один"]}',
    '{"search":false,"queries":[]}',
    '{"search":true,"queries":[]}',
    '{"search":true,"queries":["один","два"]}',
    '{"search":true,"queries":["abc"],"url":"https://other.example"}',
    '{"search":true,"queries":',
    action(['x'.repeat(5000)]),
    action(['child@example.org']),
    action(['password: PRIVATE_SENTINEL']),
  ])('rejects malformed/private/control-only output without guessing a query',text=>{
    expect(()=>parseSearchAction(text)).toThrow();
  });
  it.each([['off',1],['low',1],['medium',2],['high',3]])('auto search without sources costs the same %s passes as internet off',async(reasoning,calls)=>{
    const request=vi.fn(async()=>result('2 + 2 = 4')),search=vi.fn();
    const withInternet=await run(request,search,{reasoning});
    expect(request).toHaveBeenCalledTimes(calls);expect(search).not.toHaveBeenCalled();
    expect(withInternet.workflow.calls).toBe(calls);expect(withInternet.text).toContain('Интернет не использовался');
    expect(request.mock.calls[0][0]).toMatchObject({reasoning});
    expect(request.mock.calls[0][0].systemPrompt).toContain('ПРАВИЛА УЧИТЕЛЯ');
    for(const [args]of request.mock.calls.slice(1))expect(args.systemPrompt).not.toContain('ИНТЕРНЕТ ПО НЕОБХОДИМОСТИ');
    request.mockClear();const withoutInternet=await run(request,search,{reasoning,webSearch:false});
    expect(request).toHaveBeenCalledTimes(calls);expect(withoutInternet.text).not.toContain('Интернет не использовался');
  });
  it('retains graphics, reasoning and native photo policy in the first real answer',async()=>{
    const request=vi.fn(async args=>({...result('Вижу график'),photoInputUsed:'vision',photoCount:1,extractedPhotoText:''}));
    const output=await run(request,vi.fn(),{graphics:true,reasoning:'low',images:[config.neutralImageDataUrl],photoMode:'vision',ocrText:'STALE_OCR'});
    expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][0]).toMatchObject({graphics:true,reasoning:'low',photoMode:'vision',images:[config.neutralImageDataUrl]});
    expect(output.extractedPhotoText).toBe('');expect(output.photoInputUsed).toBe('vision');
  });
  it('sends only the validated model query to search, then answers with real excerpts and no action permission',async()=>{
    const request=vi.fn().mockResolvedValueOnce(result(action(['публичный учебный источник']))).mockResolvedValueOnce(result('Ответ по источнику [1].'));
    const search=vi.fn(async query=>sources(query));const output=await run(request,search);
    expect(request).toHaveBeenCalledTimes(2);expect(search).toHaveBeenCalledTimes(1);expect(search.mock.calls[0][0]).toBe('публичный учебный источник');
    expect(JSON.stringify(search.mock.calls)).not.toContain('PRIVATE_TASK');
    expect(request.mock.calls[1][0].systemPrompt).toContain('ПОИСКОВЫЕ ДАННЫЕ');expect(request.mock.calls[1][0].systemPrompt).not.toContain('ИНТЕРНЕТ ПО НЕОБХОДИМОСТИ');
    expect(output.text).toContain('Источники поиска');expect(output.text).not.toContain('domashka-search');expect(output.text).not.toContain('Интернет не использовался');
    expect(output.workflow).toMatchObject({calls:2,searches:1,verified:0});
  });
  it('validates all queries before sending even the first; no context/photo/secret search',async()=>{
    const request=vi.fn(async()=>result(action(['безопасная фраза','child@example.org']))),search=vi.fn();
    await expect(run(request,search,{reasoning:'high'})).rejects.toThrow(/личные данные/);expect(search).not.toHaveBeenCalled();expect(request).toHaveBeenCalledTimes(1);
  });
  it('never starts another model call after a malformed or legacy false-only plan',async()=>{
    const request=vi.fn(async()=>result('{"search":false,"queries":[]}')),search=vi.fn();
    await expect(run(request,search)).rejects.toMatchObject({stage:'answer-or-search',code:'search-action-invalid'});expect(request).toHaveBeenCalledTimes(1);expect(search).not.toHaveBeenCalled();
  });
  it('retains real sources if the model refuses the post-search answer, with no hidden retry/model switch/review',async()=>{
    const request=vi.fn().mockResolvedValueOnce(result(action(['учебный источник']))).mockRejectedValue(Object.assign(new Error('PRIVATE_QUOTA_BODY'),{code:'quota'}));
    const search=vi.fn(async query=>sources(query));const output=await run(request,search,{reasoning:'high'});
    expect(output.sourcesOnly).toBe(true);expect(output.text).toContain('Подтверждённая поисковая выдержка');expect(output.text).toContain('не ответ выбранной модели');expect(output.text).toContain('https://example.org/source');
    expect(output.used).toContain('ИИ-ответ не получен');expect(JSON.stringify(output)).not.toContain('PRIVATE_QUOTA_BODY');expect(output.workflow).toMatchObject({calls:2,searches:1,verified:0});expect(request).toHaveBeenCalledTimes(2);
  });
  it('never lets answer/review output recurse into another search',async()=>{
    const search=vi.fn(async query=>sources(query)),request=vi.fn(async()=>result(action(['учебный источник'])));
    const output=await run(request,search,{reasoning:'high'});expect(output.sourcesOnly).toBe(true);expect(request).toHaveBeenCalledTimes(2);expect(search).toHaveBeenCalledTimes(1);expect(output.text).not.toContain('domashka-search');
  });
  it('a failed search still fails closed: no memory answer and no invented source excerpts',async()=>{
    const request=vi.fn(async()=>result(action(['учебный источник']))),search=vi.fn(async()=>{throw new Error('search unavailable');});
    await expect(run(request,search)).rejects.toMatchObject({stage:'search-1'});expect(request).toHaveBeenCalledTimes(1);
  });
  it('Stop during the post-search answer never publishes source-only fallback or schedules review',async()=>{
    const controller=new AbortController(),request=vi.fn().mockResolvedValueOnce(result(action(['учебный источник']))).mockImplementation(()=>new Promise(()=>{}));
    const pending=run(request,vi.fn(async query=>sources(query)),{reasoning:'high',signal:controller.signal});
    const stopped=expect(pending).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(2));controller.abort();await stopped;
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('renders source-only excerpts as inert text rather than executing their Markdown/HTML',()=>{
    const data=sources('учебный источник');data.results[0].content='![remote](https://evil.example/leak) <img src="https://evil.example/html"> [click](https://evil.example/)';
    const html=marked.parse(searchExcerpts(data));expect(html).not.toMatch(/<img|<a\s/i);
    expect(searchActionPrompt(1)).toContain('сразу дай обычный готовый ответ');
  });
});

describe('reported phone models: no mandatory planner in the real browser adapter',()=>{
  it.each(['pollinations','qwen-3.5','gemma-3-12b'])('%s accepts the same ordinary reply with Internet auto and one generation',async model=>{
    let submits=0;
    fetch.mockImplementation(async(url,init={})=>{
      if(url.includes('pollinations')){submits++;return sse('data: {"choices":[{"delta":{"content":"2 + 2 = 4"},"finish_reason":"stop"}]}\n\n');}
      if(init.method==='POST'){submits++;return json({event_id:'fixture'});}
      return sse(`event: complete\ndata: ${JSON.stringify(model==='qwen-3.5'?[null,null,null,null,[{role:'assistant',content:'2 + 2 = 4'}]]:['2 + 2 = 4'])}\n\n`);
    });
    const output=await generateAiBrowser({provider:'builtin',model,webSearch:'auto',reasoning:'off',systemPrompt:'Учитель',messages:[{role:'user',content:'Два плюс два'}]});
    expect(submits).toBe(1);expect(output.text).toContain('2 + 2 = 4');expect(output.workflow).toMatchObject({calls:1,searches:0});expect(fetch.mock.calls.some(([url])=>url.includes('tavily')||url.includes('supabase'))).toBe(false);
  });
  it('the real browser workflow labels post-search fallback as excerpts even during final formatting',async()=>{
    let calls=0;const onStatus=vi.fn();
    fetch.mockImplementation(async(url)=>{
      if(url==='https://api.tavily.com/search')return json({results:sources('NASA planets').results});
      if(url==='https://text.pollinations.ai/openai'){
        if(++calls===1)return sse('data: '+JSON.stringify({choices:[{delta:{content:action(['NASA planets'])},finish_reason:'stop'}]})+'\n\n');
        return new Response('PRIVATE_PROVIDER_ERROR',{status:503});
      }
      throw new Error('Unexpected endpoint');
    });
    const output=await generateAiBrowser({provider:'builtin',model:'pollinations',webSearch:'auto',reasoning:'high',messages:[{role:'user',content:'Найди источник'}],onStatus});
    expect(output.sourcesOnly).toBe(true);expect(calls).toBe(2);expect(fetch).toHaveBeenCalledTimes(3);
    expect(onStatus.mock.calls.at(-1)[0]).toMatchObject({stage:'format',message:'Получены только поисковые выдержки. Готовим их к показу…'});
    expect(output.workflow).toMatchObject({calls:2,searches:1,verified:0});
    expect(JSON.stringify(output)).not.toContain('PRIVATE_PROVIDER_ERROR');
  });
  it('does not retry or silently switch a selected Gemma after an actual GPU quota refusal',async()=>{
    fetch.mockImplementation(async(url,init={})=>init.method==='POST'?json({event_id:'fixture'}):sse('event: error\ndata: "You have exceeded your GPU quota"\n\n'));
    await expect(generateAiBrowser({provider:'builtin',model:'gemma-3-12b',webSearch:'auto',reasoning:'off',messages:[{role:'user',content:'Вопрос'}]})).rejects.toMatchObject({stage:'answer-or-search',code:'quota'});
    expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls.every(([url])=>url.includes('gemma-3-12b'))).toBe(true);
  });
});
