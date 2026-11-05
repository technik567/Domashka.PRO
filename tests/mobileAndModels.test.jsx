import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import VoiceMicButton from '../src/components/VoiceMicButton';
import PhotoScannerBox from '../src/components/PhotoScannerBox';
import BuiltinModelPicker from '../src/components/BuiltinModelPicker';
import ModelInfoCard from '../src/components/ModelInfoCard';
import AiSettingsModal from '../src/components/AiSettingsModal';
import * as environment from '../src/standalone/browserEnvironment';
import { getModelProfile, RATINGS_NOTE } from '../src/standalone/modelProfiles';
import { preparePhotoFile } from '../src/standalone/visionEngine';
import * as photoEngine from '../src/standalone/visionEngine';
import { DEFAULT_AI_SETTINGS, saveAiSettings, loadAiSettings, api } from '../src/api';
import { setTutorModeEnabled } from '../src/standalone/parentalControl';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const browser = { ios: true, mobile: true, localFile: false, embeddedIOS: false, secure: true, unsafeNativeMedia: false, protocol: 'https:', origin: 'https://test.example' };
function fakeSpeech() {
  const instances = [];
  class Speech {
    constructor() { this.start = vi.fn(); this.stop = vi.fn(); this.abort = vi.fn(); instances.push(this); }
  }
  vi.stubGlobal('SpeechRecognition', Speech);
  vi.stubGlobal('webkitSpeechRecognition', undefined);
  vi.spyOn(environment, 'getBrowserEnvironment').mockReturnValue(browser);
  return instances;
}
function result(text, final) { const alternatives = [{ transcript: text }]; alternatives.isFinal = final; return { resultIndex: 0, results: [alternatives] }; }

describe('mobile camera and bounded photo import', () => {
  it('flags iPhone file/HTML Viewer and insecure HTTP while allowing Safari HTTPS', () => {
    for (const location of [{ protocol: 'file:', hostname: '', origin: 'null' }, { protocol: 'http:', hostname: '192.168.1.20', origin: 'http://192.168.1.20' }]) {
      expect(environment.getBrowserEnvironment({ navigator: { userAgent: iphone }, location, secureContext: false }).unsafeNativeMedia).toBe(true);
    }
    const secure = environment.getBrowserEnvironment({ navigator: { userAgent: iphone }, location: { protocol: 'https:', hostname: 'example.test', origin: 'https://example.test' }, secureContext: true });
    expect(secure.unsafeNativeMedia).toBe(false);
    expect(environment.getBrowserEnvironment({ navigator: { userAgent: iphone }, location: { protocol: 'https:', hostname: 'example.test' }, secureContext: false }).unsafeNativeMedia).toBe(true);
    expect(environment.getBrowserEnvironment({ navigator: { userAgent: iphone.replace('Version/18.0', '').replace('Safari/604.1', '') }, location: { protocol: 'https:', origin: 'https://example.test' }, secureContext: true }).unsafeNativeMedia).toBe(true);
  });
  it('does not mount or click the camera-capture input in a risky iOS viewer', async () => {
    vi.spyOn(environment, 'getBrowserEnvironment').mockReturnValue({ ...browser, unsafeNativeMedia: true, localFile: true });
    const clickInput = vi.spyOn(HTMLInputElement.prototype, 'click');
    render(<PhotoScannerBox imagesList={[]} onChangeImages={() => {}} onChangeOcrText={() => {}} />);
    expect(document.querySelector('input[capture]')).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Камера/ }));
    expect(clickInput).not.toHaveBeenCalled();
    expect(screen.getByText(/Снимите задание/)).toBeTruthy();
  });
  it('keeps native capture available in Safari HTTPS and exposes the explicit photo modes', () => {
    vi.spyOn(environment, 'getBrowserEnvironment').mockReturnValue(browser);
    const change = vi.fn();
    render(<PhotoScannerBox imagesList={[]} onChangeImages={() => {}} photoMode="auto" onChangePhotoMode={change} maxVisionImages={1} />);
    expect(document.querySelector('input[capture="environment"]')).toBeTruthy();
    const picker = screen.getByLabelText('Как передать фото нейросети');
    fireEvent.change(picker, { target: { value: 'vision' } });
    expect(change).toHaveBeenCalledWith('vision'); expect(screen.getByText(/до 1 фото/)).toBeTruthy();
  });
  it('does not restore an old async photo import after switching to a different chat', async () => {
    let finish;
    vi.spyOn(photoEngine, 'preparePhotoFile').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const change = vi.fn(); const busy = vi.fn();
    const { rerender } = render(<PhotoScannerBox imagesList={[]} onChangeImagesList={change} onBusyChange={busy} />);
    fireEvent.change(screen.getByLabelText('Выбрать готовые фото'), { target: { files: [new File(['photo'], 'photo.png', { type: 'image/png' })] } });
    expect(busy).toHaveBeenLastCalledWith(true);
    rerender(<PhotoScannerBox imagesList={['data:image/png;base64,AAAA']} onChangeImagesList={change} onBusyChange={busy} />);
    await act(async () => finish('data:image/png;base64,BBBB'));
    expect(change).not.toHaveBeenCalled(); expect(screen.getByAltText('Снимок задания').src).toBe('data:image/png;base64,AAAA');
    expect(busy).toHaveBeenLastCalledWith(false);
  });
  it('handles a photo-transform memory error instead of leaving an unhandled rejection', async () => {
    vi.spyOn(photoEngine, 'transformImageCanvas').mockRejectedValue(new Error('Не хватило памяти для фото'));
    render(<PhotoScannerBox imagesList={['data:image/png;base64,AAAA']} />);
    await userEvent.click(screen.getByRole('button', { name: /Повернуть/ }));
    expect(screen.getByText('Не хватило памяти для фото')).toBeTruthy();
  });
  it('rejects oversized photos before allocating an image/canvas', async () => {
    await expect(preparePhotoFile({ size: 19 * 1024 * 1024 })).rejects.toThrow('18 МБ');
  });
  it('revokes the temporary object URL if a photo fails to decode', async () => {
    const revoke = vi.fn(); const RealURL = URL;
    vi.stubGlobal('URL', class extends RealURL { static createObjectURL() { return 'blob:photo'; } static revokeObjectURL = revoke; });
    vi.stubGlobal('Image', class { set src(_value) { queueMicrotask(() => this.onerror()); } });
    await expect(preparePhotoFile(new Blob(['bad data'], { type: 'image/png' }))).rejects.toThrow('прочитать');
    expect(revoke).toHaveBeenCalledWith('blob:photo');
  });
});

