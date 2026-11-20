import asyncio
import json
import unittest
from unittest.mock import patch

import httpx
from backend import ai_service, legacy_gateways as legacy, public_demos as demos

REAL_CLIENT = httpx.AsyncClient
PHOTO = 'data:image/png;base64,AAAA'


def event(data, kind='complete'):
    return f'event: {kind}\r\ndata: {json.dumps(data, ensure_ascii=False)}\r\n\r\n'


def answer(kind='qwen35'):
    return [None, None, None, None, {'value': [{'role': 'assistant', 'content': 'Короткая подсказка'}]}] if kind == 'qwen35' else ['Короткая подсказка']


def client_patch(handler):
    return patch.object(legacy.httpx, 'AsyncClient', side_effect=lambda **kwargs:
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


class LegacyGatewayTests(unittest.TestCase):
    def test_fixed_qwen_routes_stream_complete_and_close_without_waiting_for_eof(self):
        for kind in ['qwen35', 'qwen25']:
            calls = []
            body = Stream(event([None], 'generating') + event(answer(kind)), hang=True)

            def handler(request):
                calls.append(request)
                self.assertNotIn('authorization', request.headers)
                self.assertNotIn('cookie', request.headers)
                if request.url.path.endswith('/upload'):
                    return httpx.Response(200, json=['/tmp/homework.png'], headers={'set-cookie': 'unused=private'})
                if request.method == 'POST':
                    payload = json.loads(request.content)
                    self.assertTrue(payload['session_hash'])
                    return httpx.Response(200, json={'event_id': 'fixture-event'}, headers={'set-cookie': 'unused=private'})
                return httpx.Response(200, headers={'content-type': 'text/event-stream'}, stream=body)

            with self.subTest(kind=kind), client_patch(handler) as client:
                text = legacy.call_qwen(kind, 'Учебный вопрос', 'Правила учителя', image=PHOTO, timeout=1)
            self.assertEqual(text, 'Короткая подсказка')
            self.assertTrue(body.closed)
            self.assertEqual(len(calls), 3)
            self.assertFalse(client.call_args.kwargs['follow_redirects'])
            self.assertFalse(client.call_args.kwargs['trust_env'])

    def test_http_status_is_preserved_without_reading_an_error_body_or_repeating(self):
        for status, code in [(401, 'auth'), (429, 'quota'), (503, 'unavailable')]:
            calls = []

            def handler(request):
                calls.append(request)
                return httpx.Response(status, stream=Stream('PRIVATE_SENTINEL', hang=True))

            with self.subTest(status=status), client_patch(handler), self.assertRaises(demos.PublicDemoError) as caught:
                legacy.call_qwen('qwen35', 'Question', timeout=.2)
            self.assertEqual(caught.exception.code, code)
            self.assertEqual(caught.exception.status, status)
            self.assertIn(f'HTTP {status}', str(caught.exception))
            self.assertNotIn('PRIVATE_SENTINEL', str(caught.exception))
            self.assertEqual(len(calls), 1)

    def test_one_deadline_also_cancels_silent_submit_or_stream(self):
        for submit in [True, False]:
            calls = []
            body = Stream('', hang=True)

            def handler(request):
                calls.append(request)
                if request.method == 'POST' and not submit:
                    return httpx.Response(200, json={'event_id': 'fixture'})
                return httpx.Response(200, headers={'content-type': 'text/event-stream'}, stream=body)

            with self.subTest(submit=submit), client_patch(handler), self.assertRaises(demos.PublicDemoError) as caught:
                legacy.call_qwen('qwen35', 'Question', timeout=.02)
            self.assertEqual(caught.exception.code, 'timeout')
            self.assertTrue(body.closed)
            self.assertEqual(len(calls), 1 if submit else 2)

    def test_partial_and_sse_error_are_not_answers(self):
        for content, code in [(event(answer(), 'generating'), 'incomplete'), (event('GPU quota exceeded PRIVATE_SENTINEL', 'error'), 'quota')]:
            def handler(request):
                return httpx.Response(200, json={'event_id': 'fixture'}) if request.method == 'POST' else httpx.Response(200, headers={'content-type': 'text/event-stream'}, text=content)

            with self.subTest(code=code), client_patch(handler), self.assertRaises(demos.PublicDemoError) as caught:
                legacy.call_qwen('qwen35', 'Question')
            self.assertEqual(caught.exception.code, code)
            self.assertNotIn('PRIVATE_SENTINEL', str(caught.exception))

    def test_unsafe_upload_or_event_paths_are_not_followed(self):
        for payload, image in [({'event_id': '../../secrets'}, None), (['https://foreign.example/photo'], PHOTO)]:
            calls = []

            def handler(request):
                calls.append(request)
                return httpx.Response(200, json=payload)

            with client_patch(handler), self.assertRaises(demos.PublicDemoError) as caught:
                legacy.call_qwen('qwen35', 'Question', image=image)
            self.assertEqual(caught.exception.code, 'protocol')
            self.assertEqual(len(calls), 1)

    def test_rejects_invalid_context_and_photo_before_network(self):
        with patch.object(legacy.httpx, 'AsyncClient') as client:
            for prompt, image, code in [('x' * 48001, None, 'context'), ('Question', 'not-image', 'image')]:
                with self.assertRaises(demos.PublicDemoError) as caught:
                    legacy.call_qwen('qwen35', prompt, image=image)
                self.assertEqual(caught.exception.code, code)
            client.assert_not_called()

    def test_response_extractor_discards_private_tool_blocks_and_rejects_user_echo(self):
        self.assertEqual(legacy.qwen35_answer([None, None, None, None, [{'role': 'assistant', 'content': [
            {'type': 'tool', 'content': 'PRIVATE_THINKING'}, {'type': 'text', 'content': 'Ответ'}]}]]), 'Ответ')
        with self.assertRaises(demos.PublicDemoError):
            legacy.qwen35_answer([None, None, None, None, [{'role': 'user', 'content': 'echo'}]])

    def test_python_bridge_uses_the_full_queue_budget_and_retains_tutor_context(self):
        with patch.object(legacy, 'call_qwen', return_value='Подсказка') as call:
            ai_service.generate_ai_response('builtin', '', 'qwen-3.5', 'Не выводи ответ', [{'role': 'user', 'content': 'Задание'}], tutor_only=True)
            self.assertEqual(call.call_args.args[0], 'qwen35')
            self.assertIn('ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА РЕПЕТИТОРА', call.call_args.args[2])
            self.assertGreater(call.call_args.args[5], 299)
            self.assertLessEqual(call.call_args.args[5], 300)

    def test_pollinations_is_one_fixed_request_with_bounded_body(self):
        calls = []

        def handler(request):
            calls.append(request)
            self.assertEqual(str(request.url), 'https://text.pollinations.ai/openai')
            self.assertNotIn('authorization', request.headers)
            return httpx.Response(200, json={'choices': [{'message': {'content': 'Ответ'}}]})

        with client_patch(handler):
            self.assertEqual(legacy.call_pollinations('Учитель', [{'role': 'user', 'content': 'Question'}]), 'Ответ')
        self.assertEqual(len(calls), 1)

    def test_pollinations_status_protocol_and_timeout_are_safe(self):
        cases = [(503, 'PRIVATE_SENTINEL', False, 'unavailable'), (200, 'PRIVATE_SENTINEL', False, 'protocol'), (200, '', True, 'timeout')]
        for status, text, hang, code in cases:
            with self.subTest(code=code), client_patch(lambda request: httpx.Response(status, stream=Stream(text, hang))), self.assertRaises(legacy.PollinationsError) as caught:
                legacy.call_pollinations('Teacher', [{'role': 'user', 'content': 'Question'}], timeout=.02)
            self.assertEqual(caught.exception.code, 'pollinations-' + code)
            self.assertNotIn('PRIVATE_SENTINEL', str(caught.exception))

    def test_auto_does_not_restart_after_the_overall_python_budget(self):
        with patch.object(ai_service.time, 'monotonic', side_effect=[0, 0, 301]), \
             patch.object(ai_service, '_call_qwen35_omni_server', side_effect=demos.PublicDemoError('timeout')), \
             patch.object(legacy, 'call_pollinations') as pollinations, patch.object(ai_service, '_call_qwen_vl_server') as other:
            with self.assertRaises(RuntimeError):
                ai_service.generate_ai_response('builtin', '', 'auto', 'Учитель', [{'role': 'user', 'content': 'Вопрос'}])
            pollinations.assert_not_called()
            other.assert_not_called()


if __name__ == '__main__':
    unittest.main()
