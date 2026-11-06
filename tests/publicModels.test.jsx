import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BuiltinModelPicker from '../src/components/BuiltinModelPicker';
import { PUBLIC_DEMOS } from '../src/standalone/publicModelCatalog';
import { getModelProfile } from '../src/standalone/modelProfiles';
import { DEFAULT_AI_SETTINGS, loadAiSettings, saveAiSettings } from '../src/api';

describe('public models in the existing builtin-only picker', () => {
  it.each(PUBLIC_DEMOS)('saves $id, shows source/capability/ratings and the shared quota warning', (model) => {
    saveAiSettings({ ...DEFAULT_AI_SETTINGS, builtinModel: model.id });
    const change = vi.fn();
    render(<BuiltinModelPicker settings={loadAiSettings()} onChange={change} />);
    const picker = screen.getByLabelText('Нейросеть для ответа · без ключа');
    expect(picker.value).toBe(model.id);
    expect(screen.getAllByRole('option')).toHaveLength(9);
    expect(screen.getByText(/8 вариантов \+ авто/)).toBeTruthy();
    expect(screen.getByText(/смена модели её не обнуляет/)).toBeTruthy();
    expect(screen.getAllByText(`Площадка: ${model.space}`).length).toBeGreaterThan(0);
    expect(document.querySelector('.bg-violet-500')).toBeTruthy();
    expect(document.querySelector('.bg-emerald-500')).toBeTruthy();
    expect(document.querySelector('.bg-sky-500')).toBeTruthy();
    expect(getModelProfile('builtin', model.id).ratings).toEqual(model.ratings);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    fireEvent.change(picker, { target: { value: 'qwen-3.5' } });
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ builtinModel: 'qwen-3.5' }));
    expect(fetch).not.toHaveBeenCalled(); // no background probes or hidden GPU use
  });
  it('does not move keyed/custom providers inline or overwrite their saved selection', () => {
    const { rerender, container } = render(<BuiltinModelPicker settings={{ provider: 'gemini', geminiModel: 'saved' }} />);
    expect(container.textContent).toBe('');
    for (const provider of ['openrouter', 'custom']) {
      rerender(<BuiltinModelPicker settings={{ provider, builtinModel: 'gemma-3-12b' }} />);
      expect(container.textContent).toBe('');
    }
  });
  it('keeps parent-selected models read-only without a change callback', () => {
    render(<BuiltinModelPicker settings={{ ...DEFAULT_AI_SETTINGS, builtinModel: 'gemma-3-12b' }} />);
    expect(screen.getByLabelText('Нейросеть для ответа · без ключа').disabled).toBe(true);
  });
});
