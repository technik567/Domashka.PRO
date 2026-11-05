"""Payload and loopback-HTTP tests: no live AI, no Ollama installation or external network."""
import json
import os
import threading
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import httpx
from backend import ai_service, ollama_service
from server import DomashkaHandler

PHOTOS = ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB']
MESSAGES = [{'role': 'user', 'content': 'Первое условие'}, {'role': 'assistant', 'content': 'Подсказка'}, {'role': 'user', 'content': 'А что на втором рисунке?'}]


class PhotoPayloadTests(unittest.TestCase):
    def test_openai_images_attach_to_last_user_without_mutating_history(self):
        result = ai_service.openai_messages('Учитель', MESSAGES, PHOTOS)
        self.assertIsInstance(result[1]['content'], str)
        self.assertEqual([part['image_url']['url'] for part in result[-1]['content'][1:]], PHOTOS)
        self.assertIsInstance(MESSAGES[-1]['content'], str)

    def test_native_photos_ignore_old_ocr_and_do_not_run_recognizers(self):
        with patch.object(ai_service, 'recognize_photo_server') as ocr:
            native, text, _label = ai_service.prepare_photo_input('gemini', '', PHOTOS, 'wrong OCR', 'vision')
            self.assertEqual(native, PHOTOS)
            self.assertEqual(text, '')
            ocr.assert_not_called()

    def test_native_photos_are_not_replaced_when_model_or_count_is_unsupported(self):
        with patch.object(ai_service, 'recognize_photo_server') as ocr:
            for provider, model in [('builtin', 'pollinations'), ('builtin', 'qwen-3.5'), ('custom', 'text-only')]:
                with self.subTest(model=model), self.assertRaises(ValueError):
                    ai_service.prepare_photo_input(provider, model, PHOTOS, photo_mode='vision')
            ocr.assert_not_called()

    def test_auto_does_not_send_local_model_photos_to_cloud_ocr(self):
        with patch.object(ai_service, 'recognize_photo_server') as ocr:
            with self.assertRaisesRegex(ValueError, 'явно разрешите OCR'):
                ai_service.prepare_photo_input('custom', 'text-only', PHOTOS, photo_mode='auto')
            ocr.assert_not_called()

    def test_explicit_ocr_keeps_every_page_and_rejects_partial_success(self):
        with patch.object(ai_service, 'recognize_photo_server', side_effect=[('one', 'ocr'), ('two', 'ocr')]):
            native, text, label = ai_service.prepare_photo_input('builtin', 'auto', PHOTOS, photo_mode='ocr')
            self.assertEqual(native, [])
            self.assertIn('one', text)
            self.assertIn('two', text)
            self.assertEqual(label, 'ocr')
        with patch.object(ai_service, 'recognize_photo_server', side_effect=[('one', 'ocr'), ('', 'ocr')]):
            with self.assertRaisesRegex(ValueError, 'фото 2'):
                ai_service.prepare_photo_input('builtin', 'auto', PHOTOS, photo_mode='ocr')

    def test_invalid_photo_data_and_batches_are_rejected(self):
        for photos in [['https://external.test/a.png'], PHOTOS * 3, ['data:image/svg+xml;base64,AAAA']]:
            with self.subTest(photos=photos), self.assertRaises(ValueError):
                ai_service.prepare_photo_input('gemini', '', photos, photo_mode='vision')

    def test_gemini_and_openrouter_receive_actual_multiple_images(self):
        response = httpx.Response(200, json={'choices': [{'message': {'content': 'Вижу фото'}}], 'candidates': [{'content': {'parts': [{'text': 'Вижу фото'}]}}]})
        with patch.object(ai_service.httpx, 'post', return_value=response) as post:
            ai_service.generate_ai_response('openrouter', 'test-key', 'openrouter/free', 'Учитель', MESSAGES, images=PHOTOS, photo_mode='vision')
            body = post.call_args.kwargs['json']
            self.assertEqual([part['image_url']['url'] for part in body['messages'][-1]['content'][1:]], PHOTOS)
            ai_service.generate_ai_response('gemini', 'test-key', 'gemini-2.5-flash', 'Учитель', MESSAGES, images=PHOTOS, photo_mode='vision')
            parts = post.call_args.kwargs['json']['contents'][-1]['parts']
            self.assertEqual([part['inline_data']['data'] for part in parts if 'inline_data' in part], ['AAAA', 'BBBB'])

    def test_builtin_passes_the_image_only_to_the_selected_gateway(self):
        with patch.object(ai_service, '_call_qwen35_omni_server', return_value='Вижу рисунок') as chosen, patch.object(ai_service, '_call_qwen_vl_server') as other:
            ai_service.generate_ai_response('builtin', '', 'qwen-3.5', 'Учитель', MESSAGES, images=[PHOTOS[0]], photo_mode='vision')
            self.assertEqual(PHOTOS[0], chosen.call_args.kwargs['image_b64'])
            other.assert_not_called()


