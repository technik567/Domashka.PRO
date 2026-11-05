import React, { useState } from 'react';
import { CheckCircle2, XCircle, RotateCw } from 'lucide-react';
import { recordStudentActivity } from '../api';

export const IRREGULAR_VERBS_BANK = [
  { v1: 'go', ru: 'идти, ехать', options: ['went — gone', 'goed — gone', 'went — went', 'gone — went'], correct: 0, tip: 'Супплетивные формы: go — went — gone (I went to school / He has gone home).' },
  { v1: 'write', ru: 'писать', options: ['wrote — written', 'writed — written', 'wrote — wrote', 'written — wrote'], correct: 0, tip: 'Чередование i → o → i + удвоение t в V3: write — wrote — written!' },
  { v1: 'begin', ru: 'начинать', options: ['began — begun', 'begun — began', 'begined — begun', 'began — began'], correct: 0, tip: 'Звонкое трио i – a – u: begin — began — begun (как swim — swam — swum, sing — sang — sung)!' },
  { v1: 'take', ru: 'брать', options: ['took — taken', 'taked — taken', 'took — took', 'taken — took'], correct: 0, tip: 'Как shake — shook — shaken: take — took — taken!' },
  { v1: 'see', ru: 'видеть', options: ['saw — seen', 'seed — seen', 'seen — saw', 'saw — saw'], correct: 0, tip: 'I saw a film yesterday (V2), I have seen this film (V3): see — saw — seen.' },
  { v1: 'buy', ru: 'покупать', options: ['bought — bought', 'buyed — buyed', 'brang — brought', 'caught — caught'], correct: 0, tip: 'Группа -ought (V2 = V3): buy — bought — bought, think — thought — thought, bring — brought — brought!' },
  { v1: 'choose', ru: 'выбирать', options: ['chose — chosen', 'choosed — chosen', 'chose — chose', 'chosen — chose'], correct: 0, tip: 'В V2 одна буква O, в V3 добавляется -en: choose — chose — chosen!' },
  { v1: 'break', ru: 'ломать, разбивать', options: ['broke — broken', 'breaked — broken', 'broke — broke', 'broken — broke'], correct: 0, tip: 'Как speak — spoke — spoken: break — broke — broken!' },
  { v1: 'fall', ru: 'падать (не путать с feel!)', options: ['fell — fallen', 'felt — felt', 'falled — fallen', 'fell — felt'], correct: 0, tip: 'Ловушка ОГЭ/ЕГЭ: fall (падать) — fell — fallen, а feel (чувствовать) — felt — felt!' },
  { v1: 'fly', ru: 'летать', options: ['flew — flown', 'flied — flown', 'flew — flewn', 'flown — flew'], correct: 0, tip: 'Как blow — blew — blown и grow — grew — grown: fly — flew — flown!' },
  { v1: 'know', ru: 'знать', options: ['knew — known', 'knowed — known', 'knew — knew', 'known — knew'], correct: 0, tip: 'Буква k не читается [nəʊ]: know — knew — known!' },
  { v1: 'teach', ru: 'учить, преподавать', options: ['taught — taught', 'teached — teached', 'thought — thought', 'caught — caught'], correct: 0, tip: 'Группа -aught: teach — taught — taught и catch — caught — caught!' },
  { v1: 'put', ru: 'класть, ставить', options: ['put — put', 'putted — putted', 'pat — put', 'pote — putten'], correct: 0, tip: 'Неизменяемые короткие глаголы (V1 = V2 = V3): cut, put, shut, let, set, hit, cost, hurt!' },
  { v1: 'swim', ru: 'плавать', options: ['swam — swum', 'swum — swam', 'swimmed — swum', 'swam — swimmed'], correct: 0, tip: 'Правило i – a – u: swim — swam — swum, drink — drank — drunk, ring — rang — rung!' },
  { v1: 'give', ru: 'давать', options: ['gave — given', 'gived — given', 'gave — gave', 'given — gave'], correct: 0, tip: 'Аналогично forgive — forgave — forgiven: give — gave — given!' },
  { v1: 'forget', ru: 'забывать', options: ['forgot — forgotten', 'forgetted — forgotten', 'forgot — forget', 'forgotten — forgot'], correct: 0, tip: 'Удвоение t в третьей форме: forget — forgot — forgotten!' },
  { v1: 'build', ru: 'строить', options: ['built — built', 'builded — builded', 'bald — built', 'boult — boult'], correct: 0, tip: 'Замена конечной -d на глухую -t: build — built — built, send — sent — sent, spend — spent — spent!' },
  { v1: 'wear', ru: 'носить (одежду)', options: ['wore — worn', 'weared — worn', 'ware — worn', 'wore — weared'], correct: 0, tip: 'Как tear — tore — torn: wear — wore — worn!' },
];

