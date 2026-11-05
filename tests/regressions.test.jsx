import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { renderMarkdownWithMath } from '../src/components/MarkdownMath';
import PhotoScannerBox from '../src/components/PhotoScannerBox';
import { safeStorage } from '../src/standalone/storageEngine';
import { fetchWithTimeout, raceFirstSuccess } from '../src/standalone/network';
import { solveAlgebraJS, solveFractionsJS, solveTruthTableJS, solveChemistryJS } from '../src/standalone/exactSolvers';

describe('regressions', () => {
  it('sanitizes hostile Markdown/HTML but keeps KaTeX and tables', () => {
    const html = renderMarkdownWithMath('<img src="x" onerror="alert(1)"><script>alert(2)</script>[bad](javascript:alert%281%29)\n\n$\\frac{1}{2}$\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('script,[onerror],a[href^="javascript:"]')).toBeNull();
    expect(doc.querySelector('.katex')).not.toBeNull();
    expect(doc.querySelector('math')).not.toBeNull();
    expect(doc.querySelector('table')).not.toBeNull();
  });
  it('reads the current in-memory preference after a quota failure, not stale disk data', () => {
    safeStorage.setItem('quota-test', 'old');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    safeStorage.setItem('quota-test', 'new');
    expect(safeStorage.getItem('quota-test')).toBe('new');
  });
  it('restores several photos and replaces the active photo when another chat is opened', () => {
    const one = 'data:image/png;base64,AAAA'; const two = 'data:image/png;base64,BBBB'; const three = 'data:image/png;base64,CCCC';
    const props = { imageBase64: one, imagesList: [one, two], ocrText: '' };
    const { container, rerender } = render(<PhotoScannerBox {...props} />);
    expect(container.querySelectorAll('img').length).toBeGreaterThanOrEqual(2);
    rerender(<PhotoScannerBox imageBase64={three} imagesList={[three]} ocrText="новое условие" />);
    expect(Array.from(container.querySelectorAll('img')).some((img) => img.src === three)).toBe(true);
    expect(Array.from(container.querySelectorAll('img')).some((img) => img.src === one)).toBe(false);
    rerender(<PhotoScannerBox imageBase64="" imagesList={[]} ocrText="" />);
    expect(container.querySelector('img')).toBeNull();
  });
  it('keeps the request timeout active during response body consumption', async () => {
    vi.useFakeTimers();
    fetch.mockImplementation((_url, { signal }) => Promise.resolve({
      arrayBuffer: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    }));
    const request = fetchWithTimeout('/api/test', {}, 100);
    const expected = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(150);
    await expected;
  });
  it('cancels losing OCR requests after the first success', async () => {
    let stopped = false;
    const result = await raceFirstSuccess([
      async () => 'recognized',
      (signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { stopped = true; reject(new Error('cancelled')); })),
    ]);
    expect(result).toBe('recognized');
    expect(stopped).toBe(true);
  });
  it('does not start a request already cancelled by the user', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(fetchWithTimeout('/api/test', {}, 100, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['A and B', 'A or B', 'A && B', 'A || B', '¬A ∧ (B → C)'])('accepts logical operators without doubling them: %s', (input) => {
    expect(solveTruthTableJS(input).ok).toBe(true);
  });
  it('preserves representative exact-solvers', () => {
    expect(solveAlgebraJS('x^2-7x+10=0').markdown).toContain('2');
    expect(solveFractionsJS('1/2 + 1/3').markdown).toContain('5');
    expect(solveChemistryJS('H2 + O2 = H2O').ok).toBe(true);
  });
});
