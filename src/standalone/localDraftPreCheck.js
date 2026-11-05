// Instant client-side Russian orthography, punctuation, math step & FIPI essay express-checker

const ORTHO_RULES = [
  { re: /\b([а-яё]*[жш])ы([а-яё]*)\b/giu, fix: '$1и$2', rule: 'Правописание ЖИ–ШИ пишется с буквой И' },
  { re: /\b([а-яё]*[чщ])я([а-яё]*)\b/giu, fix: '$1а$2', rule: 'Правописание ЧА–ЩА пишется с буквой А' },
  { re: /\b([а-яё]*[чщ])ю([а-яё]*)\b/giu, fix: '$1у$2', rule: 'Правописание ЧУ–ЩУ пишется с буквой У (кроме слов-исключений: жюри, брошюра, парашют)' },
  { re: /\bгаризонт([а-яё]*)\b/giu, fix: 'горизонт$1', rule: 'Словарное слово: гОризонт' },
  { re: /\b(не\s+)?чуствова([а-яё]*)\b/giu, fix: '$1чувствова$2', rule: 'Непроизносимая согласная В: чуВствовать (словарное слово)' },
  { re: /\bчуств([а-яё]*)\b/giu, fix: 'чувств$1', rule: 'Непроизносимая согласная В: чуВство' },
  { re: /\bпотомучто\b/giu, fix: 'потому что', rule: 'Союз «потому что» всегда пишется раздельно в два слова' },
  { re: /\bтаккак\b/giu, fix: 'так как', rule: 'Союз «так как» пишется раздельно' },
  { re: /\bвообщем\b/giu, fix: 'в общем', rule: 'Нет слова «вообщем»: правильно «в общем» или «вообще»' },
  { re: /\bздела([а-яё]*)\b/giu, fix: 'сдела$1', rule: 'Приставки З- не существует: пишется приставка С- (сделать)' },
  { re: /\bзда([лвш][а-яё]*)\b/giu, fix: 'сда$1', rule: 'Приставки З- не существует (кроме здесь, здание, здоровье, зги): правильно Сдал' },
  { re: /\bпридти\b/giu, fix: 'прийти', rule: 'Норма современного русского языка: «прийти»' },
  { re: /\bбудующ([а-яё]+)\b/giu, fix: 'будущ$1', rule: 'В слове «будущий» нет буквы Ю после У' },
  { re: /\bследующ([а-яё]+)\b/giu, fix: null },
  { re: /\bизвен([ия][а-яё]*)\b/giu, fix: 'извин$1', rule: 'Проверяемая безударная гласная в корне: извИнить (неви́нный)' },
  { re: /\bучавств([а-яё]+)\b/giu, fix: 'участв$1', rule: 'Лишняя буква В: правильно «участвовать» (проверочное — уча́стие)' },
  { re: /\bисскуств([а-яё]*)\b/giu, fix: 'искусств$1', rule: 'Правильно: искуССТВо (одна С в первом слоге, две СС во втором)' },
  { re: /\bпразник([а-яё]*)\b/giu, fix: 'праздник$1', rule: 'Непроизносимая согласная Д: праЗДник (празден)' },
  { re: /\bсерц([еау][а-яё]*)\b/giu, fix: 'сердц$1', rule: 'Непроизносимая согласная Д: серДце (сердечный)' },
  { re: /\bсонц([еау][а-яё]*)\b/giu, fix: 'солнц$1', rule: 'Непроизносимая согласная Л: соЛнце (солнечный)' },
  { re: /\bагенств([а-яё]*)\b/giu, fix: 'агентств$1', rule: 'Непроизносимая согласная Т: агенТство (агент)' },
  { re: /\bкоординальн([а-яё]+)\b/giu, fix: 'кардинальн$1', rule: 'Словарное слово: кАрдинально (от лат. cardinalis — главный)' },
];

const EXCEPTION_CHU = new Set(['жюри', 'брошюра', 'брошюры', 'брошюру', 'парашют', 'парашюта', 'парашюты']);

