import React, { useMemo, useState } from 'react';
import { Award, GraduationCap, AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react';

// Official FIPI-aligned OGE primary-to-mark (2..5) scales + profile 10th grade threshold
const OGE_SCALES = [
  { id: 'math', label: '📐 Математика ОГЭ', max: 31, min3: 8, min4: 15, min5: 22, prof: 19, hasGeomRule: true },
  { id: 'russian', label: '🖋️ Русский язык ОГЭ', max: 37, min3: 15, min4: 24, min5: 31, prof: 28, note: 'Для «4» нужно ≥4 баллов за грамотность (ГК1–ГК4), для «5» — ≥6 баллов!' },
  { id: 'informatics', label: '💻 Информатика ОГЭ', max: 19, min3: 5, min4: 11, min5: 16, prof: 14 },
  { id: 'social', label: '⚖️ Обществознание ОГЭ', max: 37, min3: 14, min4: 24, min5: 32, prof: 29 },
  { id: 'physics', label: '⚡ Физика ОГЭ', max: 39, min3: 10, min4: 20, min5: 30, prof: 26 },
  { id: 'chemistry', label: '🧪 Химия ОГЭ', max: 38, min3: 10, min4: 21, min5: 31, prof: 27 },
  { id: 'biology', label: '🧬 Биология ОГЭ', max: 48, min3: 13, min4: 26, min5: 38, prof: 34 },
  { id: 'geography', label: '🌍 География ОГЭ', max: 31, min3: 12, min4: 19, min5: 26, prof: 23 },
  { id: 'english', label: '🌐 Английский язык ОГЭ', max: 68, min3: 29, min4: 46, min5: 58, prof: 55 },
  { id: 'history', label: '🏛️ История ОГЭ', max: 37, min3: 11, min4: 21, min5: 30, prof: 26 },
];

// Official FIPI-aligned EGE primary -> 100-point test conversion piece-wise curves & min Rosobrnadzor / Ministry thresholds
const EGE_SUBJECTS = [
  {
    id: 'russian',
    label: '🖋️ Русский язык ЕГЭ',
    maxPrimary: 50,
    minPassTest: 40, // вуз Минобрнауки
    // exact anchor points [primary, testScore]
    anchors: [[0, 0], [16, 36], [18, 40], [25, 52], [35, 68], [42, 81], [47, 94], [49, 97], [50, 100]],
  },
  {
    id: 'math_prof',
    label: '📐 Профильная математика ЕГЭ',
    maxPrimary: 32,
    minPassTest: 40,
    anchors: [[0, 0], [6, 34], [7, 40], [11, 64], [12, 70], [18, 80], [24, 90], [29, 97], [30, 100], [32, 100]],
  },
  {
    id: 'informatics',
    label: '💻 Информатика КЕГЭ',
    maxPrimary: 29,
    minPassTest: 44,
    anchors: [[0, 0], [6, 40], [7, 44], [14, 60], [21, 80], [25, 90], [28, 98], [29, 100]],
  },
  {
    id: 'social',
    label: '⚖️ Обществознание ЕГЭ',
    maxPrimary: 58,
    minPassTest: 45,
    anchors: [[0, 0], [20, 42], [22, 45], [34, 63], [45, 81], [52, 91], [57, 98], [58, 100]],
  },
  {
    id: 'physics',
    label: '⚡ Физика ЕГЭ',
    maxPrimary: 45,
    minPassTest: 39,
    anchors: [[0, 0], [10, 39], [18, 54], [28, 74], [35, 86], [42, 96], [45, 100]],
  },
  {
    id: 'chemistry',
    label: '🧪 Химия ЕГЭ',
    maxPrimary: 56,
    minPassTest: 39,
    anchors: [[0, 0], [13, 39], [25, 56], [40, 77], [49, 90], [55, 99], [56, 100]],
  },
  {
    id: 'biology',
    label: '🧬 Биология ЕГЭ',
    maxPrimary: 57,
    minPassTest: 39,
    anchors: [[0, 0], [16, 39], [28, 55], [41, 75], [50, 90], [56, 98], [57, 100]],
  },
  {
    id: 'history',
    label: '🏛️ История ЕГЭ',
    maxPrimary: 42,
    minPassTest: 36,
    anchors: [[0, 0], [9, 36], [19, 55], [30, 76], [37, 90], [41, 97], [42, 100]],
  },
  {
    id: 'english',
    label: '🌐 Английский язык ЕГЭ',
    maxPrimary: 82,
    minPassTest: 30,
    anchors: [[0, 0], [22, 30], [45, 58], [65, 80], [75, 92], [81, 99], [82, 100]],
  },
];

function interpolateEgeScore(primary, anchors) {
  const p = Math.max(0, primary);
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [p1, t1] = anchors[i];
    const [p2, t2] = anchors[i + 1];
    if (p >= p1 && p <= p2) {
      if (p2 === p1) return t2;
      return Math.round(t1 + ((p - p1) / (p2 - p1)) * (t2 - t1));
    }
  }
  return anchors[anchors.length - 1][1];
}

