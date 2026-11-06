from pathlib import Path
import base64
import json
import re
import struct
import time
import zlib
from typing import Any, Dict, List, Optional, Tuple

import httpx
from . import ollama_service, public_demos

# Fallback catalog, not a live availability or quota guarantee.
DEFAULT_OPENROUTER_FREE_MODELS: List[Dict[str, Any]] = [
    {
        "id": "openrouter/free",
        "name": "Авто-роутер бесплатных моделей OpenRouter (Текст + Фото)",
        "vision": True,
        "badge": "Рекомендуется",
    },
    {
        "id": "google/gemma-4-31b-it:free",
        "name": "Google Gemma 4 31B (free) — Текст + Фото тетради/доски",
        "vision": True,
        "badge": "Фото + Русский",
    },
    {
        "id": "nvidia/nemotron-3.5-super-vl:free",
        "name": "NVIDIA Nemotron 3.5 Super VL (free) — Чтение формул и чертежей",
        "vision": True,
        "badge": "Vision 1M",
    },
    {
        "id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        "name": "NVIDIA Nemotron 3 Nano Omni Reasoning (free) — Рассуждения + Фото",
        "vision": True,
        "badge": "Reasoning + Фото",
    },
    {
        "id": "google/gemma-4-26b-a4b-it:free",
        "name": "Google Gemma 4 26B Fast (free) — Быстрые ответы + Фото",
        "vision": True,
        "badge": "Быстрая",
    },
    {
        "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
        "name": "NVIDIA Nemotron 3 Ultra 550B (free) — Сложные задачи ЕГЭ/Олимпиад",
        "vision": False,
        "badge": "550B Флагман",
    },
    {
        "id": "thinkingmachines/inkling:free",
        "name": "Thinking Machines Inkling (free) — Универсальная + Фото",
        "vision": True,
        "badge": "1M Контекст",
    },
]

DEFAULT_GEMINI_MODELS: List[Dict[str, Any]] = [
    {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash — Быстрый + лучшее чтение рукописного почерка",
        "vision": True,
        "badge": "Хит для фото",
    },
    {
        "id": "gemini-2.5-flash-lite",
        "name": "Gemini 2.5 Flash-Lite — Самый большой бесплатный лимит в сутки",
        "vision": True,
        "badge": "Макс. лимит",
    },
    {
        "id": "gemini-2.0-flash",
        "name": "Gemini 2.0 Flash — Стабильная мультимодальная модель",
        "vision": True,
        "badge": "Текст + Фото",
    },
    {
        "id": "gemini-2.5-pro",
        "name": "Gemini 2.5 Pro — Профильный ЕГЭ, сочинения и олимпиады",
        "vision": True,
        "badge": "Профи",
    },
]

_OR_CACHE: Dict[str, Any] = {"ts": 0.0, "models": DEFAULT_OPENROUTER_FREE_MODELS}

SUBJECT_NAMES: Dict[str, str] = {
    "auto": "Автоопределение предмета",
    "math": "Математика / Алгебра",
    "geometry": "Геометрия",
    "russian": "Русский язык",
    "literature": "Литература и сочинения",
    "physics": "Физика",
    "chemistry": "Химия",
    "informatics": "Информатика (Python / КуМир / Логика)",
    "english": "Английский язык",
    "history": "История России и Всеобщая история",
    "social": "Обществознание",
    "biology": "Биология",
    "geography": "География",
    "world": "Окружающий мир (1–4 класс)",
    "project": "Индивидуальный проект / Лабораторная работа",
}

EXAM_GOAL_LABELS: Dict[str, str] = {
    "fgos": "Школьный урок по ФГОС",
    "vpr": "Подготовка к ВПР",
    "oge": "Подготовка к ОГЭ (9 класс)",
    "ege": "Подготовка к ЕГЭ (10–11 класс)",
    "olymp": "Олимпиадный / углублённый уровень",
}


def fetch_openrouter_free_models(force: bool = False) -> List[Dict[str, Any]]:
    now = time.time()
    if not force and (now - _OR_CACHE["ts"] < 600) and _OR_CACHE["models"]:
        return _OR_CACHE["models"]

    try:
        r = httpx.get(
            "https://openrouter.ai/api/v1/models",
            headers={"User-Agent": "DomashkaPRO/1.0"},
            timeout=8.0,
        )
        r.raise_for_status()
        data = r.json().get("data", [])
        live_list: List[Dict[str, Any]] = []
        seen = set()

        # Keep openrouter/free first
        live_list.append(
            {
                "id": "openrouter/free",
                "name": "Авто-роутер бесплатных моделей OpenRouter (Текст + Фото)",
                "vision": True,
                "badge": "Автовыбор",
            }
        )
        seen.add("openrouter/free")

        for m in data:
            mid = m.get("id", "")
            if not mid or mid in seen:
                continue
            if "content-safety" in mid or "guard" in mid or "lyria" in mid:
                continue
            pricing = m.get("pricing", {}) or {}
            is_free = (":free" in mid) or (
                str(pricing.get("prompt", "1")) == "0"
                and str(pricing.get("completion", "1")) == "0"
            )
            if not is_free:
                continue
            arch = m.get("architecture", {}) or {}
            in_mod = arch.get("input_modalities") or []
            modality_str = str(arch.get("modality", ""))
            has_vision = ("image" in in_mod) or ("image" in modality_str)
            ctx = m.get("context_length") or 0
            badge = "Текст + Фото" if has_vision else "Только текст"
            if ctx >= 500000:
                badge += f" · {ctx // 1000}K"
            live_list.append(
                {
                    "id": mid,
                    "name": m.get("name") or mid,
                    "vision": has_vision,
                    "badge": badge,
                }
            )
            seen.add(mid)

        # Sort official :free vision models right after openrouter/free for best student UX
        rest = live_list[1:]
        rest.sort(key=lambda x: (not x["vision"], ":free" not in x["id"], x["name"]))
        final_models = [live_list[0]] + rest
        if len(final_models) >= 2:
            _OR_CACHE["ts"] = now
            _OR_CACHE["models"] = final_models
            return final_models
    except Exception:
        pass
    return _OR_CACHE["models"]


