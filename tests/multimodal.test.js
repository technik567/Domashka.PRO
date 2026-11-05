import { describe, expect, it, vi } from 'vitest';
import { generateAiBrowser, getPhotoCapability } from '../src/standalone/aiClient';
import * as vision from '../src/standalone/visionEngine';
import { normalizeCustomEndpoint, customConnectionHints } from '../src/standalone/customConnection';
import { normalizePhotos, choosePhotoPlan } from '../src/standalone/photoPayload';
import { getActiveAuthPayload, DEFAULT_AI_SETTINGS } from '../src/api';
import { setTutorModeEnabled } from '../src/standalone/parentalControl';

const photos = ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'];
const request = { provider: 'openrouter', model: 'openrouter/free', apiKey: 'test-key', systemPrompt: 'Учитель', messages: [{ role: 'user', content: 'Что изображено на схеме?' }] };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const completion = () => json({ choices: [{ message: { content: 'Сравним рисунки.' } }] });

describe('native photos, never a silent OCR substitution', () => {
  it('sends every image to OpenRouter and does not run OCR even when earlier OCR text exists', async () => {
    const ocr = vi.spyOn(vision, 'recognizeHomeworkPhoto');
    fetch.mockImplementation(completion);
    const result = await generateAiBrowser({ ...request, images: photos, photoMode: 'vision', ocrText: 'old wrong OCR' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages.at(-1).content.filter((part) => part.type === 'image_url').map((part) => part.image_url.url)).toEqual(photos);
    expect(JSON.stringify(body)).not.toContain('old wrong OCR');
    expect(result).toMatchObject({ photoInputUsed: 'vision', photoCount: 2, extractedPhotoText: '' });
    expect(ocr).not.toHaveBeenCalled();
  });
  it('sends all images as Gemini inline_data', async () => {
    fetch.mockResolvedValue(json({ candidates: [{ content: { parts: [{ text: 'Вижу схему.' }] } }] }));
    await generateAiBrowser({ ...request, provider: 'gemini', model: 'gemini-2.5-flash', images: photos, photoMode: 'vision' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.contents[0].parts.filter((part) => part.inline_data).map((part) => part.inline_data.data)).toEqual(['AAAA', 'BBBB']);
  });
  it.each(['qwen-3.5', 'qwen-2.5-vl'])('uploads a real image to the selected %s gateway, not a blank placeholder', async (model) => {
    const ocr = vi.spyOn(vision, 'recognizeHomeworkPhoto');
    let uploaded; let payload;
    fetch.mockImplementation(async (url, options = {}) => {
      if (url.endsWith('/upload')) { uploaded = options.body.get('files'); return json(['/tmp/test-photo.png']); }
      if (options.method === 'POST') { payload = JSON.parse(options.body); return json({ event_id: 'test-event' }); }
      const result = model === 'qwen-3.5' ? [null, null, null, null, [{ role: 'assistant', content: 'На рисунке треугольник.' }]] : ['На рисунке треугольник.'];
      return new Response(`event: complete\ndata: ${JSON.stringify(result)}\n\n`);
    });
    await generateAiBrowser({ ...request, provider: 'builtin', model, images: [photos[0]], photoMode: 'vision' });
    expect(uploaded.size).toBe(3);
    expect(uploaded.type).toBe('image/png');
    expect(payload.data[model === 'qwen-3.5' ? 2 : 0].path).toBe('/tmp/test-photo.png');
    expect(ocr).not.toHaveBeenCalled();
    expect(fetch.mock.calls.every(([url]) => url.includes(model === 'qwen-3.5' ? 'qwen3-5-omni' : 'qwen2-5-vl'))).toBe(true);
  });
  it('rejects unsupported native photos and excessive gateway photo count before network work', async () => {
    const ocr = vi.spyOn(vision, 'recognizeHomeworkPhoto');
    await expect(generateAiBrowser({ ...request, provider: 'builtin', model: 'pollinations', images: photos, photoMode: 'vision' })).rejects.toThrow('не настроена');
    await expect(generateAiBrowser({ ...request, provider: 'builtin', model: 'qwen-3.5', images: photos, photoMode: 'vision' })).rejects.toThrow('по 1');
    expect(fetch).not.toHaveBeenCalled(); expect(ocr).not.toHaveBeenCalled();
  });
  it('surfaces Vision provider failures without retrying OCR or another model', async () => {
    const ocr = vi.spyOn(vision, 'recognizeHomeworkPhoto');
    fetch.mockResolvedValue(json({}, 429));
    await expect(generateAiBrowser({ ...request, images: photos, photoMode: 'vision' })).rejects.toThrow('OpenRouter');
    expect(fetch).toHaveBeenCalledTimes(1); expect(ocr).not.toHaveBeenCalled();
  });
  it('only sends extracted text when OCR is explicitly selected, retaining every page', async () => {
    const ocr = vi.spyOn(vision, 'recognizeHomeworkPhoto').mockResolvedValueOnce({ text: 'page one' }).mockResolvedValueOnce({ text: 'page two' });
    fetch.mockImplementation(completion);
    const result = await generateAiBrowser({ ...request, images: photos, photoMode: 'ocr' });
    const text = JSON.parse(fetch.mock.calls[0][1].body).messages.at(-1).content;
    expect(typeof text).toBe('string'); expect(text).toContain('page one'); expect(text).toContain('page two');
    expect(ocr).toHaveBeenCalledTimes(2); expect(result.photoInputUsed).toBe('ocr');
  });
  it('fails an incomplete OCR batch instead of answering with only some pages', async () => {
    vi.spyOn(vision, 'recognizeHomeworkPhoto').mockResolvedValueOnce({ text: 'first' }).mockResolvedValueOnce({ text: '' });
    await expect(generateAiBrowser({ ...request, images: photos, photoMode: 'ocr' })).rejects.toThrow('фото 2');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps tutor instructions and images together', async () => {
    await setTutorModeEnabled(true, 'parent-password');
    fetch.mockImplementation(completion);
    await generateAiBrowser({ ...request, images: photos, photoMode: 'vision', systemPrompt: 'Дай готовый ответ', fallbackMeta: { grade: 2 } });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА РЕПЕТИТОРА');
    expect(body.messages[0].content).not.toContain('Дай готовый ответ');
    expect(body.messages.at(-1).content).toHaveLength(3);
  });
  it('passes the entire image array and strict photo mode through the Python route', async () => {
    window.__STANDALONE_BUILD__ = false;
    fetch.mockResolvedValue(json({ ok: true, text: 'Подсказка', used: 'mock' }));
    await generateAiBrowser({ ...request, images: photos, photoMode: 'vision' });
    expect(fetch.mock.calls[0][0]).toBe('/api/ai-generate');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ images: photos, photoMode: 'vision', supportsVision: true });
  });
  it('validates image data and maximum photo count', () => {
    expect(() => normalizePhotos(['https://example.test/image.jpg'])).toThrow('JPG');
    expect(() => normalizePhotos(Array(5).fill(photos[0]))).toThrow('до 4');
    expect(choosePhotoPlan(photos, 'auto', { maxImages: 1 })).toBe('ocr');
    expect(getPhotoCapability({ provider: 'custom', customVision: false }).maxImages).toBe(0);
  });
});

