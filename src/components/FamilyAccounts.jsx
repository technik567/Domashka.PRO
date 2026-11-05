import React, { useEffect, useState } from 'react';
import { Users, LogOut, ShieldCheck, UserPlus, LockKeyhole, ArrowRight, GraduationCap } from 'lucide-react';
import { AVATARS, getAccountGate, getCurrentAccount, subscribeAccounts, createAccount, loginAccount, logoutAccount,
  issueParentChallenge, needsLegacyPassword, getChildren, updateChild, updateAppearance, changeAccountPassword,
  resetChildPassword, createLinkCode, linkChild, revokeChildLink, getChildStudySummary, isLegacyOwner } from '../standalone/accounts';
import { copyLegacyWorkspace } from '../standalone/legacyMigration';
import { preparePhotoFile } from '../standalone/visionEngine';
import { SUBJECTS } from '../data/referenceData';
import { APP_VERSION } from '../version';
import FamilyHomeworkBoard from './FamilyHomeworkBoard';

const field = 'mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500';
const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed';
const card = 'rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-5';
export function reloadAccountPage() { window.speechSynthesis?.cancel(); window.location.reload(); }
export function Avatar({ value, size = 'w-10 h-10' }) {
  return <span className={`${size} inline-flex shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950 text-xl overflow-hidden`}>
    {value?.startsWith('data:image/') ? <img src={value} alt="Аватар" className="w-full h-full object-cover" /> : value || '👤'}
  </span>;
}
function useAccounts() {
  const [gate, setGate] = useState(getAccountGate);
  useEffect(() => {
    const update = () => setGate(getAccountGate()); const stop = subscribeAccounts(update);
    const timer = setInterval(update, 15000); window.addEventListener('focus', update);
    return () => { stop(); clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);
  return gate;
}
function AvatarPicker({ value, onChange }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <fieldset className="space-y-2">
    <legend className="text-xs font-semibold mb-2">Аватар</legend>
    <div className="flex gap-2 flex-wrap items-center">
      {AVATARS.map((emoji) => <button type="button" key={emoji} onClick={() => onChange(emoji)} aria-label={`Аватар ${emoji}`} aria-pressed={value === emoji} className={`p-1 rounded-xl border-2 ${value === emoji ? 'border-indigo-500' : 'border-transparent'}`}><Avatar value={emoji} size="w-8 h-8" /></button>)}
      <label className="text-xs font-bold text-indigo-600 dark:text-indigo-300 underline cursor-pointer">{busy ? 'Подготовка…' : 'Своя картинка'}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="sr-only" disabled={busy} aria-label="Загрузить свой аватар" onChange={async (event) => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          setBusy(true); setError('');
          try { onChange(await preparePhotoFile(file, { maxDim: 128, jpegQuality: 0.8 })); }
          catch (err) { setError(err.message); } finally { setBusy(false); }
        }} />
      </label>
      {value?.startsWith('data:') && <Avatar value={value} />}
    </div>
    {error && <p className="text-xs text-rose-600" role="alert">{error}</p>}
  </fieldset>;
}
function GradeAge({ grade, age, onGrade, onAge }) {
  return <div className="grid grid-cols-2 gap-3">
    <label className="text-xs font-semibold">Класс ученика<select className={field} value={grade} onChange={(e) => onGrade(Number(e.target.value))}>{Array.from({ length: 11 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} класс</option>)}</select></label>
    <label className="text-xs font-semibold">Возраст ученика<input type="number" min="5" max="21" required className={field} value={age} onChange={(e) => onAge(e.target.value)} /></label>
  </div>;
}

function Registration({ first = false, onCreated }) {
  const [role, setRole] = useState(first ? 'parent' : 'child');
  const [name, setName] = useState(''); const [login, setLogin] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]); const [grade, setGrade] = useState(1); const [age, setAge] = useState(7);
  const [legacyPassword, setLegacyPassword] = useState(''); const [parentPassword, setParentPassword] = useState('');
  const [challenge, setChallenge] = useState(() => globalThis.crypto?.getRandomValues ? issueParentChallenge() : null); const [answer, setAnswer] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError(''); setNotice('');
    if (password !== confirm) { setError('Пароли не совпадают.'); return; }
    setBusy(true);
    try {
      const account = await createAccount({ role, name, login, password, avatar, grade, age, legacyPassword, parentPassword, challengeId: challenge?.id, challengeAnswer: answer });
      setPassword(''); setConfirm(''); setParentPassword(''); setLegacyPassword('');
      if (first) { reloadAccountPage(); return; }
      setNotice(`Аккаунт «${account.login}» создан${role === 'child' ? ' и привязан к вам' : ''}. Для входа используйте его логин и пароль.`);
      setName(''); setLogin(''); setAnswer(''); setChallenge(issueParentChallenge()); onCreated?.(account);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4" aria-label={first ? 'Создать семейные аккаунты' : 'Добавить аккаунт'}>
    <div><h2 className="text-xl font-extrabold">{first ? 'Сначала — аккаунт родителя' : 'Добавить пользователя'}</h2><p className="text-xs text-slate-500 mt-1">Логин и пароль действуют только в этом браузере / HTML Viewer.</p></div>
    {!first && <label className="block text-xs font-semibold">Тип аккаунта<select className={field} value={role} onChange={(e) => { setRole(e.target.value); setAnswer(''); setChallenge(issueParentChallenge()); }}><option value="child">Ребёнок</option><option value="parent">Ещё один родитель</option></select></label>}
    <div className="grid sm:grid-cols-2 gap-3">
      <label className="text-xs font-semibold">Имя<input className={field} value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="name" /></label>
      <label className="text-xs font-semibold">Логин<input className={field} value={login} onChange={(e) => setLogin(e.target.value)} required minLength={3} maxLength={32} autoCapitalize="none" autoCorrect="off" autoComplete="username" placeholder="Например: anna_9" /></label>
      <label className="text-xs font-semibold">Новый пароль<input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" /></label>
      <label className="text-xs font-semibold">Повторите пароль<input className={field} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" /></label>
    </div>
    <AvatarPicker value={avatar} onChange={setAvatar} />
    {role === 'child' ? <GradeAge grade={grade} age={age} onGrade={setGrade} onAge={setAge} /> : <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
      <label className="block text-sm font-bold">Вопрос для родителя: √{challenge?.square || '…'} = ?<input type="text" inputMode="numeric" className={field} value={answer} onChange={(e) => setAnswer(e.target.value)} required autoComplete="off" aria-label="Ответ на вопрос для родителя" /></label>
      <button type="button" className="text-xs text-indigo-600 underline" onClick={() => { setChallenge(issueParentChallenge()); setAnswer(''); }}>Другой вопрос</button>
      <p className="text-[11px] text-amber-900 dark:text-amber-200">Это формальный шаг, не доказательство возраста. Управление защищает пароль. Сначала настройте семью сами и выходите из родительского аккаунта перед передачей устройства ребёнку.</p>
      {!first && <label className="block text-xs font-semibold">Ваш текущий родительский пароль<input type="password" className={field} value={parentPassword} onChange={(e) => setParentPassword(e.target.value)} autoComplete="current-password" required /></label>}
    </div>}
    {first && needsLegacyPassword() && <label className="block text-xs font-semibold">Старый пароль детского режима<input type="password" className={field} value={legacyPassword} onChange={(e) => setLegacyPassword(e.target.value)} required autoComplete="current-password" /><span className="block mt-1 font-normal text-slate-500">Без него нельзя обойти уже включённую защиту созданием нового родителя.</span></label>}
    {role === 'child' && <p className="text-xs text-slate-500">По умолчанию включён только репетитор. Класс, доступ к ИИ и другие ограничения задаются родителем после создания.</p>}
    {!globalThis.crypto?.subtle && <p role="alert" className="text-sm text-rose-600">В этом окружении нет Web Crypto для паролей. Откройте HTTPS или локальный HTML в поддерживаемом браузере.</p>}
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
    <button className={primary} disabled={busy || !globalThis.crypto?.subtle}><UserPlus className="w-4 h-4" />{busy ? 'Сохраняем защищённый аккаунт…' : first ? 'Создать семью и войти' : 'Создать аккаунт'}</button>
  </form>;
}