_TUTOR_POLICY = json.loads((Path(__file__).resolve().parent.parent / "shared" / "tutor-policy.json").read_text(encoding="utf-8"))


def build_tutor_system_prompt(grade: int = 8, subject: str = "auto") -> str:
    grade = max(1, min(11, int(grade or 8)))
    age = _TUTOR_POLICY["primary" if grade <= 4 else "middle" if grade <= 9 else "senior"]
    return (_TUTOR_POLICY["instruction"].replace("{grade}", str(grade))
            .replace("{subject}", SUBJECT_NAMES.get(subject, str(subject)))
            .replace("{ageRules}", age))


def is_openrouter_vision_model(model: str) -> bool:
    model = model or "openrouter/free"
    for item in _OR_CACHE.get("models", []):
        if item.get("id") == model:
            return bool(item.get("vision"))
    return model == "openrouter/free" or any(part in model.lower() for part in ("vision", "-vl", "omni", "gemma-3", "gemma-4", "gemini", "pixtral", "gpt-4o"))


def build_system_prompt(
    grade: int,
    exam_goal: str,
    subject: str,
    mode: str,
    sympy_hint: str = "",
) -> str:
    if mode == "tutor":
        return build_tutor_system_prompt(grade, subject)
    subj_label = SUBJECT_NAMES.get(subject, "Школьный предмет")
    goal_label = EXAM_GOAL_LABELS.get(exam_goal, "Школьный урок по ФГОС")

    if grade <= 4:
        age_rules = (
            f"Ученик учится в {grade}-м классе (начальная школа РФ). "
            "СТРОГО ЗАПРЕЩЕНО использовать методы старших классов: системы уравнений с x и y, отрицательные числа, десятичные дроби (до 4 кл.), дискриминант, тригонометрию! "
            "Объясняй тёплым, простым и понятным ребёнку языком. "
            "Для текстовых задач обязательно делай «Краткую запись» и решай строго ПО ДЕЙСТВИЯМ с понятными пояснениями к каждому действию: `1) 15 + 8 = 23 (шт.) — во второй коробке`, и в конце пиши полный `Ответ:`."
        )
    elif grade <= 6:
        age_rules = (
            f"Ученик учится в {grade}-м классе (5–6 класс ФГОС РФ). "
            "Используй только методы 5–6 класса: обыкновенные и десятичные дроби, пропорции, проценты, НОД/НОК, простейшие линейные уравнения с одной переменной x. Не используй дискриминант, производные или теорему Пифагора."
        )
    elif grade <= 9:
        age_rules = (
            f"Ученик учится в {grade}-м классе (основная школа РФ, ориентация: {goal_label}). "
            "Строго соблюдай школьную программу РФ для этого класса и требования оформления контрольных/ВПР/ОГЭ."
        )
    else:
        age_rules = (
            f"Ученик учится в {grade}-м классе (старшая школа РФ, ориентация: {goal_label}). "
            "Давай глубокий, точный разбор с учётом критериев ФИПИ (профильный/базовый уровень, развёрнутая часть ЕГЭ, ОДЗ, строгие обоснования)."
        )

    formatting_rules = """
ПРАВИЛА РОССИЙСКОГО ШКОЛЬНОГО ОФОРМЛЕНИЯ (ФГОС):
1. Физика и расчётные задачи по Химии: обязательно выделяй разделы `**Дано:**`, `**СИ:**` (ВНИМАНИЕ: в физике ВСЕГДА переводи несистемные единицы в основные единицы СИ: км/ч → м/с, мин и ч → с, г и т → кг, см и км → м, см² → м², кПа → Па, кДж → Дж, °C → К где требуется!), `**Найти:**`, `**Решение:**` (сначала запиши общие рабочие формулы в буквенном виде, вырази искомую величину и только потом подставляй числа в СИ!) и `**Ответ:**` с единицами измерения.
2. Геометрия: оформляй `**Дано:**`, `**Найти:**` (или `**Доказать:**`), краткое описание чертежа, `**Решение:**` / `**Доказательство:**` с обязательным указанием теорем/свойств/признаков в скобках («по теореме Пифагора», «так как углы накрест лежащие при $a \\parallel b$...»), `**Ответ:**`.
3. Русский язык: при разборах соблюдай канон школы РФ:
   - Фонетический разбор (1): слоги, ударение, транскрипция `[...]`, столбиком буква — звук и полная характеристика каждого звука, внизу подсчёт букв и звуков.
   - Морфемный разбор (2): окончание, основа слова, корень (подобрать 2 однокоренных слова), приставка, суффикс.
   - Морфологический разбор (3): строго пункты `I. Часть речи, общее значение, вопрос`, `II. Начальная форма; постоянные признаки; непостоянные признаки`, `III. Синтаксическая роль в предложении`.
   - Синтаксический разбор (4): грамматическая основа, второстепенные члены с вопросами, характеристика в скобках (повеств./вопрос./побуд., невоскл./воскл., прост./сложн., двусост./односост., распр./нераспр., осложнено ли) и схема `[ — = ]`.
4. Информатика: если задача на Робота/Чертёжника или школьный алгоритмический язык — приводи код на **КуМир** (`алг`, `нач`, `кон`, `нц пока ... кц`) И/ИЛИ чистый код на **Python** (без сторонних библиотек, в стиле ОГЭ/ЕГЭ) с объяснением логики.
5. Устные предметы (История, Обществознание, Биология, География, Литература): если просят таблицу — строй красивую Markdown-таблицу; если вывод к лабораторной — пиши по структуре «Цель → Наблюдения → Вывод»; если план или сочинение ОГЭ/ЕГЭ — соблюдай структуру и объём слов по критериям ФИПИ.
6. Формулы: записывай математические и химические формулы аккуратно в LaTeX: внутри строки через `$...$`, отдельные важные формулы через `$$...$$`. Не используй конструкции `\\( ... \\)` и `\\[ ... \\]` — используй только `$` и `$$`.
"""

    if mode == "notebook":
        mode_rules = (
            "РЕЖИМ РАБОТЫ: «КАК В ТЕТРАДЬ (ЧИСТОВИК ФГОС)».\n"
            "Сначала выведи раздел `## 📓 Запись в тетрадь`, который ученик может аккуратно переписать без лишних разговорных фраз, строго по школьному шаблону оформления.\n"
            "Затем выведи короткий раздел `## 💡 Пояснение (если спросит учитель)`, где за 3–5 пунктов простым языком объясни ключевую идею и правила, чтобы ученик сам всё понял и уверенно ответил у доски."
        )
    elif mode == "step_by_step":
        mode_rules = (
            "РЕЖИМ РАБОТЫ: «ПОШАГОВЫЙ РАЗБОР».\n"
            "Разбери задание максимально понятно шаг за шагом (`Шаг 1`, `Шаг 2`, ...): объясняй НЕ ТОЛЬКО что делаем, но и ПОЧЕМУ делаем именно так, какое правило/формула работает, и укажи `⚠️ Частая ловушка`, где школьники обычно теряют баллы. В конце дай чёткий `**Ответ:**`."
        )
    elif mode == "tutor":
        mode_rules = (
            "РЕЖИМ РАБОТЫ: «УМНЫЙ РЕПЕТИТОР (БЕЗ СПОЙЛЕРОВ ОТВЕТА)».\n"
            "ВНИМАНИЕ: НЕ ПИШИ готовый финальный ответ и не решай всю задачу до конца в первом сообщении! "
            "Твоя задача — научить ученика думать самостоятельно:\n"
            "1) Помоги понять условие (что известно и что нужно найти).\n"
            "2) Напомни нужное правило, формулу или приём для первого шага.\n"
            "3) Задай один конкретный, дружелюбный наводящий вопрос по первому шагу, чтобы ученик ответил в чате. Когда ученик ответит в следующих сообщениях — проверяй его мысль и веди дальше!"
        )
    else:  # creative
        mode_rules = (
            "РЕЖИМ РАБОТЫ: «СОЧИНЕНИЕ / ТАБЛИЦА / ПРОЕКТ / ЛАБОРАТОРНАЯ».\n"
            "Создай полноценную, живую, грамотную работу для школьника заданного класса (без канцелярита и штампов ИИ, естественным языком сильного ученика). "
            "Если это сочинение — выдержи чёткое деление на абзацы (вступление, основная часть с аргументами/примерами, заключение) и укажи примерное количество слов в конце."
        )

    extra = ""
    if sympy_hint:
        extra = f"\nСПРАВКА ОТ ТОЧНОГО МАТЕМАТИЧЕСКОГО ЯДРА SYMPY (используй для самопроверки вычислений): {sympy_hint}\n"

    return (
        "Ты — «Домашка.ПРО», лучший в России школьный ИИ-помощник и опытный добрый учитель по всем предметам (1–11 класс).\n"
        f"Предмет: {subj_label}.\n"
        f"{age_rules}\n"
        f"{formatting_rules}\n"
        f"{mode_rules}\n"
        f"{extra}"
        "Всегда пиши на грамотном русском языке (если само задание не требует текста на английском/иностранном языке — тогда давай текст на нужном языке + перевод и пояснения на русском). Тщательно перепроверяй арифметику!"
    )