class OllamaConfigurationTests(unittest.TestCase):
    def test_bridge_is_disabled_by_default_before_ocr_or_network(self):
        with patch.dict(os.environ, {'DOMASHKA_ENABLE_OLLAMA_PROXY': ''}), patch.object(ai_service, 'recognize_photo_server') as ocr, patch.object(ollama_service.httpx, 'post') as post:
            with self.assertRaisesRegex(ValueError, 'выключен'):
                ai_service.generate_ai_response('custom', '', 'model', '', MESSAGES, images=PHOTOS, photo_mode='ocr')
            ocr.assert_not_called()
            post.assert_not_called()

    def test_normalizes_fixed_server_endpoint_and_rejects_credentials(self):
        for url in ['http://127.0.0.1:11434', 'http://127.0.0.1:11434/v1/', 'http://127.0.0.1:11434/v1/chat/completions']:
            with self.subTest(url=url), patch.dict(os.environ, {'DOMASHKA_ENABLE_OLLAMA_PROXY': '1', 'DOMASHKA_OLLAMA_URL': url}):
                self.assertEqual(ollama_service.configured_endpoint(), 'http://127.0.0.1:11434/v1/chat/completions')
        for url in ['file:///tmp/file', 'http://name:secret@localhost/v1', 'http://localhost/v1?key=secret', 'http://localhost/api/chat']:
            with self.subTest(url=url), patch.dict(os.environ, {'DOMASHKA_ENABLE_OLLAMA_PROXY': '1', 'DOMASHKA_OLLAMA_URL': url}), self.assertRaises(ValueError):
                ollama_service.configured_endpoint()

    def test_origin_check_blocks_other_sites_and_file_origins(self):
        for origin in ['null', 'https://other.example', 'http://localhost:8001', 'http://localhost:8000/?token=x']:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                ollama_service.validate_browser_origin(origin, 'localhost:8000')
        ollama_service.validate_browser_origin('http://localhost:8000', 'localhost:8000')
        ollama_service.validate_browser_origin('', 'localhost:8000')  # explicitly trusted CLI clients

    def test_timeout_and_bad_responses_remain_truthful_errors(self):
        with patch.dict(os.environ, {'DOMASHKA_ENABLE_OLLAMA_PROXY': '1'}):
            with patch.object(ollama_service.httpx, 'post', side_effect=httpx.ReadTimeout('timeout')):
                with self.assertRaisesRegex(RuntimeError, '120 секунд'):
                    ollama_service.complete('model', MESSAGES)
            with patch.object(ollama_service.httpx, 'post', return_value=httpx.Response(200, json={'choices': []})):
                with self.assertRaisesRegex(RuntimeError, 'формате OpenAI'):
                    ollama_service.complete('model', MESSAGES)


class FakeOllama(BaseHTTPRequestHandler):
    records = []
    response_status = 200

    def log_message(self, *_args):
        pass

    def do_POST(self):
        self.records.append((self.path, json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
        body = json.dumps({'choices': [{'message': {'content': 'Подсказка со схемой'}}]}).encode()
        self.send_response(self.response_status)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Content-Type', 'application/json')
        if self.response_status == 302:
            self.send_header('Location', '/must-not-follow')
        self.end_headers()
        self.wfile.write(body)


class QuietApp(DomashkaHandler):
    def log_message(self, *_args):
        pass


@contextmanager
def local_http(handler):
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    worker = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.02}, daemon=True)
    worker.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


