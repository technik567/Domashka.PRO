import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../src/App';
import WorkflowPanel from '../src/components/WorkflowPanel';
import * as apiModule from '../src/api';
import { api, loadInputDraft } from '../src/api';
import { loadInterfacePreferences, saveInterfacePreferences } from '../src/standalone/interfacePreferences';
import { setTutorModeEnabled } from '../src/standalone/parentalControl';
import { getSearchKey, clearSearchKey } from '../src/standalone/searchCredentials';

function openSettings(){fireEvent.click(screen.getByRole('button',{name:'Настройки',exact:true}));}
function setMode(mode){fireEvent.click(screen.getByRole('radio',{name:mode==='advanced'?/Продвинутый/:/Базовый/}));}
function closeSettings(){fireEvent.click(screen.getByRole('button',{name:'Готово',exact:true}));}
describe('4.4 global simple interface',()=>{
  it('starts with one calm chat and no catalogue/toolbars/grades or stats banner',()=>{
    render(<App/>);expect(document.querySelector('.study-app').dataset.interface).toBe('basic');expect(screen.getByRole('heading',{name:'С чем помочь по учёбе?'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'Подумать'}).getAttribute('aria-pressed')).toBe('true');expect(screen.getByRole('button',{name:'Интернет: авто'})).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Калькуляторы',exact:true})).toBeNull();expect(screen.queryByRole('combobox',{name:'Выберите класс'})).toBeNull();expect(screen.queryByText(/1500 XP/)).toBeNull();expect(screen.queryByPlaceholderText(/что искать/i)).toBeNull();
    expect(screen.getByRole('button',{name:'Настройки',exact:true})).toBeTruthy();expect(fetch).not.toHaveBeenCalled();
  });
  it('changes the whole interface without losing task text, model, appearance or request settings',async()=>{
    render(<App/>);fireEvent.change(screen.getByRole('textbox',{name:'Твоё сообщение'}),{target:{value:'Моя задача, ещё не отправленная'}});
    fireEvent.change(screen.getByLabelText('Нейросеть для ответа · без ключа'),{target:{value:'qwen3-14b-demo'}});
    fireEvent.click(screen.getByRole('button',{name:'Интернет: авто'}));
    openSettings();setMode('advanced');fireEvent.change(screen.getByLabelText('Тема'),{target:{value:'dark'}});fireEvent.click(screen.getByLabelText('Учебный фотофон'));closeSettings();
    expect(document.querySelector('.study-app').dataset.interface).toBe('advanced');expect(document.documentElement.classList.contains('dark')).toBe(true);expect(document.querySelector('.study-app').dataset.photoBackground).toBe('off');
    expect(screen.getByRole('button',{name:'Калькуляторы',exact:true})).toBeTruthy();expect(document.querySelector('[data-tour="task-input"]').value).toBe('Моя задача, ещё не отправленная');expect(screen.getByLabelText('Нейросеть для ответа · без ключа').value).toBe('qwen3-14b-demo');
    expect(screen.getByRole('button',{name:'Интернет: выкл.'})).toBeTruthy();expect(loadInputDraft('solver').taskText).toBe('Моя задача, ещё не отправленная');
    openSettings();setMode('basic');closeSettings();expect(screen.getByRole('textbox',{name:'Твоё сообщение'}).value).toBe('Моя задача, ещё не отправленная');expect(loadInterfacePreferences()).toEqual({mode:'basic',background:false});
  });
  it('keeps a received conversation and unsent follow-up across interface changes',async()=>{
    vi.spyOn(api,'solveHomework').mockResolvedValue({ok:true,id:'fixture',markdown:'Учебный ответ',providerUsed:'Fixture',messages:[{role:'user',content:'Задача'},{role:'assistant',content:'Учебный ответ'}]});
    render(<App/>);fireEvent.change(screen.getByRole('textbox',{name:'Твоё сообщение'}),{target:{value:'Задача'}});fireEvent.click(screen.getByRole('button',{name:'Отправить сообщение'}));await screen.findByText('Учебный ответ');
    fireEvent.change(screen.getByRole('textbox',{name:'Продолжить диалог'}),{target:{value:'Неотправленное уточнение'}});openSettings();setMode('advanced');closeSettings();openSettings();setMode('basic');closeSettings();
    expect(screen.getByRole('textbox',{name:'Продолжить диалог'}).value).toBe('Неотправленное уточнение');expect(screen.getByText('Учебный ответ')).toBeTruthy();expect(api.solveHomework).toHaveBeenCalledTimes(1);
  });
  it('shows real pending work with Stop and discards a response received after cancel',async()=>{
    let resolve;const call=vi.spyOn(api,'solveHomework').mockImplementation(()=>new Promise(done=>{resolve=done;}));render(<App/>);
    fireEvent.change(screen.getByRole('textbox',{name:'Твоё сообщение'}),{target:{value:'Текущий вопрос'}});fireEvent.click(screen.getByRole('button',{name:'Отправить сообщение'}));expect(screen.queryByRole('heading',{name:'С чем помочь по учёбе?'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Остановить ответ'}));expect(call.mock.calls[0][0].signal.aborted).toBe(true);
    await act(async()=>{resolve({ok:true,id:'late',markdown:'СТАРЫЙ ОТВЕТ',messages:[]});});expect(screen.queryByText('СТАРЫЙ ОТВЕТ')).toBeNull();expect(screen.getByRole('textbox',{name:'Твоё сообщение'}).value).toBe('Текущий вопрос');
  });
  it('keeps drafts when opening Family and back; parent account is not required for appearance',()=>{
    render(<App/>);fireEvent.change(screen.getByRole('textbox',{name:'Твоё сообщение'}),{target:{value:'Мой черновик'}});openSettings();fireEvent.click(screen.getByRole('button',{name:'Семья, профиль и восстановление аккаунта'}));fireEvent.click(screen.getByRole('button',{name:'Чат',exact:true}));expect(screen.getByRole('textbox',{name:'Твоё сообщение'}).value).toBe('Мой черновик');
  });
  it('appearance mode cannot unlock tutor tools, model choice or search',async()=>{
    await setTutorModeEnabled(true,'parent-password');render(<App/>);openSettings();setMode('advanced');expect(screen.queryByRole('button',{name:'Открыть настройки нейросети'})).toBeNull();expect(screen.queryByLabelText(/Личный ключ поиска/)).toBeNull();closeSettings();
    expect(screen.queryByRole('button',{name:'Калькуляторы',exact:true})).toBeNull();expect(screen.getByLabelText('Нейросеть для ответа · без ключа').disabled).toBe(true);expect(screen.getByRole('button',{name:'Интернет: выкл.'}).disabled).toBe(true);expect(fetch).not.toHaveBeenCalled();
  });
  it('settings do not erase a typed transient key when changing appearance and never save it to prefs',()=>{
    saveInterfacePreferences({mode:'advanced'});render(<App/>);openSettings();const input=screen.getByLabelText(/Личный ключ поиска/);fireEvent.change(input,{target:{value:'tvly-unsent-key-123456789'}});fireEvent.change(screen.getByLabelText('Тема'),{target:{value:'dark'}});expect(input.value).toBe('tvly-unsent-key-123456789');closeSettings();openSettings();expect(screen.getByLabelText(/Личный ключ поиска/).value).toBe('');expect(getSearchKey()).toBe('');expect(JSON.stringify(localStorage)).not.toContain('tvly-unsent-key');clearSearchKey();
  });
  it('keeps the password-protected local child mode reachable in the basic interface',()=>{
    render(<App/>);openSettings();fireEvent.click(screen.getByRole('button',{name:'Детский режим с паролем'}));
    expect(screen.queryByRole('dialog',{name:'Настройки'})).toBeNull();expect(screen.getByLabelText('Придумайте родительский пароль')).toBeTruthy();
  });
  it('a new chat discards a late photo conversion instead of restoring the deleted attachment',async()=>{
    let finish;vi.spyOn(apiModule,'preparePhotoFile').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<App/>);
    const input=document.querySelector('.simple-composer input[type="file"]');fireEvent.change(input,{target:{files:[new File(['image'],'homework.png',{type:'image/png'})]}});
    expect(screen.getByText('Подготавливаем фото…')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Новый чат',exact:true}));
    await act(async()=>{finish('data:image/png;base64,AAAA');});expect(screen.queryByRole('img',{name:'Прикреплённое задание 1'})).toBeNull();expect(screen.queryByText('Подготавливаем фото…')).toBeNull();
  });
  it('checker and the preserved hidden solver have distinct model input IDs',()=>{
    saveInterfacePreferences({mode:'advanced'});render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Проверить',exact:true}));
    const picker=screen.getByRole('combobox',{name:'Нейросеть для ответа · без ключа'});expect(picker.id).toBe('checker-builtin-model');expect(document.querySelectorAll('#chat-builtin-model')).toHaveLength(1);
  });
  it('restores persisted basic/advanced preference and handles corrupted storage safely',()=>{saveInterfacePreferences({mode:'advanced',background:false});expect(loadInterfacePreferences()).toEqual({mode:'advanced',background:false});render(<App/>);expect(document.querySelector('.study-app').dataset.interface).toBe('advanced');});
});
describe('visible workflow receipts',()=>{
  it('shows only supplied events, no fake percentages, raw drafts or fabricated future checks',()=>{
    render(<WorkflowPanel busy advanced status={{message:'Ищу источники…',trail:[{id:1,stage:'search-1',message:'Ищу источники…',query:'закон Ома',state:'active'}]}} onCancel={()=>{}}/>);
    expect(screen.getByText('Запрос: закон Ома')).toBeTruthy();expect(screen.queryByText(/%/)).toBeNull();expect(screen.queryByText('Проверяю ответ')).toBeNull();expect(document.querySelector('details').open).toBe(true);
  });
  it('collapses on completion and hides query details in basic mode',()=>{
    const {rerender}=render(<WorkflowPanel busy advanced status={{message:'Готовлю ответ',trail:[]}}/>);
    rerender(<WorkflowPanel workflow={{calls:2,searches:1,verified:0,elapsedMs:2300,trail:[{id:1,stage:'search-1',state:'done',message:'Получены источники',query:'закон Ома'}]}}/>);
    expect(document.querySelector('details').open).toBe(false);expect(screen.queryByText('Запрос: закон Ома')).toBeNull();expect(screen.getByText('2 с')).toBeTruthy();
  });
});
