import { getBrowserEnvironment } from './browserEnvironment';

export function normalizeCustomEndpoint(input = '') {
  const raw = String(input || 'http://localhost:11434/v1').trim();
  let url;
  try { url = new URL(raw); } catch { throw new Error('Укажите полный адрес API, например http://localhost:11434 или https://ваш-сервер/v1.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Нужен HTTP/HTTPS-адрес API без логина, пароля, параметров и #. Ключ указывается в отдельном поле.');
  }
  let pathname = url.pathname.replace(/\/+$/, '');
  if (/\/api\/(chat|generate|tags|show)$/.test(pathname)) {
    throw new Error('Это нативный endpoint Ollama. Укажите корень сервера или /v1: например http://localhost:11434/v1.');
  }
  if (!pathname) pathname = '/v1';
  if (!pathname.endsWith('/chat/completions')) pathname += '/chat/completions';
  url.pathname = pathname;
  return url.toString();
}

export function isLoopbackHost(hostname) {
  return /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i.test(hostname);
}

export function customConnectionHints(baseUrl, environment = getBrowserEnvironment()) {
  let url;
  try { url = new URL(normalizeCustomEndpoint(baseUrl)); } catch (error) { return [error.message]; }
  const hints = [];
  if (environment.mobile && isLoopbackHost(url.hostname)) {
    hints.push('localhost / 127.0.0.1 на телефоне означает сам телефон, а не компьютер с Ollama. Нужен доступный адрес вашего API либо режим «Через Python-сервер».');
  }
  if (environment.protocol === 'https:' && url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    hints.push('HTTPS-страница не может надёжно обращаться к обычному HTTP API: браузер блокирует смешанное содержимое. Нужен HTTPS API или серверный режим, а не отключение защиты браузера.');
  }
  if (environment.unsafeNativeMedia || environment.embeddedIOS) {
    hints.push('HTML Viewer/iOS может запрещать локальную сеть или HTTP на уровне приложения. Проверьте разрешение «Локальная сеть», если оно доступно, либо используйте Safari и HTTPS.');
  }
  hints.push('Ollama должна быть запущена, модель — установлена. Адрес на другом компьютере должен быть доступен по сети.');
  hints.push(`Для прямого подключения Ollama должна разрешать CORS для origin ${environment.origin || 'вашего сайта'} через OLLAMA_ORIGINS. Разрешайте только нужный origin, не используйте *.`);
  return hints;
}

export function describeCustomNetworkError(error, baseUrl, environment = getBrowserEnvironment()) {
  if (error?.name === 'TimeoutError') {
    return 'Ollama не ответила за 120 секунд. Первый запуск может долго загружать модель: проверьте установленную модель, память компьютера и журнал Ollama. Затем повторите запрос.';
  }
  return 'Браузер не смог связаться с Ollama / своим API. По «Failed to fetch» / «Load failed» нельзя отличить CORS от недоступного сервера. ' + customConnectionHints(baseUrl, environment).join(' ');
}
