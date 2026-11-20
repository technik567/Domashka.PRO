import { validateSearchQuery } from './webSearch';

const MAX_ACTION_CHARS = 4096;
const invalid = () => Object.assign(new Error('Модель вернула некорректную команду поиска вместо ответа. Команда не выполняется; нового поиска и автоматического повтора нет.'), { code:'search-action-invalid' });

// Legacy control detection only. The workflow REJECTS these outputs; no model
// action is executable. Never infer/repair a query from model prose or tools.
export function parseSearchPlan(text, maxQueries = 1) {
  if (typeof text !== 'string' || text.length > MAX_ACTION_CHARS) throw invalid();
  let plan;
  try { plan = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw invalid(); }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).some(k => !['search','queries'].includes(k))
      || typeof plan.search !== 'boolean' || !Array.isArray(plan.queries) || plan.queries.length > maxQueries
      || plan.search !== (plan.queries.length > 0)) throw invalid();
  return { search:plan.search, queries:[...new Set(plan.queries.map(validateSearchQuery))] };
}

// Ordinary replies and code samples are not actions. Recognise reserved
// control-shaped output so a stale model response cannot become a solution.
// Parsing is for rejection only, never permission to run another search.
export function parseSearchAction(text, maxQueries = 1) {
  if (typeof text !== 'string' || !text.trim()) throw invalid();
  const raw = text.trim();
  let control;
  if (/```domashka-search\b/i.test(raw)) {
    const block = raw.match(/^```domashka-search[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
    if (!block || raw.length > MAX_ACTION_CHARS) throw invalid();
    control = block[1];
  } else {
    const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    // Accept bare control JSON from models which omit the requested fence,
    // but do not interpret ordinary code samples/quoted blocks as actions.
    if (!json.startsWith('{')) return null;
    if (json.length > MAX_ACTION_CHARS) {
      if (/^\{\s*"(?:search|queries)"\s*:/.test(json)) throw invalid();
      return null;
    }
    let object;
    try { object = JSON.parse(json); }
    catch {
      if (/^\{\s*"(?:search|queries)"\s*:/.test(json)) throw invalid();
      return null;
    }
    if (!object || !Object.hasOwn(object, 'search') && !Object.hasOwn(object, 'queries')) return null;
    control = json;
  }
  const plan = parseSearchPlan(control, maxQueries);
  // A legacy search:false is NOT an answer. Do not spend another generation
  // to recover it, show control JSON to the pupil, or pretend a search occurred.
  if (!plan.search) throw invalid();
  return plan;
}
