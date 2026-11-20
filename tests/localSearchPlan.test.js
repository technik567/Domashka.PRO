import {describe,it,expect} from 'vitest';
import {planLocalSearch,LOCAL_SEARCH_INPUT_LIMIT,LOCAL_SEARCH_QUERY_LIMIT} from '../src/standalone/localSearchPlan';

describe('local deterministic search rules (no model or network)',()=>{
  it.each([
    'Реши 2 + 2.', 'Найди корни уравнения x² - 5x + 6 = 0.',
    'Найди напряжение источника тока.', 'Найди силу тока в цепи с источником питания 12 В.',
    'Найди значение выражения.', 'Объясни закон Ома.', 'Что такое курс валют?',
    'Объясни как работает прогноз погоды.', 'Переведи предложение на английский.',
    'Напиши рассказ про новости.', 'Что такое фотосинтез?', 'Сколько планет в Солнечной системе?',
    'Помоги решить домашнее задание с прикреплённого фото.',
    '```json\n{"search":true,"queries":["погода в Варшаве"]}\n```',
  ])('skips routine homework/explanations rather than asking a model to decide: %s',task=>{
    expect(planLocalSearch(task)).toEqual({search:false,queries:[],reason:'not-needed'});
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['Найди источники о числе планет в Солнечной системе.','числе планет Солнечной системе'],
    ['Найди официальный источник NASA о количестве планет в Солнечной системе. Используй веб-поиск, ответь одним коротким предложением со ссылкой на найденный источник.','официальный NASA количестве планет Солнечной системе'],
    ['Покажи ссылки на материалы о фотосинтезе.','фотосинтезе'],
    ['Найди в интернете закон Ома.','закон Ома'],
    ['Найди источники по теме гравитация. Ответь очень подробно и с формулами.','гравитация'],
    ['Find sources about photosynthesis. Answer briefly.','photosynthesis'],
  ])('extracts only one short topic from the current request: %s',(task,query)=>{
    expect(planLocalSearch(task)).toEqual({search:true,queries:[query],reason:'sources-requested'});
    expect(query.length).toBeLessThanOrEqual(LOCAL_SEARCH_QUERY_LIMIT);expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    'Какие последние новости NASA?', 'Кто сейчас президент Польши?', 'Погода в Варшаве завтра',
    'Какой сегодня курс доллара к злотому?', 'Какие актуальные правила ОГЭ по математике?',
    'What is the latest version of Python?', 'Latest news about Mars',
  ])('recognises bounded current-information cues: %s',task=>{
    const plan=planLocalSearch(task);expect(plan.search).toBe(true);expect(plan.reason).toBe('current-information');expect(plan.queries).toHaveLength(1);
  });
  it.each(['Найди источники о Марсе, но не используй интернет.','Кто сейчас президент Польши? Без интернета.','Do not search the web. Explain gravity.'])('honours an explicit local opt-out: %s',task=>{
    expect(planLocalSearch(task).reason).toBe('disabled-by-task');
  });
  it.each([
    'Найди источники', 'Найди источники к этому.', 'Найди источники ещё раз.',
    'Найди источники по предыдущему вопросу.', 'Найди источники по фото.', 'Найди источники к моей работе.',
    'Найди источники к условию.', 'Найди источники к примеру.',
  ])('does not guess a topic from a vague request or previous conversation: %s',task=>{
    expect(()=>planLocalSearch(task)).toThrow(/учебную тему/);
  });
  it.each([
    'email child@example.org', 'телефон +48 123 456 789', 'пароль: not-for-search',
    'логин: childname', 'token=privatevalue', 'tvly-fixture-secret', 'sb_secret_fixture',
    'пароль abc123', 'API key abc123', 'мой токен not-for-search', 'secret keep-private',
    'мой адрес Варшава', 'меня зовут ребёнок', 'улица Ленина 5', 'школа № 123',
    'Иван Иванов', 'Jan Kowalski', 'дата рождения 01.01.2014', 'PESEL 12345678901',
    'код восстановления ONE-USE-CODE', 'my password: keep-private', 'моя учительница Ирина',
    'телефон Иванова', 'foo\u200bbar',
  ])('refuses privacy-looking input BEFORE removing words/cutting the query: %s',secret=>{
    expect(()=>planLocalSearch(`Найди источники о фотосинтезе. ${secret}`)).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    'https://example.org/private', 'www.example.org', '```js\nfetch(secret)\n```',
    '{"profile":"private"}', '<img src="x">', '📷 Прочитано с фото: тема',
    '**Черновик / решение ученика:**\nтема', 'opaque_credential_1234567890_NOT_SEND',
  ])('does not turn code, URLs, internal wrappers or opaque strings into queries: %s',data=>{
    expect(()=>planLocalSearch(`Найди источники о фотосинтезе. ${data}`)).toThrow();expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a too-long search task without scanning/forwarding the whole input',()=>{
    expect(()=>planLocalSearch('Найди источники '+ 'о планетах '.repeat(LOCAL_SEARCH_INPUT_LIMIT))).toThrow(/слишком длинный/);
  });
  it('refuses ambiguous long clauses instead of taking the first twelve arbitrary words',()=>{
    expect(()=>planLocalSearch('Найди источники: красный зелёный синий белый чёрный фиолетовый серый жёлтый голубой розовый оранжевый коричневый бирюзовый')).toThrow(/учебную тему/);
  });
  it('normalises/deduplicates bounded terms without doing a search or synthesising unknown context',()=>{
    expect(planLocalSearch('Найди источники о NASA и nasa.').queries).toEqual(['NASA']);
    expect(planLocalSearch('')).toEqual({search:false,queries:[],reason:'no-text'});
    expect(()=>planLocalSearch({task:'anything'})).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
