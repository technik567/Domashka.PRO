import React, { useMemo, useState } from 'react';
import {
  Calculator,
  FlaskConical,
  Gauge,
  Binary,
  Divide,
  Hash,
  SpellCheck,
  Play,
  Loader2,
  AlertCircle,
  ArrowRight,
  LineChart,
  Triangle,
  Zap,
} from 'lucide-react';
import { api } from '../api';
import { PERIODIC_ELEMENTS, SOLUBILITY_DATA } from '../data/referenceData';
import MarkdownMath from './MarkdownMath';
import FormulaIsolatorCard from './FormulaIsolatorCard';

const TOOLS = [
  {
    id: 'algebra',
    label: 'Уравнения и Алгебра',
    sub: 'Квадратные (D + Виета), системы, производные',
    icon: Calculator,
    placeholder: 'Например: x^2 - 7x + 10 = 0  или  2x + y = 7; x - y = 2',
    samples: [
      { label: 'Квадратное (D + Виета)', val: 'x^2 - 7x + 10 = 0', action: 'solve' },
      { label: 'Система уравнений', val: '2x + y = 11; 3x - y = 4', action: 'solve' },
      { label: 'Найти производную', val: 'x^3 - 6*x^2 + 9*x', action: 'diff' },
      { label: 'Разложить на множители', val: 'x^3 - 8', action: 'factor' },
    ],
  },
  {
    id: 'graph',
    label: 'График функции y = f(x)',
    sub: 'Построение параболы, прямой, гиперболы + таблица точек',
    icon: LineChart,
    placeholder: 'Например: x^2 - 4*x + 3  (можно две через ; например: x^2 - 4; x + 2)',
    samples: [
      { label: 'Парабола x² - 4x + 3', val: 'x^2 - 4*x + 3' },
      { label: 'Пересечение: x² - 4 и x + 2', val: 'x^2 - 4; x + 2' },
      { label: 'Гипербола 4/x', val: '4 / x' },
      { label: 'Тригонометрия 3*sin(x)', val: '3 * sin(x)' },
    ],
  },
  {
    id: 'geometry',
    label: 'Геометрия + Чертёж (7–11 кл.)',
    sub: 'Пифагор, Герон, трапеция, r и R + наглядный чертёж',
    icon: Triangle,
    placeholder: 'Например: a=6, b=8 (катеты) или a=13, b=14, c=15 или трапеция a=10, b=22, h=8',
    samples: [
      { label: 'Катеты a=6, b=8', val: 'a=6, b=8' },
      { label: 'Катет и гипотенуза a=5, c=13', val: 'a=5, c=13' },
      { label: 'По 3 сторонам a=13, b=14, c=15', val: 'a=13, b=14, c=15' },
      { label: 'Трапеция a=10, b=22, h=8', val: 'a=10, b=22, h=8' },
    ],
  },
  {
    id: 'fractions',
    label: 'Обыкновенные дроби',
    sub: '5–6 класс: смешанные числа, НОЗ по шагам',
    icon: Divide,
    placeholder: 'Например: 2 1/3 + 1 3/4  или  5/6 : 15/16',
    samples: [
      { label: '2 1/3 + 1 3/4', val: '2 1/3 + 1 3/4' },
      { label: '4 1/2 - 2 5/6', val: '4 1/2 - 2 5/6' },
      { label: '5/6 : 15/16', val: '5/6 : 15/16' },
    ],
  },
  {
    id: 'gcd_lcm',
    label: 'НОД и НОК чисел',
    sub: '5–6 класс: разложение на простые множители',
    icon: Hash,
    placeholder: 'Введите числа через запятую, например: 36, 48',
    samples: [
      { label: '36 и 48', val: '36, 48' },
      { label: '24, 60 и 84', val: '24, 60, 84' },
      { label: '144 и 180', val: '144, 180' },
    ],
  },
  {
    id: 'chemistry',
    label: 'Химия: реакции и масса M',
    sub: 'Уравнивание коэффициентов + молярная масса',
    icon: FlaskConical,
    placeholder: 'Например: Al + H2SO4 = Al2(SO4)3 + H2  или  CuCl2',
    samples: [
      { label: 'Al + H2SO4 = Al2(SO4)3 + H2', val: 'Al + H2SO4 = Al2(SO4)3 + H2' },
      { label: 'ОВР: KMnO4 + HCl = ...', val: 'KMnO4 + HCl = KCl + MnCl2 + Cl2 + H2O' },
      { label: 'Молярная масса Al2(SO4)3', val: 'Al2(SO4)3' },
    ],
  },
  {
    id: 'formula_isolator',
    label: 'Выражатель формул (Дано → Ответ)',
    sub: 'Физика и Химия: вывод любой буквы + расчёт в СИ',
    icon: Zap,
    placeholder: '',
    samples: [],
  },
  {
    id: 'physics_si',
    label: 'Физика: перевод в СИ',
    sub: 'Готовая колонка «Дано | СИ» с правилами',
    icon: Gauge,
    placeholder: 'v = 72 км/ч; m = 250 г; S = 15 см2; t = 10 мин',
    samples: [
      { label: 'Механика (км/ч, г, см²)', val: 'v = 72 км/ч; m = 250 г; S = 15 см2; t = 10 мин' },
      { label: 'Теплота и давление (кПа, °C, кДж)', val: 'p = 250 кПа; t = 27 °C; Q = 4.2 кДж; V = 5 л' },
    ],
  },
  {
    id: 'bases',
    label: 'Системы счисления',
    sub: 'Информатика ОГЭ/ЕГЭ: деление столбиком',
    icon: Binary,
    placeholder: 'Например: 157',
    samples: [
      { label: '157 (из 10 в 2)', val: '157', fromBase: 10, toBase: 2 },
      { label: '1011011 (из 2 в 10)', val: '1011011', fromBase: 2, toBase: 10 },
      { label: '2F4 (из 16 в 8)', val: '2F4', fromBase: 16, toBase: 8 },
    ],
  },
  {
    id: 'truth_table',
    label: 'Таблицы истинности',
    sub: 'Информатика ОГЭ / ЕГЭ №2: логические выражения',
    icon: Binary,
    placeholder: 'Например: ¬A ∧ (B → C)  или  (x -> y) and (y == z)',
    samples: [
      { label: '¬A ∧ (B → C)', val: '¬A ∧ (B → C)' },
      { label: 'ЕГЭ №2: (x → y) ∧ (¬y ≡ z)', val: '(x -> y) /\\ (not y == z)' },
    ],
  },
  {
    id: 'russian_parse',
    label: 'Русский: разборы 1, 2, 3, 4',
    sub: 'Фонетический, по составу, морфологический, синтаксис',
    icon: SpellCheck,
    placeholder: 'Введите слово или предложение для школьного разбора...',
    samples: [],
  },
];

