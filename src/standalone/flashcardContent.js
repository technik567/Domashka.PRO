import { FLASHCARD_EXERCISES } from './flashcardExercises.js';

/**
 * Extracts crisp Question <-> Answer flashcards from one or more CheatSheet objects!
 */
export function buildFlashcardsFromSheets(sheets, maxCards = 18) {
  const list = Array.isArray(sheets) ? sheets : sheets ? [sheets] : [];
  const cards = [];

  for (const sheet of list) {
    if (!sheet?.content) continue;
    const lines = String(sheet.content).split(/\r?\n/);
    let extractedForSheet = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // 1. Bullet item: - **Front:** Back  OR  - **Front** — Back
      const bulletMatch = line.match(/^[-*•]\s+\*\*([^*]+)\*\*\s*[:—–-]?\s*(.+)$/);
      if (bulletMatch) {
        const frontTerm = bulletMatch[1].replace(/:$/, '').trim();
        const backDef = bulletMatch[2].trim();
        if (frontTerm && /[\p{L}\p{N}]/u.test(backDef)) {
          cards.push({
            id: `${sheet.id}-b-${extractedForSheet}`,
            topic: sheet.title,
            gradeLabel: `${sheet.minGrade}–${sheet.maxGrade} кл.`,
            front: `**${frontTerm}**\n\n*(Из темы: «${sheet.title}»)*`,
            back: backDef,
          });
          extractedForSheet += 1;
          continue;
        }
      }

      // 2. Markdown table row: | Col1 | Col2 | ...
      if (line.startsWith('|') && line.endsWith('|') && !/^\|[\s\-:|]+\|$/.test(line)) {
        const cells = line
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        if (cells.length >= 2) {
          const c0 = cells[0].replace(/\*\*/g, '').trim();
          const low0 = c0.toLowerCase();
          if (
            c0 &&
            cells[1] &&
            !['название', 'формула', 'величина', 'падеж', 'термин', 'правило', 'функция', 'время'].includes(low0)
          ) {
            cards.push({
              id: `${sheet.id}-t-${extractedForSheet}`,
              topic: sheet.title,
              gradeLabel: `${sheet.minGrade}–${sheet.maxGrade} кл.`,
              front: `**${cells[0]}**\n\n*(Тема: «${sheet.title}»)*`,
              back: cells.slice(1).join(' — '),
            });
            extractedForSheet += 1;
          }
        }
      }
    }

    // Fallback: whole compact cheat sheet as 1 summary card
    if (extractedForSheet === 0) {
      cards.push({
        id: `${sheet.id}-full`,
        topic: sheet.title,
        gradeLabel: `${sheet.minGrade}–${sheet.maxGrade} кл.`,
        front: `Вспомните правило / формулу:\n\n### ${sheet.title}`,
        back: sheet.content,
      });
    }

    if (cards.length >= maxCards) break;
  }

  return cards.slice(0, maxCards);
}


