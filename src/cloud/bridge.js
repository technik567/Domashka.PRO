// Installed exactly once before mounting React. An account never changes inside
// a mounted workspace: login/logout/account switches require a full reload.
let driver = null;
export function installCloudDriver(value) {
  if (driver) throw new Error('Облачное рабочее пространство уже открыто. Перезагрузите страницу.');
  driver = value;
}
export function cloud() { return driver; }
export function cloudConfigured() { return Boolean(globalThis.window?.__DOMASHKA_CLOUD__); }
