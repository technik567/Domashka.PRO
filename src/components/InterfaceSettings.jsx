import React, { useEffect, useRef, useState } from 'react';
import { X, SlidersHorizontal, Sparkles, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { canSetSearchKey, hasSearchKey, setSearchKey, clearSearchKey } from '../standalone/searchCredentials';
import { runWebSearch } from '../standalone/webSearch';
import { subscribeAccounts } from '../standalone/accounts';
import { subscribeParentalControl } from '../standalone/parentalControl';

export default function InterfaceSettings({open,onClose,preferences,onPreferences,theme,onTheme,profile,onGrade,onGoal,goals=[],managed=false,tutorOnly=false,onAi,onFamily,onParent}) {
  const panel=useRef(null), abort=useRef(null),close=useRef(onClose);
  close.current=onClose;
  const [key,setKey]=useState(''),[reveal,setReveal]=useState(false),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[configured,setConfigured]=useState(false);
  useEffect(()=>{
    if(!open)return;
    setKey('');setReveal(false);setStatus('');setBusy(false);setConfigured(hasSearchKey());
    const previous=document.activeElement;const oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';panel.current?.focus();
    const reset=()=>{abort.current?.abort();setKey('');setReveal(false);setStatus('');setConfigured(false);};
    const stopAccounts=subscribeAccounts(reset),stopPolicy=subscribeParentalControl(reset);
    const keyboard=e=>{if(e.key==='Escape'){e.preventDefault();close.current();}if(e.key==='Tab'){
      const controls=[...panel.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary')].filter(el=>el.getClientRects().length);
      if(!controls.length){e.preventDefault();return;}const at=controls.indexOf(document.activeElement);
      if(e.shiftKey&&at<=0){e.preventDefault();controls.at(-1).focus();}else if(!e.shiftKey&&(at===controls.length-1||at===-1)){e.preventDefault();controls[0].focus();}
    }};
    document.addEventListener('keydown',keyboard);
    return()=>{abort.current?.abort();abort.current=null;stopAccounts();stopPolicy();document.body.style.overflow=oldOverflow;document.removeEventListener('keydown',keyboard);if(previous?.isConnected)previous.focus();};
  },[open]);
  if(!open)return null;
  const advanced=preferences.mode==='advanced';
  async function testSearch(){
    if(busy)return;const ctrl=new AbortController();abort.current=ctrl;setBusy(true);setStatus('Проверяем одним настоящим поисковым запросом…');
    try{if(key.trim()){setSearchKey(key);setKey('');setConfigured(true);}await runWebSearch('образование официальные учебные материалы',{signal:ctrl.signal});if(!ctrl.signal.aborted)setStatus('Поиск ответил. Проверка тоже расходует доступную квоту.');}
    catch(error){if(!ctrl.signal.aborted)setStatus(error.message);}
    finally{if(abort.current===ctrl){abort.current=null;setBusy(false);}}
  }
  return <div className="study-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="interface-title" className="study-modal">
      <header className="study-modal-header"><div><p className="study-eyebrow">Сделайте по-своему</p><h2 id="interface-title">Настройки</h2></div><button type="button" onClick={onClose} aria-label="Закрыть настройки" className="study-icon-button"><X size={20}/></button></header>
      <div className="study-modal-body">
        <fieldset><legend>Интерфейс</legend><div className="interface-options">{[['basic','Базовый','Только чат и самое нужное.',Sparkles],['advanced','Продвинутый','Все учебные инструменты и подключения.',SlidersHorizontal]].map(([value,label,description,Icon])=><label key={value} className={`interface-choice ${preferences.mode===value?'selected':''}`}><input type="radio" name="interface-mode" value={value} checked={preferences.mode===value} onChange={()=>onPreferences({...preferences,mode:value})}/><Icon size={20}/><strong>{label}</strong><span>{description}</span></label>)}</div><p className="study-muted">Меняется только интерфейс. Чаты и данные сохраняются, родительские ограничения остаются.</p></fieldset>
        <fieldset><legend>Внешний вид</legend><div className="study-settings-row"><label>Тема<select value={theme} onChange={e=>onTheme(e.target.value)}><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label><label className="study-check"><input type="checkbox" checked={preferences.background} onChange={e=>onPreferences({...preferences,background:e.target.checked})}/>Учебный фотофон</label></div></fieldset>
        <fieldset><legend>Обучение</legend><div className="study-settings-row"><label>Класс<select aria-label="Выберите класс" value={profile.grade} disabled={managed} onChange={e=>onGrade(e.target.value)}>{Array.from({length:11},(_,i)=><option key={i+1} value={i+1}>{i+1} класс</option>)}</select></label>{advanced&&<label>Цель<select aria-label="Цель обучения" value={profile.examGoal} disabled={managed} onChange={e=>onGoal(e.target.value)}>{goals.map(g=><option key={g.id} value={g.id}>{g.label}</option>)}</select></label>}</div>{managed&&<p className="study-muted">Класс и доступ к ИИ задаёт родитель в семейном кабинете.</p>}<button type="button" className="study-link" onClick={()=>{onClose();onFamily();}}>Семья, профиль и восстановление аккаунта</button></fieldset>
        {onParent&&<fieldset><legend>Родительский режим</legend><p className="study-muted">Ограничить этот локальный профиль учебными подсказками. Для переключения нужен родительский пароль; семейные ограничения задаются отдельно.</p><button type="button" className="study-button" onClick={()=>{onClose();onParent();}}>Детский режим с паролем</button></fieldset>}
        {advanced&&!managed&&!tutorOnly&&<fieldset><legend>Подключения ИИ</legend><p className="study-muted">Бесплатную модель можно выбрать рядом с сообщением. Провайдеры со своим ключом и локальные модели — в дополнительных настройках.</p><button type="button" className="study-button" onClick={()=>{onClose();onAi();}}>Открыть настройки нейросети</button></fieldset>}
        {advanced&&canSetSearchKey()&&<fieldset><legend>Интернет-поиск</legend><p className="study-muted">По умолчанию — без ключа. Нужен ли поиск и что искать, решает модель. У сервиса есть лимиты; ключ необязателен. Поисковику передаётся только короткий запрос.</p>
          <a href="https://app.tavily.com/" target="_blank" rel="noreferrer" className="study-link">Получить ключ Tavily <ExternalLink size={13}/></a>
          <label className="block mt-3">Личный ключ поиска (необязательно)<div className="search-key-field"><input type={reveal?'text':'password'} value={key} maxLength={245} autoComplete="off" spellCheck={false} placeholder={configured?'Ключ уже подключён в этой вкладке':'tvly-…'} onChange={e=>setKey(e.target.value)}/><button type="button" aria-label={reveal?'Скрыть ключ':'Показать ключ'} className="study-icon-button" onClick={()=>setReveal(v=>!v)}>{reveal?<EyeOff size={17}/>:<Eye size={17}/>}</button></div></label>
          <p className="study-muted">Ключ хранится только в памяти текущей вкладки до перезагрузки/смены аккаунта. Не попадает в чаты и резервные копии. В облачном режиме передаётся защищённой поисковой функции, затем Tavily. Общий ключ владельца настраивается отдельно на сервере, здесь он не показывается.</p>
          <div className="flex flex-wrap gap-2"><button type="button" className="study-button" disabled={busy} onClick={testSearch}>{busy?'Проверяем…':'Подключить и проверить поиск'}</button>{configured&&<button type="button" className="study-button" disabled={busy} onClick={()=>{clearSearchKey();setConfigured(false);setKey('');setStatus('Личный ключ удалён из памяти.');}}>Удалить ключ</button>}</div>
          {status&&<p role="status" className="study-muted mt-2">{status}</p>}
        </fieldset>}
      </div><footer className="study-modal-footer"><span>Настройки интерфейса сохраняются на этом устройстве.</span><button type="button" className="study-button primary" onClick={onClose}>Готово</button></footer>
    </section>
  </div>;
}