def build_checker_prompt(grade: int, exam_goal: str, subject: str) -> str:
    subj_label = SUBJECT_NAMES.get(subject, "Школьный предмет")
    goal_label = EXAM_GOAL_LABELS.get(exam_goal, "Школьный урок по ФГОС")
    return (
        f"Ты — внимательный, доброжелательный российский школьный учитель ({subj_label}, {grade} класс, ориентир: {goal_label}).\n"
        "Ученик прислал тебе свой черновик / решённую домашнюю работу / сочинение на проверку (текстом или на фото).\n"
        "Проведи качественную проверку строго по следующей структуре:\n\n"
        "## 📊 Предварительная оценка и разбор\n"
        "- Укажи примерную школьную оценку по 5-балльной шкале (и/или баллы по критериям ОГЭ/ЕГЭ, если выбрана подготовка к экзамену) и обязательно похвали за то, что сделано верно.\n\n"
        "## 🔍 Найденные ошибки и недочёты\n"
        "Если есть ошибки (вычислительные, логические, в оформлении Дано/СИ, орфографические, пунктуационные, грамматические, речевые или фактические), выведи их в удобной Markdown-таблице:\n"
        "| Фрагмент ученика | Тип ошибки | Как правильно и почему (правило) |\n"
        "Если ошибок нет вообще — радостно напиши, что работа выполнена безупречно!\n\n"
        "## ✨ Исправленный чистовик\n"
        "Приведи аккуратный исправленный вариант работы с сохранением авторской мысли ученика, оформленный по школьным требованиям.\n\n"
        "Формулы пиши в LaTeX через `$...$` и `$$...$$`."
    )


