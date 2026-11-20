import { validateSearchQuery } from './webSearch';

// Deliberately conservative, deterministic rules — NOT an AI classifier.
// Only the current typed task/topic enters this function. No history, profile,
// draft, OCR or image is inspected or sent to a search provider.
export const LOCAL_SEARCH_INPUT_LIMIT = 2000;
export const LOCAL_SEARCH_QUERY_LIMIT = 180;
const MAX_TERMS = 12;
const STOP = new Set(`а без бы был была были было быть в вам вас ваш ваша ваши во вот все всего вы где да дай дайте для до его ее её если есть еще ещё же за здесь и из или им их к как какая какие какой какую ко когда кто ли либо мне мной мы на над надо нам нас наш не него нее неё нет ни но ну о об обо он она они оно от по под при про с со так также там тебе тебя тем то того тоже только том тот ту ты у уже что чтобы эта эти это эту этот я
найди найдите найти ищи ищите искать поищи поищите поиск поиском поиска поиску найдем найдём подбери подберите приведи приведите покажи покажите пожалуйста проверь проверьте проверить используй используйте использовать
источник источника источники источников источникам источнике источниками ссылку ссылки ссылок ссылками ссылке ссылкой сайт сайта сайты сайтов публикации публикацию материалы материал информацию информация информации данные данных сведения сведений интернете интернет интернету интернетом сети сеть веб онлайн
ответ ответь ответьте ответа ответом ответу кратко коротко краткий короткий коротким одним одно предложение предложением предложении напиши напишите расскажи расскажите объясни объясните объяснение вопрос вопроса задание задания задаче задача задачу текст текста тексту тему тема темы тематике этому этого данном данной указанному выше ниже предыдущему предыдущий предыдущего учебный учебные учебного учебных
написать узнать получить составить сделай сделайте процитируй цитаты цитату нужна нужны нужно нужен
сделать раз новый новая новые нового новой вопросу вопросе вопросом вопросам теме работу работы работе фото фотографии фотографию изображение картинке картинку черновик черновика решению решения решении нем нём ней этой моему моего моё мое мои моя мой прошлый прошлой прошлому остальное предыдущем предыдущей другой другую такой такая таким сегодняшний моей мою моим вашим вашей условие условия условию условии условием пример примера примеру примере
интернет-поиск веб-поиск sources references source reference official
about an and are as at be been but by can could did do does explain find for from give has have how i in information into is it its look me more my of on one online or our please provide say search show short should tell than that the their them then there these they this those to up use using was web website were what when where which who why will with would you your`.split(/\s+/));

const MESSAGES = Object.freeze({
  private: 'Авто-поиск остановлен: текст похож на личные данные, контакт или секрет. Поисковику ничего не отправлено. Уберите эти сведения из обычного сообщения.',
  structured: 'Авто-поиск остановлен: ссылки, код и служебные данные не превращаются в поисковую фразу. Укажите учебную тему обычным текстом, без отдельного поля поиска.',
  long: 'Авто-поиск остановлен: текст слишком длинный для безопасного локального выделения темы. Сократите обычное сообщение; целиком оно поисковику не отправляется.',
  topic: 'Авто-поиск не смог выделить учебную тему из текущего сообщения. Добавьте название темы в обычный вопрос: история, фото и черновик не используются для угадывания запроса.',
});
const fail = kind => Object.assign(new Error(MESSAGES[kind]), {code:`search-local-${kind}`});
const skip = reason => ({search:false,queries:[],reason});

