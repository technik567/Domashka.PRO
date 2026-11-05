import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  Search,
  BookMarked,
  Target,
  Sparkles,
  Bookmark,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  X,
  PlusCircle,
  Layers,
} from 'lucide-react';
import { CHEAT_SHEETS, GRADE_STAGE_GROUPS, SUBJECTS } from '../data/referenceData';
import { copyTextSafe } from '../api';
import { safeStorage } from '../standalone/storageEngine';
import { filterCheatScope, sheetGradeLabel } from '../data/cheatCurriculum';
import MarkdownMath from './MarkdownMath';
import FlashcardsDeck, { buildFlashcardsFromSheets } from './FlashcardsDeck';

const BOOKMARKS_KEY = 'domashka_cheat_bookmarks_v21';
const PAGE_STEP = 24;

function getGradeBadgeStyle(stageId) {
  switch (stageId) {
    case '1-2':
      return 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case '3-4':
      return 'bg-teal-100 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800';
    case '5-6':
      return 'bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800';
    case '7':
      return 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    case '8':
      return 'bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 border-orange-200 dark:border-orange-800';
    case '9':
      return 'bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-300 border-violet-200 dark:border-violet-800';
    default:
      return 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800';
  }
}

/**
 * Normalizes Russian/English/LaTeX strings for reliable search:
 * - ё -> е, lowercase
 * - strips LaTeX backslash commands & markdown formatting while preserving letters, numbers & math letters
 */
