import { studyId } from '../standalone/ids';
import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Send, CheckCircle2, RotateCcw, ImagePlus, Trash2, Download, ClipboardCheck } from 'lucide-react';
import { cloudConfigured } from '../cloud/bridge';
import { getCurrentAccount } from '../standalone/accounts';
import { listHomework, getHomework, assignHomework, submitHomework, reviewHomework, deleteHomework, exportHomework, subscribeHomework, homeworkStorageNotice } from '../standalone/familyHomework';
import { safeStorage } from '../standalone/storageEngine';
import { preparePhotoFile } from '../standalone/visionEngine';
import { SUBJECTS } from '../data/referenceData';

const field = 'w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500';
const button = 'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed';
const statusText = { assigned: 'Назначено', submitted: 'Ждёт проверки', revision: 'На доработку', accepted: 'Принято' };
const subjectLabel = (id) => SUBJECTS.find((s) => s.id === id)?.label || id;
function readDraft(key) { try { return JSON.parse(safeStorage.getItem(key) || 'null'); } catch { return null; } }
function downloadJson(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function AssignmentForm({ childId, onSaved }) {
  const key = `domashka_family_assign_draft_v4_${childId}`;
  const [form, setForm] = useState(() => ({ requestId: studyId(), subject: 'math', title: '', instructions: '', due: '', ...readDraft(key) }));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { safeStorage.setItem(key, JSON.stringify(form)); }, [form, key]);
  const update = (name) => (event) => setForm((old) => ({ ...old, [name]: event.target.value, requestId: studyId() }));
  async function save(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await assignHomework({ childId, ...form });
      setForm((old) => ({ ...old, title: '', instructions: '', requestId: studyId() })); onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <form onSubmit={save} className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 p-4 space-y-3">
    <fieldset disabled={busy} className="space-y-3"><h3 className="font-bold flex items-center gap-2"><Plus className="w-4 h-4" /> Новое задание ребёнку</h3>
    <div className="grid sm:grid-cols-2 gap-3">
      <label className="text-xs font-semibold">Предмет<select className={`${field} mt-1`} value={form.subject} onChange={update('subject')}>{SUBJECTS.filter((s) => s.id !== 'auto').map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <label className="text-xs font-semibold">Срок сдачи (необязательно)<input className={`${field} mt-1`} type="date" value={form.due} onChange={update('due')} /></label>
    </div>
    <label className="block text-xs font-semibold">Название задания<input className={`${field} mt-1`} value={form.title} onChange={update('title')} required maxLength={200} placeholder="Например: дроби — упражнения 12–14" /></label>
    <label className="block text-xs font-semibold">Условие и что нужно прислать<textarea aria-label="Условие и что нужно прислать" className={`${field} mt-1 min-h-24`} value={form.instructions} onChange={update('instructions')} required maxLength={12000} placeholder="Запишите условие, номер упражнения и требования к ответу…" /></label>
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    <button className={button} disabled={busy}><Send className="w-4 h-4" />{busy ? 'Сохраняем…' : 'Назначить домашку'}</button>
    <p className="text-[11px] text-slate-500">{cloudConfigured() ? 'После сохранения на сервере задание доступно ребёнку на всех устройствах. На открытом экране нужно обновить список работ.' : 'Задание появится в аккаунте ребёнка в этом же браузере. На другой телефон оно автоматически не отправится.'}</p>
  </fieldset></form>;
}

function HomeworkCard({ item, parent, refresh }) {
  const draftKey = `domashka_family_answer_draft_v4_${item.id}`;
  const reviewKey = `domashka_family_review_draft_v42_${item.id}`;
  const [baseVersion, setBaseVersion] = useState(() => readDraft(parent ? reviewKey : draftKey)?.version ?? item.version);
  const [answer, setAnswer] = useState(() => readDraft(draftKey)?.answer ?? item.submission?.text ?? '');
  const [image, setImage] = useState(''); const [shownPhoto, setShownPhoto] = useState(''); const [removeExisting, setRemoveExisting] = useState(false); const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [comment, setComment] = useState(() => readDraft(reviewKey)?.comment ?? item.review?.comment ?? ''); const [mark, setMark] = useState(() => readDraft(reviewKey)?.mark ?? item.review?.mark ?? '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (!parent) safeStorage.setItem(draftKey, JSON.stringify({ answer, version: baseVersion })); }, [answer, draftKey, parent, baseVersion]);
  useEffect(() => { if (parent) safeStorage.setItem(reviewKey, JSON.stringify({ comment, mark, version: baseVersion })); }, [comment, mark, parent, reviewKey, baseVersion]);
  useEffect(() => setShownPhoto(''), [item.version]);
  async function run(action) {
    setError(''); setBusy(true);
    try { const saved = await action(); if (saved?.version) setBaseVersion(saved.version); await refresh(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function attach(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setLoadingPhoto(true); setError('');
    try { setImage(await preparePhotoFile(file, { maxDim: 1280, jpegQuality: 0.8 })); }
    catch (err) { setError(err.message); } finally { setLoadingPhoto(false); }
  }
  const today = new Date(); const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const overdue = item.due && item.due < localDate && !['submitted', 'accepted'].includes(item.status);
  return <article className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden" data-testid="family-homework">
    <header className="p-4 border-b border-slate-100 dark:border-slate-800">
      <div className="flex flex-wrap justify-between gap-2 mb-2 text-[11px] font-semibold">
        <span className="text-slate-500">{subjectLabel(item.subject)} · {item.authorName}</span>
        <span className={`rounded-full px-2 py-0.5 ${item.status === 'accepted' ? 'bg-emerald-100 text-emerald-800' : item.status === 'revision' ? 'bg-amber-100 text-amber-900' : 'bg-indigo-100 text-indigo-800'}`}>{statusText[item.status]}</span>
      </div>
      <h4 className="font-bold text-base break-words">{item.title}</h4>
      {item.due && <p className={`text-xs mt-1 ${overdue ? 'text-rose-600 font-bold' : 'text-slate-500'}`}>{overdue ? 'Срок прошёл' : 'Сдать до'}: {item.due}</p>}
    </header>
    <div className="p-4 space-y-4">
      {item.version !== baseVersion && <div role="alert" className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 text-xs space-y-2">
        <p>Работа изменилась на другом устройстве. Ваш текст и новое фото не заменены. Проверьте актуальное условие, присланный ответ и отзыв ниже.</p>
        <button type="button" className="underline font-bold" disabled={busy} onClick={() => {
          if (window.confirm('Продолжить редактирование актуальной версии, сохранив ваш черновик? Следующая отправка заменит ответ/отзыв показанной версии.')) setBaseVersion(item.version);
        }}>Я проверил(а) новую версию — сохранить мой черновик</button>
      </div>}
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.instructions}</p>
      {item.submission && <section className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 space-y-2">
        <h5 className="text-xs font-bold">Присланная работа · {new Date(item.submission.submittedAt).toLocaleString('ru-RU')}</h5>
        <p className="whitespace-pre-wrap break-words text-sm">{item.submission.text}</p>
        {item.submission.hasImage && !shownPhoto && <button type="button" className="text-xs font-bold text-indigo-600 underline" disabled={busy} onClick={() => run(async () => { const record = await getHomework(item.id); setShownPhoto(record.submission?.image || ''); })}>Показать фото работы</button>}
        {shownPhoto && <img src={shownPhoto} alt="Фотография выполненной работы" className="max-h-96 rounded-lg object-contain w-full bg-white" loading="lazy" />}
      </section>}
      {item.review && <section className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 text-sm">
        <h5 className="font-bold text-xs mb-1">Проверил(а): {item.review.byName}{item.review.mark ? ` · оценка ${item.review.mark}/5` : ''}</h5>
        <p className="whitespace-pre-wrap break-words">{item.review.comment || 'Работа принята. Молодец!'}</p>
        <p className="mt-2 text-[11px] text-slate-500">Это семейная оценка; она не меняет школьные отметки в дневнике.</p>
      </section>}
      {!parent && item.status !== 'accepted' && <form onSubmit={(event) => { event.preventDefault(); run(async () => {
        const previous = item.submission?.hasImage && !image && !removeExisting ? await getHomework(item.id) : null;
        const saved = await submitHomework(item.id, { answer, image: image || previous?.submission?.image || '' }, baseVersion);
        safeStorage.removeItem(draftKey); setImage(''); return saved;
      }); }} className="space-y-2">
        <label className="block text-xs font-bold">Мой ответ<textarea aria-label="Мой ответ" className={`${field} mt-1 min-h-28`} disabled={busy} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={16000} placeholder="Объясни решение своими словами или приложи фото тетради…" /></label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 p-2 text-xs font-semibold">
            <ImagePlus className="w-4 h-4" />{loadingPhoto ? 'Подготовка фото…' : 'Фото работы'}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="sr-only" disabled={busy || loadingPhoto} onChange={attach} aria-label="Прикрепить фото выполненной работы" />
          </label>
          <button className={button} disabled={busy || loadingPhoto}><Send className="w-4 h-4" />{busy ? 'Сохраняем…' : item.status === 'submitted' ? 'Обновить отправку' : 'Отправить родителю'}</button>
        </div>
        {image && <div className="flex items-start gap-2"><img src={image} alt="Фото перед отправкой" className="w-28 h-28 object-contain rounded-lg bg-white" /><button type="button" className="text-xs text-rose-600 underline" onClick={() => setImage('')}>Убрать новое фото</button></div>}
        {item.submission?.hasImage && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={removeExisting} onChange={(e) => setRemoveExisting(e.target.checked)} />Убрать прежнее фото при следующей отправке</label>}
        <p className="text-[11px] text-slate-500">Текст черновика сохраняется локально. Неотправленное новое фото после выхода нужно прикрепить заново. Для отправки родителю ИИ не используется.</p>
      </form>}
      {parent && item.submission && <div className="space-y-2">
        <label className="block text-xs font-bold">Комментарий родителя<textarea aria-label="Комментарий родителя" className={`${field} mt-1`} disabled={busy} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={8000} placeholder="Что получилось и что стоит исправить?" /></label>
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-xs">Оценка <select aria-label="Оценка" className="rounded-lg border bg-white dark:bg-slate-800 p-2 dark:border-slate-700" disabled={busy} value={mark} onChange={(e) => setMark(e.target.value)}><option value="">Без оценки</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
          <button type="button" className={button} disabled={busy} onClick={() => run(() => reviewHomework(item.id, { accepted: true, comment, mark }, baseVersion))}><CheckCircle2 className="w-4 h-4" />Принять</button>
          <button type="button" className="inline-flex items-center gap-2 border rounded-xl p-2 text-xs font-bold dark:border-slate-700 disabled:opacity-50" disabled={busy} onClick={() => run(() => reviewHomework(item.id, { accepted: false, comment, mark }, baseVersion))}><RotateCcw className="w-4 h-4" />На доработку</button>
        </div>
        <p className="text-[11px] text-slate-500">Проверка вручную: решение оценивает родитель, а не автоматическая отметка ИИ.</p>
      </div>}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {parent && <button type="button" disabled={busy} className="text-xs text-slate-400 hover:text-rose-600 inline-flex items-center gap-1" onClick={() => {
        if (window.confirm(cloudConfigured() ? 'Удалить задание и ответ из списка? Сначала можно скачать архив. Сохранённые объекты фото в облаке очищает владелец проекта отдельно.' : 'Удалить это задание вместе с ответом и фотографией? Сначала можно скачать архив работ.')) run(() => deleteHomework(item.id, baseVersion));
      }}><Trash2 className="w-3 h-3" />Удалить задание</button>}
    </div>
  </article>;
}

export default function FamilyHomeworkBoard({ childId = '', compact = false }) {
  const user = getCurrentAccount(); const parent = user?.role === 'parent';
  const [items, setItems] = useState([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [hasUpdates, setHasUpdates] = useState(false);
  const [filter, setFilter] = useState('active'); const [visible, setVisible] = useState(8);
  const refresh = useCallback(async () => {
    try { const list = await listHomework(childId); setItems(list); setError(''); setHasUpdates(false); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }, [childId]);
  useEffect(() => { let mounted = true;
    const load = async () => { try { const list = await listHomework(childId); if (mounted) { setItems(list); setError(''); setHasUpdates(false); } }
      catch (err) { if (mounted) setError(err.message); } finally { if (mounted) setLoading(false); } };
    load(); const update = () => { if (mounted) setHasUpdates(true); }; const stop = subscribeHomework(update); const onFocus = update; window.addEventListener('focus', onFocus);
    return () => { mounted = false; stop(); window.removeEventListener('focus', onFocus); };
  }, [childId]);
  useEffect(() => setVisible(8), [childId, filter]);
  useEffect(() => { const count = items.filter((item) => filter === 'all' || (filter === 'active' ? item.status !== 'accepted' : item.status === filter)).length;
    if (visible - 8 >= count) setVisible(Math.max(8, Math.ceil(count / 8) * 8));
  }, [items, filter, visible]);
  if (!user) return null;
  const filtered = items.filter((item) => filter === 'all' || (filter === 'active' ? item.status !== 'accepted' : item.status === filter));
  return <section className="space-y-4" aria-label="Семейные домашние задания">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-extrabold inline-flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-indigo-600" />{parent ? 'Семейные задания' : 'Домашка от родителей'}</h2>
      {!compact && <button type="button" className="inline-flex gap-1 items-center text-xs text-indigo-600 dark:text-indigo-400 font-bold" onClick={async () => { try { downloadJson(await exportHomework(childId, filtered.slice(visible - 8, visible).map((item) => item.id)), 'Domashka_family_homework.json'); } catch (err) { setError(err.message); } }}><Download className="w-4 h-4" />Скачать показанные работы (JSON)</button>}
    </div>
    {parent && childId && !compact && <AssignmentForm key={childId} childId={childId} onSaved={refresh} />}
    <div className="flex flex-wrap gap-2 text-xs">
      {[['active', 'В работе'], ['submitted', 'На проверке'], ['accepted', 'Принято'], ['all', 'Все']].map(([id, label]) => <button type="button" key={id} onClick={() => setFilter(id)} className={`px-3 py-1.5 rounded-full font-semibold ${id === filter ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>{label}{id === 'all' ? ` (${items.length})` : ''}</button>)}
      <button type="button" onClick={() => { if (window.confirm('Обновить список? Текстовые черновики сохраняются на устройстве. Неотправленные фото сохраните отдельно перед изменением списка/фильтра.')) refresh(); }} className="ml-auto text-slate-500 underline">Обновить</button>
    </div>
    {hasUpdates && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Есть обновления семейных работ. Нажмите «Обновить»; текущие формы не заменяются в фоне.</p>}
    {error && <p role="alert" className="rounded-xl bg-rose-50 dark:bg-rose-950/30 p-3 text-sm text-rose-600">{error}</p>}
    {homeworkStorageNotice() && <p className="text-xs text-amber-700 dark:text-amber-300">{homeworkStorageNotice()}</p>}
    {loading ? <p className="text-sm text-slate-500">Загружаем задания…</p> : !filtered.length && !error ? <p className="p-6 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-sm text-slate-500">{filter === 'active' ? 'Незавершённых заданий пока нет.' : 'В этой подборке пока нет работ.'}</p> : null}
    {filtered.slice(compact ? 0 : visible - 8, compact ? 3 : visible).map((item) => <HomeworkCard key={item.id} item={item} parent={parent} refresh={refresh} />)}
    {!compact && visible > 8 && <button type="button" className={`${button} mr-2`} onClick={() => setVisible((n) => Math.max(8, n - 8))}>Предыдущие 8 работ</button>}
    {!compact && filtered.length > visible && <button type="button" className={button} onClick={() => setVisible((n) => n + 8)}>Следующие 8 работ</button>}
    {compact && filtered.length > 3 && <p className="text-xs text-slate-500">Все задания доступны в разделе «Семья».</p>}
  </section>;
}
