import { linkAbortSignals, throwIfAborted } from './network';

export const OPENROUTER_TIMEOUT_MS = 300_000;
const MAX_RESPONSE_CHARS = 2_000_000;

function providerError(status) {
  if (status === 401) return 'OpenRouter: неверный API-ключ. Проверьте настройки ИИ.';
  if (status === 402) return 'OpenRouter: недостаточно средств или исчерпан бюджет ключа. Выберите доступную бесплатную модель или проверьте лимит ключа.';
  if (status === 403) return 'OpenRouter: доступ запрещён. Проверьте разрешения ключа, доступность модели и ограничения региона.';
  if (status === 429) return 'OpenRouter: достигнут лимит запросов или модель перегружена. Подождите и повторите запрос самостоятельно.';
  if ([502, 503, 504].includes(status)) return 'OpenRouter: провайдер модели временно недоступен или не ответил. Выберите другую модель либо повторите позже.';
  return `OpenRouter не смог завершить ответ${status ? ` (код ${status})` : ''}. Попробуйте другую модель.`;
}

// No speculative retries: a timed-out generation may still be billed by the provider.
// Reasoning deltas are deliberately not returned or retained; only answer text is collected.
export async function requestOpenRouter({ apiKey, model, messages, tutor = false, signal: externalSignal, onStatus }) {
  const { signal, cleanup } = linkAbortSignals(externalSignal, OPENROUTER_TIMEOUT_MS);
  let reader;
  try {
    throwIfAborted(externalSignal);
    onStatus?.({ stage: 'cloud', message: `OpenRouter (${model}): ждём ответ. Для сложных задач — до 5 минут; можно остановить ожидание.` });
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json', 'X-Title': 'Domashka.PRO' },
      body: JSON.stringify({ model, messages, stream: true, temperature: 0.35, max_tokens: tutor ? 1600 : 6000 }),
    });
    if (!response.ok) throw new Error(providerError(response.status));
    let answer = ''; let usedModel = model; let ended = false; let finishReason = ''; let totalChars = 0;
    function consume(data) {
      if (data?.error) throw new Error(providerError(Number(data.error.code)));
      if (data?.model) usedModel = data.model;
      const choice = data?.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const content = choice?.delta?.content ?? choice?.message?.content;
      if (typeof content === 'string') {
        answer += content;
        onStatus?.({ stage: 'streaming', receivedChars: answer.length,
          message: `OpenRouter: получаем ответ (${answer.length} символов). Генерация ещё не завершена.` });
      } else if (choice?.delta?.reasoning || choice?.delta?.reasoning_details) {
        onStatus?.({ stage: 'cloud', message: 'OpenRouter: модель рассуждает. Текст ответа ещё не готов.' });
      }
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      let jsonText = '';
      if (response.body?.getReader) {
        reader = response.body.getReader(); const decoder = new TextDecoder();
        while (true) {
          throwIfAborted(signal); const { value, done } = await reader.read();
          jsonText += decoder.decode(value, { stream: !done });
          if (jsonText.length > MAX_RESPONSE_CHARS) throw new Error('Ответ OpenRouter превышает безопасный размер. Сократите задание.');
          if (done) break;
        }
      } else jsonText = await response.text();
      if (jsonText.length > MAX_RESPONSE_CHARS) throw new Error('Ответ OpenRouter превышает безопасный размер. Сократите задание.');
      let data;
      try { data = JSON.parse(jsonText); } catch { throw new Error('OpenRouter прислал повреждённый ответ. Повторите запрос самостоятельно.'); }
      consume(data);
      ended = true;
    } else {
      let pending = '';
      function event(block) {
        const lines = block.split('\n').filter((line) => line.startsWith('data:'));
        const payload = lines.map((line) => line.slice(5).trimStart()).join('\n').trim();
        if (!payload) return; // SSE heartbeat, not task completion
        if (payload === '[DONE]') { ended = true; return; }
        let data;
        try { data = JSON.parse(payload); } catch { throw new Error('OpenRouter прислал повреждённый поток. Неполный ответ не сохранён.'); }
        consume(data);
      }
      // Normalize CRLF only after both halves have arrived, including split CR/LF chunks.
      function chunk(text, final = false) {
        totalChars += text.length;
        if (totalChars > MAX_RESPONSE_CHARS) throw new Error('Ответ OpenRouter превышает безопасный размер. Сократите задание.');
        pending += text;
        let match;
        while ((match = /\r?\n\r?\n/.exec(pending))) {
          const block = pending.slice(0, match.index).replace(/\r\n/g, '\n');
          pending = pending.slice(match.index + match[0].length);
          event(block);
        }
        if (final && pending.trim()) event(pending.replace(/\r\n/g, '\n'));
      }
      if (response.body?.getReader) {
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (!ended) {
          const next = await reader.read();
          if (signal.aborted) throw signal.reason;
          if (next.done) { chunk(decoder.decode(), true); break; }
          chunk(decoder.decode(next.value, { stream: true }));
        }
      } else {
        // Older WebViews can still read the final SSE body, without incremental updates.
        chunk(await response.text(), true);
      }
      if (!ended && !finishReason) throw new Error('Соединение OpenRouter оборвалось до завершения ответа. Неполный текст не сохранён.');
    }
    if (signal.aborted) throw signal.reason;
    throwIfAborted(externalSignal);
    if (finishReason === 'error' || finishReason === 'content_filter') throw new Error(providerError());
    if (!answer.trim()) throw new Error('OpenRouter завершил запрос без текста ответа. Возможно, модель израсходовала лимит на рассуждение. Выберите другую модель или сократите задание.');
    if (finishReason === 'length') answer += '\n\n> ⚠️ Ответ остановлен лимитом токенов модели и может быть неполным. Попросите продолжить или разделите задание.';
    return { text: answer, used: `OpenRouter (${usedModel})` };
  } catch (error) {
    if (externalSignal?.aborted) throw new DOMException('Запрос остановлен.', 'AbortError');
    if (signal.reason?.name === 'TimeoutError' || error?.name === 'TimeoutError') {
      throw new Error('OpenRouter не завершил ответ за 5 минут. Ожидание остановлено, автоматического повтора нет. Провайдер может ещё обрабатывать запрос; проверьте его журнал перед повтором.');
    }
    if (error instanceof TypeError) throw new Error('Не удалось связаться с OpenRouter или поток оборвался. Проверьте сеть и ограничения HTML Viewer. Запрос автоматически не повторяется.');
    throw error;
  } finally {
    if (reader) { try { await reader.cancel(); } catch { /* already aborted/closed */ } }
    cleanup();
  }
}