function intent(text) {
  const lower=text.toLowerCase();
  if (/(?:не\s+(?:ищи|ищите|искать|используй|используйте|нужен|нужны|надо|нужно)[^.!?\n]{0,45}(?:интернет|поиск|источник)|без\s+(?:интернета|интернет-поиска|веб-поиска)|\b(?:do not|don't) (?:search|browse)|\bwithout (?:web|internet|search))/u.test(lower)) return 'disabled-by-task';
  const plain=lower.replace(/```[\s\S]*?```/g,'')
    .replace(/источник[а-яё]*\s+(?:(?:постоянного|переменного)\s+)?(?:тока|питания|энергии|света|тепла|звука)/gu,'');
  if (/(?:найд[иуёе]|найти|ищи|ищите|поищи|подбер|подбери|приведи|привести|покажи|показать|проверь|проверить|нужн|дайте|дай|хочу)[^.!?\n]{0,150}(?:источник|ссылк|в\s+интернете|в\s+сети|официальн|сайт|публикаци)|(?:используй|использовать|выполни|запусти)[^.!?\n]{0,40}(?:веб-поиск|интернет-поиск|поиск)|(?:по\s+источникам|со\s+ссылк(?:ой|ами)\s+на\s+источник|с\s+источниками)|проверь(?:те)?[,\s]+(?:факт|достоверность|верно\s+ли|правда\s+ли)|\b(?:search for|search the web|look up|find sources|cite sources)|\b(?:find|verify|provide|give|show)\b[^.!?\n]{0,100}\b(?:sources?|references?|official|websites?|online|internet)\b/u.test(plain)) return 'sources-requested';
  if (/(?:объясни|объясните|что\s+такое|что\s+значит|как\s+работает|значение\s+слова)/u.test(plain) && !/(?:сегодня|завтра|сейчас|актуальн|действующ|последн|новейш)/u.test(plain)) return 'not-needed';
  if (/(?:^|[.!?\n]\s*)(?:какие\s+)?новости\s|(?:свежие|последние|сегодняшние)\s+новости|(?:погод[ауые]\s+в\s|прогноз\s+погоды)|курс\s+(?:валют|доллара|евро|рубля|злотого)|(?:кто|какой|какая|сколько)[^.!?\n]{0,80}(?:сейчас|на\s+сегодня)|(?:сейчас|сегодня)[^.!?\n]{0,50}(?:президент|министр|население|цена|курс\s+валют)|(?:актуальн|действующ)[^.!?\n]{0,35}(?:правил|норм|требован|закон|верси|цен)|(?:последн|новейш)[^.!?\n]{0,20}верси|\b(?:latest news|current (?:president|price|rules)|latest version|weather in|exchange rate)\b/u.test(plain)) return 'current-information';
  return 'not-needed';
}
function privacyPreflight(text) {
  // Check the ENTIRE bounded input before dropping stop-words or cutting the
  // query. Otherwise a trailing email/key could silently become unrecognised.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u.test(text)
    || /(?:sb_secret_|sb_publishable_|tvly-|sk-[a-z0-9]{12}|eyJ[a-z0-9_-]{20}|[a-f0-9]{8}(?:[- ]?[a-f0-9]{8}){3}|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:пароль|password|секрет|secret|логин|login|token|токен)\s*[:=]|(?:\+?\d[ ()-]*){10,})/iu.test(text)
    || /(?:меня\s+зовут|(?:мой|моя|моё|мое|мои)\s+(?:данные|адрес|телефон|логин|пароль|код)|я\s+(?:живу|учусь)|фамилия\s*[:=]|дата\s+рождения|резервн[а-яё]*\s+код|код[а-яё]*\s+восстановлен|школ[а-яё]*\s*(?:№|номер)\s*\d|(?:улица|квартира|ул\.|кв\.)\s|\b(?:my (?:name|address|phone|password)|recovery codes?|backup codes?|date of birth)\b)/iu.test(text)) throw fail('private');
  if (/(?:^|[^\p{L}])(?:адрес|телефон|паспорт|снилс|инн|pe[sś]el|email|e-mail|фамилия|отчество|парол[а-яё]*|passwords?|секрет[а-яё]*|secrets?|токен[а-яё]*|tokens?|api[ -]?key)(?:$|[^\p{L}])|(?:моя|мой|моего|моей|наш|наша|нашего|нашей)\s+(?:семь|сестр|брат|мам|пап|учител|школ|однокласс)|школ[а-яё]*\s*(?:№|номер)?\s*\d|\b(?:street|apartment|phone number|home address)\b/iu.test(text)) throw fail('private');
  // A pair/triple of title-cased words can be a pupil's name. We cannot
  // establish whether it names a public figure, so refuse rather than guess.
  if (/(?:^|[^\p{L}])[\p{Lu}][\p{Ll}]{1,}\s+[\p{Lu}][\p{Ll}]{1,}(?=$|[^\p{L}])/u.test(text)) throw fail('private');
  if (/(?:https?:|ftp:|www\.|data:|blob:|\b[a-z0-9-]+\.(?:com|org|net|ru|pl|co|dev|io)\b)|```|[<>{}]|\b(?:authorization|bearer)\b|(?:прочитано\s+с\s+фото|распознанн[а-яё]*\s+с\s+фото|черновик\s*\/\s*решение)/iu.test(text)) throw fail('structured');
  for (const word of text.match(/[\p{L}\p{N}_-]+/gu) || []) {
    if (word.length>40 || /^[A-Za-z0-9_-]{24,}$/.test(word) && /[\d_]/.test(word)) throw fail('structured');
  }
}

export function planLocalSearch(task) {
  if (typeof task !== 'string') throw fail('topic');
  if (!task.trim()) return skip('no-text');
  // Bounds apply even to classification; never scan arbitrarily large essays.
  const examined=task.slice(0,LOCAL_SEARCH_INPUT_LIMIT+1).normalize('NFKC');
  const reason=intent(examined);
  if (['not-needed','disabled-by-task'].includes(reason)) return skip(reason);
  if (task.length>LOCAL_SEARCH_INPUT_LIMIT || examined.length>LOCAL_SEARCH_INPUT_LIMIT) throw fail('long');
  privacyPreflight(task);
  if (task !== examined) privacyPreflight(examined);
  // Select the one current search/request clause, NOT the whole message or
  // the first N words of an essay. A later unrelated sentence never joins it.
  const clauses=examined.split(/[.!?;](?:\s+|$)|\n+/u).filter(part=>part.trim());
  const clause=clauses.find(part=>intent(part)===reason);
  if (!clause) throw fail('topic');
  const terms=[],seen=new Set();
  for (const match of clause.matchAll(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu)) {
    const term=match[0],key=term.toLowerCase();
    if (STOP.has(key)||seen.has(key)||key.length<2) continue;
    if (term.length>40 || /^[A-Za-z0-9_-]{28,}$/.test(term)&&/\d/.test(term)) throw fail('structured');
    seen.add(key);terms.push(term);
  }
  // A deictic "найди источники к этому" is not a topic. Never mine a previous
  // private turn or the attached photo for something plausible instead.
  if (!terms.some(term=>/\p{L}{3}/u.test(term))) throw fail('topic');
  // Too much material is ambiguous, not permission to chop a private task
  // into an arbitrary query. Refuse and ask for a shorter ordinary question.
  if (terms.length>MAX_TERMS || terms.join(' ').length>LOCAL_SEARCH_QUERY_LIMIT) throw fail('topic');
  const query=validateSearchQuery(terms.join(' '));
  return {search:true,queries:[query],reason};
}

export const LOCAL_SEARCH_LABELS = Object.freeze({
  'sources-requested':'Приложение распознало просьбу найти источники. Поиск начинается без запроса к модели',
  'current-information':'Приложение распознало запрос актуальных сведений. Поиск начинается без запроса к модели',
  'not-needed':'По локальным правилам поиск не понадобился. Решение принято приложением, не моделью',
  'disabled-by-task':'В текущем сообщении запрошен ответ без интернет-поиска',
  'no-text':'Для локального автопоиска нет текстовой темы. Фото, OCR и черновик поисковику не отправлялись',
});
export function localSearchDisclosure(reason) {
  return `\n\n> Интернет не использовался. ${LOCAL_SEARCH_LABELS[reason] || LOCAL_SEARCH_LABELS['not-needed']}. Новые источники не проверялись.`;
}