describe('mobile dictation lifecycle', () => {
  it('uses the Safari-prefixed API with interim preview and deduplicated final transcription', async () => {
    const instances = fakeSpeech();
    vi.stubGlobal('webkitSpeechRecognition', window.SpeechRecognition); vi.stubGlobal('SpeechRecognition', undefined);
    const transcript = vi.fn(); render(<VoiceMicButton onTranscript={transcript} />);
    await userEvent.click(screen.getByRole('button', { name: 'Голосом' }));
    const mic = instances[0]; expect(mic.lang).toBe('ru-RU'); expect(mic.interimResults).toBe(true); expect(mic.continuous).toBe(false);
    act(() => { mic.onstart(); mic.onresult(result('пробный', false)); });
    expect(screen.getByRole('status').textContent).toBe('пробный'); expect(transcript).not.toHaveBeenCalled();
    act(() => { mic.onresult(result('Готовая фраза', true)); mic.onresult(result('Готовая фраза', true)); mic.onend(); });
    expect(transcript).toHaveBeenCalledTimes(1); expect(transcript).toHaveBeenCalledWith('Готовая фраза');
    expect(screen.getByRole('button', { name: 'Голосом' })).toBeTruthy();
  });
  it('allows the final phrase to arrive after the user presses stop', async () => {
    const instances = fakeSpeech(); const transcript = vi.fn(); render(<VoiceMicButton onTranscript={transcript} />);
    await userEvent.click(screen.getByRole('button', { name: 'Голосом' }));
    act(() => instances[0].onstart());
    await userEvent.click(screen.getByRole('button', { name: 'Слушаю… (стоп)' }));
    expect(instances[0].stop).toHaveBeenCalledOnce(); expect(instances[0].abort).not.toHaveBeenCalled();
    act(() => { instances[0].onresult(result('Последняя фраза', true)); instances[0].onend(); });
    expect(transcript).toHaveBeenCalledWith('Последняя фраза');
  });
  it('aborts on unmount and ignores a late result', async () => {
    const instances = fakeSpeech(); const transcript = vi.fn();
    const view = render(<VoiceMicButton onTranscript={transcript} />);
    await userEvent.click(screen.getByRole('button', { name: 'Голосом' }));
    const mic = instances[0]; const late = mic.onresult;
    view.unmount(); late(result('late', true));
    expect(mic.abort).toHaveBeenCalledTimes(1); expect(mic.onresult).toBeNull(); expect(transcript).not.toHaveBeenCalled();
  });
  it('stops when input is disabled, and never restarts recording automatically', async () => {
    const instances = fakeSpeech(); const transcript = vi.fn();
    const { rerender } = render(<VoiceMicButton onTranscript={transcript} />);
    await userEvent.click(screen.getByRole('button', { name: 'Голосом' }));
    rerender(<VoiceMicButton onTranscript={transcript} disabled />);
    expect(instances[0].abort).toHaveBeenCalledOnce(); expect(instances).toHaveLength(1);
  });
  it('does not invoke native speech in HTML Viewer and gives keyboard-dictation fallback', async () => {
    const instances = fakeSpeech(); vi.spyOn(environment, 'getBrowserEnvironment').mockReturnValue({ ...browser, unsafeNativeMedia: true, localFile: true });
    render(<VoiceMicButton onTranscript={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Голосом' }));
    expect(instances).toHaveLength(0); expect(screen.getByRole('status').textContent).toContain('микрофон экранной клавиатуры');
  });
  it('reports microphone permission errors and provides a fallback instead of a stuck recording state', async () => {
    const instances = fakeSpeech(); render(<VoiceMicButton onTranscript={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Голосом' }));
    act(() => instances[0].onerror({ error: 'not-allowed' }));
    expect(screen.getByRole('status').textContent).toContain('запрещён');
    expect(screen.getByRole('button', { name: 'Голосом' }).getAttribute('aria-pressed')).toBe('false');
  });
  it('times out a browser which never starts recognition', () => {
    const instances = fakeSpeech(); vi.useFakeTimers();
    render(<VoiceMicButton onTranscript={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Голосом' }));
    act(() => vi.advanceTimersByTime(15000));
    expect(instances[0].abort).toHaveBeenCalledOnce(); expect(screen.getByRole('status').textContent).toContain('не запустил');
  });
});

describe('model picker, descriptions and parental guard', () => {
  it('renders the inline selector only for the default free provider', () => {
    const { rerender } = render(<BuiltinModelPicker settings={DEFAULT_AI_SETTINGS} onChange={() => {}} />);
    expect(screen.getByLabelText('Нейросеть для ответа · без ключа')).toBeTruthy();
    rerender(<BuiltinModelPicker settings={{ ...DEFAULT_AI_SETTINGS, provider: 'gemini' }} onChange={() => {}} />);
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('prevents inline and central settings changes in locked mode', async () => {
    await setTutorModeEnabled(true, 'parent-password');
    const change = vi.fn(); render(<BuiltinModelPicker settings={DEFAULT_AI_SETTINGS} onChange={change} tutorOnly />);
    const picker = screen.getByLabelText('Нейросеть для ответа · без ключа');
    expect(picker.disabled).toBe(true); fireEvent.change(picker, { target: { value: 'pollinations' } });
    expect(change).not.toHaveBeenCalled();
    expect(() => saveAiSettings({ ...DEFAULT_AI_SETTINGS, builtinModel: 'pollinations' })).toThrow('родитель');
    expect(loadAiSettings().builtinModel).toBe('auto');
  });
  it('labels ratings as editorial and uses unknown ratings for dynamic/custom models', () => {
    expect(getModelProfile('custom', 'a-new-local-model').ratings).toEqual([null, null, null]);
    expect(getModelProfile('openrouter', 'brand/new:free').ratings).toEqual([null, null, null]);
    expect(getModelProfile('builtin', 'auto').ratings).toEqual([null, null, null]);
    render(<ModelInfoCard provider="builtin" model="qwen-3.5" />);
    expect(screen.getByText(RATINGS_NOTE)).toBeTruthy();
    expect(screen.getByLabelText(/Мощность: [1-5]\/5/)).toBeTruthy();
    expect(screen.getByLabelText(/Скорость: [1-5]\/5/)).toBeTruthy();
    expect(screen.getByLabelText(/Понимание: [1-5]\/5/)).toBeTruthy();
  });
  it('keeps provider/key settings in the modal, and redirects free model choice to the chat', async () => {
    const save = vi.fn(); const openPicker = vi.fn(); vi.spyOn(api, 'getModels').mockResolvedValue({ builtin: [], openrouter_free: [], gemini: [] });
    render(<AiSettingsModal isOpen settings={DEFAULT_AI_SETTINGS} onSave={save} onClose={() => {}} onOpenBuiltinPicker={openPicker} />);
    expect(screen.queryByLabelText('2. Бесплатная облачная модель')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить и выбрать модель в чате' }));
    expect(save).toHaveBeenCalledWith(DEFAULT_AI_SETTINGS); expect(openPicker).toHaveBeenCalledOnce();
  });
  it('exposes local Vision consent and retains direct transport for standalone', async () => {
    const save = vi.fn(); vi.spyOn(api, 'getModels').mockResolvedValue({ builtin: [], openrouter_free: [], gemini: [] });
    render(<AiSettingsModal isOpen settings={{ ...DEFAULT_AI_SETTINGS, provider: 'custom' }} onSave={save} onClose={() => {}} />);
    expect(screen.getByRole('option', { name: /Через мой Python-сервер/ }).disabled).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: /Моя модель поддерживает изображения/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    expect(save.mock.calls[0][0]).toMatchObject({ customVision: true, customTransport: 'direct' });
  });
});