export function AccountRoot({ children }) {
  const gate = useAccounts(); const [login, setLogin] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (gate.configured && !gate.account) window.speechSynthesis?.cancel(); }, [gate.configured, gate.account]);
  if (!gate.configured || gate.account) return children;
  return <main className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center p-4">
    <section className={`${card} max-w-md w-full shadow-xl space-y-5`}>
      <div className="flex items-center gap-3"><div className="p-3 bg-indigo-600 text-white rounded-2xl"><GraduationCap className="w-7 h-7" /></div><div><h1 className="text-xl font-black">Домашка.ПРО <span className="text-indigo-500">{APP_VERSION}</span></h1><p className="text-xs text-slate-500">Вход в локальный аккаунт</p></div></div>
      {gate.transitioning ? <p role="status" className="text-sm text-indigo-600">Смена аккаунта… Если страница не обновилась, перезагрузите её вручную.</p> : <>
        {gate.error ? <p role="alert" className="text-sm text-rose-600">{gate.error}</p> : <>
          <div className="flex flex-wrap gap-2">{gate.accounts.map((account) => <button type="button" key={account.id} onClick={() => { setLogin(account.login); setPassword(''); }} className={`flex items-center gap-2 rounded-xl border p-2 text-xs ${login === account.login ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950' : 'border-slate-200 dark:border-slate-700'}`}><Avatar value={account.avatar} size="w-8 h-8" /><span className="text-left"><b className="block">{account.name}</b><span className="text-slate-500">{account.role === 'parent' ? 'Родитель' : 'Ученик'}</span></span></button>)}</div>
          <form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); setError(''); setBusy(true);
            try { await loginAccount(login, password); setPassword(''); reloadAccountPage(); }
            catch (err) { setError(err.message); } finally { setBusy(false); }
          }}>
            <label className="block text-xs font-semibold">Логин<input className={field} value={login} onChange={(e) => setLogin(e.target.value)} required autoComplete="username" autoCapitalize="none" autoCorrect="off" /></label>
            <label className="block text-xs font-semibold">Пароль<input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={128} autoComplete="current-password" /></label>
            {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
            <button className={`${primary} w-full`} disabled={busy}><LockKeyhole className="w-4 h-4" />{busy ? 'Проверяем пароль…' : 'Войти'}</button>
          </form>
        </>}
        <p className="text-[11px] leading-relaxed text-slate-500">Новых пользователей добавляет вошедший родитель. Пароль ребёнка можно сменить в его семейных настройках. Восстановления родительского пароля через почту нет. Не очищайте хранилище: это удалит локальные данные, а не восстановит вход.</p>
      </>}
      <p className="border-t border-slate-200 dark:border-slate-700 pt-3 text-[11px] text-slate-500">Без сервера аккаунтов и синхронизации между устройствами. Другой браузер, адрес сайта или HTML Viewer — другое хранилище.</p>
    </section>
  </main>;
}

