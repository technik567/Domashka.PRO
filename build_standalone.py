#!/usr/bin/env python3
"""
Builds a single-file client with embedded JavaScript, CSS and KaTeX fonts:
  - Domashka_PRO.html
  - static/Domashka_PRO.html
  - Domashka_PRO_Portable.zip
  - USER_GUIDE.txt (UTF-8 text copy of the full guide)
Desktop: open the generated HTML without Python/Node/server.
Mobile file viewers may block JavaScript/storage; prefer HTTPS, especially on iOS.
The root HTML is tracked in Git; static/ remains generated; the Portable ZIP is tracked for direct download.
"""
import base64
import glob
import os
import re
import shutil
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(ROOT, "static", "assets")
DISTRIBUTION_DOCS = ('USER_GUIDE.md', 'REFERENCE_COVERAGE.md', 'docs/CLOUD_SETUP.md', 'docs/CLOUD_LAUNCH.md', 'docs/PUBLIC_DEMOS.md', 'docs/QA_4.2.md', 'docs/QA_4.3.md', 'docs/QA_4.4.md', 'docs/QA_4.5.md', 'docs/QA_4.6.md', 'docs/AI_FEATURES.md', 'docs/AUTH_USERNAME.md')


def add_zip_entry(archive, name, data, mode=0o644):
    """Stable bytes/permissions, independent of source mtime or builder OS."""
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = mode << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, data)