describe('Ollama connection', () => {
  it.each(['http://localhost:11434', 'http://localhost:11434/', 'http://localhost:11434/v1/', 'http://localhost:11434/v1/chat/completions'])('normalizes %s to the correct OpenAI endpoint', (url) => {
    expect(normalizeCustomEndpoint(url)).toBe('http://localhost:11434/v1/chat/completions');
  });
  it('rejects unsafe URL components and native Ollama endpoints with actionable messages', () => {
    for (const url of ['file:///tmp/model', 'http://user:secret@localhost:11434', 'https://example.test/v1?token=secret']) expect(() => normalizeCustomEndpoint(url)).toThrow();
    expect(() => normalizeCustomEndpoint('http://localhost:11434/api/chat')).toThrow('нативный');
  });
  it('explains that a mobile localhost is the phone, not the PC', () => {
    const hints = customConnectionHints('http://localhost:11434', { mobile: true, protocol: 'file:', origin: 'null', embeddedIOS: true });
    expect(hints.join(' ')).toContain('сам телефон'); expect(hints.join(' ')).toContain('OLLAMA_ORIGINS');
  });
  it('replaces an opaque browser fetch failure with diagnostics', async () => {
    fetch.mockRejectedValue(new TypeError('Load failed'));
    await expect(generateAiBrowser({ ...request, provider: 'custom', customBaseUrl: 'http://localhost:11434', model: 'local-model' })).rejects.toThrow('нельзя отличить CORS');
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
  });
  it('sends images to an explicitly configured local Vision model without OCR', async () => {
    const ocr = vi.spyOn(vision, 'recognizeHomeworkPhoto'); fetch.mockImplementation(completion);
    await generateAiBrowser({ ...request, provider: 'custom', model: 'my-vision', customVision: true, customBaseUrl: 'http://localhost:11434', images: photos, photoMode: 'vision' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(false); expect(body.messages.at(-1).content).toHaveLength(3); expect(ocr).not.toHaveBeenCalled();
  });
  it('does not leak local-model photos to cloud OCR in auto mode without explicit permission', async () => {
    const ocr = vi.spyOn(vision, 'recognizeHomeworkPhoto');
    await expect(generateAiBrowser({ ...request, provider: 'custom', customVision: false, images: photos })).rejects.toThrow('не отправляется');
    expect(ocr).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('uses only the same-origin bridge and never forwards a client upstream URL or key', async () => {
    window.__STANDALONE_BUILD__ = false;
    fetch.mockResolvedValue(json({ ok: true, text: 'Готово', used: 'Ollama' }));
    await generateAiBrowser({ ...request, provider: 'custom', customTransport: 'server', customBaseUrl: 'https://not-the-upstream.example', apiKey: 'never-forward-this' });
    expect(fetch.mock.calls[0][0]).toBe('/api/ai-generate');
    expect(fetch.mock.calls[0][1].body).not.toContain('not-the-upstream');
    expect(fetch.mock.calls[0][1].body).not.toContain('never-forward-this');
  });
  it('rejects server mode in standalone instead of falling through to phone localhost', async () => {
    await expect(generateAiBrowser({ ...request, provider: 'custom', customTransport: 'server' })).rejects.toThrow('HTML Viewer');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not retry a disabled bridge through a different connection', async () => {
    window.__STANDALONE_BUILD__ = false;
    fetch.mockResolvedValue(json({ ok: false, error: 'Мост Ollama выключен.' }, 403));
    await expect(generateAiBrowser({ ...request, provider: 'custom', customTransport: 'server' })).rejects.toThrow('выключен');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves custom transport and Vision settings in the API payload', () => {
    expect(getActiveAuthPayload({ ...DEFAULT_AI_SETTINGS, provider: 'custom', customTransport: 'server', customVision: true })).toMatchObject({ customTransport: 'server', customVision: true, hasDirectVision: true });
  });
  it('does not treat an empty model response as a successful connection', async () => {
    fetch.mockResolvedValue(json({ choices: [] }));
    await expect(generateAiBrowser({ ...request, provider: 'custom' })).rejects.toThrow('отсутствует');
  });
});