export const HISTORY_DATES_BANK = [
  { event: 'Призвание варягов (Рюрика) в Новгород — начало государственности Руси', options: ['862 г.', '882 г.', '988 г.', '945 г.'], correct: 0, tip: '862 г. — призвание Рюрика; а в 882 г. Вещий Олег объединил Новгород и Киев!' },
  { event: 'Крещение Руси при князе Владимире Святославиче', options: ['988 г.', '980 г.', '1019 г.', '1054 г.'], correct: 0, tip: '988 г. — принятие христианства от Византии (Корсунь / Киев).' },
  { event: 'Ледовое побоище на Чудском озере (Александр Невский)', options: ['1242 г.', '1240 г.', '1223 г.', '1380 г.'], correct: 0, tip: '15 июля 1240 г. — Невская битва со шведами, 5 апреля 1242 г. — Ледовое побоище с рыцарями Ливонского ордена!' },
  { event: 'Куликовская битва (Дмитрий Донской против Мамая)', options: ['1380 г.', '1480 г.', '1237 г.', '1410 г.'], correct: 0, tip: '8 сентября 1380 г. — Куликовская битва; а ровно через 100 лет (1480 г.) — Стояние на реке Угре!' },
  { event: 'Стояние на реке Угре — окончательное свержение ордынского владычества', options: ['1480 г.', '1380 г.', '1497 г.', '1547 г.'], correct: 0, tip: '1480 г. при Иване III Великом (хан Большой Орды Ахмат отступил без генерального сражения).' },
  { event: 'Венчание Ивана IV Грозного на царство (первый русский царь)', options: ['1547 г.', '1552 г.', '1565 г.', '1584 г.'], correct: 0, tip: 'Январь 1547 г. — венчание на царство; 1552 г. — взятие Казани; 1565–1572 гг. — опричнина.' },
  { event: 'Освобождение Москвы Вторым ополчением Минина и Пожарского', options: ['1612 г.', '1613 г.', '1605 г.', '1649 г.'], correct: 0, tip: '4 ноября 1612 г. — День народного единства; а в 1613 г. Земский собор избрал Михаила Романова!' },
  { event: 'Принятие Соборного уложения царя Алексея Михайловича', options: ['1649 г.', '1550 г.', '1497 г.', '1682 г.'], correct: 0, tip: '1649 г. — Соборное уложение окончательно оформило бессрочное крепостное право в России.' },
  { event: 'Полтавская битва — коренной перелом в Северной войне (Пётр I)', options: ['1709 г.', '1700 г.', '1703 г.', '1721 г.'], correct: 0, tip: '27 июня 1709 г. — разгром армии Карла XII под Полтавой («мать Полтавской баталии» — Лесная, 1708 г.).' },
  { event: 'Ништадтский мир и провозглашение России Империей', options: ['1721 г.', '1703 г.', '1725 г.', '1755 г.'], correct: 0, tip: '1700–1721 гг. — Северная война; в 1721 г. Сенат преподнёс Петру I титул Императора.' },
  { event: 'Основание Московского университета (М. В. Ломоносов и И. И. Шувалов)', options: ['1755 г.', '1724 г.', '1762 г.', '1802 г.'], correct: 0, tip: '25 января 1755 г. (Татьянин день) при императрице Елизавете Петровне!' },
  { event: 'Отечественная война против армии Наполеона и Бородинское сражение', options: ['1812 г.', '1805 г.', '1825 г.', '1853 г.'], correct: 0, tip: '26 августа 1812 г. — Бородинская битва (М. И. Кутузов).' },
  { event: 'Восстание декабристов на Сенатской площади в Петербурге', options: ['1825 г.', '1812 г.', '1861 г.', '1881 г.'], correct: 0, tip: '14 декабря 1825 г. — в период междуцарствия после смерти Александра I.' },
  { event: 'Отмена крепостного права в России (Манифест Александра II)', options: ['1861 г.', '1864 г.', '1874 г.', '1906 г.'], correct: 0, tip: '19 февраля 1861 г. — Крестьянская реформа Александра II Освободителя!' },
  { event: 'Отречение Николая II и Октябрьская революция в России', options: ['1917 г.', '1905 г.', '1914 г.', '1922 г.'], correct: 0, tip: 'Февраль и Октябрь 1917 г. — Великая российская революция; в декабре 1922 г. образован СССР.' },
  { event: 'Великая Отечественная война советского народа', options: ['1941–1945 гг.', '1939–1945 гг.', '1914–1918 гг.', '1941–1944 гг.'], correct: 0, tip: '22 июня 1941 г. — 9 мая 1945 г. (Вторая мировая война в целом: 1 сентября 1939 — 2 сентября 1945 гг.).' },
  { event: 'Первый полёт человека в космос — Ю. А. Гагарин на корабле «Восток-1»', options: ['12 апреля 1961 г.', '4 октября 1957 г.', '18 марта 1965 г.', '20 июля 1969 г.'], correct: 0, tip: '4 октября 1957 г. — первый искусственный спутник Земли; 12 апреля 1961 г. — 108 минут полёта Юрия Гагарина!' },
  { event: 'Принятие действующей Конституции Российской Федерации на всенародном голосовании', options: ['12 декабря 1993 г.', '12 июня 1990 г.', '25 декабря 1991 г.', '7 октября 1977 г.'], correct: 0, tip: '12 декабря 1993 г. — принятие Конституции РФ!' },
];