def inline_katex_fonts(css_text: str) -> str:
    # Replace @font-face src blocks or url(/assets/*.woff2) with embedded base64 woff2
    def replace_font_face(match: re.Match) -> str:
        block = match.group(0)
        m_woff2 = re.search(r"url\((?:/assets/)?(KaTeX_[^)\"']+\.woff2)\)", block)
        if m_woff2:
            fname = m_woff2.group(1)
            fpath = os.path.join(ASSETS_DIR, fname)
            if os.path.exists(fpath):
                with open(fpath, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("ascii")
                # Replace entire src:... (with or without trailing semicolon before }) with woff2 data URI
                block = re.sub(
                    r"src:[^;}]+;?",
                    f'src:url("data:font/woff2;base64,{b64}") format("woff2");',
                    block,
                )
        else:
            # Strip any leftover /assets/KaTeX_*.woff or .ttf fallbacks when Vite already inlined woff2
            block = re.sub(r',url\(/assets/KaTeX_[^)]+\)\s*format\("[^"]+"\)', "", block)
        return block

    return re.sub(r"@font-face\{[^}]+\}", replace_font_face, css_text)


def build() -> None:
    css_files = sorted(glob.glob(os.path.join(ASSETS_DIR, "index-*.css")))
    js_files = sorted(glob.glob(os.path.join(ASSETS_DIR, "index-*.js")))
    if not css_files or not js_files:
        raise RuntimeError("Сначала выполните npm run build")

    with open(css_files[0], "r", encoding="utf-8") as f:
        css_raw = f.read()
    css_inlined = inline_katex_fonts(css_raw)

    with open(js_files[0], "r", encoding="utf-8") as f:
        js_raw = f.read()

    # Safely escape any literal </script and <!-- inside JS strings/regexes so HTML parser never breaks!
    js_safe = re.sub(r"</(script)", r"<\/\1", js_raw, flags=re.IGNORECASE)
    js_safe = js_safe.replace("<!--", "\\x3c!--")

    with open(os.path.join(ROOT, "src", "version.js"), encoding="utf-8") as f:
        ver_match = re.search(r"APP_VERSION\s*=\s*['\"]([^'\"]+)['\"]", f.read())
    if not ver_match:
        raise RuntimeError("Не удалось прочитать версию приложения из src/version.js")
    app_ver = ver_match.group(1)

    guide_path = os.path.join(ROOT, "USER_GUIDE.md")
    if not os.path.isfile(guide_path):
        raise RuntimeError("Для переносимого комплекта нужен USER_GUIDE.md")

    shutil.copyfile(guide_path, os.path.join(ROOT, "USER_GUIDE.txt"))

    html = f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Домашка.ПРО v{app_ver} — Умный ИИ-помощник школьника (1–11 класс)</title>
  <link
    rel="icon"
    type="image/svg+xml"
    href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%231d4ed8'/%3E%3Cpath d='M18 14h28a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z' fill='%23fff'/%3E%3Cpath d='M23 24h18M23 32h18M23 40h12' stroke='%232563eb' stroke-width='3.5' stroke-linecap='round'/%3E%3Ccircle cx='46' cy='46' r='11' fill='%23f59e0b'/%3E%3Cpath d='M42 46l3 3 6-6' stroke='%23fff' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"
  />
  <style>{css_inlined}</style>
</head>
<body class="bg-slate-50 text-slate-900 antialiased selection:bg-blue-100 selection:text-blue-900">
  <div id="root"></div>
  <script>window.__STANDALONE_BUILD__ = true;</script>
  <script>{js_safe}</script>
</body>
</html>
"""

    out_main = os.path.join(ROOT, "Domashka_PRO.html")
    out_static = os.path.join(ROOT, "static", "Domashka_PRO.html")
    with open(out_main, "w", encoding="utf-8") as f:
        f.write(html)
    shutil.copyfile(out_main, out_static)

    readme_txt = f"""ДОМАШКА.ПРО {app_ver} — ПЕРЕНОСИМОЕ ПРИЛОЖЕНИЕ

ЗАПУСК
Распакуйте архив, затем откройте Domashka_PRO.html в современном браузере на ПК.
Python и Node.js для этого не нужны. Исходный index.html открывать не нужно.
Android: локальный файл работает не во всех браузерах/файловых менеджерах; предпочтительнее HTTPS.
iPhone/iPad: рекомендуется HTTPS-сайт в Safari. «Файлы» / Quick Look может не запускать HTML.
Добавление ярлыка сайта на домашний экран не гарантирует офлайн-работу.

ПОЛНОЕ РУКОВОДСТВО
Откройте ПОЛНАЯ_ИНСТРУКЦИЯ.txt: ПК, Android, iOS, публикация по HTTPS, нейросети,
фото/документы, детский режим, история, обновление и решение частых проблем.
Это копия USER_GUIDE.md из исходников, включённая в комплект при сборке.

ВЫБОР НЕЙРОСЕТИ
Бесплатная модель выбирается в чате: раскройте «Модель: …».
Провайдеры с ключами/свой API: Настройки → Продвинутый → Настройки нейросети.
Описание и цветные оценки — условные ориентиры, не бенчмарки.
Без ключа: Qwen / Pollinations, публичные демо Google Gemma 3 12B, Gemma 3n E4B,
Gemma 2 9B, Meta Llama 3.2 3B и Mistral 7B v0.3 сохранены.
Пять новых экспериментальных Qwen3: 8B, 14B, 30B-A3B, 32B, 235B-A22B.
Всего 13 вариантов плюс автовыбор. Новые Qwen3 — текст/OCR, не Vision.
Это разные модели одной площадки, а не пять независимых квот.
Gemma — модели Google, но не Gemini API. У демо Hugging Face общая анонимная GPU-квота
и очередь: больше моделей не добавляет бесплатного времени. Демо заранее резервируют
60–120 секунд GPU, поэтому даже короткий запрос может не пройти по остатку квоты.
Новые демо выбираются вручную, без фонового расхода. Проверка соединения тратит квоту.
Все демо не объявляются проверенными. В коротком живом прогоне 4.6 Pollinations
ответил дважды; оба старых Qwen отказали. В отдельном цикле Pollinations план
получен, но следующий ответ не уложился в 2 минуты. Доступ может меняться.
При ошибке квоты дождитесь её восстановления; внешняя регистрация или оплата не включаются.
У OpenRouter и Gemini нужен собственный API-ключ. Квоты и доступность зависят от сервиса.
Конкретная модель не заменяется незаметно; резервирование включено только в автовыборе.
Ollama / свой API требует отдельно запущенной модели и доступного API.
localhost на телефоне — сам телефон. Для мостика через Python нужна серверная
сборка и DOMASHKA_ENABLE_OLLAMA_PROXY=1; в этом автономном HTML его нет.
Полная инструкция содержит оба способа подключения и диагностику.

Фото: «Само фото (Vision)» — схемы и рисунки. Qwen и Gemma 3/3n — один снимок,
Gemini/OpenRouter Vision — до четырёх. Gemma 2/Llama/Mistral — текст или OCR.
OCR передаёт текст, не рисунок. Демо ожидаются до 5 минут; можно остановить ожидание.
В iPhone HTML Viewer сначала снимите обычной «Камерой», затем выберите готовое
фото в «Галерее». Прямой вызов камеры в опасном iOS-контексте отключён.
«Голосом» работает только при поддержке браузера/ОС; запасной вариант — микрофон
экранной клавиатуры. Для мобильных функций предпочтительна Safari/Chrome HTTPS.

ИСПРАВЛЕНИЯ 4.6
Pollinations использует штатную бесплатную потоковую очередь: между запросами
может быть 45 секунд и дольше. До 2 минут на один проход, только законченный
текст; приватные мысли не показываются. 402/429 не оплачиваются и не повторяются.
Авто для текста сначала пробует Pollinations, затем Qwen только после отказа,
по очереди, а не одновременно. Общее ожидание Auto — до 5 минут на проход.
При передаче самого фото используются только Qwen, без скрытого OCR.
Для текстового Qwen 2.5 исправлен повреждённый служебный PNG (не ваше фото).
Qwen в живом прогоне всё ещё вернули ошибку. Полное восстановление внешних
сервисов не подтверждено. Ручной выбор Qwen не переключается на другую модель.
Ошибка планирования означает, что поисковик ещё не вызывался.
Stop, ограничение ответа, HTTP-диагностика и исправления OCR 4.5 сохранены.
web-search уже опубликована как v4 / source 4.5; повторять deployment/SQL не нужно.
Новый Gemini/общий ключ не подключён. SQL, аккаунты и CAPTCHA не менялись.

СОХРАНЕНО ИЗ 4.4
По умолчанию — базовый чат. В Настройках переключается весь интерфейс:
Базовый / Продвинутый, класс, тема и спокойный фотофон с выключателем.
Семья и восстановление доступны всегда; режим не меняет права ребёнка.
«Подумать»: адаптивно либо низкий/средний/высокий в продвинутом интерфейсе.
Средний — отдельный проверочный запрос, высокий — два и вычислитель для
подходящих числовых равенств. Это медленнее, расходует квоту и может ошибаться.
Ход работы показывает события и время, не скрытые мысли и не проценты.
«Интернет: авто»: модель сама решает, нужен ли поиск, и составляет фразу.
Отдельного поля поиска нет. Tavily keyless ограничен квотой; в локальном HTML
доступ зависит от браузера/CORS. В существующем облаке web-search 4.5 уже обновлена.
Необязательный ключ поиска: Настройки → Продвинутый; только в памяти вкладки,
не в учебном экспорте/сообщениях ИИ. Общий ключ владельца остаётся на сервере.
Максимум 4 прохода модели с планированием, 2 поиска, 8 минут ожидания.
Нет источников/неверный план — ошибка, а не выдуманный поиск. В репетиторе
поиск запрещён. Проверка ответа может завершиться частично с предупреждением.
«Остановить» отменяет ожидание, но не обещает возврат квоты чужого сервера.
Публичные Qwen3 имеют проверенный GET-контракт, но живой POST не прошёл
сетевое соединение из среды разработки. Анонимная работа не гарантируется.
Таблицы, графики/SVG, отдельный помощник и интерактивное обучение сохранены.
Отдельный Domashka_PRO_Cloudflare.zip — для существующего Workers-сайта,
не для HTML Viewer. Для прежнего Worker также подготовлены Git-сборки:
проверенный PR → одобренное слияние в main → Cloudflare Build/Deploy.
После подтверждения настроек не нужно загружать ZIP при каждом обновлении.
Публикация 4.5 из main подтверждена; 4.6 требует нового одобренного merge.
Подробности и границы проверки — docs/CLOUD_LAUNCH.md.
Ни ZIP, ни Workers Builds не обновляют Supabase Edge-функции.
SQL, аккаунты, пароли, десять кодов и Turnstile в этом обновлении не менялись.

СОХРАНЕНО ИЗ 4.2
Ожидание ИИ/OCR показывает этапы, без недостоверных процентов.
«Знаю» сначала предлагает короткое задание. +4 XP только при верном ответе,
один раз за карточку; ответ можно напечатать или надиктовать.

ОБЛАКО И АВТОНОМНЫЙ ФАЙЛ — РАЗНЫЕ РЕЖИМЫ
Этот скачанный HTML остаётся локальным. Общие аккаунты ПК/телефона работают
на отдельно настроенном HTTPS-сайте Cloudflare Pages + Supabase.
Родитель — логин/пароль и 10 одноразовых кодов восстановления; дети — созданные
родителем логины/пароли. Почта и SMTP не нужны. Облако, CAPTCHA и сайт настраивает владелец.
Наличие кода не означает публикацию. Не вводите облачные пароли на GitHub Pages.
«Семья → Перенос и резервная копия учебных данных» выгружает учебные данные,
не пароли/сеансы/API-ключи. Не удаляйте старый Viewer до проверки переноса.

ЛОКАЛЬНЫЕ СЕМЕЙНЫЕ АККАУНТЫ
Откройте «Семья»: создайте первого родителя (логин, пароль, аватар, вопрос),
затем добавьте детей с их классом и возрастом. Вопрос вроде √49 не проверяет возраст.
Если был старый родительский пароль, он требуется для создания первой семьи.
Родитель назначает домашку, ребёнок присылает текст/фото, родитель проверяет вручную,
принимает или возвращает на доработку. Для фото нажмите «Показать фото работы».
Переключайтесь кнопкой выхода под шапкой; страница намеренно перезагружается.
У каждого свои чаты/закладки/дневник; аккаунты работают только в этом браузере.
На другой ПК или телефон семейные задания автоматически НЕ передаются.
Восстановления родительского пароля по почте нет. Материалы и API-ключи не зашифрованы
на диске; защита не заменяет контроль ОС и обходится изменением данных браузера.
Первый родитель может скопировать старые данные 3.x без удаления оригиналов.
Полного бэкапа аккаунтов нет: JSON тетради сохраняет чаты одного пользователя,
а отдельная выгрузка показанных семейных работ — задания/ответы/фото/отзывы.

РАСПИСАНИЕ И ШПАРГАЛКИ
В дневнике — от 1 до 9 уроков, каждая из 8 перемен меняется отдельно (0–60 минут).
Скрытые позиции при уменьшении количества уроков сохраняются.
1263 уникальные шпаргалки, 563 новые; минимум 25 всего на каждую пару набора.
Общие темы помечены диапазонами классов. Поиск сам не отключает фильтры.

OPENROUTER И ПРОГРЕСС
Ожидание сложного ответа — до 5 минут, доступна отмена. Автоматического повторного
платного запроса после серверного сбоя нет. Проценты готовности ИИ/OCR убраны.
Показаны этапы и прошедшее время; галочки появляются по факту, не по таймеру.
Новые демо отдельно обозначены как экспериментальные; рабочий ответ не обещается.

СТАРЫЙ ОДНО-ПРОФИЛЬНЫЙ ДЕТСКИЙ РЕЖИМ
Настройки → Детский режим с паролем: задайте и подтвердите пароль (от 8 символов).
Останутся репетитор, семья, дневник и справочник. Для выхода или смены пароля нужен текущий пароль.
Обычные чаты скрываются, но не удаляются. Пароль не отправляется в сеть; хранится его хеш.
Старый одно-профильный режим относится к этому браузеру/файлу. Ограничения семейного
ученика меняются отдельно в родительском кабинете, а не этой формой.
Это не полноценный родительский контроль: очистка данных/новый профиль/изменение HTML позволяют
обойти режим, а генеративная модель может нарушить инструкции. Восстановления пароля нет.

ОФЛАЙН И ДАННЫЕ
Локальные калькуляторы, справочник, дневник и история работают без сервера.
Облачный ИИ и часть OCR/PDF требуют интернета; текст и фото передаются внешним сервисам.
Не загружайте личные данные. Для резервной копии истории используйте экспорт JSON вне детского режима.
Настройки сайта не переносятся автоматически в скачанный HTML. Старая кнопка
«Скачать копию» в тетради экспортирует чаты; новый экспорт учебного пространства
в «Семье» также сохраняет дневник/расписание, но не ключи, сеансы или пароли.
У этого локального HTML нет автосинхронизации; общий прогресс — на настроенном
облачном сайте. Не очищайте данные до экспорта. Перед обновлением проверьте копию.
Настройка облака и ограничения: docs/CLOUD_SETUP.md; отчёт проверок: docs/QA_4.6.md.
"""

    win_bat = '@echo off\r\nchcp 65001 >nul\r\nstart "" "%~dp0Domashka_PRO.html"\r\n'
    mac_cmd = '#!/bin/sh\ncd "$(dirname "$0")"\nopen "./Domashka_PRO.html" 2>/dev/null || xdg-open "./Domashka_PRO.html"\n'

    zip_path = os.path.join(ROOT, "Domashka_PRO_Portable.zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        with open(out_main, "rb") as file:
            add_zip_entry(zf, "Domashka_PRO/Domashka_PRO.html", file.read())
        add_zip_entry(zf, "Domashka_PRO/КАК_ЗАПУСТИТЬ.txt", readme_txt)
        with open(guide_path, "rb") as file:
            add_zip_entry(zf, "Domashka_PRO/ПОЛНАЯ_ИНСТРУКЦИЯ.txt", file.read())
        for relative in DISTRIBUTION_DOCS:
            source = os.path.join(ROOT, relative)
            if os.path.isfile(source):
                with open(source, "rb") as file:
                    add_zip_entry(zf, f"Domashka_PRO/{relative}", file.read())
        add_zip_entry(zf, "Domashka_PRO/Запустить_Windows.bat", win_bat)
        add_zip_entry(zf, "Domashka_PRO/Запустить_Mac_Linux.command", mac_cmd, 0o755)

    size_kb = os.path.getsize(out_main) / 1024
    zip_kb = os.path.getsize(zip_path) / 1024
    print(f"✅ Собрано (v{app_ver}): Domashka_PRO.html ({size_kb:.1f} KB) и Domashka_PRO_Portable.zip ({zip_kb:.1f} KB)")


if __name__ == "__main__":
    build()