def _split_data_uri(image_b64: str) -> Tuple[str, str]:
    """Returns (mime_type, raw_base64_without_prefix)."""
    if image_b64.startswith("data:"):
        header, b64data = image_b64.split(",", 1)
        m = re.match(r"data:([^;]+);base64", header)
        mime = m.group(1) if m else "image/jpeg"
        return mime, b64data
    return "image/jpeg", image_b64


def _normalize_latex_delimiters(text: str) -> str:
    # Convert \[ ... \] to $$ ... $$ and \( ... \) to $ ... $ so KaTeX renders everything uniformly
    text = re.sub(r"\\\[(.*?)\\\]", lambda m: f"$${m.group(1)}$$", text, flags=re.DOTALL)
    text = re.sub(r"\\\((.*?)\\\)", lambda m: f"${m.group(1)}$", text, flags=re.DOTALL)
    return text


def openai_messages(system_prompt: str, messages: List[Dict[str, Any]], photos=None):
    photos = photos or []
    result = [{"role": "system", "content": system_prompt}]
    last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=-1)
    for i, message in enumerate(messages):
        content = str(message.get("content", ""))
        if photos and i == last_user:
            content = [{"type": "text", "text": content or "Рассмотри изображения и помоги с заданием."}] + [
                {"type": "image_url", "image_url": {"url": image}} for image in photos
            ]
        result.append({"role": message.get("role", "user"), "content": content})
    return result


def photo_capacity(provider: str, model: str, vision_capable=None) -> int:
    if provider == "gemini":
        return 4
    if provider == "openrouter":
        return 4 if (vision_capable if isinstance(vision_capable, bool) else is_openrouter_vision_model(model)) else 0
    if provider == "custom":
        return 4 if vision_capable is True else 0
    if provider == "builtin" and model in public_demos.MODELS:
        return public_demos.MODELS[model]["maxImages"]
    return 1 if provider == "builtin" and (model or "auto") in ("auto", "qwen-3.5", "qwen-2.5-vl") else 0


def prepare_photo_input(provider, model, photos, ocr_text="", photo_mode="auto", vision_capable=None, purpose="solve", api_key=""):
    if not isinstance(photos, list) or len(photos) > 4:
        raise ValueError("Нужен список не более чем из четырёх фото.")
    if photo_mode not in ("auto", "vision", "ocr"):
        raise ValueError("Неизвестный способ обработки фото.")
    if any(not isinstance(image, str) or not re.fullmatch(r"data:image/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\r\n]+", image, re.I) for image in photos):
        raise ValueError("Некорректное фото. Используйте изображения JPG/PNG/WebP в data URI.")
    if sum(map(len, photos)) > 20 * 1024 * 1024:
        raise ValueError("Фото слишком большие (до 20 МБ после кодирования).")
    capacity = photo_capacity(provider, model, vision_capable)
    direct = bool(photos) and photo_mode != "ocr" and 0 < len(photos) <= capacity
    if photos and photo_mode == "vision" and not direct:
        raise ValueError(f"Выбранная модель принимает непосредственно изображений: {capacity}. Смените модель/число фото или явно выберите OCR; подмены не будет.")
    if photos and provider == "custom" and photo_mode == "auto" and not direct:
        raise ValueError("Ollama без Vision: выберите мультимодальную модель или явно разрешите OCR. Автоматической отправки фото в облачный OCR нет.")
    if direct:
        return photos, "", ""
    resolved_ocr = str(ocr_text or "").strip()
    labels = []
    if photos and not resolved_ocr:
        pages = []
        for index, image in enumerate(photos):
            text, label = recognize_photo_server(image, purpose=purpose, provider=provider, api_key=api_key, model=model)
            if not text.strip():
                raise ValueError(f"Не удалось распознать фото {index + 1}.")
            pages.append(f"[Фото {index + 1}]:\n{text}" if len(photos) > 1 else text)
            if label not in labels:
                labels.append(label)
        resolved_ocr = "\n\n".join(pages)
    return [], resolved_ocr, ", ".join(labels)


