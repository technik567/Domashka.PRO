"""One keyless streaming request, through the vendor's ordinary free queue.

The legacy origin implements stream:true as waiting for the same 45s/IP free
slot. Never sign a payment challenge, change identities or retry a refusal.
Reference: pollinations/pollinations master, cloudflare-cache/src/origin.js.
"""
import asyncio
import json
import re
from pathlib import Path

import httpx

_CONFIG = json.loads((Path(__file__).resolve().parent.parent / 'shared' / 'legacy-gateways.json').read_text(encoding='utf-8'))
POLLINATIONS_TIMEOUT = _CONFIG['pollinationsTimeoutMs'] / 1000
POLLINATIONS_MODEL = _CONFIG['pollinationsModel']
MAX_RESPONSE = 2_000_000
MAX_EVENT = 100_000


class PollinationsError(RuntimeError):
    def __init__(self, code, status=0, retry_after_seconds=0):
        self.code = 'pollinations-' + code
        self.status = status if isinstance(status, int) and 400 <= status <= 599 else 0
        self.retry_after_seconds = retry_after_seconds if isinstance(retry_after_seconds, int) and 0 < retry_after_seconds <= 3600 else 0
        messages = {'auth': 'не разрешил анонимный запрос',
                    'quota': 'отказал в бесплатном запросе (интервал или лимит сервиса)',
                    'unavailable': 'временно недоступен', 'protocol': 'вернул неподдерживаемый ответ',
                    'timeout': 'не завершил очередь и ответ в отведённое время; запрос мог быть принят',
                    'network': 'не ответил или оборвал соединение', 'incomplete': 'оборвал поток до завершения; неполный ответ не принят',
                    'empty': 'завершил запрос без текста ответа', 'context': 'задание и история превышают безопасный объём подключения'}
        super().__init__(f"Pollinations: {messages.get(code, messages['protocol'])}."
                         + (f' HTTP {self.status}.' if self.status else '')
                         + (f' Сервис просит подождать не менее {self.retry_after_seconds} с.' if self.retry_after_seconds else '')
                         + ' Автоматического повтора и оплаты нет.')


class PollinationsStream:
    """Retain only the final answer; never publish/store reasoning/tool deltas."""
    def __init__(self, is_json=False):
        self.is_json = is_json
        self.pending = self.answer = self.reason = ''
        self.size = 0
        self.complete = False

    def consume(self, data, is_json=False):
        if not isinstance(data, dict) or data.get('error'):
            raise PollinationsError('protocol')
        choices = data.get('choices')
        choice = choices[0] if isinstance(choices, list) and choices else None
        if not isinstance(choice, dict):
            if is_json:
                raise PollinationsError('protocol')
            return
        message = choice.get('message' if is_json else 'delta')
        content = message.get('content') if isinstance(message, dict) else None
        if isinstance(content, str):
            self.answer += content
            if len(self.answer) > MAX_EVENT:
                raise PollinationsError('protocol')
        if choice.get('finish_reason'):
            self.reason = choice['finish_reason']
            if self.reason not in ('stop', 'length'):
                raise PollinationsError('protocol')
            self.complete = True
        if is_json:
            self.complete = True

    def event(self, block):
        if self.complete or not block.strip():
            return
        if len(block) > MAX_EVENT:
            raise PollinationsError('protocol')
        payload = '\n'.join(line[5:].lstrip() for line in block.lstrip('\ufeff').split('\n') if line.startswith('data:')).strip()
        if not payload:
            return
        if payload == '[DONE]':
            self.complete = True
            return
        try:
            data = json.loads(payload)
        except ValueError:
            raise PollinationsError('protocol') from None
        self.consume(data)

    def feed(self, text, final=False):
        self.size += len(text)
        if self.size > MAX_RESPONSE:
            raise PollinationsError('protocol')
        self.pending += text
        if self.is_json:
            if final:
                try:
                    data = json.loads(self.pending)
                except ValueError:
                    raise PollinationsError('protocol') from None
                self.consume(data, is_json=True)
                self.pending = ''
            return
        while not self.complete:
            delimiter = re.search(r'\r?\n\r?\n', self.pending)
            if not delimiter:
                break
            self.event(self.pending[:delimiter.start()].replace('\r\n', '\n'))
            self.pending = self.pending[delimiter.end():]
        if not self.complete and len(self.pending) > MAX_EVENT:
            raise PollinationsError('protocol')
        if final and not self.complete and self.pending.strip():
            self.event(self.pending.replace('\r\n', '\n'))

    def finish(self):
        self.feed('', final=True)
        if not self.complete:
            raise PollinationsError('incomplete')
        if not self.answer.strip():
            raise PollinationsError('empty')
        if self.reason == 'length':
            self.answer += '\n\n> Ответ ограничен длиной модели и может быть неполным. Попросите продолжить или разделите задание.'
        return self.answer


async def pollinations_request(system_prompt, messages):
    turns = [{'role': m['role'], 'content': str(m.get('content') or '')} for m in (messages or [])
             if isinstance(m, dict) and m.get('role') in ('user', 'assistant')][-8:]
    system_prompt = str(system_prompt or '')
    if not turns:
        raise PollinationsError('empty')
    if len(system_prompt) + len(json.dumps(turns, ensure_ascii=False)) > 48000:
        raise PollinationsError('context')
    async with httpx.AsyncClient(timeout=httpx.Timeout(None, connect=15), follow_redirects=False, trust_env=False) as client:
        async with client.stream('POST', 'https://text.pollinations.ai/openai', headers={'Accept': 'text/event-stream'},
                                 json={'model': POLLINATIONS_MODEL, 'stream': True, 'temperature': 0.35,
                                       'messages': [{'role': 'system', 'content': system_prompt}] + turns}) as response:
            if not response.is_success:
                status = response.status_code
                raw_delay = response.headers.get('retry-after', '')
                delay = int(raw_delay) if re.fullmatch(r'[0-9]{1,4}', raw_delay) else 0
                raise PollinationsError('auth' if status in (401, 403) else 'quota' if status in (402, 429)
                                        else 'unavailable' if status >= 500 else 'protocol', status, delay)
            mime = response.headers.get('content-type', '')
            if 'text/event-stream' not in mime and 'application/json' not in mime:
                raise PollinationsError('protocol')
            raw_length = response.headers.get('content-length', '')
            if raw_length.isdigit() and int(raw_length) > MAX_RESPONSE:
                raise PollinationsError('protocol')
            parser = PollinationsStream(is_json='application/json' in mime)
            async for chunk in response.aiter_text():
                parser.feed(chunk)
                if parser.complete:
                    break
            return parser.finish()


def call_pollinations(system_prompt, messages, timeout=POLLINATIONS_TIMEOUT):
    async def bounded():
        return await asyncio.wait_for(pollinations_request(system_prompt, messages), timeout=timeout)
    try:
        return asyncio.run(bounded())
    except asyncio.TimeoutError:
        raise PollinationsError('timeout') from None
    except httpx.HTTPError:
        raise PollinationsError('network') from None
