import React, { useState } from 'react';
import { Download, Upload, ShieldCheck } from 'lucide-react';
import { cloud } from '../cloud/bridge';
import { getChildren, getCurrentAccount } from '../standalone/accounts';
import { exportStudyWorkspace, parseStudyImport, importStudyToCloud } from '../standalone/workspaceTransfer';
import { downloadCloudJson } from './CloudAccess';
const button = 'inline-flex gap-2 items-center rounded-xl px-3 py-2 bg-indigo-600 text-white text-xs font-bold disabled:opacity-50';
export default function WorkspaceTransfer() {
  const account = getCurrentAccount(); const children = account?.role === 'parent' ? getChildren() : [];
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [parsed, setParsed] = useState(null); const [target, setTarget] = useState(account?.id || ''); const [stats, setStats] = useState(false);
  async function run(work) { if (busy) return; setBusy(true); setError(''); setNotice(''); try { await work(); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <details className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-5">
    <summary className="font-bold cursor-pointer">Перенос и резервная копия учебных данных</summary>
    <div className="space-y-4 pt-4 text-sm">
      <p>Экспортируется только текущее рабочее пространство: тетрадь с фото, дневник, расписание, закладки, ошибки и статистика. Паролей, сеансов входа, связей семьи и API-ключей в файле нет.</p>
      <button type="button" disabled={busy} className={button} onClick={() => run(async () => { downloadCloudJson(await exportStudyWorkspace(), 'Domashka_study_transfer.json'); setNotice('Файл подготовлен. Он содержит личные учебные материалы и фото — храните его приватно.'); })}><Download className="w-4 h-4" />{busy ? 'Выполняем…' : 'Экспортировать учебное пространство'}</button>
      {cloud() ? <>
        <label className="block"><span className="text-xs font-bold inline-flex gap-2 items-center"><Upload className="w-4 h-4" />Выбрать файл переноса / восстановления</span>
          <input type="file" accept="application/json,.json" disabled={busy} className="block text-xs mt-2 max-w-full" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
            run(async () => { setParsed(null); if (file.size > 40000000) throw new Error('Файл больше 40 МБ.'); const data = parseStudyImport(await file.text()); setParsed(data); setStats(false); });
          }} /></label>
        {parsed && <div className="space-y-3 rounded-xl p-3 bg-indigo-50 dark:bg-indigo-950/30">
          {parsed.recovery ? <p>Восстановление несохранённой очереди: только в тот же аккаунт/проект. В ней могут быть удаления. Облачная статистика и права не заменяются данными из файла.</p> : <p>Источник: <b>{parsed.sourceName}</b>. Чатов: {parsed.chats}; разделов: {parsed.settings}. Старые XP: {parsed.stats.xp}. Существующие записи не перезаписываются.</p>}
          <label className="block text-xs font-bold">Кому перенести<select value={target} disabled={busy || parsed.recovery} onChange={(e) => setTarget(e.target.value)} className="block mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5"><option value={account.id}>Мне · {account.name}</option>{children.map((child) => <option key={child.id} value={child.id}>{child.name} · {child.grade} класс</option>)}</select></label>
          {!parsed.recovery && account.role === 'parent' && <label className="flex gap-2 text-xs"><input type="checkbox" checked={stats} onChange={(e) => setStats(e.target.checked)} /><span>Однократно перенести старые счётчики и XP с отметкой «импортировано». Это не подтверждение правильных ответов карточек.</span></label>}
          <button type="button" className={button} disabled={busy} onClick={() => {
            if (!window.confirm('Импортировать выбранные учебные данные? Оригиналы останутся на месте. Файл восстановления может содержать ранее запланированные удаления.')) return;
            run(async () => { const result = await importStudyToCloud(parsed, parsed.recovery ? account.id : target, { includeStats: stats }); setNotice(`Добавлено: ${result.added}; пропущено: ${result.skipped}. ${result.recovery ? 'Проверьте очередь и возможные конфликты.' : 'Если переносили себе, загрузите новую версию кнопкой «Обновить экран» в строке синхронизации.'}`); setParsed(null); });
          }}>Подтвердить перенос</button>
        </div>}
      </> : <p className="text-xs text-slate-500">Чтобы перенести данные из HTML Viewer: сохраните этот JSON, откройте облачный сайт, войдите и выберите файл в этом разделе. Сайт не может сам прочитать локальный HTML или другой браузер. Не удаляйте старый файл/приложение до проверки переноса.</p>}
      <p className="text-xs text-slate-500 inline-flex items-start gap-2"><ShieldCheck className="w-4 h-4 shrink-0" />Семейные работы экспортируются отдельно кнопкой над списком заданий. Старые локальные аккаунты и архивы семейных работ не превращаются автоматически в облачных пользователей/задания.</p>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
    </div>
  </details>;
}
