import { getCurrentAccount, getManagedChild, subscribeAccounts, assertAiAllowed } from './accounts';
import { isTutorModeEnabled, subscribeParentalControl } from './parentalControl';
// Deliberately memory-only. Never localStorage, sessionStorage, URL, model
// messages, cloud preferences, study exports, telemetry, logs or help context.
let value = '', owner = '', cleanup;
const fingerprint = () => getCurrentAccount()?.id || 'guest';
export function canSetSearchKey() { return !getManagedChild() && !isTutorModeEnabled(); }
export function clearSearchKey() { value=''; owner=''; cleanup?.(); cleanup=undefined; }
export function setSearchKey(key) {
  assertAiAllowed();
  if (!canSetSearchKey()) throw new Error('Поисковые ключи недоступны в детском режиме.');
  const clean = String(key || '').trim();
  if (clean && !/^tvly-[A-Za-z0-9_-]{10,240}$/.test(clean)) throw new Error('Нужен ключ Tavily, начинающийся с tvly-.');
  clearSearchKey(); value=clean; owner=fingerprint();
  const stopAccount=subscribeAccounts(clearSearchKey), stopPolicy=subscribeParentalControl(clearSearchKey);
  cleanup=()=>{stopAccount();stopPolicy();};
}
export function getSearchKey() {
  if (owner !== fingerprint() || !canSetSearchKey()) { clearSearchKey(); return ''; }
  return value;
}
export function hasSearchKey() { return Boolean(getSearchKey()); }
