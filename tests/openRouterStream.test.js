import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestOpenRouter, OPENROUTER_TIMEOUT_MS } from '../src/standalone/openRouterStream';
import { generateAiBrowser } from '../src/standalone/aiClient';

const args = { apiKey: 'test-key-not-real', model: 'test/model', messages: [{ role: 'user', content: 'Задача' }] };
function sse(text, chunkSize = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
afterEach(() => { window.__STANDALONE_BUILD__ = true; });

describe('OpenRouter long responses and streaming', () => {
  it('accepts a complex response after the former 22-second cutoff', async () => {
    vi.useFakeTimers(); let requestSignal;
    vi.stubGlobal('fetch', vi.fn((url, options) => { requestSignal = options.signal;
      return new Promise((resolve) => setTimeout(() => resolve(Response.json({ model: 'used/model', choices: [{ message: { content: 'Подробное решение' } }] })), 35000));
    }));
    const pending = requestOpenRouter(args);
    await vi.advanceTimersByTimeAsync(23000); expect(requestSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await pending).toEqual({ text: 'Подробное решение', used: 'OpenRouter (used/model)' });
    expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    const payload = JSON.parse(fetch.mock.calls[0][1].body); expect(payload.stream).toBe(true); expect(payload.model).toBe('test/model');
  });
  it('parses split UTF-8, CRLF, heartbeat comments and reasoning without exposing reasoning', async () => {
    const onStatus = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => sse(': OPENROUTER PROCESSING\r\n\r\n' +
      'data: {"choices":[{"delta":{"reasoning":"private reasoning text"}}]}\r\n\r\n' +
      'data: {"model":"chosen/model","choices":[{"delta":{"content":"Решение: "}}]}\r\n\r\n' +
      'data: {"choices":[{"delta":{"content":"2 + 2 = 4"},"finish_reason":"stop"}]}\r\n\r\n' +
      'data: [DONE]\r\n\r\n', 1)));
    const result = await requestOpenRouter({ ...args, onStatus });
    expect(result.text).toBe('Решение: 2 + 2 = 4'); expect(result.used).toBe('OpenRouter (chosen/model)');
    expect(JSON.stringify(onStatus.mock.calls)).not.toContain('private reasoning text');
    expect(onStatus.mock.calls.some(([s]) => s.stage === 'streaming' && s.receivedChars > 0)).toBe(true);
  });
  it('handles a WebView without a readable response stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: null,
      text: async () => 'data: {"choices":[{"delta":{"content":"Готово"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' })));
    expect((await requestOpenRouter(args)).text).toBe('Готово');
  });
  it.each([401, 402, 403, 429, 503])('returns a specific HTTP %s failure without retrying', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider failure', { status })));
    await expect(requestOpenRouter(args)).rejects.toThrow(/OpenRouter/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds non-streaming JSON responses too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: 'a'.repeat(2_000_001) } }] })));
    await expect(requestOpenRouter(args)).rejects.toThrow(/безопасный размер/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('supports a JSON-only WebView and rejects invalid JSON without echoing it', async () => {
    const response = { ok: true, headers: new Headers({ 'content-type': 'application/json' }), body: null };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ...response, text: async () => JSON.stringify({ choices: [{ message: { content: 'Готово' } }] }) })));
    expect((await requestOpenRouter(args)).text).toBe('Готово');
    fetch.mockImplementation(async () => ({ ...response, text: async () => 'sensitive diagnostic, not JSON' }));
    await expect(requestOpenRouter(args)).rejects.toThrow('повреждённый ответ');
  });
  it('does not treat a truncated stream as a completed answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse('data: {"choices":[{"delta":{"content":"Часть ответа"}}]}\n\n')));
    await expect(requestOpenRouter(args)).rejects.toThrow(/до завершения/); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('detects errors inside a 200 SSE response and does not echo raw secrets', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse('data: {"error":{"code":429,"message":"sensitive-upstream-diagnostic"}}\n\n')));
    const error = await requestOpenRouter(args).catch((e) => e);
    expect(error.message).toContain('лимит'); expect(error.message).not.toContain('sensitive-upstream-diagnostic');
  });
  it('discloses a token-limited answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse('data: {"choices":[{"delta":{"content":"Начало"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n')));
    expect((await requestOpenRouter(args)).text).toMatch(/лимитом токенов.*неполным/);
  });
  it('reports reasoning-only exhaustion rather than claiming success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse('data: {"choices":[{"delta":{"reasoning":"internal"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n')));
    await expect(requestOpenRouter(args)).rejects.toThrow(/без текста ответа/);
  });
  it('enforces a five-minute deadline and leaves no timer', async () => {
    vi.useFakeTimers(); let signal;
    vi.stubGlobal('fetch', vi.fn((_, options) => { signal = options.signal; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))); }));
    const check = expect(requestOpenRouter(args)).rejects.toThrow(/5 минут/);
    await vi.advanceTimersByTimeAsync(OPENROUTER_TIMEOUT_MS);
    await check; expect(signal.aborted).toBe(true); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('honors Stop immediately during the wait', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))));
    const check = expect(requestOpenRouter({ ...args, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await check; expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not duplicate an uncertain timed-out server generation by retrying directly', async () => {
    window.__STANDALONE_BUILD__ = false;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, error: 'OpenRouter: server timed out' })));
    await expect(generateAiBrowser({ ...args, provider: 'openrouter', systemPrompt: 'Учитель' })).rejects.toThrow('server timed out');
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toBe('/api/ai-generate');
  });
});
