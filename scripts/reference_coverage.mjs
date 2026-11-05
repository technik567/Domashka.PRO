import fs from 'node:fs';
import { CHEAT_SHEETS, SUBJECTS } from '../src/data/referenceData.js';
import { cheatCoverage, SUBJECT_GRADE_RANGES } from '../src/data/cheatCurriculum.js';

const rows = cheatCoverage(CHEAT_SHEETS);
const pairs = rows.reduce((n, row) => n + Object.keys(row.subjects).length, 0);
const newCount = CHEAT_SHEETS.filter((sheet) => sheet.id.startsWith('v4-')).length;
const table = Object.keys(SUBJECT_GRADE_RANGES).map((subject) => {
  const label = SUBJECTS.find((item) => item.id === subject)?.label || subject;
  return `| ${label} | ${rows.map((row) => row.subjects[subject] ?? '—').join(' | ')} |`;
});
const output = `# Покрытие базы шпаргалок 4.0

Согласованная цель: **около 25 карточек всего**, а не 25 новых, на каждую пару «класс — предмет» справочного набора.

- **${CHEAT_SHEETS.length} уникальных карточек**, из них **${newCount} новых** в 4.0.
- **${pairs} пар «класс — предмет»**, в каждой **не менее 25** карточек.
- Общая тема может относиться к нескольким соседним классам: её единственная запись учитывается в каждом применимом классе. Карточки не копируются ради увеличения счётчика. Числа в таблице нельзя складывать для получения числа уникальных карточек всей базы.
- Диапазон виден на самой карточке. «Мой класс» и числовые фильтры проверяют этот диапазон; поиск никогда не отключает фильтры без отдельного нажатия.
- «—» означает отсутствие отдельного предмета в данном диапазоне справочного набора. Начальные геометрические понятия входят в математику; окружающий мир — 1–4 классы.

Это организация **справочного набора**, не утверждение об обязательном или актуальном учебном плане каждой школы. Начало информатики/обществознания и наличие отдельного проекта зависят от программы; ранние материалы могут служить дополнительной подготовкой. Согласуйте подборку с учителем. В режиме «Все» сохранены и дополнительные материалы прежней базы.

| Предмет | ${rows.map((row) => `${row.grade} кл.`).join(' | ')} |
|---|${rows.map(() => '---:').join('|')}|
${table.join('\n')}
| **Всего доступных в классе** | ${rows.map((row) => Object.values(row.subjects).reduce((a, n) => a + n, 0)).join(' | ')} |

## Проверки и границы проверки

Автотесты проверяют все ${pairs} пары, уникальность идентификаторов, отсутствие дословно клонированных новых карточек, диапазоны, непустое содержимое и синтаксис 250 новых математических фрагментов в KaTeX. Это не независимая экспертиза каждой формулировки или официальная сертификация по ФГОС/ФИПИ. Новые материалы — компактные учебные объяснения и примеры; экзаменационные требования нужного года следует сверять отдельно.

В старом справочнике точечно уточнены условия формул интеграла/площади, стандартная запись отрицательных чисел, условия встречи в задачах на движение и название графика квадратного корня. Остальная старая база не переписывалась предположительно.

Таблица воспроизводится командой \`node scripts/reference_coverage.mjs\`; проверка без изменения файла — \`npm run check:reference\`.
`;
const path = new URL('../REFERENCE_COVERAGE.md', import.meta.url);
if (process.argv.includes('--check')) {
  if (!fs.existsSync(path) || fs.readFileSync(path, 'utf8') !== output) throw new Error('REFERENCE_COVERAGE.md не соответствует данным. Выполните node scripts/reference_coverage.mjs.');
} else fs.writeFileSync(path, output);
for (const row of rows) for (const [subject, count] of Object.entries(row.subjects)) if (count < 25) throw new Error(`Не хватает карточек: ${row.grade}/${subject}: ${count}`);
console.log(`${CHEAT_SHEETS.length} unique cards; ${newCount} new; ${pairs} grade/subject pairs meet the target.`);
