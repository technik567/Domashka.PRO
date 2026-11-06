import React, { useEffect, useRef, useState } from 'react';
import { Cloud, Download, RefreshCw, ShieldCheck, LogIn } from 'lucide-react';
import { initializeCloud } from '../cloud/runtime';
import { getCloudClient, getCloudConfig, loginEmail, cloudError } from '../cloud/client';
import { APP_VERSION } from '../version';

const field = 'mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-base outline-none focus:ring-2 focus:ring-indigo-500';
const button = 'inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-bold disabled:opacity-50';
export function downloadCloudJson(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
let captchaScript;
function loadCaptcha() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!captchaScript) captchaScript = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true; script.onload = () => resolve(window.turnstile); script.onerror = () => reject(new Error('Антиспам недоступен. Проверьте сеть и обновите страницу.')); document.head.appendChild(script);
  });
  return captchaScript;
}
export function CloudCaptcha({ onToken, reset = 0 }) {
  const element = useRef(null); const callback = useRef(onToken); callback.current = onToken;
  const [error, setError] = useState(''); let siteKey = '';
  try { siteKey = getCloudConfig().captchaSiteKey; } catch { /* local mode / config error rendered by root */ }
  useEffect(() => {
    if (!siteKey) return;
    let stopped = false; let widget;
    callback.current(''); setError('');
    loadCaptcha().then((api) => {
      if (stopped) return;
      widget = api.render(element.current, { sitekey: siteKey, size: 'flexible', callback: (token) => callback.current(token),
        'expired-callback': () => callback.current(''), 'error-callback': () => { callback.current(''); setError('Проверка не пройдена. Обновите страницу и попробуйте снова.'); } });
    }).catch((err) => { if (!stopped) setError(err.message); });
    return () => { stopped = true; if (widget !== undefined) window.turnstile?.remove(widget); };
  }, [siteKey, reset]);
  return siteKey ? <div className="space-y-2"><div ref={element} />{error && <p role="alert" className="text-xs text-rose-600">{error}</p>}</div> : null;
}

