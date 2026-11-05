import React, { useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import MarkdownMath from './MarkdownMath';
import { copyTextSafe } from '../api';

const FORMULA_CATALOG = [
  {
    id: 'ohm',
    title: '⚡ Закон Ома для участка цепи',
    baseLatex: 'I = \\frac{U}{R}',
    grade: '8–11 кл.',
    vars: [
      { key: 'I', name: 'Сила тока', unit: 'А', defaultVal: 2, exprLatex: 'I = \\frac{U}{R}', calc: (v) => v.U / v.R },
      { key: 'U', name: 'Напряжение', unit: 'В', defaultVal: 12, exprLatex: 'U = I \\cdot R', calc: (v) => v.I * v.R },
      { key: 'R', name: 'Сопротивление', unit: 'Ом', defaultVal: 6, exprLatex: 'R = \\frac{U}{I}', calc: (v) => v.U / v.I },
    ],
  },
  {
    id: 'joule_lenz',
    title: '🔥 Мощность электрического тока',
    baseLatex: 'P = U \\cdot I',
    grade: '8–11 кл.',
    vars: [
      { key: 'P', name: 'Мощность тока', unit: 'Вт', defaultVal: 1100, exprLatex: 'P = U \\cdot I', calc: (v) => v.U * v.I },
      { key: 'U', name: 'Напряжение', unit: 'В', defaultVal: 220, exprLatex: 'U = \\frac{P}{I}', calc: (v) => v.P / v.I },
      { key: 'I', name: 'Сила тока', unit: 'А', defaultVal: 5, exprLatex: 'I = \\frac{P}{U}', calc: (v) => v.P / v.U },
    ],
  },
  {
    id: 'density',
    title: '🧱 Плотность вещества',
    baseLatex: '\\rho = \\frac{m}{V}',
    grade: '7–11 кл.',
    vars: [
      { key: 'rho', sym: '\\rho', label: 'ρ', name: 'Плотность', unit: 'кг/м³', defaultVal: 7800, exprLatex: '\\rho = \\frac{m}{V}', calc: (v) => v.m / v.V },
      { key: 'm', sym: 'm', label: 'm', name: 'Масса тела', unit: 'кг', defaultVal: 15.6, exprLatex: 'm = \\rho \\cdot V', calc: (v) => v.rho * v.V },
      { key: 'V', sym: 'V', label: 'V', name: 'Объём тела', unit: 'м³', defaultVal: 0.002, exprLatex: 'V = \\frac{m}{\\rho}', calc: (v) => v.m / v.rho },
    ],
  },
  {
    id: 'newton2',
    title: '🚀 Второй закон Ньютона',
    baseLatex: 'F = m \\cdot a',
    grade: '9–11 кл.',
    vars: [
      { key: 'F', name: 'Равнодействующая сила', unit: 'Н', defaultVal: 30, exprLatex: 'F = m \\cdot a', calc: (v) => v.m * v.a },
      { key: 'm', name: 'Масса тела', unit: 'кг', defaultVal: 15, exprLatex: 'm = \\frac{F}{a}', calc: (v) => v.F / v.a },
      { key: 'a', name: 'Ускорение', unit: 'м/с²', defaultVal: 2, exprLatex: 'a = \\frac{F}{m}', calc: (v) => v.F / v.m },
    ],
  },
  {
    id: 'heat',
    title: '🌡️ Количество теплоты при нагревании',
    baseLatex: 'Q = c \\cdot m \\cdot \\Delta t',
    grade: '8–11 кл.',
    vars: [
      { key: 'Q', sym: 'Q', label: 'Q', name: 'Количество теплоты', unit: 'Дж', defaultVal: 168000, exprLatex: 'Q = c \\cdot m \\cdot \\Delta t', calc: (v) => v.c * v.m * v.dt },
      { key: 'c', sym: 'c', label: 'c', name: 'Удельная теплоёмкость', unit: 'Дж/(кг·°C)', defaultVal: 4200, exprLatex: 'c = \\frac{Q}{m \\cdot \\Delta t}', calc: (v) => v.Q / (v.m * v.dt) },
      { key: 'm', sym: 'm', label: 'm', name: 'Масса вещества', unit: 'кг', defaultVal: 2, exprLatex: 'm = \\frac{Q}{c \\cdot \\Delta t}', calc: (v) => v.Q / (v.c * v.dt) },
      { key: 'dt', sym: '\\Delta t', label: 'Δt', name: 'Изменение температуры', unit: '°C', defaultVal: 20, exprLatex: '\\Delta t = \\frac{Q}{c \\cdot m}', calc: (v) => v.Q / (v.c * v.m) },
    ],
  },
  {
    id: 'hydro',
    title: '🌊 Гидростатическое давление жидкости',
    baseLatex: 'p = \\rho \\cdot g \\cdot h',
    grade: '7–11 кл.',
    vars: [
      { key: 'p', sym: 'p', label: 'p', name: 'Давление столба жидкости', unit: 'Па', defaultVal: 50000, exprLatex: 'p = \\rho \\cdot g \\cdot h', calc: (v) => v.rho * v.g * v.h },
      { key: 'rho', sym: '\\rho', label: 'ρ', name: 'Плотность жидкости', unit: 'кг/м³', defaultVal: 1000, exprLatex: '\\rho = \\frac{p}{g \\cdot h}', calc: (v) => v.p / (v.g * v.h) },
      { key: 'h', sym: 'h', label: 'h', name: 'Глубина (высота столба)', unit: 'м', defaultVal: 5, exprLatex: 'h = \\frac{p}{\\rho \\cdot g}', calc: (v) => v.p / (v.rho * v.g) },
      { key: 'g', sym: 'g', label: 'g', name: 'Ускорение своб. падения', unit: 'Н/кг', defaultVal: 10, exprLatex: 'g = \\frac{p}{\\rho \\cdot h}', calc: (v) => v.p / (v.rho * v.h) },
    ],
  },
  {
    id: 'chem_moles',
    title: '🧪 Химия: количество вещества через массу',
    baseLatex: 'n = \\frac{m}{M}',
    grade: '8–11 кл.',
    vars: [
      { key: 'n', name: 'Количество вещества', unit: 'моль', defaultVal: 0.5, exprLatex: 'n = \\frac{m}{M}', calc: (v) => v.m / v.M },
      { key: 'm', name: 'Масса вещества', unit: 'г', defaultVal: 49, exprLatex: 'm = n \\cdot M', calc: (v) => v.n * v.M },
      { key: 'M', name: 'Молярная масса', unit: 'г/моль', defaultVal: 98, exprLatex: 'M = \\frac{m}{n}', calc: (v) => v.m / v.n },
    ],
  },
  {
    id: 'chem_omega',
    title: '🧪 Химия: массовая доля растворённого вещества',
    baseLatex: '\\omega = \\frac{m_{\\text{в-ва}}}{m_{\\text{р-ра}}} \\cdot 100\\%',
    grade: '8–11 кл. (ОГЭ/ЕГЭ №26)',
    vars: [
      { key: 'w', sym: '\\omega', label: 'ω', name: 'Массовая доля', unit: '%', defaultVal: 15, exprLatex: '\\omega = \\frac{m_{\\text{в-ва}}}{m_{\\text{р-ра}}} \\cdot 100\\%', calc: (v) => (v.ms / v.mr) * 100 },
      { key: 'ms', sym: 'm_{\\text{в-ва}}', label: 'm(в-ва)', name: 'Масса чистого вещества', unit: 'г', defaultVal: 30, exprLatex: 'm_{\\text{в-ва}} = \\frac{\\omega \\cdot m_{\\text{р-ра}}}{100\\%}', calc: (v) => (v.w * v.mr) / 100 },
      { key: 'mr', sym: 'm_{\\text{р-ра}}', label: 'm(р-ра)', name: 'Масса всего раствора', unit: 'г', defaultVal: 200, exprLatex: 'm_{\\text{р-ра}} = \\frac{m_{\\text{в-ва}} \\cdot 100\\%}{\\omega}', calc: (v) => (v.ms * 100) / v.w },
    ],
  },
];

function fmtNum(val) {
  if (!Number.isFinite(val)) return 'Ошибка (деление на 0)';
  if (Math.abs(val) >= 0.01 && Math.abs(val) < 1e6) {
    return Number(val.toFixed(4)).toString();
  }
  return val.toExponential(3);
}

export default function FormulaIsolatorCard() {
  const [formulaId, setFormulaId] = useState('ohm');
  const currentFormula = FORMULA_CATALOG.find((f) => f.id === formulaId) || FORMULA_CATALOG[0];
  const [targetKey, setTargetKey] = useState(currentFormula.vars[0].key);
  const [copied, setCopied] = useState(false);

  const [values, setValues] = useState(() => {
    const init = {};
    FORMULA_CATALOG.forEach((f) => {
      init[f.id] = {};
      f.vars.forEach((v) => {
        init[f.id][v.key] = String(v.defaultVal);
      });
    });
    return init;
  });

  const handleSelectFormula = (id) => {
    const f = FORMULA_CATALOG.find((x) => x.id === id) || FORMULA_CATALOG[0];
    setFormulaId(id);
    setTargetKey(f.vars[0].key);
  };

  const activeTarget =
    currentFormula.vars.find((v) => v.key === targetKey) || currentFormula.vars[0];
  const knownVars = currentFormula.vars.filter((v) => v.key !== activeTarget.key);

  const notebookMd = useMemo(() => {
    const numMap = {};
    let hasInvalid = false;
    knownVars.forEach((kv) => {
      const raw = String(values[formulaId]?.[kv.key] ?? kv.defaultVal).replace(',', '.');
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) hasInvalid = true;
      numMap[kv.key] = parsed;
    });

    const givenLines = knownVars
      .map((kv) => `- $${kv.sym || kv.key} = ${values[formulaId]?.[kv.key] ?? kv.defaultVal}\\text{ ${kv.unit}}$ — ${kv.name.toLowerCase()}`)
      .join('\n');

    const resultVal = hasInvalid ? NaN : activeTarget.calc(numMap);
    const resultStr = fmtNum(resultVal);

    return `### Оформление в школьную тетрадь (${currentFormula.grade})
**Дано:**
${givenLines}

**Найти:** $${activeTarget.sym || activeTarget.key} - ?$

**Решение:**
1. Запишем исходный закон (базовую формулу):
$$${currentFormula.baseLatex}$$
2. Выразим искомую величину (${activeTarget.name.toLowerCase()}):
$$${activeTarget.exprLatex}$$
3. Подставим числовые значения в СИ:
$$${activeTarget.sym || activeTarget.key} = ${resultStr}\\text{ ${activeTarget.unit}}$$

**Ответ:** $${activeTarget.sym || activeTarget.key} = ${resultStr}\\text{ ${activeTarget.unit}}$.`;
  }, [currentFormula, activeTarget, knownVars, values, formulaId]);

  const handleCopy = async () => {
    const ok = await copyTextSafe(notebookMd);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
            1. Выберите школьную формулу Физики или Химии:
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {FORMULA_CATALOG.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => handleSelectFormula(f.id)}
                className={`text-left px-3 py-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-between gap-2 ${
                  formulaId === f.id
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800/70 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                }`}
              >
                <span className="truncate">{f.title}</span>
                <span className={`text-[10px] shrink-0 ${formulaId === f.id ? 'text-indigo-100' : 'text-slate-400'}`}>
                  {f.grade}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Choose variable to isolate */}
        <div>
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
            2. Какую букву (неизвестную величину) нужно выразить и найти?
          </label>
          <div className="flex flex-wrap gap-2">
            {currentFormula.vars.map((v) => {
              const active = v.key === activeTarget.key;
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setTargetKey(v.key)}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-extrabold transition ${
                    active
                      ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-violet-400'
                  }`}
                >
                  Найти {v.label || v.key} ({v.name}, {v.unit})
                </button>
              );
            })}
          </div>
        </div>

        {/* Numeric inputs for known variables */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          {knownVars.map((kv) => (
            <div key={kv.key}>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {kv.label || kv.key} — {kv.name} ({kv.unit}):
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={values[formulaId]?.[kv.key] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [formulaId]: { ...(prev[formulaId] || {}), [kv.key]: e.target.value },
                  }))
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-bold font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Formatted Notebook Output */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-5 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
            ✅ Выведенная формула и расчёт для переписывания в тетрадь
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
        </div>
        <div className="p-4 sm:p-6 notebook-grid sm:pr-14 overflow-x-auto">
          <MarkdownMath content={notebookMd} />
        </div>
      </div>
    </div>
  );
}
