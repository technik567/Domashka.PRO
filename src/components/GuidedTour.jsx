import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Sparkles, X } from 'lucide-react';
import { workspaceKey } from '../standalone/accounts';

export function onboardingKey(auth = false) {
  if (!auth) return workspaceKey('domashka_onboarding_v1');
  return `domashka_onboarding_auth_v1_${String(window.__DOMASHKA_CLOUD__?.url || 'site')}`;
}
const seen = (key) => { try { return localStorage.getItem(key) === 'done' || localStorage.getItem(key) === 'skipped'; } catch { return false; } };
const remember = (key, value) => { try { localStorage.setItem(key,value); } catch { /* optional preference, no personal data */ } };
export function tourSteps({ auth = false, role = 'guest', cloudMode = false, tutorOnly = false, allowAi = true } = {}) {
  if (auth) return [
    { title: 'Один адрес на всех устройствах', target: '[data-tour="cloud-intro"]', text: 'На телефоне и компьютере открывайте именно этот HTTPS-сайт. Скачанный HTML — отдельное локальное приложение, а не копия облачного аккаунта.' },
    { title: 'Родитель регистрируется первым', target: '[data-tour="cloud-auth-actions"]', text: 'Выберите регистрацию родителя по логину и паролю, без почты. Сохраните все 10 одноразовых резервных кодов. Уже есть аккаунт — «Войти». «Забыли пароль?» использует один код. Если регистрация закрыта, антиспам должен настроить владелец сайта.' },
    { title: 'У ребёнка — свой полный логин', target: '[data-tour="cloud-auth-form"]', text: 'После входа родитель создаст ученика в «Семья». Ребёнок вводит полученный полный логин с частью после точки и пароль; личная почта ему не нужна. Обучение не заполняет и не отправляет форму за вас.' },
  ];
  return [
    { title: cloudMode ? 'Ваш облачный кабинет' : 'Ваше локальное пространство', target: '[data-tour="account-bar"]', text: cloudMode ? 'Вы вошли в облако. Следите за состоянием сохранения: другой компьютер увидит только подтверждённые сервером изменения. Открытый редактор не заменяется молча.' : 'Этот HTML/браузер хранит данные локально. Такой логин не появится на другом устройстве автоматически. Перед обновлением сохраняйте учебную резервную копию.' },
    { title: 'Семейный кабинет', route: 'family', target: '[data-tour="workspace"]', text: role === 'parent' ? 'Здесь добавляют ученика, выбирают класс и возраст, задают ограничения и проверяют семейные работы. Создавайте реальные аккаунты сами — обучение ничего не отправляет.' : role === 'child' ? 'Здесь ваш профиль и задания от связанных родителей. Класс, пароль и ограничения меняет родитель.' : 'Здесь можно создать локальную семью. Для общего аккаунта на телефоне и ПК нужен отдельно настроенный облачный сайт.' },
    ...(allowAi ? [
      { title: tutorOnly ? 'Начните с попытки' : 'Введите учебное задание', route: 'solver', target: '[data-tour="task-input"]', text: 'Напишите условие, используйте диктовку или добавьте фото. Проверьте текст перед отправкой. На этом шаге обучение не отправляет ваш запрос ИИ.' },
      { title: 'Модель и режимы ответа', route: 'solver', target: '[data-tour="ai-tools"]', text: `Рядом с моделью — «Рассуждение» с тремя уровнями и «Поиск» с отдельной фразой. Читайте подпись: не каждый канал поддерживает внутренний thinking. ${tutorOnly ? 'В детском режиме поиск отключён, модель выбирает родитель.' : 'Полный поиск требует настроенного облачного сервиса. Можно попросить таблицу или график.'}` },
    ] : [{ title: 'Материалы без сетевого ИИ', route: 'cheats', target: '[data-tour="workspace"]', text: 'Родитель отключил ИИ. Справочные материалы, дневник и семейные задания остаются доступны; обучение и локальная помощь не обходят запрет.' }]),
    { title: 'Дневник и расписание', route: 'diary', target: '[data-tour="workspace"]', text: 'Здесь дела, оценки и расписание до девяти уроков. Это ваш органайзер, а не автоматически подключённый школьный журнал.' },
    { title: 'Помощь всегда рядом', target: '[data-tour="help-trigger"]', text: 'Кнопка «Помощь по сайту» открывает справку и отдельный ИИ-чат. Туда не передаются ваша тетрадь, фото и список семьи. Никогда не пишите пароли и ключи. Здесь же можно повторить обучение.' },
  ];
}
function visibleTarget(selector) {
  return Array.from(document.querySelectorAll(selector)).find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || null;
}
export default function GuidedTour({ auth = false, role, cloudMode, tutorOnly, allowAi = true, replay = 0, onNavigate }) {
  const key = onboardingKey(auth);
  const [welcome, setWelcome] = useState(() => !seen(key));
  const [index, setIndex] = useState(null);
  const [rect, setRect] = useState(null);
  const card = useRef(null), highlighted = useRef(null), restoreFocus = useRef(null), navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  const steps = tourSteps({ auth, role, cloudMode, tutorOnly, allowAi });
  const step = index === null ? null : steps[Math.min(index, steps.length-1)];
  const active = welcome || Boolean(step);
  const finish = (completed) => { remember(key, completed ? 'done' : 'skipped'); setWelcome(false); setIndex(null); setRect(null); };
  useEffect(() => { if (replay) { setWelcome(true); setIndex(null); } }, [replay]);
  useEffect(() => {
    if (step?.route) navigate.current?.(step.route);
  }, [index, step?.route]);
  useLayoutEffect(() => {
    if (!step) { setRect(null); return; }
    let stopped = false, frame;
    const clicked = () => { if (step.target === '[data-tour="help-trigger"]') finish(true); };
    const measure = () => {
      if (stopped) return;
      const el = visibleTarget(step.target);
      if (highlighted.current !== el) {
        highlighted.current?.removeEventListener('click',clicked);
        highlighted.current?.removeAttribute('data-onboarding-highlight');
        highlighted.current = el;
        if (el) { el.addEventListener('click',clicked); el.setAttribute('data-onboarding-highlight','true'); el.scrollIntoView({ block:'center', behavior:'instant' }); }
      }
      const r = el?.getBoundingClientRect();
      setRect(r ? { left: Math.max(0,r.left-5), top: Math.max(0,r.top-5), right: Math.min(innerWidth,r.right+5), bottom: Math.min(innerHeight,r.bottom+5) } : null);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    schedule();
    window.addEventListener('resize',schedule); window.addEventListener('scroll',schedule,true);
    const observer = new MutationObserver(schedule); observer.observe(document.body,{ childList:true,subtree:true });
    return () => { stopped = true; cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize',schedule); window.removeEventListener('scroll',schedule,true); highlighted.current?.removeEventListener('click',clicked); highlighted.current?.removeAttribute('data-onboarding-highlight'); highlighted.current = null; };
  }, [step?.target, index]);
  useEffect(() => {
    if (!active) return;
    restoreFocus.current = document.activeElement;
    card.current?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      if (event.key === 'Tab') {
        const buttons = Array.from(card.current?.querySelectorAll('button:not(:disabled),a[href]') || []);
        if (highlighted.current?.matches('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')) buttons.unshift(highlighted.current);
        if (!buttons.length) return;
        const pos = buttons.indexOf(document.activeElement);
        if (event.shiftKey && pos <= 0) { event.preventDefault(); buttons.at(-1).focus(); }
        else if (!event.shiftKey && (pos === -1 || pos === buttons.length-1)) { event.preventDefault(); buttons[0].focus(); }
      }
    };
    document.addEventListener('keydown',keydown);
    return () => { document.removeEventListener('keydown',keydown); if (restoreFocus.current?.isConnected) restoreFocus.current.focus(); };
  }, [active, key]);
  if (!active) return null;
  const vw = typeof innerWidth === 'number' ? innerWidth : 360, vh = typeof innerHeight === 'number' ? innerHeight : 700;
  const cw = Math.min(370,vw-24);
  const top = welcome ? undefined : rect && rect.bottom + 285 < vh ? rect.bottom + 12 : rect && rect.top > 290 ? rect.top - 285 : Math.max(12, vh - 285);
  const left = welcome ? undefined : Math.max(12,Math.min(vw-cw-12,rect?.left || (vw-cw)/2));
  return createPortal(<div className="no-print" data-tour-layer="true">
    {welcome || !rect ? <div className="fixed inset-0 bg-slate-950/65 z-[100]" /> : <>
      <div className="tour-shade" style={{ left:0,top:0,right:0,height:rect.top }} />
      <div className="tour-shade" style={{ left:0,top:rect.bottom,right:0,bottom:0 }} />
      <div className="tour-shade" style={{ left:0,top:rect.top,width:rect.left,height:Math.max(0,rect.bottom-rect.top) }} />
      <div className="tour-shade" style={{ left:rect.right,right:0,top:rect.top,height:Math.max(0,rect.bottom-rect.top) }} />
      <div className="tour-highlight" style={{ left:rect.left,top:rect.top,width:Math.max(0,rect.right-rect.left),height:Math.max(0,rect.bottom-rect.top) }} />
    </>}
    <section ref={card} tabIndex={-1} role="dialog" aria-modal={welcome ? 'true' : 'false'} aria-label={welcome ? 'Знакомство с Домашка.ПРО' : 'Интерактивное обучение'}
      className={`fixed z-[110] rounded-3xl border border-indigo-200 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-5 shadow-2xl outline-none ${welcome ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2' : ''}`}
      style={{ width:cw, ...(welcome ? {} : { left,top }), maxHeight:'calc(100dvh - 24px)',overflowY:'auto' }}>
      <div className="flex justify-between items-center gap-3"><span className="text-[11px] uppercase font-black tracking-wider text-indigo-600 dark:text-indigo-300">{welcome ? 'Быстрый старт' : `Шаг ${Math.min(index+1,steps.length)} из ${steps.length}`}</span><button type="button" onClick={() => finish(false)} aria-label="Закрыть обучение" className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button></div>
      <h2 className="font-black text-lg mt-2 flex gap-2 items-center"><Sparkles size={21} className="text-indigo-600 shrink-0" />{welcome ? 'Давайте освоимся' : step.title}</h2>
      <p aria-live="polite" className="text-sm leading-relaxed mt-3 text-slate-600 dark:text-slate-300">{welcome ? `Короткое обучение подсветит настоящие кнопки. Его можно пропустить и повторить из помощи. ${auth ? 'Формы не заполняются и не отправляются автоматически.' : 'Обучение переключает разделы: перед повторным запуском сохраните незавершённые формы и фото.'}` : step.text}</p>
      {!welcome && !rect && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Элемент сейчас скрыт или ещё загружается. Можно продолжить — недоступные действия не выполняются.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
        {welcome ? <><button type="button" onClick={() => finish(false)} className="text-sm font-bold px-3 py-2">Позже</button><button type="button" onClick={() => { setWelcome(false); setIndex(0); }} className="tour-next">Начать обучение<ArrowRight size={16} /></button></>
          : <><button type="button" disabled={!index} onClick={() => setIndex((n) => Math.max(0,n-1))} className="text-sm font-bold px-2 py-2 disabled:opacity-30 inline-flex gap-1 items-center"><ArrowLeft size={16} />Назад</button><button type="button" onClick={() => index >= steps.length-1 ? finish(true) : setIndex((n) => n+1)} className="tour-next">{index >= steps.length-1 ? 'Готово' : 'Далее'}<ArrowRight size={16} /></button></>}
      </div>
    </section>
  </div>, document.body);
}
