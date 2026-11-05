import React, { useEffect, useRef, useState } from 'react';
import { LockKeyhole, ShieldCheck, X, Loader2 } from 'lucide-react';
import { changeParentPassword, setTutorModeEnabled } from '../standalone/parentalControl';

export default function ParentModeModal({ isOpen, onClose, status }) {
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [changePassword, setChangePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialogRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    setPassword(''); setNewPassword(''); setConfirmation(''); setError(''); setNotice(''); setChangePassword(false);
    const previous = document.activeElement;
    inputRef.current?.focus();
    const trap = (event) => {
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled])');
      if (!controls?.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); previous?.focus?.(); };
  }, [isOpen]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    if ((!status.configured || changePassword) && (changePassword ? newPassword : password) !== confirmation) {
      setError('Пароли не совпадают.'); return;
    }
    setBusy(true);
    try {
      if (changePassword) {
        await changeParentPassword(password, newPassword);
        setPassword(''); setNewPassword(''); setConfirmation(''); setChangePassword(false);
        setNotice('Родительский пароль изменён. Режим обучения остался прежним.');
      } else {
        await setTutorModeEnabled(!status.enabled, password);
        setPassword(''); setConfirmation('');
        onClose();
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (!isOpen) return null;
  const fieldClass = 'w-full mt-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500';
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-sm p-3 sm:p-5 flex items-center justify-center" onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="parent-mode-title" className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700">
        <div className="flex justify-between gap-3 p-5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex gap-3 items-center"><ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" /><div><h2 id="parent-mode-title" className="text-lg font-extrabold">Детский режим</h2><p className="text-xs text-slate-500 dark:text-slate-400">{status.enabled ? 'Защита включена · только репетитор' : 'Учимся решать, а не списывать'}</p></div></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Закрыть родительские настройки" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 p-3.5 text-sm space-y-2">
            <p className="font-bold">Один шаг, одна подсказка, одна попытка ребёнка.</p>
            <ul className="list-disc pl-4 space-y-1 text-xs leading-relaxed">
              <li>Репетитор учитывает класс и не должен выдавать готовую работу.</li>
              <li>Обычные чаты, чистовики, калькуляторы решений и ИИ-тесты скрываются, но не удаляются.</li>
              <li>Дневник и справочник остаются доступны. Сменить модель можно после выхода из режима.</li>
              <li>После перезагрузки защита сохраняется. Выход и смена пароля требуют родительский пароль.</li>
            </ul>
          </div>
          {status.corrupted ? <p role="alert" className="text-sm text-rose-600">Настройки защиты повреждены. Отключение без проверки пароля заблокировано.</p> : <>
            <label className="block text-sm font-semibold" htmlFor="parent-password">{status.configured ? 'Родительский пароль' : 'Придумайте родительский пароль'}
              <input ref={inputRef} id="parent-password" type="password" required minLength={status.configured ? undefined : 8} maxLength={128} autoComplete={status.configured ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} className={fieldClass} />
            </label>
            {changePassword && <label className="block text-sm font-semibold" htmlFor="new-parent-password">Новый пароль<input id="new-parent-password" type="password" minLength={8} maxLength={128} required autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={busy} className={fieldClass} /></label>}
            {(!status.configured || changePassword) && <label className="block text-sm font-semibold" htmlFor="confirm-parent-password">Повторите пароль<input id="confirm-parent-password" type="password" minLength={8} maxLength={128} required autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={busy} className={fieldClass} /><span className="block mt-1 text-xs font-normal text-slate-500">От 8 символов. Не используйте пароль от почты или других сервисов.</span></label>}
            {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
            {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}
            <button type="submit" disabled={busy} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LockKeyhole className="w-4 h-4" />}{changePassword ? 'Сохранить новый пароль' : status.enabled ? 'Отключить детский режим' : 'Включить детский режим'}</button>
            {status.configured && <button type="button" disabled={busy} onClick={() => { setChangePassword((value) => !value); setError(''); setNotice(''); }} className="w-full text-xs text-slate-500 dark:text-slate-400 hover:underline">{changePassword ? 'Назад к переключению режима' : 'Изменить родительский пароль'}</button>}
          </>}
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">Пароль не отправляется в сеть: хранится только хеш с солью (PBKDF2). Это локальный учебный режим, не полноценный родительский контроль: очистка данных, другой браузер или изменение HTML позволяют обойти его. ИИ может ошибиться и раскрыть ответ — абсолютной гарантии нет. Восстановления забытого пароля нет; сохраните его у себя.</p>
        </form>
      </section>
    </div>
  );
}
