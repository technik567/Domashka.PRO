import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

async function setupFamily() {
  let accounts = await import('../src/standalone/accounts'); const challenge = accounts.issueParentChallenge();
  await accounts.createAccount({ role: 'parent', name: 'Родитель', login: 'parent', password: 'Parent_password_42',
    challengeId: challenge.id, challengeAnswer: String(Math.sqrt(challenge.square)) });
  vi.resetModules(); accounts = await import('../src/standalone/accounts');
  const anna = await accounts.createAccount({ role: 'child', name: 'Анна', login: 'anna', password: 'Child_password_42', grade: 9, age: 15 });
  const boris = await accounts.createAccount({ role: 'child', name: 'Борис', login: 'boris', password: 'Child_password_42', grade: 2, age: 8 });
  return { accounts, anna, boris };
}
beforeEach(() => { vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); });

describe('family workspace integration', () => {
  it('switches between siblings without duplicating homework forms or keeping the wrong child', async () => {
    await setupFamily(); const FamilyAccounts = (await import('../src/components/FamilyAccounts')).default;
    render(<FamilyAccounts />);
    for (const name of ['Борис', 'Анна', 'Борис', 'Анна']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
      await waitFor(() => expect(screen.getAllByRole('region', { name: 'Семейные домашние задания' })).toHaveLength(1));
      expect(screen.getAllByLabelText('Название задания', { exact: true })).toHaveLength(1);
      expect(screen.getByText(new RegExp(`Логин: ${name === 'Анна' ? 'anna' : 'boris'}`))).toBeTruthy();
      expect(screen.getAllByText('Настройки ученика и родительский контроль')).toHaveLength(1);
    }
  });
  it('starts a registered diary without demo marks and preserves only this account’s entered marks', async () => {
    await setupFamily(); const Diary = (await import('../src/components/DiaryAndGrades')).default;
    const view = render(<Diary grade={9} />);
    expect(screen.getByText('Оценки (0, сумма весов: 0)', { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^\+ 5/ }));
    expect(screen.getByText('Оценки (1, сумма весов: 1)', { exact: true })).toBeTruthy();
    view.unmount(); render(<Diary grade={9} />);
    expect(screen.getByText('Оценки (1, сумма весов: 1)', { exact: true })).toBeTruthy();
    expect(screen.queryByText(/Решить уравнение: 2x²/)).toBeNull();
  });
  it('paginates eight cards and moves back after deleting the last card of the last page', async () => {
    const { anna } = await setupFamily(); const tasks = await import('../src/standalone/familyHomework');
    for (let i = 0; i < 9; i++) await tasks.assignHomework({ childId: anna.id, subject: 'math', title: `Задание ${i}`, instructions: 'Объясни свой ответ' });
    const Board = (await import('../src/components/FamilyHomeworkBoard')).default;
    render(<Board childId={anna.id} />);
    await waitFor(() => expect(screen.getAllByTestId('family-homework')).toHaveLength(8));
    fireEvent.click(screen.getByRole('button', { name: 'Следующие 8 работ', exact: true }));
    expect(screen.getAllByTestId('family-homework')).toHaveLength(1);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(within(screen.getByTestId('family-homework')).getByRole('button', { name: 'Удалить задание', exact: true }));
    await waitFor(() => expect(screen.getAllByTestId('family-homework')).toHaveLength(8));
    expect(screen.queryByRole('button', { name: 'Предыдущие 8 работ', exact: true })).toBeNull();
  });
});
