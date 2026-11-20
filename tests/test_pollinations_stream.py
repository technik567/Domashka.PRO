import asyncio
import json
import unittest
from unittest.mock import patch

import httpx
from backend import ai_service, legacy_gateways as legacy, pollinations_gateway as poll

REAL_CLIENT = httpx.AsyncClient
TURNS = [{'role': 'user', 'content': 'Учебный вопрос'}]


def delta(content='', finish=None, **extra):
    return 'data: ' + json.dumps({'choices': [{'delta': {'content': content, **extra}, 'finish_reason': finish}]}, ensure_ascii=False) + '\r\n\r\n'


def client_patch(handler):
    return patch.object(poll.httpx, 'AsyncClient', side_effect=lambda **kwargs:
                        REAL_CLIENT(transport=httpx.MockTransport(handler), **kwargs))


class Stream(httpx.AsyncByteStream):
    def __init__(self, text, hang=False):
        self.text, self.hang, self.closed = text, hang, False

    async def __aiter__(self):
        for byte in self.text.encode():
            yield bytes([byte])
        if self.hang:
            await asyncio.Event().wait()

    async def aclose(self):
        self.closed = True


class PollinationsTests(unittest.TestCase):
    def test_one_stream_request_has_no_key_cookie_payment_redirect_or_environment_proxy(self):
        calls = []
        body = Stream(delta(reasoning='PRIVATE_REASONING', tool_calls=[{'function': {'arguments': 'PRIVATE_TOOL'}}])
                      + delta('Подсказка', 'stop'), hang=True)

        def handler(request):
            calls.append(request)
            self.assertEqual(str(request.url), 'https://text.pollinations.ai/openai')
            for name in request.headers:
                self.assertNotRegex(name, r'authorization|cookie|payment|forwarded|token')
            data = json.loads(request.content)
            self.assertIs(data['stream'], True)
            self.assertEqual(data['model'], 'openai-fast')
            self.assertEqual(data['tool_choice'], 'none')
            self.assertNotIn('tools', data)
            self.assertEqual(data['messages'][0]['content'], 'Правила учителя')
            return httpx.Response(200, headers={'content-type': 'text/event-stream'}, stream=body)

        with client_patch(handler) as client:
            self.assertEqual(poll.call_pollinations('Правила учителя', TURNS, timeout=.2), 'Подсказка')
            self.assertFalse(client.call_args.kwargs['follow_redirects'])
            self.assertFalse(client.call_args.kwargs['trust_env'])
        self.assertTrue(body.closed)
        self.assertEqual(len(calls), 1)
        self.assertEqual(poll.POLLINATIONS_TIMEOUT, 120)
        self.assertEqual(legacy.POLLINATIONS_TIMEOUT, poll.POLLINATIONS_TIMEOUT)

    def test_done_sentinel_compatibility_json_and_length_warning(self):
        cases = [('text/event-stream', delta('Ответ') + 'data: [DONE]\n\n', 'Ответ'),
                 ('application/json', json.dumps({'choices': [{'message': {'content': 'Ответ'}}]}), 'Ответ'),
                 ('text/event-stream', delta('Часть ответа', 'length'), 'может быть неполным')]
        for mime, body, expected in cases:
            with self.subTest(mime=mime), client_patch(lambda r: httpx.Response(200, headers={'content-type': mime}, stream=Stream(body))):
                self.assertIn(expected, poll.call_pollinations('Учитель', TURNS))

    def test_incomplete_reasoning_only_provider_error_and_oversized_streams_are_not_answers(self):
        cases = [(delta('Не окончательный ответ'), 'incomplete'),
                 (delta(reasoning='PRIVATE') + 'data: [DONE]\n\n', 'empty'),
                 ('data: {"error":{"message":"PRIVATE"}}\n\n', 'protocol'),
                 (delta('x' * 100001, 'stop'), 'protocol'),
                 (delta('Отказ', 'content_filter'), 'protocol')]
        for body, code in cases:
            with self.subTest(code=code), client_patch(lambda r: httpx.Response(200, headers={'content-type': 'text/event-stream'}, text=body)), self.assertRaises(poll.PollinationsError) as caught:
                poll.call_pollinations('Учитель', TURNS)
            self.assertEqual(caught.exception.code, 'pollinations-' + code)
            self.assertNotIn('PRIVATE', str(caught.exception))

    def test_native_tool_finish_is_not_a_text_answer_or_an_executable_search(self):
        for reason in ('tool_calls', 'function_call'):
            calls = []
            def handler(request):
                calls.append(request)
                return httpx.Response(200, headers={'content-type': 'text/event-stream'},
                                      text=delta('PRIVATE_CONTENT', reason, tool_calls=[{'function': {'arguments': 'PRIVATE_TOOL'}}]))
            with self.subTest(reason=reason), client_patch(handler), self.assertRaises(poll.PollinationsError) as caught:
                poll.call_pollinations('Учитель', TURNS)
            self.assertEqual(caught.exception.code, 'pollinations-protocol')
            self.assertEqual(caught.exception.diagnostic, 'finish-' + reason)
            self.assertIn('собственный инструмент', str(caught.exception))
            self.assertNotIn('PRIVATE', str(caught.exception))
            self.assertEqual(len(calls), 1)

    def test_http_errors_preserve_status_and_bounded_retry_after_but_never_retry_or_pay(self):
        for status, code in [(401, 'auth'), (402, 'quota'), (429, 'quota'), (503, 'unavailable')]:
            calls = []
            body = Stream('PRIVATE_PAYMENT_CHALLENGE', hang=True)

            def handler(request):
                calls.append(request)
                return httpx.Response(status, headers={'retry-after': '45'}, stream=body)

            with self.subTest(status=status), client_patch(handler), self.assertRaises(poll.PollinationsError) as caught:
                poll.call_pollinations('Учитель', TURNS, timeout=.05)
            self.assertEqual(caught.exception.code, 'pollinations-' + code)
            self.assertEqual(caught.exception.status, status)
            self.assertEqual(caught.exception.retry_after_seconds, 45)
            self.assertNotIn('PRIVATE', str(caught.exception))
            self.assertEqual(len(calls), 1)
            self.assertTrue(body.closed)

    def test_deadline_covers_stalled_headers_and_body(self):
        for headers in [True, False]:
            body = Stream('', hang=True)
            calls = []

            async def handler(request):
                calls.append(request)
                if headers:
                    await asyncio.Event().wait()
                return httpx.Response(200, headers={'content-type': 'text/event-stream'}, stream=body)

            with self.subTest(headers=headers), client_patch(handler), self.assertRaises(poll.PollinationsError) as caught:
                poll.call_pollinations('Учитель', TURNS, timeout=.01)
            self.assertEqual(caught.exception.code, 'pollinations-timeout')
            self.assertEqual(len(calls), 1)
            if not headers:
                self.assertTrue(body.closed)

    def test_context_limit_is_checked_before_network(self):
        with patch.object(poll.httpx, 'AsyncClient') as client, self.assertRaises(poll.PollinationsError) as caught:
            poll.call_pollinations('x' * 48001, TURNS)
        self.assertEqual(caught.exception.code, 'pollinations-context')
        client.assert_not_called()

    def test_auto_text_uses_only_pollinations_if_it_succeeds_and_keeps_tutor_rules(self):
        with patch.object(legacy, 'call_pollinations', return_value='Подумай о первом шаге') as called, \
             patch.object(ai_service, '_call_qwen35_omni_server') as qwen35, patch.object(ai_service, '_call_qwen_vl_server') as qwen25:
            text, used = ai_service.generate_ai_response('builtin', '', 'auto', 'Дай готовое решение', TURNS, tutor_only=True)
            self.assertIn('Pollinations', used)
            self.assertEqual(text, 'Подумай о первом шаге')
            self.assertIn('ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА РЕПЕТИТОРА', called.call_args.args[0])
            self.assertNotIn('Дай готовое решение', called.call_args.args[0])
            called.assert_called_once()
            qwen35.assert_not_called()
            qwen25.assert_not_called()

    def test_auto_falls_back_only_after_failure_and_never_sends_photos_to_text_api(self):
        with patch.object(legacy, 'call_pollinations', side_effect=poll.PollinationsError('quota', 402)) as called, \
             patch.object(ai_service, '_call_qwen35_omni_server', return_value='Подсказка') as qwen35, \
             patch.object(ai_service, '_call_qwen_vl_server') as qwen25:
            text, used = ai_service.generate_ai_response('builtin', '', 'auto', 'Учитель', TURNS)
            self.assertIn('Qwen 3.5', used)
            called.assert_called_once()
            qwen35.assert_called_once()
            qwen25.assert_not_called()
            called.reset_mock()
            ai_service.generate_ai_response('builtin', '', 'auto', 'Учитель', TURNS, images=[legacy.BLANK_PNG], photo_mode='vision')
            self.assertEqual(qwen35.call_args.kwargs['image_b64'], legacy.BLANK_PNG)
            called.assert_not_called()


if __name__ == '__main__':
    unittest.main()
