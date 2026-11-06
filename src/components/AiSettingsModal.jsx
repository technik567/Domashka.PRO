import ModelInfoCard from './ModelInfoCard';
import { customConnectionHints, normalizeCustomEndpoint } from '../standalone/customConnection';
import React, { useEffect, useRef, useState } from 'react';
import { X, CheckCircle2, Sparkles, RefreshCw, ExternalLink, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { api, getActiveAuthPayload } from '../api';
import { DEFAULT_GEMINI_MODELS, DEFAULT_OPENROUTER_FREE_MODELS, getModelLabel } from '../standalone/modelCatalog';

const PROVIDERS = [
  { id: 'builtin', label: 'Бесплатный облачный ИИ', note: 'Без ключа · выбор шлюза или автовыбор' },
  { id: 'openrouter', label: 'OpenRouter Free', note: 'Бесплатные модели · нужен свой API-ключ' },
  { id: 'gemini', label: 'Google Gemini', note: 'Свой API-ключ · лимиты зависят от аккаунта' },
  { id: 'custom', label: 'Ollama / свой API', note: 'Локальная или OpenAI-совместимая модель' },
];
const controlClass = 'w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500';

export default function AiSettingsModal({ isOpen, onClose, settings, onSave, onOpenBuiltinPicker }) {
  const [form, setForm] = useState(settings);
  const [orModels, setOrModels] = useState(DEFAULT_OPENROUTER_FREE_MODELS);
  const [geminiModels, setGeminiModels] = useState(DEFAULT_GEMINI_MODELS);
  const [loadingModels, setLoadingModels] = useState(false);
  const [catalogWarning, setCatalogWarning] = useState('');
  const [testState, setTestState] = useState({ loading: false, ok: null, msg: '' });
  const [saveError, setSaveError] = useState('');
  const testRef = useRef(null);
  const catalogRef = useRef(0);
  const closeRef = useRef(null);

  useEffect(() => {
    if (isOpen) { setForm(settings); setTestState({ loading: false, ok: null, msg: '' }); setSaveError(''); closeRef.current?.focus(); }
    return () => { testRef.current?.abort(); testRef.current = null; catalogRef.current++; };
  }, [isOpen, settings]);

  useEffect(() => {
    if (isOpen && form.provider === 'openrouter') fetchModels(false);
  }, [isOpen, form.provider]);

  function changeForm(patch) {
    testRef.current?.abort(); testRef.current = null;
    setTestState({ loading: false, ok: null, msg: '' }); setSaveError('');
    setForm((previous) => ({ ...previous, ...patch }));
  }

  async function fetchModels(force) {
    const request = ++catalogRef.current;
    setLoadingModels(true);
    try {
      const data = await api.getModels(force);
      if (request !== catalogRef.current) return;
      if (data.ok) {
        setOrModels(data.openrouter_free || DEFAULT_OPENROUTER_FREE_MODELS);
        setGeminiModels(data.gemini_free || DEFAULT_GEMINI_MODELS);
        setCatalogWarning(data.catalogWarning || '');
      }
    } catch { if (request === catalogRef.current) setCatalogWarning('Каталог недоступен. Показан список из приложения.'); }
    finally { if (request === catalogRef.current) setLoadingModels(false); }
  }

  function validationError() {
    if (form.provider === 'openrouter' && !form.openrouterKey?.trim()) return 'Для OpenRouter нужен API-ключ. Добавьте его или выберите «Бесплатный облачный ИИ» без ключа.';
    if (form.provider === 'gemini' && !form.geminiKey?.trim()) return 'Для Gemini нужен API-ключ Google AI Studio.';
    if (form.provider === 'custom') {
      if ((form.customTransport || 'direct') === 'direct') {
        try { normalizeCustomEndpoint(form.customBaseUrl); } catch (error) { return error.message; }
      }
      if (!form.customModel?.trim()) return 'Укажите имя локальной модели.';
    }
    return '';
  }

  async function handleTest() {
    const error = validationError();
    if (error) { setTestState({ loading: false, ok: false, msg: error }); return; }
    testRef.current?.abort();
    const controller = new AbortController(); testRef.current = controller;
    setTestState({ loading: true, ok: null, msg: '' });
    try {
      const result = await api.testKey({ ...getActiveAuthPayload(form), signal: controller.signal });
      if (testRef.current !== controller) return;
      setTestState({ loading: false, ok: result.ok, msg: result.ok ? result.message : result.error });
    } catch (err) {
      if (testRef.current === controller) setTestState({ loading: false, ok: false, msg: err.message });
    } finally { if (testRef.current === controller) testRef.current = null; }
  }

  function save(openPicker = false) {
    const error = validationError();
    if (error) { setSaveError(error); return; }
    try { onSave(form); onClose(); if (openPicker) onOpenBuiltinPicker?.(); } catch (error) { setSaveError(error.message); }
  }

  if (!isOpen) return null;
  const selected = getActiveAuthPayload(form);
  const serverPage = !window.__STANDALONE_BUILD__ && ['http:', 'https:'].includes(window.location.protocol);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-sm p-3 sm:p-5" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="ai-settings-title" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white shrink-0">
          <div className="flex items-center gap-2.5"><Sparkles className="w-5 h-5 text-amber-300" /><div><h2 id="ai-settings-title" className="text-base sm:text-lg font-extrabold">Выбор нейросети</h2><p className="text-xs text-indigo-100">Провайдер и модель для решений, диалогов и тренировок</p></div></div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Закрыть настройки ИИ" className="p-2 rounded-lg hover:bg-white/15"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <fieldset><legend className="text-sm font-bold mb-2">1. Где будет работать ИИ</legend><div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{PROVIDERS.map((provider) => <label key={provider.id} className={`cursor-pointer p-3 rounded-xl border-2 transition ${form.provider === provider.id ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/60' : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300'}`}><span className="flex gap-2 items-center"><input type="radio" name="ai-provider" value={provider.id} checked={form.provider === provider.id} onChange={() => changeForm({ provider: provider.id })} className="accent-indigo-600" /><span className="text-sm font-bold">{provider.label}</span></span><span className="block mt-1 pl-5 text-xs text-slate-500 dark:text-slate-400">{provider.note}</span></label>)}</div></fieldset>
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-4">
            {form.provider === 'builtin' && <>
              <p className="text-sm font-bold">Бесплатная модель выбирается прямо в чате</p>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">В блоке настройки ответа — Qwen, Pollinations, Google Gemma, Llama и Mistral с описаниями и цветными оценками. У публичных демо общая GPU-квота; проверка соединения тоже её расходует. Новые демо выбираются вручную, без внешней регистрации. Провайдеры с ключами остаются здесь.</p>
              <button type="button" onClick={() => save(true)} className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">Сохранить и выбрать модель в чате</button>
            </>}
            {form.provider === 'openrouter' && <>
              <div className="flex flex-wrap justify-between gap-2"><label htmlFor="openrouter-key" className="text-sm font-bold">API-ключ OpenRouter</label><a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1">Получить ключ <ExternalLink className="w-3 h-3" /></a></div>
              <input id="openrouter-key" type="password" autoComplete="off" value={form.openrouterKey || ''} onChange={(e) => changeForm({ openrouterKey: e.target.value })} placeholder="sk-or-v1-…" className={controlClass} />
              <div className="flex flex-wrap justify-between items-center gap-2"><label htmlFor="openrouter-model" className="text-sm font-bold">2. Бесплатная модель OpenRouter</label><button type="button" onClick={() => fetchModels(true)} disabled={loadingModels} className="text-xs text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 disabled:opacity-50"><RefreshCw className={`w-3 h-3 ${loadingModels ? 'animate-spin' : ''}`} />{loadingModels ? 'Загружаем…' : 'Обновить список'}</button></div>
              <select id="openrouter-model" className={controlClass} value={form.openrouterModel || 'openrouter/free'} onChange={(e) => changeForm({ openrouterModel: e.target.value })}>
                {!orModels.some((model) => model.id === form.openrouterModel) && form.openrouterModel && <option value={form.openrouterModel}>{form.openrouterModel} — сохранена, отсутствует в каталоге</option>}
                {orModels.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.vision ? 'Фото + текст' : 'Текст'}</option>)}
              </select>
              {catalogWarning && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{catalogWarning}</p>}
              <p className="text-xs text-slate-500 dark:text-slate-400">Автовыбор — только у «openrouter/free». Конкретная выбранная модель не заменяется другой при ошибке. Нулевые тарифы не отменяют лимиты аккаунта.</p>
            </>}
            {form.provider === 'gemini' && <>
              <div className="flex flex-wrap justify-between gap-2"><label htmlFor="gemini-key" className="text-sm font-bold">API-ключ Google AI Studio</label><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1">Получить ключ <ExternalLink className="w-3 h-3" /></a></div>
              <input id="gemini-key" type="password" autoComplete="off" value={form.geminiKey || ''} onChange={(e) => changeForm({ geminiKey: e.target.value })} placeholder="AIza…" className={controlClass} />
              <label htmlFor="gemini-model" className="block text-sm font-bold">2. Модель Gemini</label>
              <select id="gemini-model" className={controlClass} value={form.geminiModel || 'gemini-2.5-flash'} onChange={(e) => changeForm({ geminiModel: e.target.value })}>
                <option value="auto">Автовыбор · Flash → Flash-Lite</option>
                {form.geminiModel && form.geminiModel !== 'auto' && !geminiModels.some((model) => model.id === form.geminiModel) && <option value={form.geminiModel}>{form.geminiModel} — сохранённая модель</option>}
                {geminiModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
              <p className="text-xs text-slate-500 dark:text-slate-400">Список поставляется с приложением. Бесплатная квота зависит от модели, страны и аккаунта. При включённом биллинге провайдера возможны списания — проверьте лимиты в AI Studio.</p>
            </>}
            {form.provider === 'custom' && <>
              <label htmlFor="custom-transport" className="block text-sm font-bold">Способ подключения</label>
              <select id="custom-transport" className={controlClass} value={form.customTransport || 'direct'} onChange={(e) => changeForm({ customTransport: e.target.value })}>
                <option value="direct">Напрямую из этого браузера</option>
                <option value="server" disabled={!serverPage}>Через мой Python-сервер (Ollama)</option>
              </select>
              {form.customTransport === 'server' ? <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">Адрес задаёт владелец Python-сервера: DOMASHKA_ENABLE_OLLAMA_PROXY=1; при необходимости DOMASHKA_OLLAMA_URL. По умолчанию Ollama работает на том же компьютере на порту 11434. Адрес и ключ из полей прямого подключения не используются. Это не публичный прокси.</p> : <>
                <label htmlFor="custom-url" className="block text-sm font-bold">Адрес OpenAI-совместимого API</label><input id="custom-url" type="url" className={controlClass} value={form.customBaseUrl || ''} onChange={(e) => changeForm({ customBaseUrl: e.target.value })} placeholder="http://localhost:11434/v1" />
                <p className="text-xs text-slate-500 dark:text-slate-400">Можно указать корень Ollama, /v1 или полный /v1/chat/completions. На телефоне localhost — сам телефон, не ваш ПК.</p>
                <label htmlFor="custom-key" className="block text-sm font-bold">API-ключ (необязательно)</label><input id="custom-key" type="password" autoComplete="off" className={controlClass} value={form.customKey || ''} onChange={(e) => changeForm({ customKey: e.target.value })} />
              </>}
              <label htmlFor="custom-model" className="block text-sm font-bold">Точное имя установленной модели</label><input id="custom-model" className={controlClass} value={form.customModel || ''} onChange={(e) => changeForm({ customModel: e.target.value })} placeholder="qwen2.5:7b" />
              <label className="flex items-start gap-2 text-xs leading-relaxed"><input type="checkbox" checked={form.customVision === true} onChange={(e) => changeForm({ customVision: e.target.checked })} className="mt-0.5" /><span>Моя модель поддерживает изображения (Vision). Включайте только для мультимодальной модели: галочка не добавляет зрение текстовой модели.</span></label>
              {!serverPage && <p className="text-xs text-amber-800 dark:text-amber-300">Серверный мост недоступен в скачанном HTML / HTML Viewer / GitHub Pages. Он работает в сайте, запущенном через server.py.</p>}
              <details className="text-xs leading-relaxed text-slate-600 dark:text-slate-300"><summary className="font-bold cursor-pointer">Если Ollama пишет Failed to fetch / Load failed</summary><ul className="list-disc pl-4 mt-2 space-y-1">{customConnectionHints(form.customBaseUrl).map((hint) => <li key={hint}>{hint}</li>)}</ul></details>
            </>}
          </div>
          <p className="text-xs font-semibold break-words">Выбрано: {getModelLabel(form)}</p>
          <ModelInfoCard provider={form.provider} model={selected.model} entry={form.provider === 'openrouter' ? orModels.find((model) => model.id === selected.model) : undefined} />
          {testState.msg && <div role="status" className={`rounded-xl p-3 text-xs flex gap-2 ${testState.ok ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300'}`}>{testState.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}<span>{testState.msg}</span></div>}
          {saveError && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{saveError}</p>}
          <div className="flex gap-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"><ShieldCheck className="w-4 h-4 shrink-0" /><p>Настройки и ключи сохраняются в этом браузере. При запросе ключ передаётся выбранному провайдеру, а в серверном режиме — также серверу сайта. Задания и фото отправляются выбранному ИИ и сервисам распознавания; не загружайте личные данные.</p></div>
        </div>
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <button type="button" onClick={handleTest} disabled={testState.loading} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs sm:text-sm font-bold disabled:opacity-50 inline-flex gap-2 items-center">{testState.loading && <Loader2 className="w-4 h-4 animate-spin" />}Проверить соединение</button>
          {testState.loading && <button type="button" onClick={() => { testRef.current?.abort(); testRef.current = null; setTestState({ loading: false, ok: null, msg: 'Проверка отменена.' }); }} className="text-xs font-bold text-rose-600">Отменить проверку</button>}
          <div className="flex gap-2"><button type="button" onClick={onClose} className="px-3 py-2 text-xs sm:text-sm">Отмена</button><button type="button" onClick={() => save()} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm">Сохранить настройки</button></div>
        </div>
      </section>
    </div>
  );
}