def _call_openrouter(
    api_key: str,
    model: str,
    system_prompt: str,
    messages: List[Dict[str, Any]],
    image_b64: Optional[str] = None,
) -> Tuple[str, str]:
    photos = image_b64 if isinstance(image_b64, list) else ([image_b64] if image_b64 else [])
    or_messages = openai_messages(system_prompt, messages, photos)

    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://domashka.pro",
        "X-Title": "Domashka.PRO School Assistant",
    }

    models_to_try = [model] if model else ["openrouter/free"]

    last_err = ""
    for candidate_model in models_to_try:
        try:
            payload = {
                "model": candidate_model,
                "messages": or_messages,
                "temperature": 0.35,
                "max_tokens": 1600 if "ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА РЕПЕТИТОРА" in system_prompt else 6000,
            }
            r = httpx.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=httpx.Timeout(300.0, connect=15.0),
            )
            if r.status_code == 200:
                data = r.json()
                choice = (data.get("choices") or [{}])[0]
                msg_obj = choice.get("message") or {}
                content = msg_obj.get("content") or ""
                used_model = data.get("model") or candidate_model
                if content.strip():
                    if choice.get("finish_reason") == "length":
                        content += "\n\n> ⚠️ Ответ остановлен лимитом токенов модели и может быть неполным. Попросите продолжить."
                    if choice.get("finish_reason") in ("error", "content_filter"):
                        raise RuntimeError("OpenRouter не завершил ответ: ошибка модели или фильтр содержимого.")
                    return _normalize_latex_delimiters(content), f"OpenRouter ({used_model})"
                last_err = "Пустой ответ от модели"
            elif r.status_code == 429:
                raise RuntimeError("OpenRouter: достигнут лимит запросов. Подождите и повторите самостоятельно.")
            elif r.status_code == 402:
                raise RuntimeError("OpenRouter: недостаточно средств или исчерпан бюджет ключа.")
            elif r.status_code == 403:
                raise RuntimeError("OpenRouter: доступ запрещён. Проверьте разрешения ключа, модель и ограничения региона.")
            elif r.status_code == 401:
                raise RuntimeError(f"Неверный API-ключ OpenRouter (код {r.status_code}). Проверьте ключ в Настройках ИИ.")
            else:
                last_err = f"HTTP {r.status_code}"
        except httpx.TimeoutException:
            raise RuntimeError("OpenRouter не ответил за отведённое время (до 5 минут ожидания). Автоматического повтора нет; провайдер может ещё обрабатывать запрос.")
        except RuntimeError:
            raise
        except Exception as exc:
            last_err = type(exc).__name__

    raise RuntimeError(f"OpenRouter временно перегружен или модель недоступна ({last_err}). Попробуйте другую бесплатную модель в списке.")


def _call_gemini(
    api_key: str,
    model: str,
    system_prompt: str,
    messages: List[Dict[str, Any]],
    image_b64: Optional[str] = None,
) -> Tuple[str, str]:
    photos = image_b64 if isinstance(image_b64, list) else ([image_b64] if image_b64 else [])
    contents = []
    for idx, msg in enumerate(messages):
        role = "model" if msg.get("role") == "assistant" else "user"
        parts: List[Dict[str, Any]] = []
        text_val = msg.get("content", "")
        if text_val:
            parts.append({"text": text_val})
        if photos and idx == max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=-1):
            if not parts:
                parts.append({"text": "Рассмотри изображения и помоги с заданием."})
            for image in photos:
                mime, raw_b64 = _split_data_uri(image)
                parts.append({"inline_data": {"mime_type": mime, "data": raw_b64}})
        if parts:
            contents.append({"role": role, "parts": parts})

    candidates = ["gemini-2.5-flash", "gemini-2.5-flash-lite"] if model == "auto" else [model or "gemini-2.5-flash"]

    last_err = ""
    for cand in candidates:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{cand}:generateContent?key={api_key.strip()}"
        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": contents,
            "generationConfig": {
                "temperature": 0.35,
                "maxOutputTokens": 1500 if "ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА РЕПЕТИТОРА" in system_prompt else 4096,
            },
        }
        try:
            r = httpx.post(url, json=payload, timeout=26.0)
            if r.status_code == 200:
                data = r.json()
                cands = data.get("candidates") or []
                if cands:
                    parts_out = (cands[0].get("content") or {}).get("parts") or []
                    text_out = "".join(p.get("text", "") for p in parts_out if "text" in p)
                    if text_out.strip():
                        return _normalize_latex_delimiters(text_out), f"Google Gemini ({cand})"
                last_err = "Модель вернула пустой ответ"
            elif r.status_code in (400, 403) and "API_KEY_INVALID" in r.text:
                raise RuntimeError("Неверный API-ключ Google Gemini. Проверьте ключ из Google AI Studio в Настройках ИИ.")
            elif r.status_code == 404:
                last_err = f"Модель {cand} не найдена"
                continue
            else:
                last_err = f"HTTP {r.status_code}"
        except RuntimeError:
            raise
        except Exception as exc:
            last_err = type(exc).__name__

    raise RuntimeError(f"Не удалось получить ответ от Google Gemini ({last_err}).")


def _make_blank_white_png() -> bytes:
    w, h = 16, 16
    raw = b"".join(b"\x00" + b"\xff\xff\xff" * w for _ in range(h))

    def _chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(raw))
        + _chunk(b"IEND", b"")
    )


def _is_valid_extracted_text(txt: str) -> bool:
    clean = (txt or "").strip()
    if len(clean) < 2:
        return False
    low = clean.lower()
    bad_markers = (
        "[error]",
        "exceeded your zerogpu",
        "quota exceeded",
        "please upload an image",
        "organization_restricted",
        "error code:",
    )
    if any(m in low for m in bad_markers):
        return False
    return bool(re.search(r"[А-Яа-яЁёA-Za-z0-9]", clean))