export function FamilyAccountBar({ onOpen }) {
  const gate = useAccounts(); const account = gate.account;
  function logout() {
    if (!window.confirm('Выйти из аккаунта на всех его вкладках? Текущие запросы остановятся. Неотправленные фотографии нужно будет прикрепить заново.')) return;
    try { logoutAccount(); reloadAccountPage(); } catch (error) { window.alert(error.message); }
  }
  return <div className="no-print border-b border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 px-3 sm:px-5 py-2 flex items-center justify-between gap-2 text-xs">
    <button type="button" onClick={onOpen} className="flex items-center gap-2 min-w-0 text-left">
      <Avatar value={account?.avatar || '👥'} size="w-7 h-7" /><span className="min-w-0"><b className="block truncate">{account ? account.name : 'Локальные семейные аккаунты'}</b><span className="text-[10px] text-slate-500">{account ? account.role === 'parent' ? `Родитель · ${account.login}` : `${account.grade} класс · ${account.age} лет · ${account.login}` : 'Отдельные тетради, пароли и домашка от родителей'}</span></span>
    </button>
    <div className="flex items-center gap-2 shrink-0"><button type="button" onClick={onOpen} className="font-bold text-indigo-600 dark:text-indigo-300 inline-flex items-center gap-1"><Users className="w-4 h-4" />{account ? 'Семья' : 'Настроить'}</button>{account && <button type="button" onClick={logout} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500" aria-label="Выйти и сменить аккаунт" title="Выйти и сменить аккаунт"><LogOut className="w-4 h-4" /></button>}</div>
  </div>;
}

function PersonalSettings({ account }) {
  const [name, setName] = useState(account.name); const [avatar, setAvatar] = useState(account.avatar);
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  return <details className={card}><summary className="font-bold cursor-pointer">Мой аккаунт: имя, аватар и пароль</summary><div className="space-y-5 pt-4">
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); setError(''); try { updateAppearance({ name, avatar }); setNotice('Имя и аватар сохранены.'); } catch (err) { setError(err.message); } }}>
      <label className="block text-xs font-semibold">Отображаемое имя<input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required /></label>
      <AvatarPicker value={avatar} onChange={setAvatar} /><button className={primary}>Сохранить профиль</button>
    </form>
    <form className="space-y-3 border-t dark:border-slate-700 pt-4" onSubmit={async (event) => { event.preventDefault(); setError(''); setNotice('');
      if (next !== confirm) { setError('Пароли не совпадают.'); return; } setBusy(true);
      try { await changeAccountPassword(current, next); reloadAccountPage(); } catch (err) { setError(err.message); } finally { setBusy(false); }
    }}>
      <label className="block text-xs font-semibold">Текущий пароль<input type="password" className={field} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></label>
      <div className="grid sm:grid-cols-2 gap-3"><label className="text-xs font-semibold">Новый пароль<input type="password" className={field} value={next} onChange={(e) => setNext(e.target.value)} minLength={8} maxLength={128} autoComplete="new-password" required /></label><label className="text-xs font-semibold">Повтор нового пароля<input type="password" className={field} value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} maxLength={128} autoComplete="new-password" required /></label></div>
      <button className={primary} disabled={busy}>{busy ? 'Меняем пароль…' : 'Сменить мой пароль'}</button>
    </form>
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-600">{notice}</p>}
  </div></details>;
}