function CloudLogin({ recovery = false, initialError = '' }) {
  const [mode, setMode] = useState(recovery ? 'recovery' : 'login');
  const [login, setLogin] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [name, setName] = useState(''); const [avatar, setAvatar] = useState('🦉');
  const [root, setRoot] = useState(() => 4 + crypto.getRandomValues(new Uint8Array(1))[0] % 12); const [answer, setAnswer] = useState('');
  const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(initialError); const [notice, setNotice] = useState('');
  const [captcha, setCaptcha] = useState(''); const [reset, setReset] = useState(0);
  let cfg; try { cfg = getCloudConfig(); } catch (err) { return <p role="alert" className="p-6 text-rose-700">{err.message}</p>; }
  const choose = (next) => { setMode(next); setError(''); setNotice(''); setPassword(''); setConfirm(''); setCaptcha(''); setReset((n) => n + 1); };
  async function submit(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice('');
    const client = getCloudClient();
    try {
      if (['register','recovery'].includes(mode) && (password !== confirm || password.trim().length < 8 || password.length > 128)) throw new Error('Пароли должны совпадать; длина — 8–128 символов.');
      if (cfg.captchaSiteKey && mode !== 'recovery' && !captcha) throw new Error('Пройдите проверку антиспама.');
      if (mode === 'login') {
        const result = await client.auth.signInWithPassword({ email: loginEmail(login), password, options: { captchaToken: captcha || undefined } });
        if (result.error) throw result.error; setPassword(''); location.reload();
      } else if (mode === 'register') {
        const email = loginEmail(login); if (!login.includes('@')) throw new Error('Для родителя нужна настоящая почта. Ребёнка добавляют после входа родителя.');
        if (String(answer).trim() !== String(root)) throw new Error('Проверьте ответ на вопрос для родителя. Это не доказательство возраста.');
        if (!consent || !name.trim()) throw new Error('Укажите имя и подтвердите облачный способ хранения.');
        const result = await client.auth.signUp({ email, password, options: { emailRedirectTo: cfg.siteUrl, captchaToken: captcha || undefined,
          data: { name: name.trim(), avatar, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } } });
        if (result.error) throw result.error;
        if (result.data.session) { await client.auth.signOut({ scope: 'local' }); throw new Error('Владелец должен включить подтверждение почты перед публичной регистрацией.'); }
        setPassword(''); setConfirm('');
        setNotice('Проверьте почту и папку «Спам»: для нового аккаунта нужно подтверждение. Если почта уже зарегистрирована, войдите или восстановите пароль. Не пришло письмо — владелец должен проверить SMTP и лимиты отправки.');
      } else if (mode === 'reset') {
        if (!login.includes('@')) throw new Error('Пароль ребёнка меняет родитель в семейном кабинете. Здесь нужна почта родителя.');
        const result = await client.auth.resetPasswordForEmail(loginEmail(login), { redirectTo: cfg.siteUrl, captchaToken: captcha || undefined });
        if (result.error) throw result.error;
        setNotice('Если для этой почты доступно восстановление, придёт письмо. Проверьте «Спам». Если писем нет, обратитесь к владельцу сайта: требуется рабочая SMTP-отправка.');
      } else {
        const result = await client.auth.updateUser({ password }); if (result.error) throw result.error;
        await client.auth.signOut({ scope: 'local' }); setPassword(''); setConfirm(''); choose('login'); setNotice('Пароль изменён, старые сеансы приложения закрыты. Войдите с новым паролем.');
      }
    } catch (err) { setError(cloudError(err).message); }
    finally { setBusy(false); setCaptcha(''); setReset((n) => n + 1); }
  }
  return <main className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex justify-center items-center p-4">
    <section className="max-w-lg w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl space-y-5">
      <header className="flex gap-3 items-center"><Cloud className="w-9 h-9 text-indigo-600 shrink-0" /><div><h1 className="text-xl font-black">Домашка.ПРО {APP_VERSION}</h1><p className="text-xs text-slate-500">Облачный кабинет · один аккаунт на компьютере и телефоне</p></div></header>
      {mode !== 'recovery' && <div className="flex flex-wrap gap-2 text-xs font-bold">{[['login','Войти'],['register','Я родитель: регистрация'],['reset','Забыли пароль?']].map(([id,label]) => <button key={id} type="button" disabled={busy} onClick={() => choose(id)} className={`rounded-xl px-3 py-2 ${mode === id ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200' : 'bg-slate-100 dark:bg-slate-800'}`}>{label}</button>)}</div>}
      <form onSubmit={submit} className="space-y-4" aria-label="Облачный вход">
        {mode !== 'recovery' && <label className="block text-sm font-semibold">{mode === 'login' ? 'Почта родителя или полный логин ребёнка' : 'Почта родителя'}
          <input className={field} type={mode === 'login' ? 'text' : 'email'} value={login} onChange={(e) => setLogin(e.target.value)} required maxLength={254} autoCapitalize="none" autoCorrect="off" autoComplete={mode === 'login' ? 'username' : 'email'} />
        </label>}
        {mode === 'register' && <>
          <label className="block text-sm font-semibold">Имя родителя<input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="name" /></label>
          <label className="block text-sm font-semibold">Аватар<select className={field} value={avatar} onChange={(e) => setAvatar(e.target.value)}>{['🦉','🦊','🐱','🐼','🚀','🌟','🎨','🧑‍🏫'].map((icon) => <option key={icon}>{icon}</option>)}</select></label>
        </>}
        {mode !== 'reset' && <label className="block text-sm font-semibold">{mode === 'login' ? 'Пароль' : 'Новый пароль'}<input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>}
        {['register','recovery'].includes(mode) && <label className="block text-sm font-semibold">Повторите пароль<input className={field} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" /></label>}
        {mode === 'register' && <>
          <div className="rounded-xl p-3 bg-amber-50 dark:bg-amber-950/30 text-sm space-y-2"><label className="block font-bold">Вопрос для родителя: √{root * root} = ?<input className={field} value={answer} onChange={(e) => setAnswer(e.target.value)} inputMode="numeric" required aria-label="Ответ на вопрос для родителя" /></label>
            <button type="button" onClick={() => { setRoot(4 + crypto.getRandomValues(new Uint8Array(1))[0] % 12); setAnswer(''); }} className="text-xs underline">Другой вопрос</button>
            <p className="text-xs">Это формальный шаг, не проверка возраста. Не передавайте ребёнку пароль родителя.</p></div>
          <label className="flex gap-2 text-xs leading-relaxed"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required className="mt-0.5" /><span>Я создаю свой родительский аккаунт и понимаю: сохранённые учебные данные и фото передаются в облачный проект владельца сайта. Детей добавлю сам(а). Не буду загружать чужие персональные данные.</span></label>
        </>}
        {mode !== 'recovery' && <CloudCaptcha onToken={setCaptcha} reset={reset} />}
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
        <button className={`${button} w-full`} disabled={busy}><LogIn className="w-4 h-4" />{busy ? 'Выполняем…' : mode === 'login' ? 'Войти' : mode === 'register' ? 'Зарегистрироваться' : mode === 'reset' ? 'Отправить письмо' : 'Сохранить новый пароль'}</button>
      </form>
      <p className="text-xs leading-relaxed text-slate-500">У ребёнка нет обязательной почты: родитель создаёт ему полный логин и пароль. Математический вопрос не заменяет защиту аккаунта.</p>
      <details className="text-xs leading-relaxed text-slate-500"><summary className="cursor-pointer font-bold">Что хранится в облаке</summary><p className="mt-2">Профили, учебная статистика, тетрадь и отправленные фото, дневник, расписание, закладки, ошибки и семейные задания. Ключи ИИ, локальные пароли и неотправленные черновики не синхронизируются. Бесплатное облако имеет лимиты и может быть приостановлено владельцем или провайдером. Это не школьный электронный дневник.</p></details>
      <a href="./Domashka_PRO.html" download className="inline-flex gap-1 items-center text-xs font-bold text-indigo-600 dark:text-indigo-300"><Download className="w-3.5 h-3.5" />Скачать отдельную автономную версию без синхронизации</a>
    </section>
  </main>;
}

export function CloudStatus({ runtime }) {
  const [, render] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => runtime.subscribe(() => render((n) => n + 1)), [runtime]);
  const state = runtime.status();
  const problem = state.error || state.cacheError || error;
  const message = state.reloadRequired ? 'Версия выбрана. Обновите экран перед дальнейшей работой.'
    : state.conflicts?.length ? `Конфликтов: ${state.conflicts.length}. Обе версии сохранены — выберите нужную.`
    : problem ? problem : state.pending ? `Не отправлено в облако: ${state.pending}. ${state.cachePending ? 'Сохраняем очередь на устройстве…' : 'Очередь сохранена на устройстве.'}`
    : state.cachePending ? 'Обновляем кэш устройства…' : state.incoming ? 'В облаке есть новая версия. Загрузите её перед редактированием.'
    : 'Сохранено в облаке';
  async function run(action) { setBusy(true); setError(''); try { await action(); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <aside className={`no-print px-3 sm:px-5 py-2 border-b text-xs space-y-2 ${problem || state.conflicts?.length || state.pending ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-900' : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 border-indigo-100 dark:border-indigo-900'}`} aria-label="Синхронизация аккаунта">
    <div className="flex flex-wrap gap-x-4 gap-y-2 items-center justify-between"><p role="status" className="inline-flex items-center gap-2"><Cloud className="w-4 h-4 shrink-0" />{message}</p>
      <div className="flex flex-wrap gap-3 font-bold">
        <button type="button" disabled={busy || state.saving || state.reloadRequired} onClick={() => run(() => runtime.refresh())} className="underline disabled:opacity-50">{state.saving ? 'Сохраняем…' : 'Синхронизировать'}</button>
        {(state.incoming > 0 || state.reloadRequired) && <button type="button" disabled={busy || state.reloadRequired && (state.cachePending || Boolean(state.cacheError))} className="underline disabled:opacity-50" onClick={() => {
          if (!window.confirm('Загрузить сохранённые изменения и обновить экран? Неотправленные фото и незавершённые формы нужно предварительно сохранить отдельно.')) return;
          if (state.reloadRequired) location.reload(); else run(() => runtime.reloadFromCloud());
        }}>Обновить экран</button>}
        {(problem || state.pending > 0 || state.conflicts?.length > 0) && <button type="button" className="underline" onClick={() => downloadCloudJson(runtime.backup(), 'Domashka_cloud_recovery.json')}>Скачать резервную копию изменений</button>}
      </div>
    </div>
    {state.conflicts?.map((key) => <div key={key} className="rounded-xl border border-amber-300 dark:border-amber-800 p-3 space-y-2">
      <p className="font-bold break-all">{key.startsWith('chat/') ? 'Чат тетради' : 'Раздел настроек'}: {key}</p>
      <p>Другая версия уже на сервере. Перед выбором можно скачать обе версии. Это не автоматическое объединение ответов.</p>
      <details><summary className="cursor-pointer underline">Посмотреть различия</summary><div className="grid sm:grid-cols-2 gap-2 mt-2">
        <div><b>На этом устройстве</b><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all bg-white/60 dark:bg-slate-900/60 p-2 rounded text-[10px]">{JSON.stringify(runtime.sync.pending[key]?.value, null, 2).slice(0,5000)}</pre></div>
        <div><b>В облаке</b><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all bg-white/60 dark:bg-slate-900/60 p-2 rounded text-[10px]">{JSON.stringify(runtime.sync.conflicts[key]?.value, null, 2).slice(0,5000)}</pre></div>
      </div></details>
      <div className="flex flex-wrap gap-3 underline font-bold"><button type="button" disabled={busy} onClick={() => {
        if (window.confirm('Заменить облачную версию этой записью с устройства? Сначала скачайте обе версии, если нужны обе.')) run(() => runtime.resolveConflict(key,'local'));
      }}>Оставить версию устройства</button><button type="button" disabled={busy} onClick={() => {
        if (window.confirm('Отбросить локальное изменение этого раздела и выбрать облачное? Сначала можно скачать обе версии.')) run(() => runtime.resolveConflict(key,'remote'));
      }}>Выбрать облачную версию</button></div>
    </div>)}
    {state.cacheError && <button type="button" disabled={busy} className="underline font-bold" onClick={() => run(() => runtime.sync.durable())}>Повторить запись кэша</button>}
    <p className="text-[10px] opacity-80">Статус относится к сохранённым записям, не к неотправленным формам и фото.</p>
    {state.cacheError && <p className="font-bold">Копия на устройстве не подтверждена. Не закрывайте страницу до отправки или скачивания резервной копии.</p>}
  </aside>;
}
function ReadyCloud({ runtime, children }) {
  const [gate, setGate] = useState(() => runtime.getAccountGate()); const [, redraw] = useState(0);
  const frozen = !gate.account;
  useEffect(() => {
    if (!frozen) return;
    const update = () => redraw((n) => n + 1);
    const unsubscribe = runtime.subscribe(update);
    update(); // A cache write can settle between render and this passive effect.
    return unsubscribe;
  }, [runtime, frozen]);
  useEffect(() => runtime.subscribeAccounts(() => setGate(runtime.getAccountGate())), [runtime]);
  return <><CloudStatus runtime={runtime} />{gate.account ? children : <main className="p-6 max-w-xl mx-auto space-y-4">
    <ShieldCheck className="w-9 h-9 text-indigo-600" /><h1 className="text-xl font-bold">Рабочее пространство приостановлено</h1>
    <p role="alert" className="text-sm">{gate.error || 'Аккаунт меняется. Дождитесь обновления страницы.'}</p>
    <p className="text-xs text-slate-500">Несохранённая очередь остаётся привязанной к прежнему аккаунту. Не очищайте данные сайта; сначала скачайте копию выше.</p>
    <button className={button} disabled={Boolean(runtime.status().cacheError || runtime.status().cachePending)} onClick={() => location.reload()}>Обновить страницу</button>
  </main>}</>;
}
export default function CloudRoot({ children }) {
  const [state, setState] = useState({ mode: 'loading' });
  useEffect(() => { let active = true;
    initializeCloud().then((next) => { if (active) setState(next); }).catch((err) => { if (active) setState({ mode: 'error', error: err.message }); });
    return () => { active = false; };
  }, []);
  if (state.mode === 'ready') return <ReadyCloud runtime={state.runtime}>{children}</ReadyCloud>;
  if (state.mode === 'login' || state.mode === 'recovery') return <CloudLogin recovery={state.mode === 'recovery'} />;
  return <main className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center p-5"><section className="max-w-lg bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-xl space-y-4">
    <Cloud className="w-10 h-10 text-indigo-600" /><h1 className="font-extrabold text-xl">{state.mode === 'loading' ? 'Открываем облачный кабинет…' : 'Облако пока недоступно'}</h1>
    <p role={state.mode === 'error' ? 'alert' : 'status'} className="text-sm">{state.error || 'Проверяем вход и загружаем данные. До завершения загрузки учебные данные не изменяются.'}</p>
    {state.mode === 'error' && <><button className={button} onClick={() => location.reload()}><RefreshCw className="w-4 h-4" />Повторить</button>
      <button className="text-sm underline ml-3" onClick={async () => { try { await getCloudClient().auth.signOut({ scope: 'local' }); location.reload(); } catch { /* configuration error remains visible */ } }}>Войти заново</button>
      <p className="text-xs text-slate-500">Этот выход не удаляет кэш прежнего аккаунта. После входа в тот же аккаунт очередь будет восстановлена. Локальная версия не выдаётся за синхронизированную.</p></>}
  </section></main>;
}
