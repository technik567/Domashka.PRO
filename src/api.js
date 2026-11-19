import { ensureWorkspaceActive, getManagedChild, getInheritedAiSettings } from './standalone/accounts';
import { isTutorModeEnabled } from './standalone/parentalControl';
import { tutorFollowupQuestion } from './standalone/tutorPolicy';
import { throwIfAborted } from './standalone/network';

const TUTOR_ONLY_ERROR = { ok: false, error: 'В детском режиме доступен только репетитор. Этот инструмент открывается родителем.' };
function checkRequestActive(signal, lockAtStart) {
  ensureWorkspaceActive();
  throwIfAborted(signal);
  if (isTutorModeEnabled() !== lockAtStart) throw new DOMException('Режим обучения изменён.', 'AbortError');
}

import {
  safeStorage,
  chatStore,
  subscribeHistory,
  saveInputDraft,
  loadInputDraft,
  getStudentStats,
  recordStudentActivity,
  mistakeStore,
  subscribeMistakes,
} from './standalone/storageEngine';
import { runExactToolJS, autoVerifyMathJS } from './standalone/exactSolvers';
import {
  fetchFreeModelsBrowser,
  buildSystemPrompt,
  buildCheckerPrompt,
  generateAiBrowser,
  generatePracticeQuizBrowser,
  generateExamVariantBrowser,
  generateMistakeDrillBrowser,
  isKnownOpenRouterVisionModel,
  getPhotoCapability,
} from './standalone/aiClient';
import {
  fileToDataUri,
  transformImageCanvas,
  preparePhotoFile,
  recognizeHomeworkPhoto,
} from './standalone/visionEngine';
import { runLocalExpressCheck } from './standalone/localDraftPreCheck';

const SETTINGS_KEY = 'domashka_pro_ai_settings_v2';
const PROFILE_KEY = 'domashka_pro_student_profile_v2';
const THEME_KEY = 'domashka_pro_theme_v3';

export const DEFAULT_AI_SETTINGS = {
  builtinModel: 'auto',
  provider: 'builtin', // 'builtin' | 'openrouter' | 'gemini' | 'custom'
  openrouterKey: '',
  openrouterModel: 'openrouter/free',
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
  customBaseUrl: 'http://localhost:11434/v1',
  customModel: 'qwen2.5:7b',
  customKey: '',
  customTransport: 'direct',
  customVision: false,
};

export const DEFAULT_PROFILE = {
  grade: 8,
  examGoal: 'fgos',
};