export default function ExamScoreCalculator({ grade = 9 }) {
  const [examMode, setExamMode] = useState(grade >= 10 ? 'ege' : 'oge');

  // OGE state
  const [ogeSubjId, setOgeSubjId] = useState('math');
  const [ogePts, setOgePts] = useState(17);
  const [ogeGeomPts, setOgeGeomPts] = useState(3);

  // EGE state
  const [egeSubjId, setEgeSubjId] = useState('russian');
  const [egePrimary, setEgePrimary] = useState(38);
  const [bundle, setBundle] = useState([
    { id: 'b1', name: 'Русский язык', score: 78 },
    { id: 'b2', name: 'Профильная математика', score: 76 },
    { id: 'b3', name: 'Информатика / Предмет по выбору', score: 80 },
  ]);
  const [extraAchievPts, setExtraAchievPts] = useState(5); // ГТО, медаль, волонтёрство (0..10)

  const ogeSubj = OGE_SCALES.find((s) => s.id === ogeSubjId) || OGE_SCALES[0];
  const clampedOge = Math.min(ogeSubj.max, Math.max(0, ogePts));

  const ogeResult = useMemo(() => {
    if (ogeSubj.hasGeomRule && ogeGeomPts < 2) {
      return {
        mark: 2,
        failedGeom: true,
        nextHint: `Набрано меньше 2 обязательных первичных баллов по блоку «Геометрия» (№15–19, №23–25)! Даже при высоком общем балле ставится «2». Добавьте ещё ${2 - ogeGeomPts} б. по геометрии.`,
      };
    }
    let mark = 2;
    let nextHint = `До тройки («3») не хватает ${ogeSubj.min3 - clampedOge} перв. б.`;
    if (clampedOge >= ogeSubj.min5) {
      mark = 5;
      nextHint = 'Поздравляем! Это твёрдая «5» и уверенное прохождение в профильный 10 класс!';
    } else if (clampedOge >= ogeSubj.min4) {
      mark = 4;
      nextHint = `Твёрдая «4»! До пятёрки («5») нужно ещё +${ogeSubj.min5 - clampedOge} перв. б.`;
    } else if (clampedOge >= ogeSubj.min3) {
      mark = 3;
      nextHint = `Экзамен сдан на «3». До четвёрки («4») осталось набрать +${ogeSubj.min4 - clampedOge} перв. б.`;
    }
    return { mark, failedGeom: false, nextHint };
  }, [ogeSubj, clampedOge, ogeGeomPts]);

  const egeSubj = EGE_SUBJECTS.find((s) => s.id === egeSubjId) || EGE_SUBJECTS[0];
  const clampedEgePrimary = Math.min(egeSubj.maxPrimary, Math.max(0, egePrimary));
  const egeTestScore = interpolateEgeScore(clampedEgePrimary, egeSubj.anchors);

  const totalUniversityScore =
    bundle.reduce((acc, b) => acc + (Number(b.score) || 0), 0) +
    Math.min(10, Math.max(0, Number(extraAchievPts) || 0));

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/60 border border-violet-200 dark:border-violet-800 flex items-center justify-center text-violet-600 dark:text-violet-400 shrink-0">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
              Калькулятор баллов ОГЭ и ЕГЭ (шкалы ФИПИ)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Перевод первичных баллов в оценку аттестата (ОГЭ) или тестовые 100 баллов вуза (ЕГЭ)
            </p>
          </div>
        </div>

        <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs font-bold self-start">
          <button
            type="button"
            onClick={() => setExamMode('oge')}
            className={`px-3 py-1.5 rounded-lg transition ${
              examMode === 'oge'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            ОГЭ (9 класс)
          </button>
          <button
            type="button"
            onClick={() => setExamMode('ege')}
            className={`px-3 py-1.5 rounded-lg transition ${
              examMode === 'ege'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            ЕГЭ (10–11 класс)
          </button>
        </div>
      </div>

      {examMode === 'oge' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                Предмет ОГЭ:
              </label>
              <select
                value={ogeSubjId}
                onChange={(e) => {
                  const next = OGE_SCALES.find((s) => s.id === e.target.value) || OGE_SCALES[0];
                  setOgeSubjId(next.id);
                  setOgePts(next.min4);
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs sm:text-sm font-bold text-slate-900 dark:text-white outline-none"
              >
                {OGE_SCALES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} (макс. {s.max})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-bold mb-1">
                <span className="text-slate-700 dark:text-slate-200">Ваш первичный балл:</span>
                <span className="text-indigo-600 dark:text-indigo-400 font-extrabold">
                  {clampedOge} из {ogeSubj.max}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={ogeSubj.max}
                value={clampedOge}
                onChange={(e) => setOgePts(Number(e.target.value))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
            </div>
          </div>

          {ogeSubj.hasGeomRule && (
            <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-amber-900 dark:text-amber-200">
                📐 Из них первичных баллов по <b>Геометрии</b> (обязательный минимум — <b>2 балла</b>!):
              </span>
              <div className="flex items-center gap-1.5">
                {[0, 1, 2, 3, 4, 5].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setOgeGeomPts(g)}
                    className={`px-2.5 py-1 rounded-lg font-extrabold border ${
                      ogeGeomPts === g
                        ? g < 2
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {g === 5 ? '5+' : g}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mark card */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black text-white shadow-md shrink-0 ${
                  ogeResult.mark === 5
                    ? 'bg-emerald-600'
                    : ogeResult.mark === 4
                    ? 'bg-blue-600'
                    : ogeResult.mark === 3
                    ? 'bg-amber-500'
                    : 'bg-rose-600'
                }`}
              >
                {ogeResult.mark}
              </div>
              <div>
                <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                  Оценка за экзамен: «{ogeResult.mark}» ({clampedOge} / {ogeSubj.max} б.)
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                  {ogeResult.nextHint}
                </div>
                {ogeSubj.note && (
                  <div className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1 font-medium">
                    ℹ️ {ogeSubj.note}
                  </div>
                )}
              </div>
            </div>

            <div className="text-xs px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shrink-0">
              <div className="text-slate-400 text-[10px] uppercase font-bold">Пороги оценок:</div>
              <div className="font-bold text-slate-700 dark:text-slate-200 mt-0.5">
                «3»: от {ogeSubj.min3} · «4»: от {ogeSubj.min4} · «5»: от {ogeSubj.min5}
              </div>
              <div className="text-[11px] text-violet-600 dark:text-violet-400 font-semibold">
                Профильный 10 класс: рек. от {ogeSubj.prof} б. ({clampedOge >= ogeSubj.prof && !ogeResult.failedGeom ? 'пройден ✓' : `ещё ${Math.max(0, ogeSubj.prof - clampedOge)} б.`})
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                Предмет ЕГЭ (перевод первичных баллов в 100):
              </label>
              <select
                value={egeSubjId}
                onChange={(e) => {
                  const next = EGE_SUBJECTS.find((s) => s.id === e.target.value) || EGE_SUBJECTS[0];
                  setEgeSubjId(next.id);
                  setEgePrimary(Math.round(next.maxPrimary * 0.7));
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs sm:text-sm font-bold text-slate-900 dark:text-white outline-none"
              >
                {EGE_SUBJECTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} (макс. {s.maxPrimary} перв.)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-bold mb-1">
                <span className="text-slate-700 dark:text-slate-200">Первичный балл:</span>
                <span className="text-indigo-600 dark:text-indigo-400 font-extrabold">
                  {clampedEgePrimary} из {egeSubj.maxPrimary}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={egeSubj.maxPrimary}
                value={clampedEgePrimary}
                onChange={(e) => setEgePrimary(Number(e.target.value))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <div
                className={`w-16 h-14 rounded-2xl flex items-center justify-center text-xl font-black text-white shadow-md shrink-0 ${
                  egeTestScore >= 80
                    ? 'bg-emerald-600'
                    : egeTestScore >= egeSubj.minPassTest
                    ? 'bg-indigo-600'
                    : 'bg-rose-600'
                }`}
              >
                {egeTestScore}
              </div>
              <div>
                <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                  Тестовый балл ЕГЭ: {egeTestScore} из 100
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1 mt-0.5">
                  {egeTestScore >= egeSubj.minPassTest ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Порог подачи документов в вузы Минобрнауки ({egeSubj.minPassTest} б.) пройден!</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      <span>Ниже минимального порога вузов Минобрнауки ({egeSubj.minPassTest} теств. б.)</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                setBundle((prev) => [
                  ...prev,
                  { id: `b_${Date.now()}`, name: egeSubj.label, score: egeTestScore },
                ])
              }
              className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Добавить в сумму вуза
            </button>
          </div>

          {/* University Admission Sum */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <Award className="w-4 h-4 text-amber-500" />
                Сумма конкурсных баллов для поступления в вуз:
              </span>
              <span className="px-3 py-1 rounded-full bg-indigo-600 text-white font-black text-sm">
                Итого: {totalUniversityScore} б.
              </span>
            </div>

            <div className="space-y-1.5">
              {bundle.map((item) => (
                <div key={item.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) =>
                      setBundle((prev) =>
                        prev.map((x) => (x.id === item.id ? { ...x, name: e.target.value } : x))
                      )
                    }
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={item.score}
                    onChange={(e) =>
                      setBundle((prev) =>
                        prev.map((x) =>
                          x.id === item.id
                            ? { ...x, score: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }
                            : x
                        )
                      )
                    }
                    className="w-20 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-center"
                  />
                  {bundle.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setBundle((prev) => prev.filter((x) => x.id !== item.id))}
                      className="p-1.5 text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500 dark:text-slate-400">
                <span>Индивидуальные достижения (аттестат с отличием, ГТО, волонтёрство — до 10 б.):</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={extraAchievPts}
                  onChange={(e) => setExtraAchievPts(Math.min(10, Math.max(0, Number(e.target.value) || 0)))}
                  className="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-center text-slate-800 dark:text-white"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