function shuffleOptionsWithAnswer(item) {
  const indexed = item.options.map((text, idx) => ({ text, isCorrect: idx === item.correct }));
  // deterministic per item text + seed? Let's shuffle cleanly on question switch
  for (let i = indexed.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }
  return {
    ...item,
    shuffledOptions: indexed.map((x) => x.text),
    shuffledCorrect: indexed.findIndex((x) => x.isCorrect),
  };
}

export function IrregularVerbsBlitz() {
  const [idx, setIdx] = useState(0);
  const [question, setQuestion] = useState(() => shuffleOptionsWithAnswer(IRREGULAR_VERBS_BANK[0]));
  const [picked, setPicked] = useState(null);
  const [combo, setCombo] = useState(0);
  const [score, setScore] = useState(0);

  const nextVerb = () => {
    const nextIdx = (idx + 1) % IRREGULAR_VERBS_BANK.length;
    setIdx(nextIdx);
    setQuestion(shuffleOptionsWithAnswer(IRREGULAR_VERBS_BANK[nextIdx]));
    setPicked(null);
  };

  const isAnswered = picked !== null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-sm space-y-5 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          🌐 Неправильные глаголы V1 – V2 – V3 ({idx + 1} / {IRREGULAR_VERBS_BANK.length})
        </span>
        <div className="flex items-center gap-2 text-xs font-bold">
          <span className="px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300">
            🔥 Серия: {combo}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
            Верно: {score}
          </span>
        </div>
      </div>

      <div className="text-center py-2">
        <div className="text-xs text-slate-400 mb-1">Выберите верные 2-ю и 3-ю формы (Past Simple — Past Participle):</div>
        <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
          to {question.v1}{' '}
          <span className="text-base sm:text-lg font-bold text-slate-500 dark:text-slate-400">
            ({question.ru})
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {question.shuffledOptions.map((opt, optIdx) => {
          const isRight = optIdx === question.shuffledCorrect;
          const isChosen = picked === optIdx;
          let cls =
            'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 hover:border-indigo-400 text-slate-900 dark:text-white';
          if (isAnswered) {
            if (isRight) {
              cls =
                'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/40';
            } else if (isChosen) {
              cls = 'bg-rose-50 dark:bg-rose-950/50 border-rose-400 text-rose-900 dark:text-rose-200';
            } else {
              cls = 'opacity-50 border-slate-200 dark:border-slate-800 text-slate-400';
            }
          }
          return (
            <button
              key={optIdx}
              type="button"
              disabled={isAnswered}
              onClick={() => {
                setPicked(optIdx);
                if (optIdx === question.shuffledCorrect) {
                  setCombo((c) => c + 1);
                  setScore((s) => s + 1);
                  recordStudentActivity('quiz_correct', 8);
                } else {
                  setCombo(0);
                }
              }}
              className={`p-3.5 sm:p-4 rounded-2xl border-2 text-base sm:text-lg font-extrabold font-mono transition flex items-center justify-center gap-2 ${cls}`}
            >
              <span>{opt}</span>
              {isAnswered && isRight && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
              {isAnswered && isChosen && !isRight && <XCircle className="w-5 h-5 text-rose-600 shrink-0" />}
            </button>
          );
        })}
      </div>

      {isAnswered && (
        <div className="p-4 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200">
            💡 <b>Запоминалка:</b> {question.tip}
          </p>
          <button
            type="button"
            onClick={nextVerb}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-extrabold shrink-0 inline-flex items-center justify-center gap-1.5"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Следующий глагол →
          </button>
        </div>
      )}
    </div>
  );
}

