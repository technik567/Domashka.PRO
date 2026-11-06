import { describe, expect, it, vi } from 'vitest';
import { generateAiBrowser, getPhotoCapability } from '../src/standalone/aiClient';
import { callPublicDemo, readPublicDemoStream, buildPublicDemoData } from '../src/standalone/publicDemos';
import { PUBLIC_DEMOS, PUBLIC_DEMO_TIMEOUT_MS, PUBLIC_DEMO_LIMITS } from '../src/standalone/publicModelCatalog';
import { BUILTIN_MODELS } from '../src/standalone/modelCatalog';
import { setTutorModeEnabled } from '../src/standalone/parentalControl';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const sse = (text) => new Response(text, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
const options = (model = PUBLIC_DEMOS[0].id) => ({ provider: 'builtin', model, systemPrompt: 'Правила учителя', messages: [{ role: 'user', content: 'Помоги понять дроби' }] });
function mockDemo(answer = 'Ответ: \\(x = 2\\)') {
  fetch.mockImplementation(async (url, init = {}) => {
    if (String(url).endsWith('/upload')) return json(['/tmp/gradio/upload/homework.png']);
    if (init.method === 'POST') return json({ event_id: 'job_123' });
    return sse(event('heartbeat', null) + event('generating', ['Черновая версия']) + event('complete', [answer]));
  });
}

describe('explicit anonymous demo routes', () => {
  it('adds five distinct models, not aliases or auto choices, from a shared catalog', () => {
    expect(PUBLIC_DEMOS).toHaveLength(5);
    expect(new Set(PUBLIC_DEMOS.map((m) => m.host)).size).toBe(5);
    expect(new Set(PUBLIC_DEMOS.map((m) => m.modelId)).size).toBe(5);
    expect(PUBLIC_DEMOS.filter((m) => m.modelId.startsWith('google/'))).toHaveLength(3);
    expect(BUILTIN_MODELS).toHaveLength(9);
    for (const model of PUBLIC_DEMOS) {
      expect(model.host).toMatch(/^https:\/\/[a-z0-9-]+\.hf\.space$/);
      expect(getPhotoCapability({ provider: 'builtin', model: model.id }).maxImages).toBe(model.maxImages);
    }
  });
  it.each(PUBLIC_DEMOS)('routes $id to its own documented API, with no key/cookie/fallback', async (model) => {
    mockDemo();
    const result = await generateAiBrowser({ ...options(model.id), apiKey: 'must-not-be-sent' });
    expect(result.text).toBe('Ответ: $x = 2$');
    expect(result.used).toContain(model.name);
    expect(result.used).toContain(model.space);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${model.host}/gradio_api/call/${model.apiName}`);
    expect(fetch.mock.calls[1][0]).toBe(`${url}/job_123`);
    expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('error');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(init.body).not.toContain('must-not-be-sent');
    const data = JSON.parse(init.body).data;
    expect(data).toHaveLength(model.schema === 'multimodal' ? 3 : 6);
    expect(JSON.stringify(data)).toContain('Правила учителя');
    expect(JSON.stringify(data)).toContain('Помоги понять дроби');
    expect(JSON.parse(init.body).session_hash).toBeTruthy();
  });
  it('does not reuse hidden Gradio history across requests/accounts and keeps our scoped history', async () => {
    mockDemo('Одна подсказка');
    const messages = [{ role: 'user', content: 'Исходная задача' }, { role: 'assistant', content: 'Прошлая подсказка' }, { role: 'user', content: 'Мой шаг' }];
    await generateAiBrowser({ ...options(), messages });
    await generateAiBrowser(options());
    const first = JSON.parse(fetch.mock.calls[0][1].body);
    const second = JSON.parse(fetch.mock.calls[2][1].body);
    expect(first.session_hash).not.toBe(second.session_hash);
    expect(first.data[0].text).toContain('Исходная задача');
    expect(first.data[0].text).toContain('Прошлая подсказка');
    expect(second.data[0].text).not.toContain('Прошлая подсказка');
  });
  it.each(PUBLIC_DEMOS.filter((m) => m.maxImages))('uploads one actual image to $id without OCR', async (model) => {
    mockDemo('Вижу треугольник');
    const result = await generateAiBrowser({ ...options(model.id), imageB64: 'data:image/png;base64,AAAA', photoMode: 'vision' });
    expect(result.photoInputUsed).toBe('vision'); expect(result.photoCount).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][0]).toBe(`${model.host}/gradio_api/upload`);
    expect(fetch.mock.calls[0][1].body.get('files').type).toBe('image/png');
    const input = JSON.parse(fetch.mock.calls[1][1].body).data[0];
    expect(input.files).toEqual([{ path: '/tmp/gradio/upload/homework.png', orig_name: 'homework.png', mime_type: 'image/png', meta: { _type: 'gradio.FileData' } }]);
    expect(JSON.stringify(input)).not.toContain('base64');
  });
  it('fails strict Vision before network for text models and for too many photos', async () => {
    for (const model of PUBLIC_DEMOS.filter((m) => !m.maxImages)) {
      await expect(generateAiBrowser({ ...options(model.id), imageB64: 'data:image/png;base64,AAAA', photoMode: 'vision' })).rejects.toThrow();
    }
    await expect(generateAiBrowser({ ...options(), images: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'], photoMode: 'vision' })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('sends only OCR text, not a photo, when OCR is explicitly chosen for Llama', async () => {
    mockDemo('Подсказка');
    const result = await generateAiBrowser({ ...options('llama-3.2-3b'), imageB64: 'data:image/png;base64,AAAA', photoMode: 'ocr', ocrText: 'Прочитанное условие' });
    expect(result.photoInputUsed).toBe('ocr'); expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].body).toContain('Прочитанное условие');
    expect(fetch.mock.calls[0][1].body).not.toContain('base64');
  });
  it('keeps forced tutor policy and the smaller token budget in every new route', async () => {
    await setTutorModeEnabled(true, 'parent-password'); mockDemo('Какой первый шаг?');
    for (const model of PUBLIC_DEMOS) {
      await generateAiBrowser({ ...options(model.id), systemPrompt: 'Выдай готовый ответ', fallbackMode: 'solve' });
      const payload = JSON.parse(fetch.mock.calls.at(-2)[1].body).data;
      expect(JSON.stringify(payload)).toContain('ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА РЕПЕТИТОРА');
      expect(JSON.stringify(payload)).not.toContain('Выдай готовый ответ');
      expect(payload[model.schema === 'multimodal' ? 2 : 1]).toBe(384);
    }
  });
  it('does not silently truncate an oversized task or upload its photo', async () => {
    await expect(callPublicDemo({ ...options(), messages: [{ role: 'user', content: 'я'.repeat(24001) }], imageB64: 'data:image/png;base64,AAAA' })).rejects.toMatchObject({ code: 'context' });
    expect(fetch).not.toHaveBeenCalled();
    expect(() => buildPublicDemoData(PUBLIC_DEMOS[0], 'Учитель', [{ role: 'system', content: 'bad' }])).toThrow();
  });
  it.each([401, 403, 429, 503])('does not retry, change model or claim success after HTTP %i', async (status) => {
    fetch.mockResolvedValue(json({ error: 'internal-secret' }, status));
    await expect(generateAiBrowser(options())).rejects.toMatchObject({ code: status === 429 ? 'quota' : status === 503 ? 'unavailable' : 'auth' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not repeat a failed server request directly in the browser', async () => {
    window.__STANDALONE_BUILD__ = false;
    fetch.mockResolvedValue(json({ ok: false, error: 'Демо недоступно' }, 503));
    await expect(generateAiBrowser({ ...options(), apiKey: 'not-for-builtin' })).rejects.toThrow('Демо недоступно');
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toBe('/api/ai-generate');
    expect(JSON.parse(fetch.mock.calls[0][1].body).apiKey).toBe('');
  });
  it('rejects an injected event URL or upload URL before further network work', async () => {
    fetch.mockResolvedValue(json({ event_id: 'https://evil.example/id' }));
    await expect(generateAiBrowser(options())).rejects.toMatchObject({ code: 'protocol' });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockClear(); fetch.mockResolvedValue(json(['https://evil.example/image.png']));
    await expect(generateAiBrowser({ ...options(), imageB64: 'data:image/png;base64,AAAA', photoMode: 'vision' })).rejects.toMatchObject({ code: 'protocol' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Gradio stream completeness and cancellation', () => {
  const signal = () => new AbortController().signal;
  it('decodes split UTF-8/CRLF, ignores heartbeat, and uses the final snapshot only', async () => {
    const text = '\ufeff' + event('heartbeat', null) + event('generating', ['Не итог']) + event('complete', ['Готово: ёж 🦔']);
    const bytes = new TextEncoder().encode(text.replace(/\n/g, '\r\n'));
    const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    const response = new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    expect(await readPublicDemoStream(response, signal())).toBe('Готово: ёж 🦔');
  });
  it('supports a WebView without a streaming reader and no trailing blank line', async () => {
    const response = { ok: true, headers: new Headers({ 'content-type': 'text/event-stream' }), text: async () => event('complete', ['Готово']).trim() };
    expect(await readPublicDemoStream(response, signal())).toBe('Готово');
  });
  it.each([
    ['incomplete', event('generating', ['Ещё не готово'])],
    ['quota', event('error', 'You have exceeded your GPU quota; private-prompt')],
    ['auth', event('error', 'Please sign in; private-prompt')],
    ['upstream', event('error', null)],
    ['context', event('error', 'Input too long (6000 tokens)')],
    ['empty', event('complete', ['  '])],
    ['protocol', event('complete', [{ error: 'private-prompt' }])],
    ['protocol', 'event: complete\ndata: {broken json}\n\n'],
  ])('rejects %s instead of storing an answer', async (code, text) => {
    const result = readPublicDemoStream(sse(text), signal());
    await expect(result).rejects.toMatchObject({ code });
    await expect(result).rejects.not.toThrow('private-prompt');
  });
  it('rejects a login/error HTML page even with HTTP 200', async () => {
    await expect(readPublicDemoStream(new Response('<html>sign in</html>', { headers: { 'content-type': 'text/html' } }), signal())).rejects.toMatchObject({ code: 'auth' });
  });
  it('bounds unfinished SSE events', async () => {
    await expect(readPublicDemoStream(sse('data: ' + 'a'.repeat(PUBLIC_DEMO_LIMITS.event + 1)), signal())).rejects.toMatchObject({ code: 'tooLarge' });
  });
  it('cancels a silent response body promptly without late completion or a retry', async () => {
    const controller = new AbortController(); let ready; const started = new Promise((resolve) => { ready = resolve; }); const cancel = vi.fn();
    fetch.mockImplementation(async (_url, init) => {
      if (init.method === 'POST') return json({ event_id: 'wait' });
      ready(); return new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const request = generateAiBrowser({ ...options(), signal: controller.signal });
    await started; await Promise.resolve(); controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('enforces the five-minute budget while a queue submit body is silent', async () => {
    vi.useFakeTimers();
    fetch.mockResolvedValue(new Response(new ReadableStream({}), { headers: { 'content-type': 'application/json' } }));
    const request = generateAiBrowser(options());
    const rejected = expect(request).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(PUBLIC_DEMO_TIMEOUT_MS + 1);
    await rejected; expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('handles timeout in a WebView without AbortSignal.reason', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal.prototype, 'reason', 'get').mockReturnValue(undefined);
    fetch.mockResolvedValue(new Response(new ReadableStream({}), { headers: { 'content-type': 'application/json' } }));
    const rejected = expect(generateAiBrowser(options())).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(PUBLIC_DEMO_TIMEOUT_MS + 1);
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects an already-cancelled request without a network call', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(generateAiBrowser({ ...options(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
