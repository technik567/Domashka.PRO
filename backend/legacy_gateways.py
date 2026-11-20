"""Bounded original keyless gateways. No retries, new routes, keys or cookies.

The synchronous Python bridge runs each async operation with a TOTAL deadline,
not a per-packet timeout. Gradio success requires a complete, textual SSE event.
"""
import asyncio
import json
import re
import uuid

import httpx
from . import public_demos as demos

QWEN_TIMEOUT = 300.0
POLLINATIONS_TIMEOUT = 45.0
HOSTS = {"qwen35": "https://qwen-qwen3-5-omni-offline-demo.hf.space",
         "qwen25": "https://developer0hye-qwen2-5-vl-7b-instruct.hf.space"}
BLANK_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFUlEQVR4nGP8//8/AzWAiSTVIxx1AA5xAx/73812AAAAAElFTkSuQmCC"


def checked_answer(text):
    if not isinstance(text, str):
        raise demos.PublicDemoError("protocol")
    if re.search(r"^\s*(?:\[error\]|you have exceeded your|<span[^>]*color[^>]*red)", text, re.I):
        error = demos.provider_error(0, text)
        raise demos.PublicDemoError("upstream") if error.code == "protocol" else error
    return text


def qwen35_answer(data):
    raw = data[4] if len(data) > 4 else None
    history = raw if isinstance(raw, list) else raw.get("value") if isinstance(raw, dict) else None
    last = history[-1] if isinstance(history, list) and history else None
    if not isinstance(last, dict) or last.get("role") != "assistant":
        raise demos.PublicDemoError("protocol")
    text = last.get("content")
    if isinstance(text, list):
        text = "\n".join(block if isinstance(block, str) else str(block.get("text", block.get("content", "")))
                         for block in text if isinstance(block, str) or isinstance(block, dict) and block.get("type") == "text")
    return checked_answer(text)


async def qwen_request(kind, prompt, system_prompt="", history=None, image=None):
    if kind not in HOSTS:
        raise demos.PublicDemoError("unknown")
    turns = [{"role": m["role"], "content": str(m.get("content") or "")} for m in (history or [])
             if isinstance(m, dict) and m.get("role") in ("user", "assistant")]
    if len(str(prompt)) + len(str(system_prompt)) + len(json.dumps(turns, ensure_ascii=False)) > 48000:
        raise demos.PublicDemoError("context")
    if not str(prompt).strip() and not image:
        raise demos.PublicDemoError("emptyInput")
    file = demos.photo_file(image or BLANK_PNG) if image or kind == "qwen25" else None
    async with httpx.AsyncClient(timeout=httpx.Timeout(None, connect=15), follow_redirects=False, trust_env=False) as client:
        descriptor = None
        if file:
            uploaded = await demos.small_json(client, "POST", HOSTS[kind] + "/gradio_api/upload", files={"files": file})
            path = uploaded[0] if isinstance(uploaded, list) and len(uploaded) == 1 else None
            if (not isinstance(path, str) or not path.startswith("/") or path.startswith("//") or len(path) > 2048
                    or ".." in path.split("/") or re.search(r"[\x00\r\n]", path)):
                raise demos.PublicDemoError("protocol")
            descriptor = {"path": path, "meta": {"_type": "gradio.FileData"}}
        data = ([prompt, None, descriptor, None, turns[-6:], system_prompt, 0.35, 0.85, 20]
                if kind == "qwen35" else [descriptor, prompt])
        name = "chat_predict" if kind == "qwen35" else "qwen_vl_inference"
        base = f"{HOSTS[kind]}/gradio_api/call/{name}"
        submitted = await demos.small_json(client, "POST", base, json={"data": data, "session_hash": uuid.uuid4().hex})
        event = submitted.get("event_id") if isinstance(submitted, dict) else None
        if not isinstance(event, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", event):
            raise demos.PublicDemoError("protocol")
        client.cookies.clear()
        async with client.stream("GET", f"{base}/{event}") as response:
            await demos.expect_ok(response)
            if "text/event-stream" not in response.headers.get("content-type", ""):
                raise demos.provider_error(0, await demos.small_body(response))
            parser = demos.DemoStream(qwen35_answer if kind == "qwen35" else lambda data: checked_answer(data[0] if data else None))
            async for chunk in response.aiter_text():
                parser.feed(chunk)
                if parser.complete:
                    break
            return parser.finish()


def call_qwen(kind, prompt, system_prompt="", history=None, image=None, timeout=QWEN_TIMEOUT):
    async def bounded():
        return await asyncio.wait_for(qwen_request(kind, prompt, system_prompt, history, image), timeout=timeout)
    try:
        return asyncio.run(bounded())
    except asyncio.TimeoutError:
        error = demos.PublicDemoError("timeout")
        if timeout < QWEN_TIMEOUT:
            error.args = (f"Qwen: истекло ожидание ({max(1, round(timeout))} с). Запрос мог быть принят; автоматического повтора нет.",)
        raise error from None
    except httpx.HTTPError:
        raise demos.PublicDemoError("network") from None


class PollinationsError(RuntimeError):
    def __init__(self, code, status=0):
        self.code = "pollinations-" + code
        self.status = status if isinstance(status, int) and 400 <= status <= 599 else 0
        messages = {"auth": "не разрешил анонимный запрос", "quota": "отказал из-за лимита или условий доступа",
                    "unavailable": "временно недоступен", "protocol": "вернул неподдерживаемый ответ",
                    "timeout": "не завершил ответ в отведённое время", "network": "не ответил или оборвал соединение"}
        super().__init__(f"Pollinations: {messages[code]}." + (f" HTTP {self.status}." if self.status else "")
                         + " Автоматического повтора и платного перехода нет.")


async def pollinations_request(system_prompt, messages):
    async with httpx.AsyncClient(timeout=httpx.Timeout(None, connect=15), follow_redirects=False, trust_env=False) as client:
        async with client.stream("POST", "https://text.pollinations.ai/openai", json={"model": "openai",
                                 "messages": [{"role": "system", "content": system_prompt}] + messages[-8:], "temperature": 0.35}) as response:
            if not response.is_success:
                status = response.status_code
                raise PollinationsError("auth" if status in (401, 403) else "quota" if status in (402, 429)
                                        else "unavailable" if status >= 500 else "protocol", status)
            text = ""
            async for chunk in response.aiter_text():
                text += chunk
                if len(text) > 100000:
                    raise PollinationsError("protocol")
            try:
                data = json.loads(text)
                answer = data["choices"][0]["message"]["content"]
                if data.get("error") or not isinstance(answer, str) or not answer.strip():
                    raise ValueError()
            except (ValueError, KeyError, IndexError, TypeError):
                raise PollinationsError("protocol") from None
            return answer


def call_pollinations(system_prompt, messages, timeout=POLLINATIONS_TIMEOUT):
    async def bounded():
        return await asyncio.wait_for(pollinations_request(system_prompt, messages), timeout=timeout)
    try:
        return asyncio.run(bounded())
    except asyncio.TimeoutError:
        raise PollinationsError("timeout") from None
    except httpx.HTTPError:
        raise PollinationsError("network") from None