function compileMathFn(rawExpr) {
  let s = (rawExpr || '')
    .replace(/^y\s*=\s*/i, '')
    .replace(/^f\s*\(\s*x\s*\)\s*=\s*/i, '')
    .replace(/,/g, '.')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\^/g, '**')
    .replace(/(\d)\s*([xX(])/g, '$1*$2')
    .replace(/\b(sin|cos|tan|sqrt|abs|log|exp)\b/gi, (m) => `Math.${m.toLowerCase()}`)
    .replace(/\bpi\b|π/gi, 'Math.PI');

  if (!/^[0-9xX+\-*/().\sMathPIEincosqrtablgxp]+$/.test(s)) {
    throw new Error('Недопустимые символы в формуле функции.');
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function('x', `"use strict"; return (${s.replace(/X/g, 'x')});`);
  // test call
  fn(1);
  return fn;
}

function FunctionPlotCard({ exprInput }) {
  const data = useMemo(() => {
    const parts = (exprInput || '')
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 2);
    if (!parts.length) return { error: 'Введите формулу, например x^2 - 4*x + 3' };

    try {
      const fns = parts.map((p, idx) => ({
        label: `y${parts.length > 1 ? idx + 1 : ''} = ${p.replace(/^y\s*=\s*/i, '')}`,
        fn: compileMathFn(p),
        color: idx === 0 ? '#2563eb' : '#e11d48',
      }));

      const xMin = -8,
        xMax = 8,
        yMin = -8,
        yMax = 8;
      const W = 520,
        H = 520;
      const toSvgX = (x) => ((x - xMin) / (xMax - xMin)) * W;
      const toSvgY = (y) => H - ((y - yMin) / (yMax - yMin)) * H;

      const paths = fns.map((fObj) => {
        let d = '';
        let penDown = false;
        for (let x = xMin; x <= xMax; x += 0.05) {
          let y;
          try {
            y = fObj.fn(x);
          } catch {
            y = NaN;
          }
          if (!Number.isFinite(y) || Math.abs(y) > 40) {
            penDown = false;
            continue;
          }
          const sx = toSvgX(x).toFixed(1);
          const sy = toSvgY(y).toFixed(1);
          d += `${penDown ? 'L' : 'M'}${sx},${sy} `;
          penDown = true;
        }
        return { ...fObj, d };
      });

      const tableX = [-3, -2, -1, 0, 1, 2, 3];
      const tableRows = tableX.map((x) => ({
        x,
        vals: fns.map((f) => {
          const v = f.fn(x);
          return Number.isFinite(v) ? Number(v.toFixed(2)) : '—';
        }),
      }));

      return { paths, tableRows, xMin, xMax, yMin, yMax, W, H, toSvgX, toSvgY };
    } catch (e) {
      return { error: e.message || 'Проверьте запись формулы функции.' };
    }
  }, [exprInput]);

  if (data.error) {
    return (
      <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
        {data.error}
      </div>
    );
  }

  const ticks = [-6, -4, -2, 2, 4, 6];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-5 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-extrabold text-slate-800 dark:text-white">
          📈 Координатная плоскость Oxy (масштаб 1 ед.)
        </span>
        <div className="flex items-center gap-3">
          {data.paths.map((p, idx) => (
            <span key={idx} className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-slate-700 dark:text-slate-200">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
              {p.label}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
        <div className="md:col-span-7 bg-slate-50 dark:bg-slate-950 rounded-xl p-2 border border-slate-200 dark:border-slate-800">
          <svg viewBox={`0 0 ${data.W} ${data.H}`} className="w-full h-auto">
            {Array.from({ length: 17 }, (_, i) => i - 8).map((v) => (
              <g key={v}>
                <line
                  x1={data.toSvgX(v)}
                  y1={0}
                  x2={data.toSvgX(v)}
                  y2={data.H}
                  stroke="rgba(148,163,184,0.22)"
                  strokeWidth="1"
                />
                <line
                  x1={0}
                  y1={data.toSvgY(v)}
                  x2={data.W}
                  y2={data.toSvgY(v)}
                  stroke="rgba(148,163,184,0.22)"
                  strokeWidth="1"
                />
              </g>
            ))}

            {/* Axes */}
            <line x1={0} y1={data.toSvgY(0)} x2={data.W} y2={data.toSvgY(0)} stroke="#64748b" strokeWidth="2" />
            <line x1={data.toSvgX(0)} y1={0} x2={data.toSvgX(0)} y2={data.H} stroke="#64748b" strokeWidth="2" />

            {ticks.map((t) => (
              <g key={t} fontSize="11" fill="#64748b" fontFamily="monospace">
                <text x={data.toSvgX(t) - 6} y={data.toSvgY(0) + 15}>{t}</text>
                <text x={data.toSvgX(0) + 6} y={data.toSvgY(t) + 4}>{t}</text>
              </g>
            ))}

            {data.paths.map((p, idx) => (
              <path key={idx} d={p.d} fill="none" stroke={p.color} strokeWidth="3" strokeLinecap="round" />
            ))}
          </svg>
        </div>

        {/* Table of values for school notebook */}
        <div className="md:col-span-5 space-y-2">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
            📓 Таблица точек для построения в тетради:
          </div>
          <table className="w-full text-xs border-collapse rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100">
                <th className="p-2 border border-slate-200 dark:border-slate-700 font-mono">x</th>
                {data.paths.map((p, idx) => (
                  <th key={idx} className="p-2 border border-slate-200 dark:border-slate-700 font-mono">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.tableRows.map((row) => (
                <tr key={row.x} className="text-center font-mono text-slate-700 dark:text-slate-200">
                  <td className="p-1.5 border border-slate-200 dark:border-slate-800 font-bold">{row.x}</td>
                  {row.vals.map((v, idx) => (
                    <td key={idx} className="p-1.5 border border-slate-200 dark:border-slate-800">{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ChemistryReferenceCard({ onInsertElement }) {
  const [chemTab, setChemTab] = useState('periodic'); // 'periodic' | 'solubility'
  const [selectedEl, setSelectedEl] = useState(PERIODIC_ELEMENTS[0]);

  const groupStyle = (g) => {
    switch (g) {
      case 'alkali':
        return 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200';
      case 'alkaline':
        return 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200';
      case 'nonmetal':
        return 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200';
      case 'halogen':
        return 'bg-teal-50 dark:bg-teal-950/50 border-teal-200 dark:border-teal-800 text-teal-900 dark:text-teal-200';
      case 'noble':
        return 'bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-200';
      default:
        return 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200';
    }
  };

  const solCellStyle = (v) => {
    if (v === 'Р') return 'bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-extrabold';
    if (v === 'М') return 'bg-amber-50/80 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-extrabold';
    if (v === 'Н') return 'bg-rose-50/80 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-extrabold';
    return 'bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold';
  };

  const neutrons = Math.max(0, Math.round(selectedEl.ar) - selectedEl.z);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-extrabold text-slate-900 dark:text-white">
            🧪 Школьный справочник химика (ОГЭ / ЕГЭ)
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Интерактивные элементы ФГОС (протоны, нейтроны, степени окисления) и таблица растворимости
          </p>
        </div>
        <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-bold">
          <button
            type="button"
            onClick={() => setChemTab('periodic')}
            className={`px-3 py-1.5 rounded-lg transition ${
              chemTab === 'periodic'
                ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            ⚛️ Элементы
          </button>
          <button
            type="button"
            onClick={() => setChemTab('solubility')}
            className={`px-3 py-1.5 rounded-lg transition ${
              chemTab === 'solubility'
                ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            💧 Растворимость
          </button>
        </div>
      </div>

      {chemTab === 'periodic' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-5 sm:grid-cols-9 gap-1.5">
            {PERIODIC_ELEMENTS.map((el) => {
              const isSel = selectedEl?.z === el.z;
              return (
                <button
                  key={el.z}
                  type="button"
                  onClick={() => setSelectedEl(el)}
                  className={`p-2 rounded-xl border text-left transition ${groupStyle(el.group)} ${
                    isSel ? 'ring-2 ring-indigo-600 scale-[1.03] shadow-sm' : 'hover:opacity-90'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] opacity-75 font-mono">
                    <span>{el.z}</span>
                    <span>{el.ar}</span>
                  </div>
                  <div className="text-sm font-black leading-tight mt-0.5">{el.sym}</div>
                  <div className="text-[9px] truncate opacity-85">{el.name}</div>
                </button>
              );
            })}
          </div>

          {selectedEl && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                  {selectedEl.sym} — {selectedEl.name} (№ {selectedEl.z}, Ar ≈ {selectedEl.ar})
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap gap-x-4 gap-y-1">
                  <span>Протонов p⁺: <b>{selectedEl.z}</b></span>
                  <span>Электронов e⁻: <b>{selectedEl.z}</b></span>
                  <span>Нейтронов n⁰: <b>{neutrons}</b></span>
                  <span>Степени окисления: <b>{selectedEl.ox}</b></span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onInsertElement?.(selectedEl.sym)}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shrink-0 transition"
              >
                + Вставить {selectedEl.sym} в расчёт
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-[11px] border-collapse text-center">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                  <th className="p-1.5 border border-slate-200 dark:border-slate-700 font-extrabold">Ионы</th>
                  {SOLUBILITY_DATA.cations.map((c) => (
                    <th key={c} className="p-1.5 border border-slate-200 dark:border-slate-700 font-mono font-bold">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SOLUBILITY_DATA.rows.map((r) => (
                  <tr key={r.anion}>
                    <td className="p-1.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 font-mono font-bold text-slate-800 dark:text-slate-200">
                      {r.anion}
                    </td>
                    {r.vals.map((v, idx) => (
                      <td
                        key={idx}
                        className={`p-1.5 border border-slate-200 dark:border-slate-700 ${solCellStyle(v)}`}
                        title={`${SOLUBILITY_DATA.cations[idx]} + ${r.anion}: ${
                          v === 'Р' ? 'Растворимо' : v === 'М' ? 'Малорастворимо' : v === 'Н' ? 'Нерастворимо (осадок ↓)' : 'Разлагается водой / не существует'
                        }`}
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-slate-600 dark:text-slate-400">
            <span><b className="text-emerald-600">Р</b> — растворимо</span>
            <span><b className="text-amber-600">М</b> — малорастворимо</span>
            <span><b className="text-rose-600">Н</b> — нерастворимо (осадок ↓)</span>
            <span><b>—</b> — разлагается водой</span>
          </div>
        </div>
      )}
    </div>
  );
}

function GeometryVisualCard({ exprInput }) {
  const geom = useMemo(() => {
    const kv = {};
    const matches = (exprInput || '').replace(/,/g, ';').split(';');
    for (const part of matches) {
      const m = part.trim().match(/^([abchr])\s*=\s*([0-9]+(?:\.[0-9]+)?)$/i);
      if (m) kv[m[1].toLowerCase()] = Number(m[2]);
    }
    const fmt = (n) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(2)).toString());

    // Case 1: Trapezoid (a, b, h)
    if (kv.a > 0 && kv.b > 0 && kv.h > 0 && !kv.c) {
      const { a, b, h } = kv;
      const m = (a + b) / 2;
      const S = m * h;
      const leg = Math.hypot(Math.abs(b - a) / 2, h);
      const P = a + b + 2 * leg;
      const md = `### Трапеция с основаниями $a = ${a}$, $b = ${b}$ и высотой $h = ${h}$
- **Средняя линия:** $m = \\frac{a + b}{2} = \\frac{${a} + ${b}}{2} = \\mathbf{${fmt(m)}}$
- **Площадь трапеции:** $S = \\frac{a + b}{2} \\cdot h = ${fmt(m)} \\cdot ${h} = \\mathbf{${fmt(S)}}$
- **Для равнобедренной трапеции:** боковая сторона $c = \\sqrt{\\left(\\frac{|b-a|}{2}\\right)^2 + h^2} = \\mathbf{${fmt(leg)}}$, периметр $P = \\mathbf{${fmt(P)}}$.`;
      return { type: 'trapezoid', a, b, h, m, S, md };
    }

    // Case 2: Triangle by 3 sides (a, b, c)
    if (kv.a > 0 && kv.b > 0 && kv.c > 0) {
      const { a, b, c } = kv;
      if (a + b <= c || a + c <= b || b + c <= a) {
        return { error: `Треугольник со сторонами ${a}, ${b}, ${c} не существует (нарушено неравенство треугольника: сумма двух сторон должна быть строго больше третьей).` };
      }
      const P = a + b + c;
      const p = P / 2;
      const S = Math.sqrt(p * (p - a) * (p - b) * (p - c));
      const r = S / p;
      const R = (a * b * c) / (4 * S);
      const angA = (Math.acos((b * b + c * c - a * a) / (2 * b * c)) * 180) / Math.PI;
      const angB = (Math.acos((a * a + c * c - b * b) / (2 * a * c)) * 180) / Math.PI;
      const angC = 180 - angA - angB;
      const md = `### Треугольник со сторонами $a = ${a}$, $b = ${b}$, $c = ${c}$
- **Периметр и полупериметр:** $P = ${fmt(P)}, \\quad p = \\frac{P}{2} = ${fmt(p)}$
- **Площадь по формуле Герона:** $S = \\sqrt{p(p-a)(p-b)(p-c)} = \\mathbf{${fmt(S)}}$
- **Радиусы окружностей:** вписанной $r = \\frac{S}{p} = \\mathbf{${fmt(r)}}$, описанной $R = \\frac{abc}{4S} = \\mathbf{${fmt(R)}}$
- **Углы (теорема косинусов):** $\\alpha \\approx ${fmt(angA)}^\\circ, \\; \\beta \\approx ${fmt(angB)}^\\circ, \\; \\gamma \\approx ${fmt(angC)}^\\circ$.`;
      return { type: 'tri3', a, b, c, S, md };
    }

    // Case 3: Right triangle (2 of a, b, c)
    if ((kv.a > 0 && kv.b > 0) || (kv.a > 0 && kv.c > 0) || (kv.b > 0 && kv.c > 0)) {
      let a = kv.a, b = kv.b, c = kv.c;
      let stepLine = '';
      if (a > 0 && b > 0) {
        c = Math.hypot(a, b);
        stepLine = `Гипотенуза по теореме Пифагора: $c = \\sqrt{a^2 + b^2} = \\sqrt{${a}^2 + ${b}^2} = \\sqrt{${fmt(a*a + b*b)}} = \\mathbf{${fmt(c)}}$`;
      } else if (a > 0 && c > 0) {
        if (c <= a) return { error: 'Гипотенуза c должна быть строго больше катета a!' };
        b = Math.sqrt(c * c - a * a);
        stepLine = `Второй катет по теореме Пифагора: $b = \\sqrt{c^2 - a^2} = \\sqrt{${c}^2 - ${a}^2} = \\mathbf{${fmt(b)}}$`;
      } else {
        if (c <= b) return { error: 'Гипотенуза c должна быть строго больше катета b!' };
        a = Math.sqrt(c * c - b * b);
        stepLine = `Первый катет по теореме Пифагора: $a = \\sqrt{c^2 - b^2} = \\sqrt{${c}^2 - ${b}^2} = \\mathbf{${fmt(a)}}$`;
      }
      const S = (a * b) / 2;
      const P = a + b + c;
      const hc = (a * b) / c;
      const r = (a + b - c) / 2;
      const R = c / 2;
      const md = `### Прямоугольный треугольник ($\\angle C = 90^\\circ$)
- ${stepLine}
- **Площадь:** $S = \\frac{1}{2} a \\cdot b = \\frac{1}{2} \\cdot ${fmt(a)} \\cdot ${fmt(b)} = \\mathbf{${fmt(S)}}$, периметр $P = \\mathbf{${fmt(P)}}$
- **Высота к гипотенузе:** $h_c = \\frac{ab}{c} = \\mathbf{${fmt(hc)}}$
- **Радиусы:** описанной $R = \\frac{c}{2} = \\mathbf{${fmt(R)}}$, вписанной $r = \\frac{a + b - c}{2} = \\mathbf{${fmt(r)}}$.`;
      return { type: 'right', a, b, c, fmt, md };
    }

    return { error: 'Укажите параметры через запятую, например: a=6, b=8 (катеты) или a=13, b=14, c=15 (3 стороны) или a=10, b=22, h=8 (трапеция).' };
  }, [exprInput]);

  if (geom.error) {
    return (
      <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
        {geom.error}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm grid grid-cols-1 md:grid-cols-12 gap-5 items-center animate-fade-up">
      <div className="md:col-span-5 bg-slate-50 dark:bg-slate-950 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 flex items-center justify-center">
        <svg viewBox="0 0 260 200" className="w-full max-w-[260px] h-auto">
          {geom.type === 'right' && (
            <g>
              <polygon points="45,165 215,165 45,35" fill="rgba(79,70,229,0.10)" stroke="#4f46e5" strokeWidth="3" strokeLinejoin="round" />
              <polyline points="45,147 63,147 63,165" fill="none" stroke="#4f46e5" strokeWidth="2" />
              <text x="125" y="185" fontSize="12" fontWeight="bold" fill="#4f46e5" textAnchor="middle">b = {Number(geom.b.toFixed(2))}</text>
              <text x="22" y="105" fontSize="12" fontWeight="bold" fill="#4f46e5" textAnchor="middle">a = {Number(geom.a.toFixed(2))}</text>
              <text x="142" y="92" fontSize="12" fontWeight="bold" fill="#e11d48" textAnchor="middle">c = {Number(geom.c.toFixed(2))}</text>
            </g>
          )}
          {geom.type === 'tri3' && (
            <g>
              <polygon points="35,165 225,165 115,35" fill="rgba(16,185,129,0.12)" stroke="#059669" strokeWidth="3" strokeLinejoin="round" />
              <text x="130" y="185" fontSize="12" fontWeight="bold" fill="#059669" textAnchor="middle">c = {geom.c}</text>
              <text x="62" y="95" fontSize="12" fontWeight="bold" fill="#059669" textAnchor="middle">b = {geom.b}</text>
              <text x="182" y="95" fontSize="12" fontWeight="bold" fill="#059669" textAnchor="middle">a = {geom.a}</text>
            </g>
          )}
          {geom.type === 'trapezoid' && (
            <g>
              <polygon points="75,45 185,45 225,160 35,160" fill="rgba(245,158,11,0.12)" stroke="#d97706" strokeWidth="3" strokeLinejoin="round" />
              <line x1="75" y1="45" x2="75" y2="160" stroke="#64748b" strokeWidth="2" strokeDasharray="4 4" />
              <line x1="55" y1="102.5" x2="205" y2="102.5" stroke="#4f46e5" strokeWidth="2" strokeDasharray="5 3" />
              <text x="130" y="36" fontSize="12" fontWeight="bold" fill="#d97706" textAnchor="middle">a = {geom.a}</text>
              <text x="130" y="180" fontSize="12" fontWeight="bold" fill="#d97706" textAnchor="middle">b = {geom.b}</text>
              <text x="93" y="118" fontSize="11" fontWeight="bold" fill="#64748b">h={geom.h}</text>
              <text x="155" y="96" fontSize="11" fontWeight="bold" fill="#4f46e5">m={Number(geom.m.toFixed(2))}</text>
            </g>
          )}
        </svg>
      </div>
      <div className="md:col-span-7">
        <MarkdownMath content={geom.md} />
      </div>
    </div>
  );
}

export default function ExactTools({ onSendToAiSolver }) {
  const [activeTool, setActiveTool] = useState('algebra');
  const [inputVal, setInputVal] = useState('x^2 - 7x + 10 = 0');
  const [algAction, setAlgAction] = useState('auto');
  const [fromBase, setFromBase] = useState(10);
  const [toBase, setToBase] = useState(2);
  const [rusParseType, setRusParseType] = useState('1');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultMd, setResultMd] = useState('');

  const currentMeta = TOOLS.find((t) => t.id === activeTool) || TOOLS[0];

  function selectTool(t) {
    setActiveTool(t.id);
    setError('');
    setResultMd('');
    if (t.samples && t.samples[0]) {
      setInputVal(t.samples[0].val);
      if (t.samples[0].fromBase) setFromBase(t.samples[0].fromBase);
      if (t.samples[0].toBase) setToBase(t.samples[0].toBase);
    } else {
      setInputVal('');
    }
  }

  async function handleRun(e) {
    e?.preventDefault();
    if (activeTool === 'graph' || activeTool === 'geometry') return;

    if (activeTool === 'russian_parse') {
      if (!inputVal.trim()) {
        setError('Введите слово или предложение для разбора.');
        return;
      }
      const typeNames = {
        '1': 'полный фонетический (звуко-буквенный) разбор (цифра 1) с транскрипцией и подсчётом букв и звуков',
        '2': 'морфемный разбор по составу (цифра 2: окончание, основа, корень + однокоренные слова, приставка, суффикс)',
        '3': 'полный морфологический разбор (цифра 3) строго по школьной схеме I, II, III',
        '4': 'полный синтаксический разбор предложения (цифра 4) с членами предложения, характеристикой в скобках и схемой',
      };
      onSendToAiSolver?.({
        subject: 'russian',
        mode: 'notebook',
        text: `Выполни ${typeNames[rusParseType]} для: «${inputVal.trim()}» строго по школьному стандарту ФГОС.`,
      });
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await api.runExactTool({
        tool: activeTool,
        input: inputVal,
        action: algAction,
        fromBase,
        toBase,
      });
      if (!res.ok) {
        setError(res.error || 'Проверьте формат ввода.');
        setResultMd('');
      } else {
        setResultMd(res.markdown);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left Tool Selector */}
      <div className="lg:col-span-4 space-y-2">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const isAct = activeTool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTool(t)}
              className={`w-full text-left p-3.5 rounded-xl border transition flex items-start gap-3 ${
                isAct
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-800 hover:border-indigo-400'
              }`}
            >
              <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${isAct ? 'text-amber-300' : 'text-indigo-600 dark:text-indigo-400'}`} />
              <div>
                <div className="font-extrabold text-sm leading-tight">{t.label}</div>
                <div className={`text-xs mt-0.5 ${isAct ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'}`}>
                  {t.sub}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Right Active Calculator */}
      <div className="lg:col-span-8 space-y-5">
        <form
          onSubmit={handleRun}
          className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4"
        >
          <div>
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">{currentMeta.label}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Мгновенный точный расчёт по шагам (работает даже полностью без интернета!)
            </p>
          </div>

          {currentMeta.samples.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {currentMeta.samples.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setInputVal(s.val);
                    if (s.action) setAlgAction(s.action);
                    if (s.fromBase) setFromBase(s.fromBase);
                    if (s.toBase) setToBase(s.toBase);
                  }}
                  className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-700 dark:hover:text-indigo-300 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold transition"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {activeTool === 'algebra' && (
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'auto', label: 'Авто (решить / упростить)' },
                { id: 'factor', label: 'Разложить на множители' },
                { id: 'diff', label: 'Производная f′(x)' },
                { id: 'integrate', label: 'Первообразная ∫f(x)dx' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAlgAction(opt.id)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-semibold ${
                    algAction === opt.id
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-600 text-indigo-800 dark:text-indigo-300'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {activeTool === 'bases' && (
            <div className="grid grid-cols-2 gap-3 max-w-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Из системы (основание):
                </label>
                <input
                  type="number"
                  min={2}
                  max={36}
                  value={fromBase}
                  onChange={(e) => setFromBase(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  В систему (основание):
                </label>
                <input
                  type="number"
                  min={2}
                  max={36}
                  value={toBase}
                  onChange={(e) => setToBase(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                />
              </div>
            </div>
          )}

          {activeTool === 'russian_parse' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { id: '1', label: '1 — Фонетический (звуко-буквенный)' },
                { id: '2', label: '2 — Морфемный (по составу слова)' },
                { id: '3', label: '3 — Морфологический (часть речи)' },
                { id: '4', label: '4 — Синтаксический (предложение)' },
              ].map((rt) => (
                <button
                  key={rt.id}
                  type="button"
                  onClick={() => setRusParseType(rt.id)}
                  className={`text-left text-xs p-2.5 rounded-xl border font-semibold ${
                    rusParseType === rt.id
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-600 text-indigo-800 dark:text-indigo-300'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {rt.label}
                </button>
              ))}
            </div>
          )}

          {activeTool !== 'formula_isolator' && (
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder={currentMeta.placeholder}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              {activeTool !== 'graph' && activeTool !== 'geometry' && (
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-extrabold inline-flex items-center justify-center gap-2 shrink-0 transition"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : activeTool === 'russian_parse' ? (
                    <ArrowRight className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  {activeTool === 'russian_parse' ? 'Сделать разбор с ИИ' : 'Рассчитать по шагам'}
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </form>

        {activeTool === 'formula_isolator' && <FormulaIsolatorCard />}

        {activeTool === 'graph' && <FunctionPlotCard exprInput={inputVal} />}

        {activeTool === 'geometry' && <GeometryVisualCard exprInput={inputVal} />}

        {resultMd && activeTool !== 'graph' && activeTool !== 'geometry' && activeTool !== 'formula_isolator' && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden animate-fade-up">
            <div className="px-4 sm:px-5 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800 text-xs font-extrabold text-slate-700 dark:text-slate-200">
              ✅ Точное пошаговое решение (готово для записи в тетрадь)
            </div>
            <div className="p-4 sm:p-6 notebook-grid sm:pr-14 overflow-x-auto">
              <MarkdownMath content={resultMd} />
            </div>
          </div>
        )}

        {activeTool === 'chemistry' && (
          <ChemistryReferenceCard
            onInsertElement={(sym) =>
              setInputVal((prev) => (prev.includes('=') ? sym : `${prev}${sym}`))
            }
          />
        )}
      </div>
    </div>
  );
}