def _extract_qwen35_omni_sse(sse_text: str) -> str:
    lines = sse_text.splitlines()
    for idx, ln in enumerate(lines):
        if ln.strip() == "event: error":
            raise RuntimeError("Qwen3.5-Omni SSE error")
        if ln.strip() == "event: complete" and idx + 1 < len(lines):
            nxt = lines[idx + 1].strip()
            if nxt.startswith("data:"):
                arr = json.loads(nxt[5:].strip())
                if isinstance(arr, list) and len(arr) >= 5 and isinstance(arr[4], list) and arr[4]:
                    last_msg = arr[4][-1]
                    content = last_msg.get("content", "") if isinstance(last_msg, dict) else str(last_msg)
                    if isinstance(content, list):
                        content = "\n".join(
                            (b.get("text", "") if isinstance(b, dict) else str(b)) for b in content
                        )
                    out = str(content or "").strip()
                    if _is_valid_extracted_text(out):
                        return _normalize_latex_delimiters(out)
    raise RuntimeError("Empty Qwen3.5-Omni response")


def _call_qwen35_omni_server(
    text_prompt: str,
    system_prompt: str = "",
    history: Optional[List[Dict[str, Any]]] = None,
    image_b64: Optional[str] = None,
    timeout: float = 18.0,
) -> str:
    host = "https://qwen-qwen3-5-omni-offline-demo.hf.space"
    img_descriptor = None
    if image_b64:
        mime, raw_b64 = _split_data_uri(image_b64)
        img_bytes = base64.b64decode(raw_b64)
        ext = "png" if "png" in mime else "jpg"
        up = httpx.post(
            f"{host}/gradio_api/upload",
            files={"files": (f"homework.{ext}", img_bytes, mime)},
            timeout=min(10.0, timeout),
        )
        up.raise_for_status()
        up_path = up.json()[0]
        img_descriptor = {"path": up_path, "meta": {"_type": "gradio.FileData"}}

    clean_hist = [
        {"role": m.get("role", "user"), "content": str(m.get("content", ""))}
        for m in (history or [])[-6:]
    ]
    call_r = httpx.post(
        f"{host}/gradio_api/call/chat_predict",
        json={
            "data": [
                text_prompt,
                None,
                img_descriptor,
                None,
                clean_hist,
                system_prompt or "",
                0.35,
                0.85,
                20,
            ]
        },
        timeout=min(10.0, timeout),
    )
    call_r.raise_for_status()
    ev = call_r.json().get("event_id")
    if not ev:
        raise RuntimeError("Missing Qwen3.5-Omni event_id")

    sse_r = httpx.get(f"{host}/gradio_api/call/chat_predict/{ev}", timeout=timeout)
    sse_r.raise_for_status()
    return _extract_qwen35_omni_sse(sse_r.text)


def _call_qwen_vl_server(
    prompt: str,
    image_b64: Optional[str] = None,
    timeout: float = 16.0,
) -> str:
    host = "https://developer0hye-qwen2-5-vl-7b-instruct.hf.space"
    if image_b64:
        mime, raw_b64 = _split_data_uri(image_b64)
        img_bytes = base64.b64decode(raw_b64)
        ext = "png" if "png" in mime else "jpg"
    else:
        mime = "image/png"
        img_bytes = _make_blank_white_png()
        ext = "png"

    up = httpx.post(
        f"{host}/gradio_api/upload",
        files={"files": (f"homework.{ext}", img_bytes, mime)},
        timeout=min(10.0, timeout),
    )
    up.raise_for_status()
    up_path = up.json()[0]

    call_r = httpx.post(
        f"{host}/gradio_api/call/qwen_vl_inference",
        json={
            "data": [
                {"path": up_path, "meta": {"_type": "gradio.FileData"}},
                prompt,
            ]
        },
        timeout=min(10.0, timeout),
    )
    call_r.raise_for_status()
    event_id = call_r.json().get("event_id")
    if not event_id:
        raise RuntimeError("No event_id from Qwen2.5-VL")

    sse_r = httpx.get(
        f"{host}/gradio_api/call/qwen_vl_inference/{event_id}",
        timeout=timeout,
    )
    sse_r.raise_for_status()
    lines = sse_r.text.splitlines()
    for idx, ln in enumerate(lines):
        if ln.strip() == "event: error":
            raise RuntimeError("Qwen2.5-VL event error")
        if ln.strip() == "event: complete" and idx + 1 < len(lines):
            nxt = lines[idx + 1]
            if nxt.startswith("data:"):
                arr = json.loads(nxt[5:].strip())
                out = str(arr[0] if isinstance(arr, list) and arr else arr).strip()
                if _is_valid_extracted_text(out):
                    return _normalize_latex_delimiters(out)
    for ln in reversed(lines):
        if ln.startswith("data:"):
            try:
                arr = json.loads(ln[5:].strip())
                out = str(arr[0] if isinstance(arr, list) and arr else arr).strip()
                if _is_valid_extracted_text(out):
                    return _normalize_latex_delimiters(out)
            except Exception:
                pass
    raise RuntimeError("Empty Qwen2.5-VL response")


def _call_ocr_space_server(image_b64: str, timeout: float = 10.0) -> str:
    mime, raw_b64 = _split_data_uri(image_b64)
    data_uri = f"data:{mime};base64,{raw_b64}"
    r = httpx.post(
        "https://api.ocr.space/parse/image",
        data={
            "apikey": "helloworld",
            "base64Image": data_uri,
            "language": "rus",
            "OCREngine": "2",
            "scale": "true",
            "detectOrientation": "true",
            "isTable": "true",
        },
        timeout=timeout,
    )
    r.raise_for_status()
    payload = r.json()
    if payload.get("IsErroredOnProcessing"):
        err_msg = payload.get("ErrorMessage") or "OCR.space processing error"
        raise RuntimeError(str(err_msg))
    parsed = payload.get("ParsedResults") or []
    txt = "\n".join((p.get("ParsedText") or "").strip() for p in parsed).strip()
    if _is_valid_extracted_text(txt):
        return txt
    raise RuntimeError("Empty OCR.space text")