function normalizeSearchText(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\\(?:text|frac|sqrt|cdot|implies|iff|le|ge|ne|pm|times|div|to|rightarrow|leftarrow|uparrow|downarrow)\b/g, ' ')
    .replace(/[*_`#$~{}[\]()|<>«»„“"']/g, ' ')
    .replace(/[—–−‐‑]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lightweight Russian/English suffix stemmer so "падежи" <-> "падеж", "треугольника" <-> "треугольник",
 * "дробей" <-> "дроб", "шепот" <-> "шёпот", "логарифмы" <-> "логарифм" all match reliably!
 */
function stemSearchToken(tok) {
  if (!tok || tok.length <= 3) return tok;
  if (/^\d+$/.test(tok)) return tok;
  const stripped = tok.replace(
    /(?:ами|ями|ого|его|ому|ему|ими|ыми|иях|иям|ией|ость|ости|ение|ание|ться|тся|ешь|ите|ают|яют|ов|ев|ей|ий|ый|ой|ая|яя|ое|ее|ые|ие|ам|ям|ах|ях|ом|ем|ую|юю|ия|ии|ью|ть|ти|ы|и|а|я|у|ю|е|о)$/u,
    ''
  );
  return stripped.length >= 3 ? stripped : tok.slice(0, Math.max(3, tok.length - 1));
}

function scoreSheetMatch(indexedItem, queryNorm, tokens) {
  if (!tokens.length) return 1;
  let totalScore = 0;
  if (indexedItem.titleNorm.includes(queryNorm)) totalScore += 60;
  if (indexedItem.tagsNorm.includes(queryNorm)) totalScore += 40;

  for (let i = 0; i < tokens.length; i += 1) {
    const rawTok = tokens[i];
    const stem = stemSearchToken(rawTok);
    const inTitle = indexedItem.titleNorm.includes(rawTok) || indexedItem.titleNorm.includes(stem);
    const inTags = indexedItem.tagsNorm.includes(rawTok) || indexedItem.tagsNorm.includes(stem);
    const inSubj = indexedItem.subjNorm.includes(rawTok) || indexedItem.subjNorm.includes(stem);
    const inBody = indexedItem.bodyNorm.includes(rawTok) || indexedItem.bodyNorm.includes(stem);

    if (!inTitle && !inTags && !inSubj && !inBody) {
      return 0; // Every query word must match somewhere in the card!
    }
    if (inTitle) totalScore += 25;
    else if (inTags) totalScore += 15;
    else if (inSubj) totalScore += 10;
    else totalScore += 5;
  }
  return totalScore;
}

const CheatSheetCard = memo(function CheatSheetCard({
  card,
  subjLabel,
  isBookmarked,
  isCollapsed,
  copied,
  onToggleCollapse,
  onToggleBookmark,
  onCopy,
  onSolveSample,
  onPracticeTopic,
  onOpenFlashcards,
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-indigo-300 dark:hover:border-indigo-800 transition overflow-hidden">
      <div className="px-3.5 sm:px-5 py-3 bg-slate-50/90 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-start sm:items-center gap-2 min-w-0 flex-1">
          <span
            className={`px-2 py-0.5 rounded-lg text-[11px] font-extrabold border shrink-0 mt-0.5 sm:mt-0 ${getGradeBadgeStyle(
              card.stageId
            )}`}
          >
            {sheetGradeLabel(card)}
          </span>
          <button
            type="button"
            onClick={() => onToggleCollapse(card.id)}
            className="text-left font-extrabold text-xs sm:text-sm text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 transition flex items-center gap-1.5 min-w-0"
          >
            <span className="leading-snug">{card.title}</span>
            {isCollapsed ? (
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            ) : (
              <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
            )}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {subjLabel && (
            <span className="px-2 py-0.5 rounded-full bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-semibold text-[11px]">
              {subjLabel}
            </span>
          )}

          {onSolveSample && card.samplePrompt && (
            <button
              type="button"
              onClick={() =>
                onSolveSample({
                  subject: card.subject,
                  text: card.samplePrompt,
                  mode: 'step_by_step',
                })
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition shadow-sm text-[11px]"
              title="Открыть учебный пример по этой теме в Решателе"
            >
              <Sparkles className="w-3 h-3" />
              Пример в ИИ
            </button>
          )}

          {onOpenFlashcards && (
            <button
              type="button"
              onClick={() => onOpenFlashcards([card], card.title)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-bold hover:bg-emerald-200 transition text-[11px]"
              title="Превратить эту шпаргалку в интерактивные карточки «Знаю / Повторить»"
            >
              <Layers className="w-3 h-3" />
              Карточки
            </button>
          )}

          {onPracticeTopic && (
            <button
              type="button"
              onClick={() => onPracticeTopic({ subject: card.subject, topic: card.title })}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-100 dark:bg-violet-950 text-violet-800 dark:text-violet-300 font-bold hover:bg-violet-200 transition text-[11px]"
            >
              <Target className="w-3 h-3" />
              Тренировать
            </button>
          )}

          <button
            type="button"
            onClick={() => onCopy(card)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 transition font-semibold text-[11px]"
            title="Скопировать шпаргалку"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-600">Скопировано</span>
              </>
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onToggleBookmark(card.id)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border transition font-semibold ${
              isBookmarked
                ? 'bg-amber-100 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-amber-600'
            }`}
            title={isBookmarked ? 'Убрать из закладок' : 'Сохранить в закладки'}
          >
            <Bookmark className={`w-3.5 h-3.5 ${isBookmarked ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-3.5 sm:p-5 overflow-x-auto">
          <MarkdownMath content={card.content} />
        </div>
      )}
    </div>
  );
});

export default function CheatSheets({ grade = 7, onPracticeTopic, onSolveSample }) {
  const [query, setQuery] = useState('');
  const [subjFilter, setSubjFilter] = useState('all');
  const [gradeFilter, setGradeFilter] = useState('my'); // strict 'all' | 'my' | 'bookmarks' | numeric grade
  const [copiedId, setCopiedId] = useState(null);
  const [collapsedIds, setCollapsedIds] = useState({});
  const [visibleLimit, setVisibleLimit] = useState(PAGE_STEP);
  const [flashcardModal, setFlashcardModal] = useState(null); // { cards, title }
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      const saved = JSON.parse(safeStorage.getItem(BOOKMARKS_KEY) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      safeStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
    } catch {
      // ignore storage quota errors
    }
  }, [bookmarks]);

  // Reset pagination whenever filters or search query change
  useEffect(() => {
    setVisibleLimit(PAGE_STEP);
  }, [query, subjFilter, gradeFilter, grade]);

  const subjLabelMap = useMemo(() => {
    const m = {};
    SUBJECTS.forEach((s) => {
      m[s.id] = s.label;
    });
    return m;
  }, []);

  // Pre-build normalized search index ONCE for all 650+ sheets!
  const indexedSheets = useMemo(() => {
    const sorted = [...CHEAT_SHEETS].sort((a, b) => {
      if (a.gradeOrder !== b.gradeOrder) return a.gradeOrder - b.gradeOrder;
      return (a.minGrade || 1) - (b.minGrade || 1);
    });
    return sorted.map((item) => ({
      ...item,
      titleNorm: normalizeSearchText(item.title),
      tagsNorm: normalizeSearchText(`${item.tags} ${item.grades}`),
      subjNorm: normalizeSearchText(subjLabelMap[item.subject] || item.subject),
      bodyNorm: normalizeSearchText(item.content),
    }));
  }, [subjLabelMap]);

  const gradeScoped = useMemo(() => filterCheatScope(indexedSheets, {
    gradeFilter, grade, bookmarks,
  }), [indexedSheets, gradeFilter, grade, bookmarks]);

  const filtered = useMemo(() => {
    const queryNorm = normalizeSearchText(query);
    const tokens = queryNorm ? queryNorm.split(' ').filter(Boolean) : [];
    const scoped = gradeScoped.filter((item) => subjFilter === 'all' || item.subject === subjFilter);
    if (!tokens.length) return scoped;
    return scoped.map((item) => ({ item, score: scoreSheetMatch(item, queryNorm, tokens) }))
      .filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.item.gradeOrder - b.item.gradeOrder)
      .map(({ item }) => item);
  }, [gradeScoped, query, subjFilter]);

  const visibleItems = useMemo(() => {
    return filtered.slice(0, visibleLimit);
  }, [filtered, visibleLimit]);

  const groupedByStage = useMemo(() => {
    if (!['all', 'bookmarks'].includes(gradeFilter)) return visibleItems.length ? [{ id: 'selected', title: `${gradeFilter === 'my' ? grade : gradeFilter} класс · выбранные материалы`, items: visibleItems, totalInStage: filtered.length }] : [];
    // Group all-grade browsing by the original study stage.
    return GRADE_STAGE_GROUPS.map((group) => ({
      ...group,
      items: visibleItems.filter((item) => item.stageId === group.id),
      totalInStage: filtered.filter((item) => item.stageId === group.id).length,
    })).filter((g) => g.items.length > 0);
  }, [visibleItems, filtered, gradeFilter, grade]);

  const availableSubjects = useMemo(() => {
    const counts = {};
    gradeScoped.forEach((c) => {
      counts[c.subject] = (counts[c.subject] || 0) + 1;
    });
    return SUBJECTS.filter((s) => counts[s.id]).map((s) => ({
      ...s,
      count: counts[s.id],
    }));
  }, [gradeScoped]);

  const toggleBookmark = React.useCallback((id) => {
    setBookmarks((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const toggleCollapse = React.useCallback((id) => {
    setCollapsedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleCopy = React.useCallback(async (card) => {
    const ok = await copyTextSafe(`${card.title} (${sheetGradeLabel(card)})\n\n${card.content}`);
    if (ok) {
      setCopiedId(card.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  const allCollapsed = visibleItems.length > 0 && visibleItems.every((c) => collapsedIds[c.id]);
  const handleToggleAll = () => {
    if (allCollapsed) {
      setCollapsedIds({});
    } else {
      const next = {};
      filtered.forEach((c) => {
        next[c.id] = true;
      });
      setCollapsedIds(next);
    }
  };

  return (
    <div className="space-y-5">
      {/* Control panel */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <BookMarked className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                  Школьная база шпаргалок · {CHEAT_SHEETS.length} карточек
                </h2>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold">
                  Строго по классам: 1 → 11
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Умный поиск понимает окончания слов, е/ё, предметы, формулы, даты и задания ВПР/ОГЭ/ЕГЭ
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full lg:w-auto">
            <div className="relative flex-1 lg:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск: падежи, Ома, Виета, 1861, Н и НН, митоз..."
                className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs sm:text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-2 p-0.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  title="Очистить поиск"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleToggleAll}
              className="text-xs px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 transition shrink-0"
              title="Свернуть или развернуть карточки для быстрого обзора"
            >
              {allCollapsed ? 'Развернуть' : 'Компактно'}
            </button>
          </div>
        </div>

        {/* Quick popular search chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-[11px]">
          <span className="text-slate-400 font-semibold shrink-0">Быстрый поиск:</span>
          {[
            'падежи',
            'корни с чередованием',
            'Н и НН',
            'дискриминант',
            'Пифагора',
            'закон Ома',
            'ОВР',
            'Present Perfect',
            '1861',
            'митоз и мейоз',
            'Python ЕГЭ',
          ].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setQuery(query === chip ? '' : chip)}
              className={`px-2 py-0.5 rounded-md border shrink-0 transition font-medium ${
                query === chip
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
              }`}
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Grade filter pills */}
        <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">
              <GraduationCap className="w-3.5 h-3.5" />
              Класс:
            </span>
            <button
              type="button"
              onClick={() => setGradeFilter('all')}
              className={`text-xs px-2.5 py-1 rounded-lg font-bold transition ${
                gradeFilter === 'all'
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Все (1→11)
            </button>
            <button
              type="button"
              onClick={() => setGradeFilter('my')}
              className={`text-xs px-2.5 py-1 rounded-lg font-bold transition ${
                gradeFilter === 'my'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100'
              }`}
            >
              🎯 Мой {grade} класс
            </button>
            {Array.from({ length: 11 }, (_, i) => ({ id: String(i + 1), label: `${i + 1} кл.` })).map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setGradeFilter(st.id)}
                className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition ${
                  gradeFilter === st.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {st.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setGradeFilter('bookmarks')}
              className={`text-xs px-2.5 py-1 rounded-lg font-bold transition inline-flex items-center gap-1 ${
                gradeFilter === 'bookmarks'
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100'
              }`}
            >
              <Bookmark className="w-3 h-3 fill-current" />
              Закладки ({bookmarks.length})
            </button>

            {filtered.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setFlashcardModal({
                    cards: buildFlashcardsFromSheets(filtered.slice(0, 12), 20),
                    title: query.trim()
                      ? `Карточки: «${query.trim()}»`
                      : `Умные карточки (${gradeFilter === 'my' ? `${grade} кл.` : 'подборка ФГОС'})`,
                  })
                }
                className="ml-auto text-xs px-3 py-1 rounded-lg font-extrabold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-sm inline-flex items-center gap-1.5 transition"
                title="Учить текущую подборку шпаргалок по карточкам «Знаю / Повторить» за 5 минут"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Учить по карточкам (5 мин)</span>
              </button>
            )}
          </div>

          {/* Subject filter pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">
              Предмет:
            </span>
            <button
              type="button"
              onClick={() => setSubjFilter('all')}
              className={`text-xs px-2.5 py-1 rounded-lg font-bold transition ${
                subjFilter === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Все предметы ({gradeScoped.length})
            </button>
            {availableSubjects.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSubjFilter(s.id)}
                className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition ${
                  subjFilter === s.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {s.label} <span className="opacity-75">({s.count})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Search summary strip */}
        {(query.trim() || subjFilter !== 'all' || gradeFilter !== 'all') && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div className="text-slate-600 dark:text-slate-300">
              Найдено шпаргалок: <b className="text-indigo-600 dark:text-indigo-400">{filtered.length}</b>

            </div>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSubjFilter('all');
                setGradeFilter('my');
              }}
              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Сбросить фильтры
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500 px-1">В «Мой класс» попадают только карточки, в диапазон которых входит выбранный класс. Общие темы отмечены диапазоном классов. Поиск сам не отключает фильтры.</p>
      {!filtered.length && query.trim() && (gradeFilter !== 'all' || subjFilter !== 'all') && <button type="button" onClick={() => { setGradeFilter('all'); setSubjFilter('all'); }} className="rounded-xl border border-indigo-300 dark:border-indigo-700 px-4 py-2 text-sm font-bold text-indigo-600 dark:text-indigo-300">Искать по всем классам и предметам</button>}

      {/* Grouped cheat sheets ordered 1 -> 11 */}
      <div className="space-y-6">
        {groupedByStage.map((group) => (
          <section key={group.id} className="space-y-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <h3 className="text-sm sm:text-base font-extrabold text-slate-800 dark:text-slate-100">
                {group.title}
              </h3>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                {group.totalInStage} шт.
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3.5">
              {group.items.map((card) => (
                <CheatSheetCard
                  key={card.id}
                  card={card}
                  subjLabel={subjLabelMap[card.subject]}
                  isBookmarked={bookmarks.includes(card.id)}
                  isCollapsed={!!collapsedIds[card.id] && !query.trim()}
                  copied={copiedId === card.id}
                  onToggleCollapse={toggleCollapse}
                  onToggleBookmark={toggleBookmark}
                  onCopy={handleCopy}
                  onSolveSample={onSolveSample}
                  onPracticeTopic={onPracticeTopic}
                  onOpenFlashcards={(sheets, title) =>
                    setFlashcardModal({
                      cards: buildFlashcardsFromSheets(sheets, 16),
                      title: `Карточки: ${title}`,
                    })
                  }
                />
              ))}
            </div>
          </section>
        ))}

        {/* Progressive Load More Button */}
        {visibleLimit < filtered.length && (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setVisibleLimit((prev) => prev + 36)}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-extrabold shadow-md shadow-indigo-600/15 inline-flex items-center justify-center gap-2 transition"
            >
              <PlusCircle className="w-4 h-4" />
              Показать ещё ({Math.min(36, filtered.length - visibleLimit)} из оставшихся {filtered.length - visibleLimit})
            </button>
            <button
              type="button"
              onClick={() => setVisibleLimit(filtered.length)}
              className="w-full sm:w-auto px-4 py-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              Показать все ({filtered.length})
            </button>
          </div>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-12 px-4 text-slate-500 dark:text-slate-400 text-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
            <div>
              {gradeFilter === 'bookmarks'
                ? 'У вас пока нет сохранённых закладок. Нажмите на значок закладки в правом верхнем углу любой шпаргалки!'
                : `Ничего не найдено по запросу «${query}». Попробуйте ввести одно ключевое слово (например: «Ома», «причастие», «дроби»).`}
            </div>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSubjFilter('all');
                setGradeFilter('my');
              }}
              className="text-xs px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition"
            >
              Показать все {CHEAT_SHEETS.length} шпаргалок (1→11 класс)
            </button>
          </div>
        )}
      </div>
      {flashcardModal && (
        <FlashcardsDeck
          cards={flashcardModal.cards}
          deckTitle={flashcardModal.title}
          onClose={() => setFlashcardModal(null)}
        />
      )}
    </div>
  );
}
