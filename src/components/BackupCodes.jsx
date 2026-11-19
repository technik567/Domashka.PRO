import React, { useEffect, useState } from 'react';
import { Copy, Download, KeyRound } from 'lucide-react';

// Memory-only one-time display. Parent must discard the array on completion.
// This file is deliberately separate from study-data exports and AI helpers.
export default function BackupCodes({ codes, login, siteUrl, onDone, doneLabel = 'Я сохранил(а) коды — перейти ко входу' }) {
  const [saved, setSaved] = useState(false); const [notice, setNotice] = useState('');
  useEffect(() => {
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload',warn);
    return () => window.removeEventListener('beforeunload',warn);
  }, []);
  const text = () => `Домашка.ПРО — секретные одноразовые коды восстановления\nСайт: ${siteUrl}\nЛогин: ${login}\n\n${codes.map((code,index) => `${index+1}. ${code}`).join('\n')}\n\nКаждый код можно использовать ОДИН раз. Не передавайте их детям, поддержке или ИИ.\nИспользованный код зачеркните. Остальные продолжают работать.\nПеревыпуск набора аннулирует ВСЕ предыдущие коды.\nХраните отдельно от устройства/браузера, доступ к которому можно потерять.\n`;
  function download() {
    const url = URL.createObjectURL(new Blob([text()],{type:'text/plain;charset=utf-8'}));
    const link = document.createElement('a'); link.href=url; link.download='Domashka_PRO_backup_codes.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url),5000);
    setNotice('Файл передан браузеру. Проверьте «Загрузки» и сохраните его в безопасном месте.');
  }
  return <section aria-label="10 резервных кодов" className="space-y-4 rounded-2xl border-2 border-indigo-400 p-4 bg-indigo-50 dark:bg-indigo-950/30">
    <h2 className="text-lg font-extrabold flex gap-2 items-center"><KeyRound className="w-5 h-5 shrink-0" />Сохраните все 10 кодов</h2>
    <p className="text-sm">Логин: <strong className="break-all">{login}</strong>. Каждый код восстанавливает доступ <strong>один раз</strong>. После использования одного остальные действуют — новый набор не выдаётся автоматически.</p>
    <p className="text-xs font-bold text-amber-900 dark:text-amber-200">Это секреты, равноценные паролю. После закрытия полный список нельзя открыть снова: сервер хранит только хеши. Не отправляйте коды в чат или помощнику.</p>
    <ol className="space-y-2" aria-label="Список резервных кодов">
      {codes.map((code,index) => <li key={code} className="flex gap-2 items-start rounded-lg bg-white dark:bg-slate-900 p-2 text-xs sm:text-sm"><span className="text-slate-500 tabular-nums w-5 shrink-0">{index+1}.</span><code className="font-mono select-all break-words leading-relaxed">{code}</code></li>)}
    </ol>
    <div className="flex gap-3 flex-wrap text-sm font-bold">
      <button type="button" onClick={download} className="inline-flex items-center gap-1 rounded-xl border border-indigo-300 px-3 py-2"><Download className="w-4 h-4" />Скачать 10 кодов (.txt)</button>
      <button type="button" onClick={async () => {
        try { if (!navigator.clipboard?.writeText) throw new Error('Unavailable'); await navigator.clipboard.writeText(text()); setNotice('Скопировано. Сохраните в менеджере паролей, затем очистите буфер обмена.'); }
        catch { setNotice('Копирование недоступно. Скачайте файл или выделите и скопируйте список вручную.'); }
      }} className="inline-flex items-center gap-1 rounded-xl border border-indigo-300 px-3 py-2"><Copy className="w-4 h-4" />Скопировать</button>
    </div>
    {notice && <p role="status" className="text-xs">{notice}</p>}
    <label className="flex gap-2 text-sm items-start"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} className="mt-1" /><span>Я сохранил(а) все 10 кодов отдельно. Понимаю: без пароля и неиспользованного кода самостоятельное восстановление невозможно.</span></label>
    <button type="button" disabled={!saved} onClick={onDone} className="w-full rounded-xl bg-indigo-600 text-white font-bold p-3 text-sm disabled:opacity-50">{doneLabel}</button>
  </section>;
}