function ChildSettings({ child, parents }) {
  const me = getCurrentAccount(); const [grade, setGrade] = useState(child.grade); const [age, setAge] = useState(child.age);
  const [tutorOnly, setTutor] = useState(child.policy.tutorOnly); const [allowAi, setAllowAi] = useState(child.policy.allowAi);
  const [disabled, setDisabled] = useState(child.disabled); const [share, setShare] = useState(child.policy.aiSettingsOwnerId === me.id);
  const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false);
  function attempt(action, message) { setError(''); setNotice(''); try { action(); setNotice(message); } catch (err) { setError(err.message); } }
  useEffect(() => { setGrade(child.grade); setAge(child.age); setTutor(child.policy.tutorOnly);
    setAllowAi(child.policy.allowAi); setDisabled(child.disabled); setShare(child.policy.aiSettingsOwnerId === me.id);
  }, [child.grade, child.age, child.policy.tutorOnly, child.policy.allowAi, child.policy.aiSettingsOwnerId, child.disabled, me.id]);
  const summary = getChildStudySummary(child.id);
  return <details className={card}><summary className="font-bold cursor-pointer">Настройки ученика и родительский контроль</summary><div className="space-y-5 pt-4">
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); attempt(() => updateChild(child.id, { grade: Number(grade), age: Number(age), tutorOnly, allowAi, disabled, shareAiSettings: share }), 'Настройки сохранены. Старые сеансы ученика закрыты; нужно войти заново.'); }}>
      <GradeAge grade={grade} age={age} onGrade={setGrade} onAge={setAge} />
      {[[tutorOnly, setTutor, 'Только репетитор: без готового чистовика и решающих калькуляторов'], [allowAi, setAllowAi, 'Разрешить ИИ и распознавание фото'], [share, setShare, 'Использовать мои текущие настройки ИИ'], [disabled, setDisabled, 'Заблокировать вход ученика (данные останутся)']].map(([value, update, label]) => <label key={label} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-indigo-600" checked={value} onChange={(e) => update(e.target.checked)} /><span>{label}</span></label>)}
      <p className="text-xs text-slate-500">При передаче настроек ваш API-ключ используется в браузере ребёнка. Локальное приложение не может скрыть его от инструментов разработчика. Настройте бюджет ключа у провайдера. Без передачи настроек используется отдельная конфигурация ученика (по умолчанию — бесплатный канал).</p>
      {child.policy.aiSettingsOwnerId && child.policy.aiSettingsOwnerId !== me.id && <p className="text-xs text-amber-700">Сейчас используются настройки другого родителя. Сохранение этой формы заменит источник настройками вашего аккаунта либо отключит наследование.</p>}
      <button className={primary}>Сохранить ограничения</button>
    </form>
    <section className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-xs space-y-2">
      <h4 className="font-bold">Локальная учебная сводка</h4>
      <p>Разборов ИИ: {summary.stats.solvedCount || 0} · проверок: {summary.stats.checkedCount || 0} · верных ответов тренажёра: {summary.stats.quizCorrect || 0}</p>
      <p>Личный планер: {summary.tasks.filter((task) => task.done).length} из {summary.tasks.length} отмечено выполненными учеником. Это не проверка родителем.</p>
      <div className="flex gap-2 flex-wrap">{Object.entries(summary.grades).filter(([, marks]) => Array.isArray(marks) && marks.length).map(([subject, marks]) => <span key={subject} className="rounded-lg bg-white dark:bg-slate-900 px-2 py-1">{SUBJECTS.find((s) => s.id === subject)?.label || subject}: {marks.map((mark) => mark.val).join(', ')}</span>)}</div>
      <p className="text-slate-500">Отметки введены локально; это не подключение к школьному электронному дневнику. Личные чаты здесь не показываются.</p>
    </section>
    <form className="space-y-3 border-t dark:border-slate-700 pt-4" onSubmit={async (event) => { event.preventDefault(); setError(''); setNotice('');
      if (newPassword !== confirm) { setError('Пароли не совпадают.'); return; } setBusy(true);
      try { await resetChildPassword(child.id, currentPassword, newPassword); setCurrentPassword(''); setNewPassword(''); setConfirm(''); setNotice('Пароль ученика изменён, его старые сеансы закрыты.'); }
      catch (err) { setError(err.message); } finally { setBusy(false); }
    }}>
      <h4 className="font-bold text-sm">Ребёнок забыл пароль?</h4>
      <label className="block text-xs font-semibold">Ваш родительский пароль<input type="password" className={field} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" /></label>
      <label className="block text-xs font-semibold">Новый пароль ребёнка<input type="password" className={field} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} maxLength={128} required autoComplete="new-password" /></label>
      <label className="block text-xs font-semibold">Повтор пароля ребёнка<input type="password" className={field} value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} maxLength={128} required autoComplete="new-password" /></label>
      <button className={primary} disabled={busy}>Сменить пароль ребёнка</button>
    </form>
    <section className="space-y-2 border-t dark:border-slate-700 pt-4">
      <h4 className="text-sm font-bold">Связь с другими родителями</h4>
      {child.parentIds.map((id) => <div key={id} className="flex justify-between gap-2 text-xs"><span>{parents.find((p) => p.id === id)?.name || 'Родитель'}{id === me.id ? ' (вы)' : ''}</span>{child.parentIds.length > 1 && <button type="button" className="text-rose-600 underline" onClick={() => { if (window.confirm('Отозвать доступ этого родителя к ученику?')) attempt(() => revokeChildLink(child.id, id), 'Связь отозвана.'); }}>Отозвать связь</button>}</div>)}
      <button type="button" className="text-xs font-bold text-indigo-600 dark:text-indigo-300 underline" onClick={() => attempt(() => setCode(createLinkCode(child.id)), 'Код действует 15 минут, один раз.')}>Создать код привязки</button>
      {code && <p className="font-mono font-bold tracking-widest text-indigo-600 break-all">{code}</p>}
      <p className="text-[11px] text-slate-500">Другой родитель должен уже иметь аккаунт в этом браузере. Код вводится после входа под его логином. По интернету этот код не работает.</p>
    </section>
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-600">{notice}</p>}
  </div></details>;
}

