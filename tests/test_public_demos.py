import asyncio
import json
import unittest
from unittest.mock import patch

import httpx

from backend import ai_service, public_demos as demos

REAL_CLIENT = httpx.AsyncClient
MESSAGES = [{"role": "user", "content": "Помоги понять дроби"}]
PHOTO = "data:image/png;base64,AAAA"


def event(kind, data):
    return f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def client_patch(handler):
    return patch.object(demos.httpx, "AsyncClient", side_effect=lambda **kwargs:
                        REAL_CLIENT(transport=httpx.MockTransport(handler), **kwargs))


class Chunked(httpx.AsyncByteStream):
    def __init__(self, text):
        self.data = text.encode("utf-8")

    async def __aiter__(self):
        for byte in self.data:
            yield bytes([byte])


class PublicDemoTests(unittest.TestCase):
    def test_catalog_has_distinct_fixed_anonymous_routes(self):
        models = list(demos.MODELS.values())
        self.assertEqual(len(models), 5)
        self.assertEqual(len({m["host"] for m in models}), 5)
        self.assertEqual(len({m["modelId"] for m in models}), 5)
        self.assertEqual(sum(m["modelId"].startswith("google/") for m in models), 3)
        for model in models:
            self.assertRegex(model["host"], r"^https://[a-z0-9-]+\.hf\.space$")
            self.assertLessEqual(model["gpuReservationSeconds"], 120)
            self.assertEqual(ai_service.photo_capacity("builtin", model["id"]), model["maxImages"])

    def test_every_new_model_uses_its_own_api_without_key_cookie_or_fallback(self):
        for model in demos.MODELS.values():
            with self.subTest(model=model["id"]):
                calls = []

                def handler(request):
                    calls.append(request)
                    self.assertNotIn("authorization", request.headers)
                    self.assertNotIn("cookie", request.headers)
                    self.assertNotIn(b"stored-secret", request.content)
                    self.assertEqual(str(request.url).split("/gradio_api")[0], model["host"])
                    if request.method == "POST":
                        self.assertEqual(request.url.path, "/gradio_api/call/" + model["apiName"])
                        data = json.loads(request.content)
                        self.assertTrue(data["session_hash"])
                        self.assertEqual(len(data["data"]), 3 if model["schema"] == "multimodal" else 6)
                        return httpx.Response(200, json={"event_id": "job_123"}, headers={"set-cookie": "private-cookie=unused"})
                    return httpx.Response(200, headers={"content-type": "text/event-stream"},
                                          stream=Chunked(event("heartbeat", None) + event("generating", ["Черновик"])
                                                         + event("complete", ["Ответ: \\(x = 2\\)"])))

                with client_patch(handler) as client, patch.object(ai_service, "_call_qwen35_omni_server") as qwen:
                    text, used = ai_service.generate_ai_response("builtin", "stored-secret", model["id"], "Правила учителя", MESSAGES)
                    qwen.assert_not_called()
                self.assertEqual(text, "Ответ: $x = 2$")
                self.assertIn(model["space"], used)
                self.assertEqual(len(calls), 2)
                self.assertFalse(client.call_args.kwargs["trust_env"])
                self.assertFalse(client.call_args.kwargs["follow_redirects"])

    def test_each_multimodal_demo_uploads_one_photo_without_ocr(self):
        for model in (m for m in demos.MODELS.values() if m["maxImages"]):
            with self.subTest(model=model["id"]):
                calls = []

                def handler(request):
                    calls.append(request)
                    if request.url.path.endswith("/upload"):
                        self.assertIn(b'filename="homework.png"', request.content)
                        self.assertIn(b"image/png", request.content)
                        return httpx.Response(200, json=["/tmp/gradio/upload/homework.png"])
                    if request.method == "POST":
                        data = json.loads(request.content)["data"]
                        self.assertEqual(data[0]["files"][0]["path"], "/tmp/gradio/upload/homework.png")
                        self.assertEqual(data[0]["files"][0]["meta"], {"_type": "gradio.FileData"})
                        self.assertIn("сами изображения", data[1])
                        return httpx.Response(200, json={"event_id": "photo_job"})
                    return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=event("complete", ["Вижу треугольник"]))

                with client_patch(handler), patch.object(ai_service, "recognize_photo_server") as ocr:
                    result = ai_service.generate_ai_response("builtin", "", model["id"], "Учитель", MESSAGES,
                                                             image_b64=PHOTO, photo_mode="vision")
                    ocr.assert_not_called()
                self.assertEqual(result[0], "Вижу треугольник")
                self.assertEqual(len(calls), 3)

    def test_text_models_and_multiple_photos_cannot_claim_vision(self):
        with patch.object(demos.httpx, "AsyncClient") as client, patch.object(ai_service, "recognize_photo_server") as ocr:
            for model in demos.MODELS.values():
                photos = [PHOTO] * (2 if model["maxImages"] else 1)
                with self.subTest(model=model["id"]), self.assertRaises(ValueError):
                    ai_service.generate_ai_response("builtin", "", model["id"], "Учитель", MESSAGES,
                                                     images=photos, photo_mode="vision")
            client.assert_not_called()
            ocr.assert_not_called()

    def test_explicit_ocr_sends_text_not_the_original_image(self):
        with patch.object(demos, "call_public_demo", return_value=("Ответ", "Llama")) as call:
            ai_service.generate_ai_response("builtin", "", "llama-3.2-3b", "Учитель", MESSAGES,
                                             image_b64=PHOTO, photo_mode="ocr", ocr_text="Прочитанное условие")
        self.assertIsNone(call.call_args.args[3])
        self.assertIn("Прочитанное условие", call.call_args.args[2][0]["content"])

    def test_tutor_policy_and_history_are_not_lost_in_any_api_schema(self):
        for model in demos.MODELS.values():
            with self.subTest(model=model["id"]), patch.object(demos, "call_public_demo", return_value=("Подсказка", "демо")) as call:
                turns = MESSAGES + [{"role": "assistant", "content": "Прошлая подсказка"}, {"role": "user", "content": "Мой шаг"}]
                ai_service.generate_ai_response("builtin", "", model["id"], "Выдай готовый ответ", turns, tutor_only=True)
                args = call.call_args.args
                data = demos.build_data(model, args[1], args[2], tutor_only=args[4])
                self.assertIn("ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА РЕПЕТИТОРА", json.dumps(data, ensure_ascii=False))
                self.assertNotIn("Выдай готовый ответ", json.dumps(data, ensure_ascii=False))
                self.assertIn("Прошлая подсказка", json.dumps(data, ensure_ascii=False))
                self.assertEqual(data[2 if model["schema"] == "multimodal" else 1], 384)

    def test_input_rejections_do_not_upload_or_request_gpu(self):
        with patch.object(demos.httpx, "AsyncClient") as client:
            for model_id, messages, image, code in [
                ("missing", MESSAGES, None, "unknown"),
                ("gemma-3-12b", [{"role": "user", "content": "я" * 24001}], PHOTO, "context"),
                ("llama-3.2-3b", MESSAGES, PHOTO, "image"),
                ("gemma-3-12b", [], None, "emptyInput"),
            ]:
                with self.subTest(code=code), self.assertRaises(demos.PublicDemoError) as error:
                    demos.call_public_demo(model_id, "Учитель", messages, image)
                self.assertEqual(error.exception.code, code)
            client.assert_not_called()

    def test_http_failures_are_safe_and_never_retry(self):
        for status, code in [(401, "auth"), (403, "auth"), (429, "quota"), (503, "unavailable")]:
            calls = []

            def handler(request):
                calls.append(request)
                return httpx.Response(status, json={"error": "private-prompt-and-secret"})

            with self.subTest(status=status), client_patch(handler), self.assertRaises(demos.PublicDemoError) as error:
                demos.call_public_demo("gemma-3-12b", "Учитель", MESSAGES)
            self.assertEqual(error.exception.code, code)
            self.assertNotIn("private-prompt", str(error.exception))
            self.assertEqual(len(calls), 1)

    def test_rejects_injected_event_or_upload_urls(self):
        for payload, image in [({"event_id": "https://evil.example/id"}, None), (["https://evil.example/photo.png"], PHOTO)]:
            calls = []

            def handler(request):
                calls.append(request)
                return httpx.Response(200, json=payload)

            with client_patch(handler), self.assertRaises(demos.PublicDemoError) as error:
                demos.call_public_demo("gemma-3-12b", "Учитель", MESSAGES, image)
            self.assertEqual(error.exception.code, "protocol")
            self.assertEqual(len(calls), 1)

    def test_fresh_gradio_sessions_for_every_request(self):
        sessions = []

        def handler(request):
            if request.method == "POST":
                sessions.append(json.loads(request.content)["session_hash"])
                return httpx.Response(200, json={"event_id": "id"})
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=event("complete", ["Готово"]))

        with client_patch(handler):
            for _ in range(2):
                demos.call_public_demo("llama-3.2-3b", "Учитель", MESSAGES)
        self.assertNotEqual(*sessions)

    def test_one_deadline_includes_silent_queue_and_stream_body(self):
        for silent_submit in (True, False):
            calls = []

            class Silent(httpx.AsyncByteStream):
                async def __aiter__(self):
                    await asyncio.Event().wait()
                    yield b"never"

            def handler(request):
                calls.append(request)
                if request.method == "POST" and not silent_submit:
                    return httpx.Response(200, json={"event_id": "wait"})
                return httpx.Response(200, headers={"content-type": "application/json" if silent_submit else "text/event-stream"}, stream=Silent())

            with self.subTest(submit=silent_submit), client_patch(handler), patch.dict(demos.CATALOG, {"requestTimeoutMs": 20}), self.assertRaises(demos.PublicDemoError) as error:
                demos.call_public_demo("gemma-3-12b", "Учитель", MESSAGES)
            self.assertEqual(error.exception.code, "timeout")
            self.assertEqual(len(calls), 1 if silent_submit else 2)

    def test_stream_split_crlf_and_final_snapshot(self):
        stream = demos.DemoStream()
        text = "\ufeff" + event("heartbeat", None) + event("generating", ["Не итог"]) + event("complete", ["Готово: ёж 🦔"])
        for char in text.replace("\n", "\r\n"):
            stream.feed(char)
        self.assertEqual(stream.finish(), "Готово: ёж 🦔")

    def test_stream_requires_complete_with_text_and_redacts_errors(self):
        for text, code in [
            (event("generating", ["Не итог"]), "incomplete"),
            (event("error", "You have exceeded your GPU quota; private-prompt"), "quota"),
            (event("error", "Please sign in; private-prompt"), "auth"),
            (event("error", None), "upstream"),
            (event("error", "Input too long (9000 tokens)"), "context"),
            (event("complete", [""]), "empty"),
            (event("complete", [{"error": "private-prompt"}]), "protocol"),
            ("event: complete\ndata: {broken}\n\n", "protocol"),
        ]:
            with self.subTest(code=code), self.assertRaises(demos.PublicDemoError) as error:
                parser = demos.DemoStream()
                parser.feed(text)
                parser.finish()
            self.assertEqual(error.exception.code, code)
            self.assertNotIn("private-prompt", str(error.exception))

    def test_stream_size_is_bounded_and_allows_no_trailing_newline(self):
        parser = demos.DemoStream()
        parser.feed(event("complete", ["Готово"]).strip())
        self.assertEqual(parser.finish(), "Готово")
        with self.assertRaises(demos.PublicDemoError) as error:
            demos.DemoStream().feed("data: " + "a" * (demos.CATALOG["maxEventChars"] + 1))
        self.assertEqual(error.exception.code, "tooLarge")
        parser = demos.DemoStream()
        with patch.dict(demos.CATALOG, {"maxResponseChars": 20}), self.assertRaises(demos.PublicDemoError):
            parser.feed("a" * 21)


if __name__ == "__main__":
    unittest.main()