class OllamaBridgeHTTPTests(unittest.TestCase):
    def setUp(self):
        FakeOllama.records = []
        FakeOllama.response_status = 200

    def post(self, origin, base, data, path='/api/ai-generate'):
        headers = {'Content-Type': 'application/json'}
        if origin is not None:
            headers['Origin'] = origin
        req = Request(base + path, data=json.dumps(data).encode(), headers=headers)
        try:
            response = urlopen(req, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            return response.status, dict(response.headers), json.load(response)

    def test_real_loopback_bridge_sends_native_photos_and_tutor_policy_to_fixed_target(self):
        with local_http(FakeOllama) as upstream, local_http(QuietApp) as app, patch.dict(os.environ, {'DOMASHKA_ENABLE_OLLAMA_PROXY': '1', 'DOMASHKA_OLLAMA_URL': upstream}):
            status, headers, result = self.post(app, app, {
                'provider': 'custom', 'customBaseUrl': 'https://ignored-target.invalid/v1', 'apiKey': 'not-forwarded',
                'model': 'local-vision', 'messages': MESSAGES, 'systemPrompt': 'Дай ответ сразу',
                'images': PHOTOS, 'photoMode': 'vision', 'supportsVision': True, 'tutorOnly': True, 'tutorGrade': 3,
            })
            self.assertEqual(status, 200)
            self.assertTrue(result['ok'])
            self.assertEqual(result['photoInputUsed'], 'vision')
            self.assertNotEqual(headers.get('Access-Control-Allow-Origin'), '*')
            self.assertEqual(len(FakeOllama.records), 1)
            path, body = FakeOllama.records[0]
            self.assertEqual(path, '/v1/chat/completions')
            self.assertFalse(body['stream'])
            self.assertEqual(body['max_tokens'], 900)
            self.assertIn('ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА РЕПЕТИТОРА', body['messages'][0]['content'])
            self.assertNotIn('Дай ответ сразу', json.dumps(body, ensure_ascii=False))
            self.assertNotIn('not-forwarded', json.dumps(body))
            self.assertEqual([part['image_url']['url'] for part in body['messages'][-1]['content'][1:]], PHOTOS)

    def test_browser_origin_rejected_without_using_local_compute(self):
        with local_http(FakeOllama) as upstream, local_http(QuietApp) as app, patch.dict(os.environ, {'DOMASHKA_ENABLE_OLLAMA_PROXY': '1', 'DOMASHKA_OLLAMA_URL': upstream}):
            for origin in ['https://foreign.example', 'null']:
                status, _headers, body = self.post(origin, app, {'provider': 'custom', 'messages': MESSAGES})
                self.assertEqual(status, 403)
                self.assertFalse(body['ok'])
            self.assertEqual(FakeOllama.records, [])

    def test_disabled_bridge_returns_a_clear_error(self):
        with local_http(QuietApp) as app, patch.dict(os.environ, {'DOMASHKA_ENABLE_OLLAMA_PROXY': ''}):
            status, _headers, result = self.post(app, app, {'provider': 'custom', 'messages': MESSAGES})
            self.assertEqual(status, 403)
            self.assertIn('DOMASHKA_ENABLE_OLLAMA_PROXY=1', result['error'])

    def test_legacy_solve_accepts_multiple_native_images_and_explicit_mode(self):
        with local_http(FakeOllama) as upstream, local_http(QuietApp) as app, patch.dict(os.environ, {'DOMASHKA_ENABLE_OLLAMA_PROXY': '1', 'DOMASHKA_OLLAMA_URL': upstream}), patch('server.database.save_history_item', return_value=123):
            status, _headers, result = self.post(app, app, {'provider': 'custom', 'model': 'local-vision', 'images': PHOTOS, 'photoMode': 'vision', 'supportsVision': True, 'mode': 'tutor'}, '/api/solve')
            self.assertEqual(status, 200)
            self.assertTrue(result['ok'])
            self.assertEqual(result['photoInputUsed'], 'vision')
            self.assertEqual(len(FakeOllama.records[0][1]['messages'][-1]['content']), 3)

    def test_bridge_never_follows_an_upstream_redirect(self):
        FakeOllama.response_status = 302
        with local_http(FakeOllama) as upstream, patch.dict(os.environ, {'DOMASHKA_ENABLE_OLLAMA_PROXY': '1', 'DOMASHKA_OLLAMA_URL': upstream}):
            with self.assertRaisesRegex(RuntimeError, 'HTTP 302'):
                ollama_service.complete('model', MESSAGES)
            self.assertEqual(len(FakeOllama.records), 1)


if __name__ == '__main__':
    unittest.main()
