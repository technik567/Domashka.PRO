import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Paperclip, X, Copy, Check, Volume2, GraduationCap, Lightbulb, PenLine, Search } from 'lucide-react';
import { preparePhotoFile } from '../api';
import VoiceMicButton from './VoiceMicButton';
import MarkdownMath from './MarkdownMath';
import BuiltinModelPicker from './BuiltinModelPicker';
import AiRequestControls from './AiRequestControls';
import WorkflowPanel from './WorkflowPanel';

function Controls({aiSettings,onChangeAiSettings,onOpenAiSettings,requestModes,setRequestModes,busy,tutorOnly}) {
  const tools=<AiRequestControls compact value={requestModes} onChange={setRequestModes} disabled={busy} tutorOnly={tutorOnly}/>;
  return aiSettings.provider==='builtin'?<BuiltinModelPicker compact settings={aiSettings} onChange={onChangeAiSettings} disabled={busy} tutorOnly={tutorOnly} onOpenSettings={onOpenAiSettings} tools={tools}/>:tools;
}
export function SimpleComposer({text,onText,onSubmit,onPaste,textareaRef,photos,onPhotos,onBusy,busy,photoMode,onPhotoMode,maxImages,tutorOnly,grade,error,resetSignal=0,...controls}) {
  const file=useRef(null),generation=useRef(0);const [preparing,setPreparing]=useState(false),[fileError,setFileError]=useState('');
  useEffect(()=>{
    generation.current++;setPreparing(false);setFileError('');onBusy(false);
    return()=>{generation.current++;onBusy(false);};
  },[resetSignal]);
  async function attach(e) {
    const files=[...e.target.files||[]];e.target.value='';if(!files.length)return;
    if(files.length+photos.length>4){setFileError('Можно прикрепить до четырёх фотографий.');return;}
    const op=++generation.current;setPreparing(true);onBusy(true);setFileError('');
    try{const next=[];for(const item of files){next.push(await preparePhotoFile(item));if(op!==generation.current)return;}onPhotos([...photos,...next]);}
    catch(err){if(op===generation.current)setFileError(err.message);}
    finally{if(op===generation.current){setPreparing(false);onBusy(false);}}
  }
  return <div className="simple-start">
    <div className="simple-greeting"><div className="simple-greeting-mark"><GraduationCap size={30}/></div><p className="study-eyebrow">Твоё место для новых открытий</p><h1>{tutorOnly?'Разберёмся вместе':'С чем помочь по учёбе?'}</h1><p>{tutorOnly?'Начни со своей попытки. Я помогу сделать следующий шаг.':'Задай вопрос, прикрепи задание — начнём с самого важного.'}</p></div>
    <form className="simple-composer" onSubmit={onSubmit} aria-label="Учебный чат">
      <label className="sr-only" htmlFor="simple-task">Твоё сообщение</label><textarea id="simple-task" data-tour="task-input" ref={textareaRef} rows={4} value={text} onChange={e=>onText(e.target.value)} onPaste={onPaste} disabled={busy} placeholder="Напиши вопрос или добавь фото задания…" onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing){e.preventDefault();onSubmit(e);}}}/>
      {photos.length>0&&<div className="simple-photo-list">{photos.map((src,i)=><div key={src.slice(-40)+i}><img src={src} alt={`Прикреплённое задание ${i+1}`}/><button type="button" aria-label={`Удалить фото ${i+1}`} disabled={busy||preparing} onClick={()=>onPhotos(photos.filter((_,n)=>n!==i))}><X size={13}/></button></div>)}</div>}
      <div className="simple-composer-actions"><div className="flex gap-1 items-center"><button type="button" className="study-button quiet" disabled={busy||preparing} onClick={()=>file.current?.click()}><Paperclip size={18}/><span>Фото</span></button><input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={attach}/><VoiceMicButton disabled={busy||preparing} onTranscript={spoken=>onText(text?`${text} ${spoken}`:spoken)}/></div><div className="flex gap-3 items-center"><span className="simple-grade">{grade} класс</span><button type="submit" className="simple-send" disabled={busy||preparing||(!text.trim()&&!photos.length)} aria-label="Отправить сообщение"><ArrowUp size={21}/></button></div></div>
      <div className="simple-composer-settings"><Controls {...controls} busy={busy||preparing} tutorOnly={tutorOnly}/></div>
      {photos.length>0&&<details className="simple-photo-info"><summary>Как будет прочитано фото</summary><p>Выбранное подключение принимает до {maxImages} фото напрямую. Если фото больше или модель текстовая, режим «Авто» использует отдельное распознавание. Изображения передаются выбранным сервисам; не прикрепляй личные данные.</p><label>Способ чтения<select className="study-select" value={photoMode} disabled={busy||preparing} onChange={e=>onPhotoMode(e.target.value)}><option value="auto">Авто</option><option value="vision">Само фото (Vision)</option><option value="ocr">Распознанный текст (OCR)</option></select></label></details>}
    </form>
    {(preparing||error||fileError)&&<p role={error||fileError?'alert':'status'} className="simple-error">{error||fileError||'Подготавливаем фото…'}</p>}
    {!text&&!photos.length&&!busy&&<div className="simple-suggestions">{[[Lightbulb,'Объясни тему','Объясни простыми словами, как складывать дроби с разными знаменателями.'],[PenLine,'Разбери задание','Помоги разобраться с заданием: '],[Search,'Найди источники','Найди надёжные источники о Солнечной системе.']].filter((_,i)=>!tutorOnly||i!==2).map(([Icon,title,prompt])=><button key={title} type="button" onClick={()=>{onText(prompt);textareaRef.current?.focus();}}><Icon size={17}/>{title}</button>)}</div>}
    <p className="simple-disclaimer">{tutorOnly?'Подсказки вместо готовых ответов.':'Интернет в режиме «авто»: приложение ищет по локальным правилам до ответа модели.'} Бесплатные подключения имеют лимиты.</p>
  </div>;
}