def recognize_photo_server(
    image_b64: str,
    purpose: str = "solve",
    provider: str = "builtin",
    api_key: str = "",
    model: str = "",
) -> Tuple[str, str]:
    """Fast server-side Vision/OCR cascade immune to client ISP/Cloudflare blocks."""
    is_draft = purpose in ("check", "draft_check")
    vision_prompt = (
        "Ты — точный ИИ-сканер школьных тетрадей. Дословно перепиши весь рукописный и печатный текст, "
        "примеры, формулы и вычисления ученика с фотографии. НЕ ИСПРАВЛЯЙ ошибки ученика — перепиши "
        "ровно так, как написано в тетради! Выведи только распознанный текст без вступлений."
        if is_draft
        else "Ты — точный ИИ-сканер школьных заданий. Дословно перепиши весь текст задания, числа, "
        "уравнения и формулы с фотографии (формулы можно в виде x^2, a/b или LaTeX). "
        "Выведи только распознанный текст задания без решения и без лишних комментариев."
    )

    clean_key = (api_key or "").strip()
    if provider == "gemini" and clean_key:
        try:
            txt, _ = _call_gemini(
                clean_key,
                model or "gemini-2.5-flash",
                "Перепиши текст и формулы с изображения дословно без комментариев.",
                [{"role": "user", "content": vision_prompt}],
                image_b64=image_b64,
            )
            if _is_valid_extracted_text(txt):
                return txt.strip(), "Google Gemini Vision"
        except Exception:
            pass

    if provider == "openrouter" and clean_key and is_openrouter_vision_model(model):
        try:
            txt, _ = _call_openrouter(
                clean_key,
                model or "openrouter/free",
                "Перепиши текст и формулы с изображения дословно без комментариев.",
                [{"role": "user", "content": vision_prompt}],
                image_b64=image_b64,
            )
            if _is_valid_extracted_text(txt):
                return txt.strip(), "OpenRouter Vision"
        except Exception:
            pass

    errors: List[str] = []
    tiers = (
        [
            ("Qwen3.5-Omni ИИ-зрение (сервер)", lambda: _call_qwen35_omni_server(vision_prompt, "Выведи только распознанный текст с изображения без вступлений.", None, image_b64, timeout=14.0)),
            ("OCR.space Engine 2 (сервер)", lambda: _call_ocr_space_server(image_b64, timeout=9.0)),
            ("Qwen2.5-VL ИИ-зрение (сервер)", lambda: _call_qwen_vl_server(vision_prompt, image_b64, timeout=14.0)),
        ]
        if is_draft
        else [
            ("OCR.space Engine 2 (сервер)", lambda: _call_ocr_space_server(image_b64, timeout=8.5)),
            ("Qwen3.5-Omni ИИ-зрение (сервер)", lambda: _call_qwen35_omni_server(vision_prompt, "Выведи только распознанный текст с изображения без вступлений.", None, image_b64, timeout=14.0)),
            ("Qwen2.5-VL ИИ-зрение (сервер)", lambda: _call_qwen_vl_server(vision_prompt, image_b64, timeout=14.0)),
        ]
    )
    for label, fn in tiers:
        try:
            out = fn()
            if _is_valid_extracted_text(out):
                return out.strip(), label
        except Exception as exc:
            errors.append(f"{label}: {exc}")

    raise RuntimeError(f"Не удалось распознать текст на фото ({'; '.join(errors)}).")


def _call_builtin_free(
    system_prompt: str,
    messages: List[Dict[str, Any]],
    has_raw_image_without_ocr: bool = False,
    model: str = "auto",
    image_b64: Optional[str] = None,
    tutor_only: bool = False,
) -> Tuple[str, str]:
    """A fixed choice never silently changes model; only auto cascades."""
    selected = model or "auto"
    if selected in public_demos.MODELS:
        text, used = public_demos.call_public_demo(selected, system_prompt, messages, image_b64, tutor_only)
        return _normalize_latex_delimiters(text), used
    if selected not in ("auto", "qwen-3.5", "pollinations", "qwen-2.5-vl"):
        raise ValueError("Неизвестная бесплатная облачная модель. Выберите её заново в настройках.")

    def qwen35():
        return _call_qwen35_omni_server(
            text_prompt=(messages[-1].get("content", "") if messages else ""),
            system_prompt=system_prompt, history=messages[:-1], image_b64=image_b64, timeout=20.0,
        )

    def pollinations():
        response = httpx.post(
            "https://text.pollinations.ai/openai",
            json={"model": "openai", "messages": [{"role": "system", "content": system_prompt}] + messages,
                  "temperature": 0.35}, timeout=12.0,
        )
        if response.status_code != 200:
            raise RuntimeError(f"HTTP {response.status_code}")
        return (((response.json().get("choices") or [{}])[0].get("message") or {}).get("content") or "")

    def qwen25():
        # Crucially keep the tutor policy and conversation, not just the last question.
        conversation = "\n\n".join(f"{m.get('role', 'user')}: {m.get('content', '')}" for m in messages)
        return _call_qwen_vl_server(
            ("Рассмотри само изображение. " if image_b64 else "Игнорируй пустой фон. ") + f"Следуй инструкции учителя:\n{system_prompt}\n\n{conversation}",
            image_b64=image_b64, timeout=16.0,
        )

    gateways = [("qwen-3.5", "Qwen 3.5 Omni", qwen35),
                ("pollinations", "Pollinations", pollinations),
                ("qwen-2.5-vl", "Qwen 2.5 VL", qwen25)]
    errors = []
    for model_id, label, call in gateways:
        if image_b64 and model_id == "pollinations":
            continue
        if selected != "auto" and model_id != selected:
            continue
        try:
            text = call()
            if not text or not text.strip():
                raise RuntimeError("Пустой ответ")
            return _normalize_latex_delimiters(text), f"{label} (облачный шлюз)"
        except Exception as exc:
            # Do not expose request URLs, credentials or provider response bodies to the client.
            errors.append(f"{label}: {type(exc).__name__}")
    raise RuntimeError("Выбранный облачный ИИ недоступен. Попробуйте позже или смените модель в настройках. " + "; ".join(errors))


