#!/usr/bin/env python3
import json
import mimetypes
import os
import posixpath
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict
from urllib.parse import parse_qs, unquote, urlparse

from backend import ai_service, database, solvers, ollama_service

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(ROOT_DIR, "static")
PORT = int(os.environ.get("PORT", "8000"))

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")
mimetypes.add_type("font/ttf", ".ttf")


def prepare_request_photos(data, purpose="solve"):
    provider = data.get("provider", "builtin")
    api_key = str(data.get("apiKey") or "").strip()
    if provider not in ("builtin", "openrouter", "gemini", "custom"):
        raise ValueError("Неизвестный провайдер ИИ.")
    if provider in ("openrouter", "gemini") and not api_key:
        raise ValueError("Для выбранного провайдера требуется ваш API-ключ.")
    photos = data.get("images")
    if photos is None:
        photos = [data["imageBase64"]] if data.get("imageBase64") else []
    native, ocr, label = ai_service.prepare_photo_input(
        provider, data.get("model", ""), photos, data.get("ocrText", ""),
        data.get("photoMode", "auto"), data.get("supportsVision"), purpose, api_key,
    )
    used = "vision" if native else "ocr" if (photos or ocr) else "none"
    return photos, native, ocr, label, used


class DomashkaHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[HTTP] {self.address_string()} - {fmt % args}", flush=True)

    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if not getattr(self, "_ollama_request", False):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        if length > 25 * 1024 * 1024:
            self.close_connection = True
            raise ValueError("Файл слишком большой (максимум 25 МБ).")
        raw = self.rfile.read(length)
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("Нужен JSON-объект.")
        return value

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        try:
            if path == "/api/health":
                self._send_json(200, {"ok": True, "app": "Домашка.ПРО", "version": "3.5"})
                return

            if path == "/api/models":
                force = qs.get("refresh", ["0"])[0] == "1"
                or_models = ai_service.fetch_openrouter_free_models(force=force)
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "openrouter_free": or_models,
                        "gemini_free": ai_service.DEFAULT_GEMINI_MODELS,
                    },
                )
                return

            if path == "/api/history":
                fav_only = qs.get("favorites", ["0"])[0] == "1"
                items = database.list_history(limit=60, favorites_only=fav_only)
                self._send_json(200, {"ok": True, "items": items})
                return

            # Serve static frontend files
            self._serve_static(path)
        except Exception as exc:
            traceback.print_exc()
            self._send_json(500, {"ok": False, "error": str(exc)})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        self._ollama_request = False
        try:
            data = self._read_json()
            self._ollama_request = data.get("provider") == "custom"
            if self._ollama_request:
                try:
                    ollama_service.validate_browser_origin(self.headers.get("Origin", ""), self.headers.get("Host", ""))
                    ollama_service.configured_endpoint()
                except ValueError as exc:
                    self._send_json(403, {"ok": False, "error": str(exc)})
                    return
            tutor_only = data.get("tutorOnly") is True
            if tutor_only and path in ("/api/check-draft", "/api/exact"):
                self._send_json(403, {"ok": False, "error": "В детском режиме доступен только репетитор."})
                return

            if path == "/api/test-key":
                provider = data.get("provider", "builtin")
                api_key = data.get("apiKey", "")
                model = data.get("model", "")
                res = ai_service.test_provider_key(provider, api_key, model)
                self._send_json(200, res)
                return

            if path == "/api/vision-ocr":
                image_b64 = data.get("imageBase64") or ""
                purpose = data.get("purpose", "solve")
                provider = data.get("provider", "builtin")
                api_key = data.get("apiKey", "")
                model = data.get("model", "")
                if not image_b64:
                    self._send_json(400, {"ok": False, "error": "Изображение не передано."})
                    return
                txt, engine = ai_service.recognize_photo_server(
                    image_b64=image_b64,
                    purpose=purpose,
                    provider=provider,
                    api_key=api_key,
                    model=model,
                )
                self._send_json(200, {"ok": True, "text": txt, "engine": engine})
                return

            if path == "/api/ai-generate":
                provider = data.get("provider", "builtin")
                api_key = data.get("apiKey", "")
                model = data.get("model", "")
                system_prompt = data.get("systemPrompt", "")
                messages = data.get("messages") or []
                image_b64 = data.get("imageBase64") or None
                ocr_text = (data.get("ocrText") or "").strip()
                purpose = data.get("purpose", "solve")

                photos, native_photos, resolved_ocr, vision_label, photo_input_used = prepare_request_photos(data, purpose)

                ans_md, provider_used = ai_service.generate_ai_response(
                    provider=provider,
                    api_key=api_key,
                    model=model,
                    system_prompt=system_prompt,
                    messages=messages,
                    images=native_photos,
                    photo_mode="vision" if native_photos else "ocr",
                    ocr_text=resolved_ocr,
                    purpose=purpose,
                    tutor_only=tutor_only,
                    tutor_grade=data.get("tutorGrade", 8),
                    tutor_subject=data.get("tutorSubject", "auto"),
                    vision_capable=data.get("supportsVision"),
                )
                final_used = f"{provider_used} + {vision_label}" if (vision_label and vision_label not in provider_used) else provider_used
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "text": ans_md,
                        "used": final_used,
                        "extractedPhotoText": resolved_ocr,
                        "visionEngineLabel": vision_label,
                        "photoInputUsed": photo_input_used,
                    },
                )
                return

            if path == "/api/solve":
                grade = int(data.get("grade", 7))
                exam_goal = data.get("examGoal", "fgos")
                subject = data.get("subject", "auto")
                mode = "tutor" if tutor_only else data.get("mode", "notebook")
                task_text = (data.get("taskText") or "").strip()
                image_b64 = data.get("imageBase64") or None
                ocr_text = (data.get("ocrText") or "").strip()
                provider = data.get("provider", "builtin")
                api_key = data.get("apiKey", "")
                model = data.get("model", "")
                photos, native_photos, ocr_text, vision_label, photo_input_used = prepare_request_photos(data, "solve")

                if not task_text and not photos and not ocr_text:
                    self._send_json(
                        400,
                        {"ok": False, "error": "Введите текст домашнего задания или прикрепите фотографию / скриншот."},
                    )
                    return

                sympy_badge = "" if mode == "tutor" else solvers.try_sympy_auto_verify(task_text or ocr_text)
                sys_prompt = ai_service.build_system_prompt(
                    grade=grade,
                    exam_goal=exam_goal,
                    subject=subject,
                    mode=mode,
                    sympy_hint=sympy_badge,
                )

                user_prompt = task_text or "Помоги решить домашнее задание с прикреплённого фото."
                messages = [{"role": "user", "content": user_prompt}]

                ans_md, provider_used = ai_service.generate_ai_response(
                    provider=provider,
                    api_key=api_key,
                    model=model,
                    system_prompt=sys_prompt,
                    messages=messages,
                    images=native_photos,
                    photo_mode="vision" if native_photos else "ocr",
                    ocr_text=ocr_text,
                    vision_capable=data.get("supportsVision"),
                    purpose="solve",
                    tutor_only=mode == "tutor",
                    tutor_grade=grade,
                    tutor_subject=subject,
                )

                conv_messages = [
                    {"role": "user", "content": user_prompt + (f"\n\n[Текст с фото: {ocr_text}]" if ocr_text else "")},
                    {"role": "assistant", "content": ans_md},
                ]
                item_id = database.save_history_item(
                    item_type="solve",
                    grade=grade,
                    exam_goal=exam_goal,
                    subject=subject,
                    mode=mode,
                    task_text=task_text or (ocr_text[:200] if ocr_text else "Задание по фото"),
                    has_image=bool(photos),
                    response_md=ans_md,
                    sympy_badge=sympy_badge,
                    provider_used=provider_used,
                    messages=conv_messages,
                )

                self._send_json(
                    200,
                    {
                        "ok": True,
                        "id": item_id,
                        "markdown": ans_md,
                        "sympyBadge": sympy_badge,
                        "providerUsed": provider_used,
                        "photoInputUsed": photo_input_used,
                        "extractedPhotoText": ocr_text,
                        "messages": conv_messages,
                    },
                )
                return

            if path == "/api/chat":
                grade = int(data.get("grade", 7))
                exam_goal = data.get("examGoal", "fgos")
                subject = data.get("subject", "auto")
                mode = "tutor" if tutor_only else data.get("mode", "notebook")
                history_id = data.get("historyId")
                messages = data.get("messages") or []
                action = data.get("action", "question")
                question = (data.get("question") or "").strip()
                provider = data.get("provider", "builtin")
                api_key = data.get("apiKey", "")
                model = data.get("model", "")
                photos, native_photos, ocr_text, vision_label, photo_input_used = prepare_request_photos(data, "solve")

                if action == "board_prep":
                    prompt_q = (
                        "Представь, что завтра учитель вызовет меня к доске по этому заданию. "
                        "Составь 3 самых вероятных вопроса учителя «на понимание» по этому решению и напиши короткие, чёткие ответы, чтобы получить твёрдую пятёрку!"
                    )
                elif action == "similar_task":
                    prompt_q = (
                        f"Придумай одну похожую тренировочную задачу такого же уровня ({grade} класс) с другими числами или словами, чтобы я закрепил тему. "
                        "Сначала напиши условие задачи и короткую подсказку, а правильный ответ укажи в самом низу отдельной строкой."
                    )
                elif action == "simpler":
                    prompt_q = (
                        f"Объясни это же решение ещё проще, буквально «на пальцах», для ученика {grade} класса, без сложных формулировок."
                    )
                else:
                    prompt_q = question

                if mode == "tutor" and action != "question":
                    prompt_q = {
                        "board_prep": "Задай один вопрос на понимание без готового ответа.",
                        "similar_task": "Придумай одну похожую задачу без решения и ответа.",
                        "simpler": "Дай одну более простую подсказку без вычисления результата за меня.",
                    }.get(action, question)
                if not prompt_q:
                    self._send_json(400, {"ok": False, "error": "Введите вопрос для ИИ-помощника."})
                    return

                sys_prompt = ai_service.build_system_prompt(
                    grade=grade,
                    exam_goal=exam_goal,
                    subject=subject,
                    mode=mode,
                )
                updated_msgs = list(messages) + [{"role": "user", "content": prompt_q}]
                ans_md, provider_used = ai_service.generate_ai_response(
                    provider=provider,
                    api_key=api_key,
                    model=model,
                    system_prompt=sys_prompt,
                    messages=updated_msgs,
                    images=native_photos,
                    photo_mode="vision" if native_photos else "ocr",
                    ocr_text=ocr_text,
                    vision_capable=data.get("supportsVision"),
                    purpose="solve",
                    tutor_only=mode == "tutor",
                    tutor_grade=grade,
                    tutor_subject=subject,
                )
                updated_msgs.append({"role": "assistant", "content": ans_md})
                if history_id:
                    try:
                        database.update_history_messages(int(history_id), updated_msgs)
                    except Exception:
                        pass

                self._send_json(
                    200,
                    {
                        "ok": True,
                        "reply": ans_md,
                        "providerUsed": provider_used,
                        "photoInputUsed": photo_input_used,
                        "extractedPhotoText": ocr_text,
                        "messages": updated_msgs,
                    },
                )
                return

            if path == "/api/check-draft":
                grade = int(data.get("grade", 7))
                exam_goal = data.get("examGoal", "fgos")
                subject = data.get("subject", "auto")
                condition_text = (data.get("conditionText") or "").strip()
                draft_text = (data.get("draftText") or "").strip()
                image_b64 = data.get("imageBase64") or None
                ocr_text = (data.get("ocrText") or "").strip()
                provider = data.get("provider", "builtin")
                api_key = data.get("apiKey", "")
                model = data.get("model", "")
                photos, native_photos, ocr_text, vision_label, photo_input_used = prepare_request_photos(data, "check")

                if not draft_text and not photos and not ocr_text:
                    self._send_json(
                        400,
                        {"ok": False, "error": "Напишите свой ответ/сочинение или прикрепите фото своей тетради для проверки."},
                    )
                    return

                sys_prompt = ai_service.build_checker_prompt(grade, exam_goal, subject)
                parts_txt = []
                if condition_text:
                    parts_txt.append(f"**Условие задания / тема:**\n{condition_text}")
                if draft_text:
                    parts_txt.append(f"**Мой черновик / решение ученика:**\n{draft_text}")
                if not parts_txt:
                    parts_txt.append("Проверь мою домашнюю работу на прикреплённой фотографии.")
                full_user_msg = "\n\n".join(parts_txt)

                ans_md, provider_used = ai_service.generate_ai_response(
                    provider=provider,
                    api_key=api_key,
                    model=model,
                    system_prompt=sys_prompt,
                    messages=[{"role": "user", "content": full_user_msg}],
                    images=native_photos,
                    photo_mode="vision" if native_photos else "ocr",
                    ocr_text=ocr_text,
                    vision_capable=data.get("supportsVision"),
                    purpose="check",
                )

                conv_messages = [
                    {"role": "user", "content": full_user_msg},
                    {"role": "assistant", "content": ans_md},
                ]
                item_id = database.save_history_item(
                    item_type="check",
                    grade=grade,
                    exam_goal=exam_goal,
                    subject=subject,
                    mode="checker",
                    task_text=condition_text or (draft_text[:160] if draft_text else "Проверка черновика по фото"),
                    has_image=bool(photos),
                    response_md=ans_md,
                    sympy_badge="",
                    provider_used=provider_used,
                    messages=conv_messages,
                )

                self._send_json(
                    200,
                    {
                        "ok": True,
                        "id": item_id,
                        "markdown": ans_md,
                        "providerUsed": provider_used,
                        "photoInputUsed": photo_input_used,
                        "extractedPhotoText": ocr_text,
                        "messages": conv_messages,
                    },
                )
                return

            if path == "/api/exact":
                tool = data.get("tool", "algebra")
                inp = data.get("input", "")
                if tool == "algebra":
                    res = solvers.solve_algebra(inp, action=data.get("action", "auto"))
                elif tool == "fractions":
                    res = solvers.solve_fractions_step(inp)
                elif tool == "gcd_lcm":
                    res = solvers.solve_gcd_lcm(inp)
                elif tool == "chemistry":
                    res = solvers.solve_chemistry(inp)
                elif tool == "physics_si":
                    res = solvers.convert_physics_si(inp)
                elif tool == "bases":
                    from_b = int(data.get("fromBase", 10))
                    to_b = int(data.get("toBase", 2))
                    res = solvers.solve_number_bases(inp, from_b, to_b)
                elif tool == "truth_table":
                    res = solvers.solve_truth_table(inp)
                else:
                    res = {"ok": False, "error": f"Неизвестный инструмент: {tool}"}
                self._send_json(200, res)
                return

            if path == "/api/history/favorite":
                item_id = int(data.get("id", 0))
                new_val = database.toggle_favorite(item_id)
                self._send_json(200, {"ok": new_val is not None, "favorite": new_val})
                return

            if path == "/api/history/delete":
                item_id = int(data.get("id", 0))
                deleted = database.delete_history_item(item_id)
                self._send_json(200, {"ok": deleted})
                return

            self._send_json(404, {"ok": False, "error": f"Маршрут {path} не найден"})
        except Exception as exc:
            traceback.print_exc()
            self._send_json(200, {"ok": False, "error": str(exc)})

    def _serve_static(self, url_path: str) -> None:
        clean_path = posixpath.normpath(unquote(url_path)).lstrip("/")
        target = os.path.abspath(os.path.join(STATIC_DIR, clean_path))
        if not target.startswith(os.path.abspath(STATIC_DIR)) or os.path.isdir(target) or not os.path.exists(target):
            target = os.path.join(STATIC_DIR, "index.html")

        if not os.path.exists(target):
            msg = "Сборка интерфейса ещё не завершена.".encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
            return

        ctype, _ = mimetypes.guess_type(target)
        if not ctype:
            ctype = "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"

        with open(target, "rb") as f:
            content = f.read()

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Access-Control-Allow-Origin", "*")
        if target.endswith("Domashka_PRO.html"):
            self.send_header("Content-Disposition", 'attachment; filename="Domashka_PRO.html"')
            self.send_header("Cache-Control", "no-cache")
        elif target.endswith("index.html"):
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(content)


def main() -> None:
    database.init_db()
    os.makedirs(STATIC_DIR, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), DomashkaHandler)
    print(f"🚀 Домашка.ПРО сервер запущен на http://0.0.0.0:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
