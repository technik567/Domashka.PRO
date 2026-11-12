import React, { useEffect, useState } from 'react';
import { cloud } from '../cloud/bridge';
import { getCloudConfig } from '../cloud/client';
import { CloudCaptcha } from './CloudAccess';
import BackupCodes from './BackupCodes';

export default function CloudRecoverySettings({ account }) {
  const [open, setOpen] = useState(false); const [status, setStatus] = useState(null);
  const [password, setPassword] = useState(''); const [agree, setAgree] = useState(false);
  const [captcha, setCaptcha] = useState(''); const [reset, setReset] = useState(0);
  const [issued, setIssued] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return; let active = true;
    cloud().backupStatus().then(data => { if (active) setStatus(data); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [open]);
  async function rotate(event) {
    event.preventDefault(); if (busy || !agree) return; setBusy(true); setError('');
    try {
      const result = await cloud().replaceBackupCodes(password,captcha);
      setPassword(''); setAgree(false); setStatus({remaining:10,total:10}); setIssued(result);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); setCaptcha(''); setReset(n => n+1); }
  }
  return <details className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="font-bold cursor-pointer">Резервные коды восстановления</summary>
    <div className="mt-4 space-y-4">
      {issued ? <BackupCodes codes={issued.codes} login={issued.login} siteUrl={getCloudConfig().siteUrl} onDone={() => setIssued(null)} doneLabel="Я сохранил(а) новый набор — закрыть список" /> : <>
        <p className="text-sm">{status ? `Осталось неиспользованных кодов: ${status.remaining} из ${status.total}.` : 'Откройте раздел для проверки остатка кодов.'} Сами коды повторно не показываются. После обычной смены пароля неиспользованные коды сохраняются.</p>
        {status?.remaining === 0 && <p role="alert" className="text-sm text-amber-800 dark:text-amber-200">Резервных кодов нет. Пока вы помните пароль, создайте новый набор и сохраните его отдельно.</p>}
        <form onSubmit={rotate} className="space-y-3">
          <label className="block text-sm font-semibold">Текущий пароль для перевыпуска кодов<input className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-3" type="password" value={password} onChange={event => setPassword(event.target.value)} required autoComplete="current-password" maxLength={128} /></label>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={agree} onChange={event => setAgree(event.target.checked)} required /><span>Понимаю: новый набор отменит ВСЕ прежние коды, в том числе неиспользованные. Нужно заново сохранить 10 кодов.</span></label>
          {open && <CloudCaptcha onToken={setCaptcha} reset={reset} />}
          <button type="submit" disabled={busy || !agree} className="rounded-xl bg-indigo-600 text-white font-bold px-4 py-2.5 text-sm disabled:opacity-50">{busy ? 'Перевыпускаем…' : 'Перевыпустить 10 кодов'}</button>
        </form>
        <p className="text-xs text-slate-500">Не передавайте коды ребёнку. Для сброса его пароля есть отдельная форма. Потеряли ответ при перевыпуске? Старые коды могли уже перестать действовать: повторите перевыпуск через минуту, используя пароль.</p>
      </>}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    </div>
  </details>;
}
