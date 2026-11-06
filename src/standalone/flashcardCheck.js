import { studyId } from './ids';
import { buildFlashcardChecks, flashcardKey, normalizeFlashcardAnswer } from './flashcardContent.js';
import { ensureWorkspaceActive, workspaceKey } from './accounts';
import { rewardVerifiedFlashcard } from './storageEngine';
import { cloud } from '../cloud/bridge.js';

const attempts = new Map();
let serial = Promise.resolve();

export async function beginFlashcardCheck(card) {
  ensureWorkspaceActive();
  const key = flashcardKey(card);
  if (cloud()) return cloud().beginFlashcardCheck(key);
  const variants = buildFlashcardChecks(card);
  if (!variants.length) return { unavailable: true, question: 'Для этой карточки пока нет короткой однозначной проверки. Можно повторить её без XP.' };
  const check = variants[Math.floor(Math.random() * variants.length)];
  const id = studyId();
  for (const [token, state] of attempts) if (state.expires < Date.now()) attempts.delete(token);
  while (attempts.size >= 30) attempts.delete(attempts.keys().next().value);
  attempts.set(id, { ...check, key, tries: 0, finished: false, expires: Date.now() + 10 * 60 * 1000 });
  return { id, question: check.question, kind: check.kind, remaining: 3 };
}

export async function answerFlashcardCheck(id, answer) {
  ensureWorkspaceActive();
  if (cloud()) return cloud().answerFlashcardCheck(id, answer);
  const work = async () => {
    ensureWorkspaceActive();
    const check = attempts.get(id);
    if (!check || check.expires < Date.now()) throw new Error('Проверка устарела. Откройте новое задание.');
    if (check.finished) return { ...check.result, replayed: true };
    const response = normalizeFlashcardAnswer(answer);
    if (!response) throw new Error('Введите или надиктуйте короткий ответ.');
    if (response.length > 200) throw new Error('Нужен короткий ответ: до 200 символов.');
    check.tries++;
    const correct = check.answers.includes(response);
    if (!correct) {
      const finished = check.tries >= 3;
      const result = { correct: false, awarded: 0, finished, remaining: Math.max(0, 3 - check.tries), expected: finished ? check.answers[0] : '' };
      check.finished = finished; check.result = result;
      return result;
    }
    const awarded = rewardVerifiedFlashcard(check.key);
    const result = { correct: true, awarded, finished: true, remaining: Math.max(0, 3 - check.tries) };
    check.finished = true; check.result = result;
    return result;
  };
  const run = () => globalThis.navigator?.locks?.request
    ? navigator.locks.request(workspaceKey('flashcard-rewards'), work) : work();
  const job = serial.catch(() => {}).then(run);
  serial = job;
  return job;
}