export function HistoryDatesBlitz() {
  const [idx, setIdx] = useState(0);
  const [question, setQuestion] = useState(() => shuffleOptionsWithAnswer(HISTORY_DATES_BANK[0]));
  const [picked, setPicked] = useState(null);
  const [combo, setCombo] = useState(0);
  const [score, setScore] = useState(0);

  const nextDate = () => {
    const nextIdx = (idx + 1) % HISTORY_DATES_BANK.length;
    setIdx(nextIdx);
    setQuestion(shuffleOptionsWithAnswer(HISTORY_DATES_BANK[nextIdx]));
    setPicked(null);
  };

  const isAnswered = picked !== null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-sm space-y-5 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400">
          🏛️ Главные даты истории России ({idx + 1} / {HISTORY_DATES_BANK.length})
        </span>
        <div className="flex items-center gap-2 text-xs font-bold">
          <span className="px-2.5 py-1 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300">
            🔥 Серия: {combo}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
            Верно: {score}
          </span>
        </div>
      </div>

      <div className="text-center py-2 px-2">
        <div className="text-xs text-slate-400 mb-1">В каком году произошло это событие?</div>
        <div className="text-base sm:text-xl font-extrabold text-slate-900 dark:text-white leading-snug">
          «{question.event}»
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {question.shuffledOptions.map((opt, optIdx) => {
          const isRight = optIdx === question.shuffledCorrect;
          const isChosen = picked === optIdx;
          let cls =
            'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 hover:border-rose-400 text-slate-900 dark:text-white';
          if (isAnswered) {
            if (isRight) {
              cls =
                'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/40';
            } else if (isChosen) {
              cls = 'bg-rose-50 dark:bg-rose-950/50 border-rose-400 text-rose-900 dark:text-rose-200';
            } else {
              cls = 'opacity-50 border-slate-200 dark:border-slate-800 text-slate-400';
            }
          }
          return (
            <button
              key={optIdx}
              type="button"
              disabled={isAnswered}
              onClick={() => {
                setPicked(optIdx);
                if (optIdx === question.shuffledCorrect) {
                  setCombo((c) => c + 1);
                  setScore((s) => s + 1);
                  recordStudentActivity('quiz_correct', 8);
                } else {
                  setCombo(0);
                }
              }}
              className={`p-3.5 rounded-2xl border-2 text-sm sm:text-base font-black transition flex items-center justify-center gap-1.5 ${cls}`}
            >
              <span>{opt}</span>
            </button>
          );
        })}
      </div>

      {isAnswered && (
        <div className="p-4 rounded-2xl bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200">
            📜 <b>Историческая справка:</b> {question.tip}
          </p>
          <button
            type="button"
            onClick={nextDate}
            className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-extrabold shrink-0 inline-flex items-center justify-center gap-1.5"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Следующая дата →
          </button>
        </div>
      )}
    </div>
  );
}
