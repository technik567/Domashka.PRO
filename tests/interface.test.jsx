import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AiSettingsModal from '../src/components/AiSettingsModal';
import ParentModeModal from '../src/components/ParentModeModal';
import App from '../src/App';
import { api, DEFAULT_AI_SETTINGS, loadAiSettings } from '../src/api';
import { getParentalStatus, setTutorModeEnabled } from '../src/standalone/parentalControl';

describe('settings UI', () => {
  it('saves a specific free gateway and keeps a missing saved OpenRouter model visible', async () => {
    const onSave = vi.fn(); const user = userEvent.setup();
    const { rerender } = render(<App />);
    await user.selectOptions(screen.getByLabelText('Нейросеть для ответа · без ключа'), 'pollinations');
    expect(loadAiSettings()).toMatchObject({ provider: 'builtin', builtinModel: 'pollinations' });
    vi.spyOn(api, 'getModels').mockResolvedValue({ ok: true, openrouter_free: [{ id: 'openrouter/free', name: 'Auto' }] });
    rerender(<AiSettingsModal isOpen settings={{ ...DEFAULT_AI_SETTINGS, provider: 'openrouter', openrouterKey: 'test', openrouterModel: 'saved/model:free' }} onSave={onSave} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('2. Бесплатная модель OpenRouter').value).toBe('saved/model:free'));
    expect(screen.getByRole('option', { name: /saved\/model:free/ })).toBeTruthy();
  });
  it('requires matching password confirmation before enabling parental mode', async () => {
    const user = userEvent.setup(); const onClose = vi.fn();
    render(<ParentModeModal isOpen status={getParentalStatus()} onClose={onClose} />);
    await user.type(screen.getByLabelText('Придумайте родительский пароль'), 'parent-password');
    await user.type(screen.getByLabelText(/^Повторите пароль/), 'not-matching');
    await user.click(screen.getByRole('button', { name: 'Включить детский режим' }));
    expect(screen.getByRole('alert').textContent).toBe('Пароли не совпадают.');
    expect(getParentalStatus().enabled).toBe(false);
    await user.clear(screen.getByLabelText(/^Повторите пароль/));
    await user.type(screen.getByLabelText(/^Повторите пароль/), 'parent-password');
    await user.click(screen.getByRole('button', { name: 'Включить детский режим' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(getParentalStatus().enabled).toBe(true);
  });
  it('keeps standalone downloads inside the site subdirectory', () => {
    const originalUrl = window.location.href;
    try {
      window.history.replaceState(null, '', '/Domashka.PRO/');
      render(<App />);
      const download = screen.getByRole('link', { name: 'Скачать автономный HTML' });
      expect(download.getAttribute('href')).toBe('./Domashka_PRO.html');
      expect(new URL(download.href).pathname).toBe('/Domashka.PRO/Domashka_PRO.html');
      window.history.replaceState(null, '', '/Domashka.PRO/index.html');
      expect(new URL(download.href).pathname).toBe('/Domashka.PRO/Domashka_PRO.html');
      expect(download.getAttribute('download')).toBe('Domashka_PRO.html');
    } finally {
      window.history.replaceState(null, '', originalUrl);
    }
  });
  it('shows only tutor, diary and reference workspaces after reloading a locked app', async () => {
    await setTutorModeEnabled(true, 'parent-password');
    render(<App />);
    expect(screen.getByText('Детский режим: только репетитор.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Начать с подсказки' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Калькуляторы', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Проверить', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Скачать копию', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: /Как в тетрадь/ })).toBeNull();
  });
});