function Migration({ account, children }) {
  const [target, setTarget] = useState(account.id); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  return <details className={card}><summary className="font-bold cursor-pointer">Старые данные версии 3.x</summary><div className="space-y-3 pt-3 text-sm">
    <p>Старые данные не удалены. Скопируйте тетрадь с фотографиями, дневник, расписание, закладки и статистику себе или своему ребёнку. Заполненные настройки и совпадающие чаты не перезаписываются. Ключи ИИ и пароли не копируются.</p>
    <label className="block text-xs font-semibold">Кому перенести<select className={field} value={target} onChange={(e) => setTarget(e.target.value)}><option value={account.id}>Мне ({account.name})</option>{children.map((child) => <option key={child.id} value={child.id}>{child.name} · {child.grade} класс</option>)}</select></label>
    <button type="button" className={primary} disabled={busy} onClick={async () => { setNotice(''); setBusy(true);
      try { const result = await copyLegacyWorkspace(target); setNotice(`Скопировано чатов: ${result.copiedChats}, разделов настроек: ${result.copiedPreferences}. Оригиналы сохранены. Для отображения войдите в выбранный аккаунт заново.`); }
      catch (error) { setNotice(error.message); } finally { setBusy(false); }
    }}>{busy ? 'Копируем…' : 'Скопировать без удаления оригиналов'}</button>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <p className="text-[11px] text-slate-500">Видны только данные того же браузера и адреса/файла. Экспорт тетради сохраняет чаты, но не семейные аккаунты и не все настройки. Архив семейных работ — отдельный JSON для чтения, не автоматическое восстановление аккаунтов.</p>
  </div></details>;
}