// Stable content identity, not a password hash or a claim of cheat-proof testing.
// A changed rule is a new card; restarting a deck is not.
export function flashcardKey(card) {
  const text = `check-v1\n${card.front}\n${card.back}`;
  let a = 2166136261; let b = 3339675911;
  for (const character of text) {
    a = Math.imul(a ^ character.codePointAt(0), 16777619);
    b = Math.imul(b ^ character.codePointAt(0), 2246822519);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

const UNITS = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять',
  'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const WORD_NUMBERS = new Map([['нуль', '0'], ['одна', '1'], ['одно', '1'], ['две', '2'], ['сто', '100']]);
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
for (let n = 0; n < 1000; n++) {
  const rest = n % 100; const tail = rest < 20 ? UNITS[rest] : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? ` ${UNITS[rest % 10]}` : ''}`;
  WORD_NUMBERS.set(n < 100 ? tail : `${HUNDREDS[Math.floor(n / 100)]}${rest ? ` ${tail}` : ''}`, String(n));
}
WORD_NUMBERS.set('тысяча', '1000'); WORD_NUMBERS.set('одна тысяча', '1000');
for (const [word, number] of [...WORD_NUMBERS]) {
  if (word === 'один' || word.endsWith(' один')) { WORD_NUMBERS.set(word.replace(/один$/, 'одна'), number); WORD_NUMBERS.set(word.replace(/один$/, 'одно'), number); }
  if (word === 'два' || word.endsWith(' два')) WORD_NUMBERS.set(word.replace(/два$/, 'две'), number);
}
export const FLASHCARD_WORD_NUMBERS = [...WORD_NUMBERS];
export function normalizeFlashcardAnswer(value) {
  let text = String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/ё/g, 'е')
    .replace(/[−–]/g, '-').replace(/^[\s.!?,;:]+|[\s.!?,;:]+$/g, '').replace(/\s+/g, ' ');
  if (WORD_NUMBERS.has(text)) return WORD_NUMBERS.get(text);
  if (text.startsWith('минус ') && WORD_NUMBERS.has(text.slice(6))) text = '-' + WORD_NUMBERS.get(text.slice(6));
  const fraction = text.match(/^(минус )?(.+?) цел(?:ая|ых) (.+?) (десятая|десятых|сотая|сотых|тысячная|тысячных)$/);
  if (fraction) {
    const number = (part) => WORD_NUMBERS.get(part) ?? (/^\d+$/.test(part) ? part : null);
    const whole = number(fraction[2]), part = number(fraction[3]);
    const scale = fraction[4].startsWith('десят') ? 1 : fraction[4].startsWith('сот') ? 2 : 3;
    if (whole !== null && part !== null && Number(part) < 10 ** scale) text = `${fraction[1] ? '-' : ''}${whole}.${part.padStart(scale,'0')}`;
  }
  text = text.replace(/,/g, '.');
  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) {
    const negative = text.startsWith('-'); const [whole, fraction = ''] = text.replace(/^[+-]/, '').split('.');
    const integer = whole.replace(/^0+(?=\d)/, ''); const tail = fraction.replace(/0+$/, '');
    return `${negative && (integer !== '0' || tail) ? '-' : ''}${integer}${tail ? '.' + tail : ''}`;
  }
  return text;
}

// No AI grading, no invented facts. Small verified mental-arithmetic templates
// where the card's topic is explicit; otherwise exact recall from its own text.
const MENTAL_CHECKS = [
  [/процент/i, [['Сколько будет 10% от 80? Напиши только число.', '8'], ['Сколько будет 25% от 40? Напиши только число.', '10']]],
  [/периметр.*прямоугольник|прямоугольник.*периметр/i, [['Стороны прямоугольника — 3 и 5 см. Чему равен периметр в сантиметрах?', '16']]],
  [/площадь.*прямоугольник|прямоугольник.*площадь/i, [['Стороны прямоугольника — 4 и 6 см. Чему равна площадь в квадратных сантиметрах?', '24']]],
  [/площадь.*треугольник|треугольник.*площадь/i, [['Основание треугольника — 6 см, высота к нему — 4 см. Чему равна площадь в квадратных сантиметрах?', '12']]],
  [/среднее арифметическое/i, [['Чему равно среднее арифметическое чисел 4 и 8?', '6'], ['Чему равно среднее арифметическое чисел 3, 6 и 9?', '6']]],
  [/плотность/i, [['Масса вещества — 20 г, его объём — 5 кубических сантиметров. Найди плотность в граммах на кубический сантиметр. Ответ — число.', '4']]],
  [/равномерное движен|скорость.*путь|путь.*скорость/i, [['При равномерном движении пройдено 12 м за 3 с. Чему равна скорость в метрах в секунду?', '4']]],
];
const STOP_WORDS = new Set(('который которая которое которые каждого каждый такая такое такие этого этой этих чтобы когда если тогда только также после перед между через сначала затем например поэтому потому нужно можно нельзя всегда иногда обычно очень более менее будет будут есть имеют имеет является являются должен должна должны важно правило пример ответ решение задача задачи значение значения способ формула формулы проверка проверьте запомните используйте определите найдите объясните считайте применяют означает помогает один одного двух трех четыре пять').split(' '));
function plainRecallText(markdown) {
  return String(markdown || '').replace(/```[\s\S]*?```/g, ' ').replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, ' … ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, ' ')
    .replace(/[*_#`|>]/g, '').replace(/^\s*[-•]\s*/gm, '').replace(/\s+/g, ' ').trim();
}
export function buildFlashcardChecks(card) {
  const explicit = FLASHCARD_EXERCISES[card.id];
  if (explicit) return [{ question: explicit[0], answers: [normalizeFlashcardAnswer(explicit[1])], kind: 'mental' }];
  const title = `${card.topic || ''} ${String(card.front || '').split('\n')[0]}`;
  for (const [pattern, checks] of MENTAL_CHECKS) {
    if (pattern.test(title)) return checks.map(([question, answer]) => ({ question, answers: [normalizeFlashcardAnswer(answer)], kind: 'mental' }));
  }
  const text = plainRecallText(card.back);
  const candidates = [...text.matchAll(/[А-Яа-яЁёA-Za-z]{4,24}/gu)]
    .filter((match) => !STOP_WORDS.has(normalizeFlashcardAnswer(match[0])) && match.index < 800)
    .sort((a, b) => Math.abs(a[0].length - 9) - Math.abs(b[0].length - 9) || a.index - b.index);
  const used = new Set(); const checks = [];
  for (const match of candidates) {
    const answer = normalizeFlashcardAnswer(match[0]);
    if (used.has(answer)) continue;
    used.add(answer);
    // Keep a complete short clause when possible. Explicitly ask for the
    // wording on the card, rather than marking arbitrary synonyms as false.
    let start = Math.max(0, match.index - 85); let end = Math.min(text.length, match.index + match[0].length + 100);
    if (start) { const space = text.indexOf(' ', start); start = space < match.index ? space + 1 : start; }
    if (end < text.length) { const space = text.lastIndexOf(' ', end); end = space > match.index + match[0].length ? space : end; }
    const excerpt = `${start ? '…' : ''}${text.slice(start, match.index)}［пропуск］${text.slice(match.index + match[0].length, end)}${end < text.length ? '…' : ''}`;
    // Do not reveal the same answer elsewhere in the question.
    const masked = excerpt.replace(new RegExp(match[0], 'giu'), '［пропуск］');
    checks.push({ question: `Восстанови одно слово из формулировки карточки:\n\n${masked}\n\nВпиши слово в той же форме.`, answers: [answer], kind: 'recall' });
    if (checks.length === 3) break;
  }
  // A formula-only card without a safely checkable short answer remains useful
  // for practice, but must not award XP for self-reporting knowledge.
  return checks;
}
