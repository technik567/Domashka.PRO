import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
Element.prototype.scrollIntoView = () => {};
beforeEach(() => {
  localStorage.clear();
  window.__STANDALONE_BUILD__ = true;
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network disabled in tests'))));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
