import { safeStorage } from './storageEngine';
export const INTERFACE_KEY = 'domashka_interface_v1';
export function loadInterfacePreferences() {
  let saved; try { saved=JSON.parse(safeStorage.getItem(INTERFACE_KEY)||'{}'); } catch { saved={}; }
  return {mode:saved?.mode==='advanced'?'advanced':'basic',background:saved?.background!==false};
}
export function saveInterfacePreferences(value) {
  const safe={mode:value?.mode==='advanced'?'advanced':'basic',background:value?.background!==false};
  safeStorage.setItem(INTERFACE_KEY,JSON.stringify(safe)); return safe;
}