def generate_ai_response(
    provider: str, api_key: str, model: str, system_prompt: str, messages: List[Dict[str, Any]],
    image_b64: Optional[str] = None, ocr_text: str = "", purpose: str = "solve",
    tutor_only: bool = False, tutor_grade: int = 8, tutor_subject: str = "auto",
    vision_capable: Optional[bool] = None, images: Optional[List[str]] = None, photo_mode: str = "auto",
) -> Tuple[str, str]:
    if provider not in ("builtin", "openrouter", "gemini", "custom"):
        raise ValueError("Неизвестный провайдер ИИ")
    if provider in ("openrouter", "gemini") and not (api_key or "").strip():
        raise ValueError("Для выбранного провайдера требуется API-ключ. Выберите режим без ключа или укажите ключ.")
    if provider == "custom":
        ollama_service.configured_endpoint()  # opt-in before any OCR / network work
    if tutor_only:
        system_prompt = build_tutor_system_prompt(tutor_grade, tutor_subject)
    messages = [{"role": m["role"], "content": str(m.get("content", ""))} for m in messages
                if isinstance(m, dict) and m.get("role") in ("user", "assistant")]
    if not messages:
        raise ValueError("Сообщение пустое")
    if tutor_only and len(messages) > 7:
        messages = [messages[0]] + messages[-6:]
    photos = images if images is not None else ([image_b64] if image_b64 else [])
    native_photos, resolved_ocr, vision_label = prepare_photo_input(
        provider, model, photos, ocr_text, photo_mode, vision_capable, purpose, (api_key or "").strip())
    if native_photos:
        system_prompt += "\nРассмотри сами изображения: рисунки, схемы, графики и пространственные связи. Если детали неразборчивы, уточни их, не выдумывай. Соблюдай все правила учебного режима."
    working_msgs = [dict(m) for m in messages]
    if resolved_ocr:
        index = max((i for i, m in enumerate(working_msgs) if m["role"] == "user"), default=-1)
        if index >= 0:
            working_msgs[index]["content"] += f"\n\n[{'Записи ученика' if purpose == 'check' else 'Задание'}, распознанные с фото — OCR]:\n{resolved_ocr}"
    # Keep the old single-photo API compatible while supporting multiple images.
    image_arg = native_photos if len(native_photos) > 1 else (native_photos[0] if native_photos else None)
    if provider == "openrouter":
        ans, used = _call_openrouter(api_key.strip(), model or "openrouter/free", system_prompt, working_msgs, image_arg)
    elif provider == "gemini":
        ans, used = _call_gemini(api_key.strip(), model or "gemini-2.5-flash", system_prompt, working_msgs, image_arg)
    elif provider == "custom":
        ans, used = ollama_service.complete(model, openai_messages(system_prompt, working_msgs, native_photos), tutor_only)
    else:
        ans, used = _call_builtin_free(system_prompt, working_msgs, model=model, image_b64=image_arg, tutor_only=tutor_only)
    return ans, (f"{used} + {vision_label}" if vision_label else used)


def test_provider_key(provider: str, api_key: str, model: str = "") -> Dict[str, Any]:
    clean_key = (api_key or "").strip()
    if provider == "custom":
        txt, used = generate_ai_response("custom", "", model, "Отвечай кратко.", [{"role": "user", "content": "Напиши: ИИ готов."}])
        return {"ok": True, "message": f"{used}: {txt}"}
    if provider == "builtin":
        txt, used = _call_builtin_free(
            "Отвечай кратко на русском.",
            [{"role": "user", "content": "Напиши только фразу: ИИ готов помогать с домашкой!"}],
            model=model,
        )
        return {"ok": True, "message": f"{used}: {txt.strip()}"}

    if not clean_key:
        return {"ok": False, "error": "Введите API-ключ для проверки."}

    try:
        if provider == "openrouter":
            txt, used = _call_openrouter(
                clean_key,
                model or "openrouter/free",
                "Отвечай одной короткой фразой на русском.",
                [{"role": "user", "content": "Скажи: Ключ OpenRouter успешно подключён!"}],
            )
            return {"ok": True, "message": f"{used} — {txt.strip()}"}
        elif provider == "gemini":
            txt, used = _call_gemini(
                clean_key,
                model or "gemini-2.5-flash",
                "Отвечай одной короткой фразой на русском.",
                [{"role": "user", "content": "Скажи: Ключ Google Gemini успешно подключён!"}],
            )
            return {"ok": True, "message": f"{used} — {txt.strip()}"}
        return {"ok": False, "error": f"Неизвестный провайдер: {provider}"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
