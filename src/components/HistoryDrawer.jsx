import React, { useEffect, useRef, useState } from 'react';
import {
  History,
  Star,
  Trash2,
  ExternalLink,
  Camera,
  Loader2,
  Download,
  Upload,
} from 'lucide-react';
import { api } from '../api';
import { SUBJECTS } from '../data/referenceData';

export default function HistoryDrawer({ onOpenItem }) {
  const [items, setItems] = useState([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const importRef = useRef(null);

  useEffect(() => {
    load();
  }, [favoritesOnly]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.getHistory(favoritesOnly);
      if (res.ok) setItems(res.items || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleFav(id) {
    const res = await api.toggleFavorite(id);
    if (res.ok) load();
  }

  async function handleDelete(id) {
    const res = await api.deleteHistory(id);
    if (res.ok) {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }
  }

  function handleExportJson() {
    const jsonStr = api.exportHistoryJson();
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Domashka_PRO_tetrad.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const total = api.importHistoryJson(String(reader.result));
        setNotice(`✅ Тетрадь успешно загружена! Всего записей: ${total}`);
        load();
        setTimeout(() => setNotice(''), 4000);
      } catch (e) {
        setNotice(`❌ Ошибка импорта: ${e.message}`);
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <History className="w-5 h-5 text-blue-600" />
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Моя тетрадь (сохраняется прямо в вашем браузере)
            </h2>
            <p className="text-xs text-slate-500">
              Все решённые задачи хранятся локально на вашем устройстве + можно выгрузить копию в файл
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFavoritesOnly(false)}
            className={`text-xs px-3 py-1.5 rounded-xl font-semibold ${
              !favoritesOnly ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            Все записи
          </button>
          <button
            type="button"
            onClick={() => setFavoritesOnly(true)}
            className={`text-xs px-3 py-1.5 rounded-xl font-semibold inline-flex items-center gap-1 ${
              favoritesOnly ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            <Star className="w-3.5 h-3.5" />
            Избранное
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            className="text-xs px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold inline-flex items-center gap-1"
            title="Сохранить все записи тетради в файл на компьютере"
          >
            <Download className="w-3.5 h-3.5 text-blue-600" />
            Экспорт .json
          </button>

          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="text-xs px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold inline-flex items-center gap-1"
            title="Загрузить записи тетради из файла"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-600" />
            Импорт
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-medium">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="py-12 flex items-center justify-center text-slate-500 text-sm gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          Загружаем записи тетради...
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
          {favoritesOnly
            ? 'В избранном пока нет записей. Отметьте важные решения звёздочкой!'
            : 'История пока пуста — решите любое задание в ИИ-Решателе, и оно сохранится здесь на вашем устройстве.'}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const subj = SUBJECTS.find((s) => s.id === item.subject);
            const dateStr = new Date(item.created_at * 1000).toLocaleString('ru-RU', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <div
                key={item.id}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm hover:border-blue-300 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`px-2 py-0.5 rounded-md font-bold ${
                        item.item_type === 'check'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {item.item_type === 'check' ? 'Проверка' : 'Решение'} · {item.grade} кл.
                    </span>
                    {subj && <span className="text-slate-600 font-medium">{subj.label}</span>}
                    {item.has_image === 1 && (
                      <span className="inline-flex items-center gap-1 text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                        <Camera className="w-3 h-3" />С фото
                      </span>
                    )}
                    <span className="text-slate-400">{dateStr}</span>
                  </div>
                  <p className="text-sm font-medium text-slate-800 line-clamp-2">
                    {item.task_text}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenItem(item)}
                    className="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold inline-flex items-center gap-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Открыть
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFav(item.id)}
                    className={`p-2 rounded-xl border transition ${
                      item.favorite
                        ? 'bg-amber-50 border-amber-300 text-amber-500'
                        : 'bg-white border-slate-200 text-slate-400 hover:text-amber-500'
                    }`}
                    title="В избранное"
                  >
                    <Star className={`w-4 h-4 ${item.favorite ? 'fill-amber-400' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="p-2 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:border-rose-200 transition"
                    title="Удалить"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
