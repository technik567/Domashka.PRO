// Existing local family accounts and genuine server-backed accounts are separate
// authorities. A configured cloud site MUST NOT fall back to a local registry.
import * as local from './localAccounts';
import { cloud, cloudConfigured } from '../cloud/bridge';
export { ACCOUNTS_KEY, AVATARS, WORKSPACE_ID, persistLocal, issueParentChallenge } from './localAccounts';
function remote() {
  const driver = cloud();
  if (!driver) throw new Error('Облачное рабочее пространство ещё не загружено.');
  return driver;
}
const invoke = (name, args) => cloudConfigured() ? remote()[name](...args) : local[name](...args);
export const getCurrentAccount = () => cloudConfigured() ? cloud()?.getCurrentAccount() || null : local.getCurrentAccount();
export const getAccountGate = () => cloudConfigured() ? cloud()?.getAccountGate() || { configured: true, account: null, accounts: [], transitioning: false, error: '' } : local.getAccountGate();
export const subscribeAccounts = (listener) => cloudConfigured() ? remote().subscribeAccounts(listener) : local.subscribeAccounts(listener);
export const ensureWorkspaceActive = () => cloudConfigured() ? remote().assertActive() : local.ensureWorkspaceActive();
export function workspaceKeyFor(id, key) { return cloudConfigured() ? `domashka_cloud_${remote().projectRef}_${id}::${key}` : local.workspaceKeyFor(id, key); }
export function workspaceKey(key) { return cloudConfigured() ? workspaceKeyFor(remote().uid, key) : local.workspaceKey(key); }
export function workspaceDbName(id) { return cloudConfigured() ? `domashka_cloud_${remote().projectRef}_${id ?? remote().uid}` : local.workspaceDbName(id); }
export const getManagedChild = () => { const user = getCurrentAccount(); return user?.role === 'child' ? user : null; };
export const isChildWorkspace = () => cloudConfigured() ? cloud()?.family?.account.role === 'child' : local.isChildWorkspace();
export function assertAiAllowed() { ensureWorkspaceActive(); cloud()?.verifyAiPolicy(); if (getManagedChild()?.policy.allowAi === false) throw new Error('Родитель отключил ИИ для этого аккаунта. Дневник и материалы остаются доступны.'); }
export const getChildren = (...args) => invoke('getChildren', args);
export const canManageChild = (...args) => cloudConfigured() ? Boolean(cloud()?.canManageChild(...args)) : local.canManageChild(...args);
export const getInheritedAiSettings = (...args) => invoke('getInheritedAiSettings', args);
export const createAccount = (...args) => invoke('createAccount', args);
export const logoutAccount = (...args) => invoke('logoutAccount', args);
export const updateAppearance = (...args) => invoke('updateAppearance', args);
export const updateChild = (...args) => invoke('updateChild', args);
export const changeAccountPassword = (...args) => invoke('changeAccountPassword', args);
export const resetChildPassword = (...args) => invoke('resetChildPassword', args);
export const createLinkCode = (...args) => invoke('createLinkCode', args);
export const linkChild = (...args) => invoke('linkChild', args);
export const revokeChildLink = (...args) => invoke('revokeChildLink', args);
export const getChildStudySummary = (...args) => invoke('getChildStudySummary', args);
export function loginAccount(...args) {
  if (cloudConfigured()) throw new Error('Для смены облачного аккаунта выйдите и откройте форму облачного входа.');
  return local.loginAccount(...args);
}
export function beginAccountTransition() {
  if (cloudConfigured()) throw new Error('Сначала сохраните очередь и выйдите через облачный кабинет.');
  return local.beginAccountTransition();
}
export const needsLegacyPassword = () => !cloudConfigured() && local.needsLegacyPassword();
export const isLegacyOwner = () => !cloudConfigured() && local.isLegacyOwner();
export function authorizeLegacyCopy(id) {
  if (cloudConfigured()) throw new Error('Локальный HTML и сайт имеют разные хранилища. Используйте явный экспорт/импорт учебных данных, не базу паролей.');
  return local.authorizeLegacyCopy(id);
}