export function loadTheme() {
  return safeStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

export function saveTheme(theme) {
  const val = theme === 'dark' ? 'dark' : 'light';
  safeStorage.setItem(THEME_KEY, val);
  return val;
}

export function loadAiSettings() {
  try {
    const inherited = getInheritedAiSettings();
    if (inherited) return { ...DEFAULT_AI_SETTINGS, ...inherited };
    const raw = safeStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function saveAiSettings(settings) {
  ensureWorkspaceActive();
  if (getManagedChild()) throw new Error('Настройки ИИ для ученика выбирает родитель в разделе «Семья».');
  if (isTutorModeEnabled()) throw new Error('Настройки ИИ меняет родитель после отключения детского режима паролем.');
  const merged = { ...DEFAULT_AI_SETTINGS, ...settings };
  safeStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

export function loadStudentProfile() {
  const child = getManagedChild();
  if (child) return { ...DEFAULT_PROFILE, grade: child.grade, examGoal: child.grade === 9 ? 'oge' : child.grade >= 10 ? 'ege' : 'fgos' };
  try {
    const raw = safeStorage.getItem(PROFILE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE };
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveStudentProfile(profile) {
  ensureWorkspaceActive();
  if (getManagedChild()) return loadStudentProfile();
  const merged = { ...DEFAULT_PROFILE, ...profile };
  safeStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
  return merged;
}

export function getActiveAuthPayload(aiSettings) {
  const s = aiSettings || loadAiSettings();
  if (s.provider === 'openrouter') {
    return {
      provider: 'openrouter',
      apiKey: (s.openrouterKey || '').trim(),
      model: s.openrouterModel || 'openrouter/free',
      customBaseUrl: '',
      hasDirectVision: isKnownOpenRouterVisionModel(s.openrouterModel),
    };
  }
  if (s.provider === 'gemini') {
    return {
      provider: 'gemini',
      apiKey: (s.geminiKey || '').trim(),
      model: s.geminiModel || 'gemini-2.5-flash',
      customBaseUrl: '',
      hasDirectVision: true,
    };
  }
  if (s.provider === 'custom') {
    return {
      provider: 'custom',
      apiKey: (s.customKey || '').trim(),
      model: (s.customModel || 'qwen2.5:7b').trim(),
      customBaseUrl: (s.customBaseUrl || 'http://localhost:11434/v1').trim(),
      customTransport: s.customTransport || 'direct',
      customVision: s.customVision === true,
      hasDirectVision: s.customVision === true,
    };
  }
  return {
    provider: 'builtin',
    apiKey: '',
    model: s.builtinModel || 'auto',
    customBaseUrl: '',
    hasDirectVision: getPhotoCapability({ provider: 'builtin', model: s.builtinModel || 'auto' }).maxImages > 0,
  };
}

export const api = {
  async getModels(refresh = false) {
    const data = await fetchFreeModelsBrowser(refresh);
    return { ok: true, ...data };
  },

  async testKey({ provider, apiKey, model, customBaseUrl, customTransport, customVision, signal }) {
    try {
      const { text, used } = await generateAiBrowser({
        provider,
        apiKey,
        model,
        customBaseUrl, customTransport, customVision,
        systemPrompt: 'Отвечай одной короткой фразой на русском языке.',
        signal, allowLocalFallback: false,
        messages: [{ role: 'user', content: 'Напиши: ИИ готов помогать с домашкой!' }],
      });
      return { ok: true, message: `${used}: ${text.trim()}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async recognizePhoto(imageDataUri, onProgressOrOpts = {}, purposeArg = 'solve') {
    const onProgress =
      typeof onProgressOrOpts === 'function'
        ? onProgressOrOpts
        : onProgressOrOpts?.onProgress || onProgressOrOpts?.onStatus;
    const purpose =
      typeof onProgressOrOpts === 'object' && onProgressOrOpts?.purpose
        ? onProgressOrOpts.purpose
        : purposeArg || 'solve';
    const signal = typeof onProgressOrOpts === 'object' ? onProgressOrOpts?.signal : undefined;
    const res = await recognizeHomeworkPhoto(imageDataUri, { onProgress, purpose, signal });
    return { ok: true, ...res };
  },

  async solveHomework({
    grade,
    examGoal,
    subject,
    mode,
    taskText,
    imageBase64,
    imagesList,
    ocrText,
    photoMode = 'auto',
    provider,
    apiKey,
    model,
    customBaseUrl, customTransport, customVision,
    onStatus,
    reasoning = 'off', webSearch = false, searchQuery = '',
    signal,
  }) {
    const locked = isTutorModeEnabled();
    const tutor = locked || mode === 'tutor';
    const effectiveMode = tutor ? 'tutor' : mode;
    const cleanTask = (taskText || '').trim();
    let cleanOcr = (ocrText || '').trim();
    const allImgs = Array.isArray(imagesList) && imagesList.length > 0 ? imagesList : imageBase64 ? [imageBase64] : [];
    // Do not derive exact-answer hints or local findings from stale OCR in a native-image request.
    if (allImgs.length && (photoMode === 'vision' || (photoMode === 'auto' && allImgs.length <= getPhotoCapability({ provider, model, customVision }).maxImages))) cleanOcr = '';
    if (!cleanTask && allImgs.length === 0 && !cleanOcr) {
      return { ok: false, error: 'Напишите задание, надиктуйте голосом или добавьте фотографию.' };
    }

    onStatus?.({ stage: 'prepare', message: 'Подготавливаем условие и выбранный учебный режим…' });

    try {
      checkRequestActive(signal, locked);
      const sympyBadge = tutor ? '' : autoVerifyMathJS(cleanTask || cleanOcr);
      const sysPrompt = buildSystemPrompt(grade, examGoal, subject, effectiveMode, sympyBadge);
      const userPrompt = cleanTask || 'Помоги решить домашнее задание с прикреплённого фото.';

      const {
        text: ansMd,
        used: providerUsed,
        extractedPhotoText, photoInputUsed = 'none',
      } = await generateAiBrowser({
        provider,
        apiKey,
        model,
        customBaseUrl, customTransport, customVision,
        systemPrompt: sysPrompt, graphics: true, reasoning, webSearch, searchQuery,
        messages: [{ role: 'user', content: userPrompt }],
        imageB64: allImgs[0] || null,
        images: allImgs,
        photoMode,
        ocrText: cleanOcr,
        onStatus,
        fallbackMode: tutor ? 'tutor' : 'solve',
        fallbackMeta: { grade, subject },
        requiresPhotoContent: Boolean(allImgs.length > 0 && !cleanTask && !cleanOcr),
        signal,
      });

      const finalOcr = photoInputUsed === 'vision' ? '' : extractedPhotoText || cleanOcr;
      checkRequestActive(signal, locked);
      const recheckedSympy = tutor ? '' : sympyBadge || autoVerifyMathJS(finalOcr);

      const convMessages = [
        {
          role: 'user',
          content: userPrompt + (finalOcr ? `\n\n📷 Прочитано с фото:\n${finalOcr}` : ''),
        },
        { role: 'assistant', content: ansMd },
      ];

      onStatus?.({ stage: 'saving', message: 'Ответ получен. Сохраняем в вашу тетрадь…' });
      const saved = await chatStore.saveNew({
        item_type: 'solve',
        tutor_only: locked,
        grade,
        exam_goal: examGoal,
        subject,
        mode: effectiveMode,
        task_text: cleanTask || (finalOcr ? finalOcr.slice(0, 180) : 'Задание по фото'),
        image_b64: allImgs[0] || '',
        images_b64: allImgs,
        photo_mode: photoMode,
        photo_input_used: photoInputUsed,
        ocr_text: finalOcr,
        response_md: ansMd,
        sympy_badge: recheckedSympy,
        provider_used: providerUsed,
        messages: convMessages,
      });

      return {
        ok: true,
        id: saved.id,
        chatRecord: saved,
        markdown: ansMd,
        extractedPhotoText: finalOcr,
        photoInputUsed,
        sympyBadge: recheckedSympy,
        providerUsed,
        messages: convMessages,
      };
    } catch (e) {
      if (e?.name === 'AbortError') return { ok: false, aborted: true, error: '' };
      return { ok: false, error: e.message };
    }
  },

  async chatFollowup({
    grade,
    examGoal,
    subject,
    mode,
    itemType = 'solve',
    historyId,
    messages,
    action,
    question,
    provider,
    apiKey,
    model,
    customBaseUrl, customTransport, customVision,
    onStatus,
    reasoning = 'off', webSearch = false, searchQuery = '',
    signal,
  }) {
    const locked = isTutorModeEnabled();
    const tutor = locked || mode === 'tutor';
    let promptQ = (question || '').trim();
    if (action === 'board_prep') {
      promptQ =
        'Представь, что завтра учитель вызовет меня к доске по этому заданию. Составь 3 самых вероятных вопроса учителя «на понимание» по этому решению и напиши короткие, уверенные ответы на пятёрку!';
    } else if (action === 'similar_task') {
      promptQ = `Придумай одну похожую тренировочную задачу такого же уровня (${grade} класс) с другими числами или словами, чтобы я закрепил тему. Сначала условие и подсказка, а правильный ответ в самом низу.`;
    } else if (action === 'simpler') {
      promptQ = `Объясни это же решение ещё проще, буквально «на пальцах», для ученика ${grade} класса.`;
    } else if (action === 'explain_rules') {
      promptQ = `Объясни подробнее с примерами все правила, в которых были допущены ошибки в моей работе, чтобы я больше их не допускал.`;
    }

    if (tutor) promptQ = tutorFollowupQuestion(action, grade) || promptQ;
    if (!promptQ) return { ok: false, error: 'Введите вопрос.' };

    try {
      const original = historyId ? await chatStore.get(historyId) : null;
      if (locked && historyId) {
        if (!original?.tutor_only) return { ok: false, error: 'Начните новый диалог с репетитором. Обычные чаты закрыты в детском режиме.' };
      }
      checkRequestActive(signal, locked);
      const sysPrompt =
        itemType === 'check' && !tutor
          ? buildCheckerPrompt(grade, examGoal, subject)
          : buildSystemPrompt(grade, examGoal, subject, tutor ? 'tutor' : mode);

      const nextMsgs = [...(messages || []), { role: 'user', content: promptQ }];
      const { text: reply, used: providerUsed, photoInputUsed } = await generateAiBrowser({
        provider,
        apiKey,
        model,
        customBaseUrl, customTransport, customVision,
        systemPrompt: sysPrompt, graphics: true, reasoning, webSearch, searchQuery,
        messages: nextMsgs,
        // Images remain available to native Vision on every follow-up, not only the first turn.
        imageB64: original?.image_b64 && (original.photo_input_used === 'vision' || !original.ocr_text) ? original.image_b64 : null,
        images: original && (original.photo_input_used === 'vision' || !original.ocr_text) ? (original.images_b64?.length ? original.images_b64 : original.image_b64 ? [original.image_b64] : []) : [],
        photoMode: original?.photo_input_used === 'vision' ? 'vision' : (original?.photo_mode || 'auto'),
        onStatus,
        fallbackMode: tutor ? 'tutor' : itemType === 'check' ? 'check' : 'solve',
        fallbackMeta: { grade, subject },
        signal,
      });
      checkRequestActive(signal, locked);
      nextMsgs.push({ role: 'assistant', content: reply });
      if (historyId) {
        onStatus?.({ stage: 'saving', message: 'Сохраняем продолжение диалога…' });
        await chatStore.update(historyId, {
          messages: nextMsgs,
          response_md: nextMsgs[1]?.content || reply,
        });
      }
      return { ok: true, reply, providerUsed, photoInputUsed, messages: nextMsgs };
    } catch (e) {
      if (e?.name === 'AbortError') return { ok: false, aborted: true, error: '' };
      return { ok: false, error: e.message };
    }
  },

  async checkDraft({
    grade,
    examGoal,
    checkType = 'general',
    conditionText,
    draftText,
    imageBase64,
    imagesList,
    ocrText,
    photoMode = 'auto',
    provider,
    apiKey,
    model,
    customBaseUrl, customTransport, customVision,
    onStatus,
    reasoning = 'off', webSearch = false, searchQuery = '',
    signal,
  }) {
    if (isTutorModeEnabled()) return { ...TUTOR_ONLY_ERROR };
    const locked = false;
    const cleanCond = (conditionText || '').trim();
    const cleanDraft = (draftText || '').trim();
    let cleanOcr = (ocrText || '').trim();
    const allImgs = Array.isArray(imagesList) && imagesList.length > 0 ? imagesList : imageBase64 ? [imageBase64] : [];
    // Do not derive exact-answer hints or local findings from stale OCR in a native-image request.
    if (allImgs.length && (photoMode === 'vision' || (photoMode === 'auto' && allImgs.length <= getPhotoCapability({ provider, model, customVision }).maxImages))) cleanOcr = '';

    if (!cleanDraft && allImgs.length === 0 && !cleanOcr) {
      return {
        ok: false,
        error: 'Напишите свой черновик в поле текста ИЛИ прикрепите фотографию тетради.',
      };
    }

    // 1. Instant local express check (0.01s)
    const express = runLocalExpressCheck({
      conditionText: cleanCond,
      draftText: cleanDraft || cleanOcr,
      checkType,
      grade,
    });

    const parts = [];
    if (cleanCond) parts.push(`**Условие задания / тема:**\n${cleanCond}`);
    if (cleanDraft) parts.push(`**Черновик / решение ученика:**\n${cleanDraft}`);
    if (!parts.length) parts.push('Внимательно прочитай и проверь мою домашнюю работу на прикреплённой фотографии.');
    const fullUserMsg = parts.join('\n\n');

    try {
      const sysPrompt = buildCheckerPrompt(grade, examGoal, checkType);
      const {
        text: ansMd,
        used: providerUsed,
        extractedPhotoText, photoInputUsed = 'none',
      } = await generateAiBrowser({
        provider,
        apiKey,
        model,
        customBaseUrl, customTransport, customVision,
        systemPrompt: sysPrompt, graphics: true, reasoning, webSearch, searchQuery,
        messages: [{ role: 'user', content: fullUserMsg }],
        imageB64: allImgs[0] || null,
        images: allImgs,
        photoMode,
        ocrText: cleanOcr,
        onStatus,
        fallbackMode: 'check',
        requiresPhotoContent: Boolean(allImgs.length > 0 && !cleanDraft && !cleanOcr),
        fallbackMeta: {
          conditionText: cleanCond,
          draftText: cleanDraft,
          checkType,
          grade,
        },
        signal,
      });

      checkRequestActive(signal, locked);
      const finalOcr = photoInputUsed === 'vision' ? '' : extractedPhotoText || cleanOcr;
      const finalExpress =
        finalOcr && !cleanDraft
          ? runLocalExpressCheck({
              conditionText: cleanCond,
              draftText: finalOcr,
              checkType,
              grade,
            })
          : express;

      const convMessages = [
        {
          role: 'user',
          content: fullUserMsg + (finalOcr ? `\n\n📷 Прочитано с фото:\n${finalOcr}` : ''),
        },
        { role: 'assistant', content: ansMd },
      ];

      onStatus?.({ stage: 'saving', message: 'Ответ получен. Сохраняем в вашу тетрадь…' });
      const saved = await chatStore.saveNew({
        item_type: 'check',
        grade,
        exam_goal: examGoal,
        subject: checkType,
        mode: 'checker',
        title: `Проверка: ${(cleanCond || cleanDraft || finalOcr || 'Работа по фото').slice(0, 56)}`,
        task_text: cleanCond || (cleanDraft ? cleanDraft.slice(0, 160) : finalOcr.slice(0, 160) || 'Проверка по фото'),
        condition_text: cleanCond,
        draft_text: cleanDraft,
        image_b64: allImgs[0] || '',
        images_b64: allImgs,
        photo_mode: photoMode,
        photo_input_used: photoInputUsed,
        ocr_text: finalOcr,
        response_md: ansMd,
        provider_used: providerUsed,
        messages: convMessages,
      });

      const mistakesAdded = mistakeStore.captureFromDraftCheck(ansMd, finalExpress?.findings || [], {
        checkType,
        grade,
      });

      return {
        ok: true,
        id: saved.id,
        chatRecord: saved,
        markdown: ansMd,
        express: finalExpress,
        extractedPhotoText: finalOcr,
        photoInputUsed,
        mistakesAdded,
        providerUsed,
        messages: convMessages,
      };
    } catch (e) {
      if (e?.name === 'AbortError') return { ok: false, aborted: true, error: '', express };
      return { ok: false, error: e.message, express };
    }
  },

  async generateQuiz({ grade, subject, topic, provider, apiKey, model, customBaseUrl, customTransport, customVision, onStatus, signal }) {
    if (isTutorModeEnabled()) return { ...TUTOR_ONLY_ERROR };
    return generatePracticeQuizBrowser({
      grade,
      subject,
      topic,
      provider,
      apiKey,
      model,
      customBaseUrl, customTransport, customVision,
      onStatus,
      signal,
    });
  },

  async generateExamVariant({
    grade,
    subject,
    examType,
    topic,
    provider,
    apiKey,
    model,
    customBaseUrl, customTransport, customVision,
    onStatus,
    signal,
  }) {
    if (isTutorModeEnabled()) return { ...TUTOR_ONLY_ERROR };
    return generateExamVariantBrowser({
      grade,
      subject,
      examType,
      topic,
      provider,
      apiKey,
      model,
      customBaseUrl, customTransport, customVision,
      onStatus,
      signal,
    });
  },

  async generateMistakeDrill({
    mistake,
    grade,
    provider,
    apiKey,
    model,
    customBaseUrl, customTransport, customVision,
    onStatus,
    signal,
  }) {
    if (isTutorModeEnabled()) return { ...TUTOR_ONLY_ERROR };
    return generateMistakeDrillBrowser({
      mistake,
      grade,
      provider,
      apiKey,
      model,
      customBaseUrl, customTransport, customVision,
      onStatus,
      signal,
    });
  },

  async runExactTool(payload) {
    if (isTutorModeEnabled()) return { ...TUTOR_ONLY_ERROR };
    return runExactToolJS(payload);
  },
};

export async function copyTextSafe(text) {
  const str = String(text || '');
  if (!str) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(str);
      return true;
    }
  } catch {
    // Fall back to execCommand below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export {
  chatStore,
  subscribeHistory,
  saveInputDraft,
  loadInputDraft,
  getStudentStats,
  recordStudentActivity,
  mistakeStore,
  subscribeMistakes,
  fileToDataUri,
  transformImageCanvas,
  preparePhotoFile,
  runLocalExpressCheck,
};