export function SimpleConversation({result,task,photos,followups,chatInput,onChatInput,onSend,chatLoading,status,onCancel,copy,copied,speak,speaking,error,tutorOnly,...controls}) {
  return <section className="simple-conversation" aria-label="Диалог с помощником">
    <div className="simple-user-message"><p>{task||'Задание на фото'}</p>{photos.length>0&&<div className="simple-photo-list">{photos.map((src,i)=><img key={i} src={src} alt={`Задание на фото ${i+1}`}/>)}</div>}</div>
    <article className="simple-answer"><div className="simple-answer-name"><GraduationCap size={18}/>Домашка.ПРО</div><MarkdownMath content={result.markdown}/></article>
    {followups.map((message,i)=><article key={i} className={message.role==='user'?'simple-user-message':'simple-answer'}>{message.role==='user'?<p>{message.content}</p>:<MarkdownMath content={message.content}/>}</article>)}
    {chatLoading?<WorkflowPanel status={status} busy onCancel={onCancel}/>:result.workflow&&<WorkflowPanel workflow={result.workflow}/>}
    <div className="simple-answer-actions"><button type="button" className="study-icon-button" title={copied?'Скопировано':'Копировать диалог'} aria-label={copied?'Скопировано':'Копировать диалог'} onClick={copy}>{copied?<Check size={16}/>:<Copy size={16}/>}</button><button type="button" className="study-icon-button" aria-label={speaking?'Остановить озвучивание':'Озвучить ответ'} onClick={speak}><Volume2 size={16}/></button><span>{result.providerUsed}</span></div>
    {error&&<p role="alert" className="simple-error">{error}</p>}
    <form className="simple-composer followup-composer" onSubmit={e=>{e.preventDefault();if(chatInput.trim())onSend();}}>
      <label className="sr-only" htmlFor="simple-followup">Продолжить диалог</label><textarea id="simple-followup" rows={2} value={chatInput} onChange={e=>onChatInput(e.target.value)} disabled={chatLoading} placeholder={tutorOnly?'Твоя попытка или вопрос репетитору…':'Спроси ещё или попроси объяснить проще…'} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing){e.preventDefault();if(chatInput.trim())onSend();}}}/>
      <div className="simple-composer-actions"><div className="min-w-0 space-y-2"><VoiceMicButton disabled={chatLoading} onTranscript={spoken=>onChatInput(chatInput?`${chatInput} ${spoken}`:spoken)}/><Controls {...controls} busy={chatLoading} tutorOnly={tutorOnly}/></div><button type="submit" className="simple-send" disabled={chatLoading||!chatInput.trim()} aria-label="Отправить уточнение"><ArrowUp size={20}/></button></div>
    </form>
  </section>;
}
