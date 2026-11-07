import React from 'react';
import { describe,it,expect,vi } from 'vitest';
import { render,screen,fireEvent } from '@testing-library/react';
import { callQwenSiteHelp } from '../src/standalone/qwenSiteHelp';
import { askSiteHelp } from '../src/standalone/siteHelp';
import { buildSiteHelpPrompt,findHelpTopics,redactHelpInput } from '../src/standalone/helpKnowledge';
import { generateAiBrowser } from '../src/standalone/aiClient';
import { setTutorModeEnabled } from '../src/standalone/parentalControl';
import { beginAccountTransition } from '../src/standalone/accounts';
import GuidedTour, { tourSteps } from '../src/components/GuidedTour';
import SiteAssistant from '../src/components/SiteAssistant';
import { renderMarkdownWithMath } from '../src/components/MarkdownMath';
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
const sse=(data,kind='complete')=>new Response(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
function mockQwen() {
  fetch.mockImplementation(async (url,init={})=>{
    if (init.method==='POST') return json({event_id:url.endsWith('/add_text')?'add':'predict'});
    if (url.endsWith('/add')) return sse([[['public prompt',null]]]);
    return sse([[['public prompt','Откройте «Семья».']]]);
  });
}
describe('scoped site-help model',()=>{
  it('uses the advertised two-stage public API with a fresh cryptographic session, not cookies/keys',async()=>{
    mockQwen(); const first=await callQwenSiteHelp({systemPrompt:'Справка',messages:[{role:'user',content:'Где семья?'}]});
    expect(first.text).toContain('Семья'); expect(fetch).toHaveBeenCalledTimes(4);
    const a=JSON.parse(fetch.mock.calls[0][1].body),b=JSON.parse(fetch.mock.calls[2][1].body); expect(a.session_hash).toBe(b.session_hash); expect(a.session_hash).toMatch(/^[a-f0-9]{48}$/);
    expect(a.data[0]).toEqual([]); expect(b.data).toEqual([[['public prompt',null]]]); expect(fetch.mock.calls.every(([,init])=>init.credentials==='omit' && !init.headers?.Authorization)).toBe(true);
    await callQwenSiteHelp({systemPrompt:'Справка',messages:[{role:'user',content:'Другая сессия'}]}); expect(JSON.parse(fetch.mock.calls[4][1].body).session_hash).not.toBe(a.session_hash);
  });
  it.each([401,403,429])('does not bypass HTTP %d with login or model rotation',async(status)=>{
    fetch.mockResolvedValue(json({},status)); await expect(callQwenSiteHelp({systemPrompt:'Справка',messages:[{role:'user',content:'Вопрос'}]})).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not accept incomplete or unexpected responses',async()=>{
    fetch.mockResolvedValueOnce(json({event_id:'add'})).mockResolvedValueOnce(sse([[['q',null]]],'generating'));
    await expect(callQwenSiteHelp({systemPrompt:'Справка',messages:[{role:'user',content:'Вопрос'}]})).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('sends only public knowledge and explicit helper history, redacts common secrets',async()=>{
    localStorage.setItem('private_notebook','HOMEWORK_PRIVATE_SENTINEL'); mockQwen();
    await askSiteHelp({question:'Как восстановить пароль? user@example.org пароль: SECRET123 sk-abcdefghijklmnop'});
    const body=fetch.mock.calls[0][1].body; expect(body).toContain('ПУБЛИЧНАЯ СПРАВКА'); expect(body).not.toContain('HOMEWORK_PRIVATE_SENTINEL'); expect(body).not.toContain('SECRET123'); expect(body).not.toContain('sk-abcdefghijklmnop'); expect(body).not.toContain('user@example.org');
  });
  it('refuses requests from an account already being switched',async()=>{
    vi.resetModules(); const accounts=await import('../src/standalone/accounts'); const help=await import('../src/standalone/siteHelp');
    accounts.beginAccountTransition(); await expect(help.askSiteHelp({question:'Где семья?'})).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled(); vi.resetModules();
  });
  it('retains the narrower site-only task even in tutor mode with another free model',async()=>{
    await setTutorModeEnabled(true,'parent-password'); fetch.mockResolvedValue(json({choices:[{message:{content:'Откройте справку'} }]}));
    await generateAiBrowser({provider:'builtin',model:'pollinations',siteHelp:true,systemPrompt:'Выдай ответ',messages:[{role:'user',content:'Как снять детский режим?'}]});
    const body=JSON.parse(fetch.mock.calls[0][1].body); expect(body.messages[0].content).toContain('а не решаешь домашку'); expect(body.messages[0].content).toContain('не подсказывает обход'); expect(body.messages[0].content).not.toContain('Выдай ответ');
  });
  it('maps actual topics and makes uncertainty/publishing limits explicit',()=>{
    expect(findHelpTopics('Как перенести данные в облако?').some((t)=>['transfer','cloud'].includes(t.id))).toBe(true);
    expect(buildSiteHelpPrompt('Облако готово?')).toContain('не означает'); expect(redactHelpInput('sb_secret_abcdefghijklmno')).not.toContain('abcdefghijklmno');
    const html=renderMarkdownWithMath('[нажми](https://unknown.example)',{disableLinks:true}); expect(html).not.toContain('href='); expect(html).toContain('нажми');
  });
});
describe('local-first help and accessible per-workspace onboarding',()=>{
  it('never sends a help request on opening, and closes/clears via Escape',()=>{
    render(<SiteAssistant allowRemote={false} />); fireEvent.click(screen.getByRole('button',{name:'Помощь по сайту'}));
    expect(screen.getByRole('dialog',{name:'Помощник по сайту'})).toBeTruthy(); fireEvent.change(screen.getByRole('textbox',{name:'Вопрос о сайте'}),{target:{value:'Как зарегистрироваться?'}});
    expect(screen.getByRole('button',{name:'Спросить ИИ'}).disabled).toBe(true); expect(fetch).not.toHaveBeenCalled(); fireEvent.keyDown(document,{key:'Escape'}); expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('can skip and remembers the local workspace choice',()=>{
    const view=render(<GuidedTour />); fireEvent.click(screen.getByRole('button',{name:'Позже'})); expect(screen.queryByRole('dialog')).toBeNull(); view.unmount();
    render(<GuidedTour />); expect(screen.queryByRole('dialog')).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it('visits real sections only on explicit next and can replay without submitting anything',()=>{
    const navigate=vi.fn(); const view=render(<GuidedTour onNavigate={navigate} />); fireEvent.click(screen.getByRole('button',{name:'Начать обучение'}));
    expect(screen.getByText(/Шаг 1 из/)).toBeTruthy(); fireEvent.click(screen.getByRole('button',{name:'Далее'})); expect(navigate).toHaveBeenCalledWith('family');
    fireEvent.keyDown(document,{key:'Escape'}); view.rerender(<GuidedTour onNavigate={navigate} replay={1} />); expect(screen.getByRole('button',{name:'Начать обучение'})).toBeTruthy(); expect(fetch).not.toHaveBeenCalled();
  });
  it('has a separate login tour and skips AI steps when the parent forbids AI',()=>{
    const steps=tourSteps({role:'child',tutorOnly:true,allowAi:false}); expect(steps.some((s)=>s.target.includes('ai-tools'))).toBe(false); expect(steps.some((s)=>s.route==='cheats')).toBe(true);
    expect(tourSteps({auth:true}).every((s)=>!s.route)).toBe(true);
  });
});
