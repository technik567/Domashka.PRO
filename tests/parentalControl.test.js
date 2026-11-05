import { describe, it, expect, vi } from 'vitest';
import { getParentalStatus, setTutorModeEnabled, changeParentPassword, subscribeParentalControl } from '../src/standalone/parentalControl';

const KEY = 'domashka_parental_control_v1';
const password = 'родитель-123';

describe('parental lock', () => {
  it('starts unlocked and rejects short passwords', async () => {
    expect(getParentalStatus().enabled).toBe(false);
    await expect(setTutorModeEnabled(true, '123')).rejects.toThrow('8');
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it('persists only a salted hash, not the password', async () => {
    await setTutorModeEnabled(true, password);
    const raw = localStorage.getItem(KEY);
    expect(raw).not.toContain(password);
    expect(JSON.parse(raw)).toMatchObject({ enabled: true, iterations: 310000 });
    expect(JSON.parse(raw).hash).toHaveLength(64);
    expect(getParentalStatus()).toMatchObject({ enabled: true, configured: true });
    const saved = JSON.parse(raw);
    localStorage.clear(); getParentalStatus();
    await setTutorModeEnabled(true, password);
    expect(JSON.parse(localStorage.getItem(KEY)).hash).not.toBe(saved.hash);
  });
  it('wrong password cannot disable or change the lock; correct password can', async () => {
    await setTutorModeEnabled(true, password);
    await expect(setTutorModeEnabled(false, 'wrong')).rejects.toThrow('Неверный');
    await expect(changeParentPassword('wrong', 'new-password')).rejects.toThrow('Неверный');
    expect(getParentalStatus().enabled).toBe(true);
    await changeParentPassword(password, 'new-password');
    await expect(setTutorModeEnabled(false, password)).rejects.toThrow('Неверный');
    await setTutorModeEnabled(false, 'new-password');
    expect(getParentalStatus()).toMatchObject({ enabled: false, configured: true });
    await expect(setTutorModeEnabled(true, 'replacement-password')).rejects.toThrow('Неверный');
    await setTutorModeEnabled(true, 'new-password');
    expect(getParentalStatus().enabled).toBe(true);
  });
  it('rate-limits repeated wrong passwords', async () => {
    await setTutorModeEnabled(true, password);
    for (let i = 0; i < 5; i++) await expect(setTutorModeEnabled(false, 'wrong')).rejects.toThrow();
    await expect(setTutorModeEnabled(false, password)).rejects.toThrow('Подождите');
    expect(getParentalStatus().enabled).toBe(true);
  });
  it('refuses activation if persistent storage is full', async () => {
    getParentalStatus();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    await expect(setTutorModeEnabled(true, password)).rejects.toThrow('Не удалось сохранить');
    expect(getParentalStatus().enabled).toBe(false);
  });
  it('keeps corrupted persisted settings locked', () => {
    localStorage.setItem(KEY, '{bad-json');
    expect(getParentalStatus()).toMatchObject({ enabled: true, corrupted: true });
  });
  it('notifies this tab and responds to storage events from other tabs', async () => {
    const changed = vi.fn(); const stop = subscribeParentalControl(changed);
    await setTutorModeEnabled(true, password);
    expect(changed).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