export default function FamilyAccounts() {
  const gate = useAccounts(); const account = gate.account; const [selectedId, setSelectedId] = useState(''); const [code, setCode] = useState(''); const [linkMessage, setLinkMessage] = useState('');
  const children = account?.role === 'parent' ? getChildren() : [];
  const selected = children.find((child) => child.id === selectedId) || children[0];
  if (!account) return <section className="max-w-3xl mx-auto space-y-5">
    <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-6 text-white"><Users className="w-8 h-8 mb-3" /><h1 className="text-2xl font-black">Каждому — своя тетрадь.<br />Всей семье — общий учебный план.</h1><p className="text-sm text-indigo-100 mt-3">Разные классы, отдельные пароли и аватары. Родитель задаёт домашку, ребёнок присылает ответ, родитель проверяет и помогает исправить.</p></div>
    <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 text-xs leading-relaxed"><b>Важно:</b> аккаунты локальные, без синхронизации ПК и телефона. Данные занятий и ключи не зашифрованы на устройстве. Это не замена родительскому контролю ОС: доступ к файлам браузера или очистка хранилища обходят локальные ограничения. Старые данные останутся, а после создания семьи гостевой вход будет закрыт.</div>
    <div className={card}><Registration first /></div>
  </section>;
  if (account.role === 'child') return <div className="space-y-5">
    <div className={`${card} flex gap-3 items-center`}><Avatar value={account.avatar} /><div><h1 className="text-xl font-extrabold">Привет, {account.name}!</h1><p className="text-xs text-slate-500">{account.grade} класс · {account.age} лет · задания и обратная связь от родителей</p></div></div>
    {!account.policy.allowAi && <p className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-sm text-amber-800 dark:text-amber-200">ИИ отключён родителем. Можно читать материалы, вести дневник и отправлять выполненную домашку.</p>}
    <FamilyHomeworkBoard /><PersonalSettings account={account} />
    <p className="text-xs text-slate-500">Класс, режим обучения и настройки ИИ меняет родитель. Для этого нужно выйти и войти под родительским логином.</p>
  </div>;
  return <div className="space-y-5">
    <header className={`${card} bg-gradient-to-r from-indigo-50 to-white dark:from-indigo-950/40 dark:to-slate-900`}><div className="flex items-center gap-3"><Avatar value={account.avatar} /><div><h1 className="text-xl font-extrabold">Семейный кабинет</h1><p className="text-xs text-slate-500">{account.name} · учеников: {children.length} · данные только в этом браузере</p></div><ShieldCheck className="w-6 h-6 text-indigo-600 ml-auto shrink-0" /></div></header>
    <div className="grid lg:grid-cols-[230px_minmax(0,1fr)] gap-5">
      <aside className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Мои ученики</h2>
        {children.map((child) => <button key={child.id} type="button" onClick={() => setSelectedId(child.id)} className={`w-full flex items-center gap-2 text-left p-3 rounded-xl border ${selected?.id === child.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'}`}><Avatar value={child.avatar} size="w-8 h-8" /><span className="min-w-0 flex-1"><b className="block text-sm truncate">{child.name}</b><span className="text-[11px] text-slate-500">{child.grade} кл. · {child.age} лет{child.disabled ? ' · заблокирован' : ''}</span></span><ArrowRight className="w-4 h-4 shrink-0 text-indigo-400" /></button>)}
        {!children.length && <p className="text-xs text-slate-500">Добавьте ребёнка ниже — привязка к вам создастся автоматически.</p>}
        <form className="space-y-2 pt-3" onSubmit={(event) => { event.preventDefault(); try { const child = linkChild(code); setSelectedId(child.id); setCode(''); setLinkMessage('Ученик привязан.'); } catch (error) { setLinkMessage(error.message); } }}>
          <label className="block text-xs font-semibold">Код от другого родителя<input className={field} value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} placeholder="Код привязки" required /></label><button className={`${primary} w-full text-xs`}>Привязать ученика</button>{linkMessage && <p role="status" className="text-xs">{linkMessage}</p>}
        </form>
      </aside>
      <div className="space-y-4 min-w-0">{selected ? <>
        <div><h2 className="text-lg font-extrabold">{selected.name} <span className="text-slate-400 font-medium">· {selected.grade} класс</span></h2><p className="text-xs text-slate-500">Логин: {selected.login}. Проверяйте работу, а не только отметку «сделано».</p></div>
        <FamilyHomeworkBoard key={`homework-${selected.id}`} childId={selected.id} />
        <ChildSettings key={`controls-${selected.id}`} child={selected} parents={gate.accounts} />
      </> : <div className={`${card} text-sm text-slate-500`}>Здесь появятся задания и настройки выбранного ребёнка.</div>}</div>
    </div>
    <details className={card} open={!children.length}><summary className="font-bold cursor-pointer inline-flex items-center gap-2"><UserPlus className="w-4 h-4" />Добавить ребёнка или родителя</summary><div className="pt-4"><Registration onCreated={(created) => { if (created.role === 'child') setSelectedId(created.id); }} /></div></details>
    <PersonalSettings account={account} />
    {isLegacyOwner() && <Migration account={account} children={children} />}
    <p className="text-xs leading-relaxed text-slate-500">После передачи устройства ребёнку выходите из аккаунта. Сеанс длится до 8 часов и закрывается при выходе, блокировке или смене пароля. Сохраните родительский пароль в безопасном месте: восстановления через почту нет. Локальные материалы и настройки не зашифрованы на диске.</p>
  </div>;
}