function safeEvalSimpleMathExpr(expr) {
  const clean = expr
    .replace(/,/g, '.')
    .replace(/−|–|—/g, '-')
    .replace(/×|·/g, '*')
    .replace(/÷|:/g, '/')
    .replace(/\^/g, '**')
    .trim();
  // Allow only numbers, arithmetic ops, parens, whitespace
  if (!/^[0-9+\-*/().\s]+$/.test(clean) || !/[0-9]/.test(clean)) return null;
  if (clean.length > 60) return null;
  try {
    // eslint-disable-next-line no-new-func
    const val = Function(`"use strict"; return (${clean});`)();
    return typeof val === 'number' && Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

export function runLocalExpressCheck({ conditionText = '', draftText = '', checkType = 'general', grade = 8 }) {
  const text = (draftText || '').trim();
  const findings = [];
  let fixedText = text;

  if (text) {
    // 1. Orthography scan
    for (const item of ORTHO_RULES) {
      if (!item.fix) continue;
      let match;
      const rx = new RegExp(item.re.source, item.re.flags);
      while ((match = rx.exec(text)) !== null) {
        const orig = match[0];
        if (EXCEPTION_CHU.has(orig.toLowerCase())) continue;
        const replacement = orig.replace(new RegExp(item.re.source, 'iu'), item.fix);
        if (replacement.toLowerCase() !== orig.toLowerCase()) {
          findings.push({
            fragment: orig,
            type: 'Орфография',
            fix: replacement,
            why: item.rule,
          });
          fixedText = fixedText.replace(orig, replacement);
        }
      }
    }

    // 2. Missing comma before subordinate / adversative conjunctions
    const commaConjunctions = ['потому что', 'так как', 'а также', 'но', 'зато', 'однако', 'который', 'которая', 'которое', 'которые', 'чтобы'];
    for (const conj of commaConjunctions) {
      const rx = new RegExp(`([а-яёА-ЯЁ0-9])\\s+(${conj})\\b`, 'gu');
      let m;
      while ((m = rx.exec(fixedText)) !== null) {
        const beforeIdx = Math.max(0, m.index - 12);
        const contextBefore = fixedText.slice(beforeIdx, m.index + 1).toLowerCase();
        if (contextBefore.endsWith('не ') || contextBefore.endsWith('и ')) continue;
        findings.push({
          fragment: `${m[0]}`,
          type: 'Пунктуация',
          fix: `${m[1]}, ${m[2]}`,
          why: `Перед союзом / союзным словом «${conj}» обычно ставится запятая, разделяющая части предложения.`,
        });
      }
    }

    // 3. Arithmetic equality chain check (e.g. "D = 49 - 24 = 27" or "2 * 6 + 3 = 16")
    const lines = text.split(/\n|;/);
    for (const line of lines) {
      if (!line.includes('=')) continue;
      const parts = line.split('=').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        for (let i = 0; i < parts.length - 1; i++) {
          const v1 = safeEvalSimpleMathExpr(parts[i]);
          const v2 = safeEvalSimpleMathExpr(parts[i + 1]);
          if (v1 !== null && v2 !== null && Math.abs(v1 - v2) > 1e-6) {
            const niceCorrect = Number.isInteger(v1) ? String(v1) : Number(v1.toFixed(4)).toString();
            findings.push({
              fragment: `${parts[i]} = ${parts[i + 1]}`,
              type: 'Вычислительная ошибка',
              fix: `${parts[i]} = ${niceCorrect}`,
              why: `Левая часть выражения равна ${niceCorrect}, а написано ${parts[i + 1]}.`,
            });
          }
        }
      }
    }
  }

  // 4. Word & paragraph statistics (especially useful for essays)
  const words = text ? text.split(/\s+/).filter((w) => /[а-яёa-z0-9]/iu.test(w)) : [];
  const wordCount = words.length;
  const paragraphs = text ? text.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean).length : 0;

  let volumeNote = '';
  if (checkType === 'essay_oge') {
    volumeNote =
      wordCount >= 70
        ? `✅ Объём соответствует требованиям ОГЭ: **${wordCount} слов** (минимум 70 слов), абзацев: **${paragraphs}**.`
        : `⚠️ Внимание по критериям ОГЭ: сейчас **${wordCount} слов**, а для зачёта сочинения 13.1/13.2/13.3 нужно **не менее 70 слов**!`;
  } else if (checkType === 'essay_ege') {
    volumeNote =
      wordCount >= 150
        ? `✅ Объём соответствует требованиям ЕГЭ: **${wordCount} слов** (минимум 150 слов), абзацев: **${paragraphs}**.`
        : `⚠️ Внимание по критериям ЕГЭ: сейчас **${wordCount} слов**, работы менее **150 слов** не засчитываются экспертами ФИПИ!`;
  } else if (wordCount > 0) {
    volumeNote = `📊 Статистика текста: слов — **${wordCount}**, смысловых строк/абзацев — **${paragraphs}**.`;
  }

  return {
    wordCount,
    paragraphs,
    volumeNote,
    findings,
    fixedText,
    conditionText,
    grade,
  };
}

export function buildOfflineTeacherCheckMarkdown(expressResult, { checkType = 'general', grade = 8 } = {}) {
  const { findings, fixedText, volumeNote, wordCount } = expressResult;
  const errCount = findings.length;
  let score = 5;
  if (errCount >= 1 && errCount <= 2) score = 4;
  else if (errCount >= 3 && errCount <= 5) score = 3;
  else if (errCount > 5) score = 2;

  if ((checkType === 'essay_oge' && wordCount > 0 && wordCount < 70) || (checkType === 'essay_ege' && wordCount > 0 && wordCount < 150)) {
    score = Math.min(score, 3);
  }

  const rows = findings.length
    ? findings
        .map(
          (f, idx) =>
            `| ${idx + 1} | «${f.fragment}» | ${f.type} | **${f.fix}** | ${f.why} |`
        )
        .join('\n')
    : '| — | Явных орфографических и арифметических сбоев не обнаружено | — | Выглядит аккуратно | Проверьте смысловую полноту ответа по условию |';

  return `### Предварительная оценка (локальный экспресс-проверщик, ${grade} класс): **«${score}»**

${volumeNote}

### Найденные ошибки и замечания (${errCount})

| № | Фрагмент в черновике | Тип ошибки | Как правильно | Объяснение правила |
|---|---|---|---|---|
${rows}

### Исправленный вариант текста

${fixedText || '*(Текст черновика пуст)*'}

> 💡 *Примечание: выполнена мгновенная локальная проверка орфографии, пунктуации и вычислений. Для глубокого смыслового разбора учителем-ИИ убедитесь, что файл открыт с доступом в интернет или подключён бесплатный ключ Gemini / OpenRouter.*`;
}
