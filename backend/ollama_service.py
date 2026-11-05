"""Opt-in, same-origin Ollama bridge. The upstream URL is NEVER accepted from a client."""
import os
from urllib.parse import urlsplit, urlunsplit

import httpx


def proxy_enabled() -> bool:
    return os.environ.get('DOMASHKA_ENABLE_OLLAMA_PROXY', '').strip() == '1'


def configured_endpoint() -> str:
    if not proxy_enabled():
        raise ValueError('Мост Ollama выключен. На компьютере с Python задайте DOMASHKA_ENABLE_OLLAMA_PROXY=1, запустите Ollama и перезапустите server.py. По умолчанию используется Ollama на этом же компьютере, порт 11434.')
    value = os.environ.get('DOMASHKA_OLLAMA_URL', 'http://127.0.0.1:11434/v1').strip()
    parts = urlsplit(value)
    if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError('Некорректный DOMASHKA_OLLAMA_URL на Python-сервере: нужен HTTP/HTTPS URL без логина, пароля и параметров.')
    path = parts.path.rstrip('/') or '/v1'
    if path.endswith(('/api/chat', '/api/generate', '/api/tags', '/api/show')):
        raise ValueError('DOMASHKA_OLLAMA_URL должен указывать на корень Ollama или /v1, не на нативный /api/chat.')
    if not path.endswith('/chat/completions'):
        path += '/chat/completions'
    return urlunsplit((parts.scheme, parts.netloc, path, '', ''))


def validate_browser_origin(origin: str, host: str) -> None:
    # A browser from another site must not be able to spend the local machine's GPU.
    # This is a CSRF/origin check, NOT authentication for a publicly exposed server.
    if not origin:
        return  # local command-line clients; server is intended for a trusted network only
    parsed = urlsplit(origin)
    if parsed.scheme not in ('http', 'https') or parsed.netloc.lower() != host.lower() or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise ValueError('Мост Ollama разрешён только со страницы вашего Python-сервера (same-origin), не из стороннего сайта или file://.')


def complete(model: str, messages: list, tutor_only: bool = False) -> tuple[str, str]:
    endpoint = configured_endpoint()
    model = str(model or 'qwen2.5:7b').strip()
    if not model or len(model) > 200 or len(messages) > 100:
        raise ValueError('Проверьте имя модели и длину диалога Ollama.')
    try:
        # No redirects or environment HTTP proxy: keep data at the administrator's configured target.
        response = httpx.post(endpoint, json={
            'model': model, 'messages': messages, 'stream': False, 'temperature': 0.35,
            'max_tokens': 900 if tutor_only else 4000,
        }, timeout=httpx.Timeout(120.0, connect=5.0), follow_redirects=False, trust_env=False)
    except httpx.TimeoutException as exc:
        raise RuntimeError('Ollama не ответила за 120 секунд. Проверьте загрузку модели, память и журнал Ollama на компьютере с Python.') from exc
    except httpx.RequestError as exc:
        raise RuntimeError('Python-сервер не смог подключиться к Ollama. Запустите Ollama, проверьте DOMASHKA_OLLAMA_URL и установленную модель. localhost здесь — компьютер с Python, не телефон.') from exc
    if response.status_code == 404:
        raise RuntimeError('Ollama: HTTP 404. Проверьте точное имя в ollama list / ollama pull и URL /v1/chat/completions.')
    if response.status_code != 200:
        raise RuntimeError(f'Ollama: HTTP {response.status_code}. Проверьте модель, поддержку изображений и журнал сервера. Ответы и ключи upstream в ошибку не включаются.')
    try:
        text = response.json()['choices'][0]['message']['content']
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise RuntimeError('Ollama вернула ответ не в формате OpenAI chat/completions.') from exc
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError('Ollama вернула пустой текст. Проверьте модель и совместимость API.')
    return text.strip(), f'Ollama через Python ({model})'
