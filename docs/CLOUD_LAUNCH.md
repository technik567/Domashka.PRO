# Существующий сайт Домашка.ПРО: обновления из GitHub и завершение запуска

Сайт остаётся **https://gentle-fog-7c3b.jr-polyakoff.workers.dev/**, Worker — **`gentle-fog-7c3b`**, Supabase — **`zgfjfngcwtupqyirwfha`**. Не создавать другой Worker/Pages, не менять домен, Site key или учётные записи. SMTP и почтовый домен не нужны. [Вход без почты](AUTH_USERNAME.md) · [Общая установка другого проекта](CLOUD_SETUP.md).

## Текущий статус — что подтверждено, а что ещё нет

- **PR №8 с обновлением 4.4 объединён в `main` с разрешения владельца**, merge commit `869a5031cf678c5dc01f98fd71981ec74cf92dca`. Это подтверждено GitHub, но само по себе не доказывает публикацию сайта.
- **Владелец сообщил, что подключил GitHub к Cloudflare.** Настройки Build/Branch control и успешный production deployment после подключения ещё не прочитаны. Наличие связи с GitHub не равно правильно настроенной сборке.
- В репозитории подготовлены `wrangler.json`, публичная конфигурация, сборка облачного HTML и проверяемая команда публикации **существующего Worker**. Эта настройка требует отдельного одобренного слияния; прежнее разрешение на PR №8 не является разрешением на новый PR. При подготовке выполняются только проверки и `--dry-run`, не реальный deploy.
- Supabase в текущем сеансе выключен. **Новая `web-search` 4.4 агентом не развёрнута**; последнее подтверждённое развёртывание — v2. Cloudflare публикует интерфейс, **не Edge Functions, SQL, Auth или данные**. Для этого отдельного шага достаточно включить уже подключённый Supabase в Arena — не нужны новые пароли/токены.

## 1. Один раз проверить настройки Git-сборки в Cloudflare

Открыть **Workers & Pages → gentle-fog-7c3b → Settings → Build / Builds**. Названия пунктов панели могут немного отличаться.

| Поле | Значение |
|---|---|
| Git repository | `technik567/Domashka.PRO` |
| Production branch / Git branch | **`main`** |
| Root directory | корень репозитория, без подпапки |
| Build command | **`npm ci && npm run build:worker`** |
| Deploy command | **`npm run deploy:worker`** |
| Branch control → Enable Preview Builds | **выключено** |

Не выбирать рабочую ветку `arena/…` вместо `main`. Preview builds здесь не нужны: серверные Origin и Turnstile разрешают только действующий адрес сайта. `preview_urls:false` в Wrangler отключает version preview URL, но **не заменяет выключение Preview Builds в панели**. Не менять настройки preview-ресурсов или заводить новый сайт.

`npm ci` устанавливает зафиксированные зависимости. Если хочется избежать второй установки после автоматической установки Cloudflare, можно задать **Build variable** `SKIP_DEPENDENCY_INSTALL=1`; для правильности это необязательно. Node 22 (не ниже 22.12) и Python 3.11 выбираются через `.node-version` / `.python-version`, npm 10.9.8 — через `packageManager`. Python-скрипту сборки хватает стандартной библиотеки; Python API сервера на Cloudflare не запускается.

### Публичные значения уже сохранены — секреты вводить не нужно

`build:worker` берёт **ровно четыре публичных поля** из `cloudflare.public.json`. Это прежние URL/publishable key Supabase, `siteUrl:auto` и публичный Site key Turnstile из облачной поставки. Эти значения и так доступны браузеру; они не дают административных полномочий. Для этого способа **не требуется вручную переносить четыре `DOMASHKA_*` переменные в панель**. Файл проходит ту же валидацию, что и `prepare_cloud.py`; отсутствующая/повреждённая конфигурация останавливает сборку.

`service_role`, `sb_secret_…`, секрет Turnstile, пароли, коды восстановления и Tavily API key **не добавлять** ни в этот JSON, ни в Git, ни в build-переменные фронтенда. Cloudflare сам использует свой deployment token в Workers Builds; передавать его агенту/в GitHub Secrets не нужно. Секреты Supabase остаются в Supabase. Окружение сборки не переносится в публичную конфигурацию.

### Что именно публикуется

`npm run build:worker` собирает автономный HTML и вызывает `prepare_worker.py`, использующий существующий `prepare_cloud.py`:

- **`.cache/worker-site/index.html`** — настроенный облачный клиент, не сырой Vite `index.html` и не локальный клиент без аккаунтов;
- `_headers` — прежние CSP, `no-store`, `no-referrer` и остальные заголовки;
- `Domashka_PRO.html` — отдельный автономный файл **без cloud config**;
- только разрешённые публичные инструкции. Исходники, `.env`, `.git`, SQL/Edge-код и служебный manifest в каталог сайта не входят.

Отдельная фиксированная `.cache/worker-site` не смешивается с ручной сборкой `.cache/cloud-site`. Пересборка удаляет старые файлы только из этого generated-каталога; ссылки на другие папки отклоняются. В `wrangler.json` имя **точно `gentle-fog-7c3b`**; серверного скрипта, новых маршрутов/домена или Supabase-команд нет. Не заменять команду на обычный `npm run build` и не указывать `static/` или корень репозитория как assets directory.

`deploy:worker` сначала проверяет контекст Workers Builds (`WORKERS_CI=1`, ветка `main`, commit SHA), имя Worker, cloud config, заголовки и SHA-256/список подготовленных файлов. После этого вызывает **локальный закреплённый Wrangler**. Из другой ветки или без контекста публикация отклоняется до запуска Wrangler. Это защита от ошибочного запуска **этой команды**, не замена правам Cloudflare и настройкам веток: переменные окружения можно изменить, а прямой `wrangler deploy` обходит обёртку. В панели должен быть именно `npm run deploy:worker`.

### Как будут выходить следующие обновления

1. Изменения готовятся в рабочей ветке и Pull Request; GitHub Actions проверяет тесты, упаковку и **Wrangler dry-run без публикации/токена Cloudflare**.
2. Владелец разрешает слияние только проверенного PR; изменения объединяются в `main`.
3. Cloudflare по push в `main` запускает Build command, затем Deploy command и обновляет тот же сайт. ZIP вручную больше не нужен для каждого обновления интерфейса.
4. Проверить **успешный production build/deployment и commit SHA** в Cloudflare, затем открыть прежний HTTPS-адрес. Уже открытая вкладка не заменяет код сама: сначала дождаться сохранения данных, затем обновить страницу.

Cloudflare запускается по push, **не ждёт отдельного завершения GitHub Actions на `main`**. Поэтому зелёные проверки PR и разрешение владельца нужны **до** merge; не отправлять непроверенные изменения прямо в `main`. Изменения Edge Functions/SQL в GitHub не применятся автоматически — они всегда отдельная операция.

Первое подтверждение интеграции — успешный deployment **коммита с этой настройкой после одобренного слияния**, а не зелёный `--dry-run`. До этого для сверки достаточно скриншота Build settings / Branch control без токенов. Если первый build упал до слияния настройки, не создавать другой Worker и не отключать CAPTCHA; проверить branch, команды и наличие конфигурации в нужном коммите. Журнал можно передать без секретов. После изменения настроек Cloudflare применяет их к следующему/повторному build; не повторять публикацию вслепую.

При проблеме с новым интерфейсом можно вернуть предыдущий исправный deployment **того же Worker** через его список deployments; не очищать Supabase или browser storage. Следующий push в `main` снова запустит сборку, поэтому исправление/возврат исходников также проходит через проверенный PR. Здесь откат не выполнялся.

### Проверка разработчиком без публикации

```sh
npm ci
npm test
npm run check:reference
npm run test:cloud
npm run check:worker
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Последняя Python-команда требует зависимости из `requirements.txt`, в отличие от самого cloud builder. `check:worker` пересобирает сайт и завершает `wrangler deploy --dry-run`; токен Cloudflare/вход через CLI ему не нужны. GitHub workflow не содержит production deployment. В unit-тестах реальные вызовы публикации подменены; проверяются отказ другой ветке, лишние/изменённые файлы, секретные/некорректные параметры, символические ссылки, несохранённые заголовки и локальная копия HTML. Эти проверки **не доказывают настройки панели или живую авторизацию**.

Документация Cloudflare: [build/deploy и системные переменные](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [production/preview branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/), [Node/Python/npm и dependency install](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/), [static assets](https://developers.cloudflare.com/workers/static-assets/).

## 2. Отдельно обновить серверный поиск 4.4

1. Обновить **только существующую `web-search`** исходником `supabase/functions/web-search/index.ts`. Сохранить secrets и `verify_jwt=false`: Auth проверяется внутри функции. Это можно сделать через существующее подключение Arena после включения Supabase либо редактор функции в панели. Нового проекта/CLI/миграции не требуется.
2. Функция сохраняет `Auth.getUser`, реальный session ID, `domashka_reserve_search`, квоты и запреты ребёнка. Если нет ключа Tavily, отправляет официальный `X-Tavily-Access-Mode: keyless`; явный личный ключ используется только для вызова, не пишется в БД/логи. Ключ владельца не возвращается браузеру.
3. Проверить один безличный вопрос с поиском и настоящий ответ модели на опубликованном сайте. Ошибка лимита/плана не должна порождать фиктивные источники. Физический iPhone/Safari и HTML Viewer проверяются отдельно.

**До шага 1 старый `web-search` v2 может отвечать, что нужен ключ владельца.** Это не причина добавлять секрет в HTML. Tavily keyless ограничен и может быть недоступен; числовая квота не обещается, PAYG не включать. Отдельный безличный Node-тест в GitHub Actions подтвердил Tavily keyless HTTP 200 / NASA, но **не использовал этот Supabase и не публиковал сайт**. [QA 4.4](QA_4.4.md).

## 3. Что уже установлено — не настраивать заново ради интерфейса

- Supabase **Domashka.PRO**, ref **`zgfjfngcwtupqyirwfha`**, Frankfurt / `eu-central-1`, при создании запрошен Free. [Панель](https://supabase.com/dashboard/project/zgfjfngcwtupqyirwfha). На последнем чтении проекта: `ACTIVE_HEALTHY`, PostgreSQL 17; это не текущая проверка доступности.
- Auth Site URL и единственный redirect URL уже записаны как `https://gentle-fog-7c3b.jr-polyakoff.workers.dev/`. Edge secret `DOMASHKA_ALLOWED_ORIGINS` — тот же origin **без `/`**. Не добавлять localhost, preview-домены или wildcard.
- Установлены шесть исходных миграций `202611060001`–`202611060006`, поиск `20261106160243_domashka_web_search.sql` и `20261112144047_username_recovery.sql`. SHA-256 последней: `41d121fd4c776d8c67890a00fd4816ce9564e3acc6d34bb194f9bc7416ac116f`. Установленные SQL не повторяют/не редактируют; будущие изменения — отдельными миграциями.
- Последние подтверждённые функции: **`account-access` v1 ACTIVE**, **`family-admin` v5 ACTIVE**, **`web-search` v2 ACTIVE**. `verify_jwt=false` преднамерен: публичные действия защищены CAPTCHA/квотами, приватные — внутренним Auth.getUser и проверкой действующего сеанса/прав. ACTIVE не доказывает приёмочный сценарий.
- На настоящей БД ранее проверено: `domashka_register_ticket`, `domashka_recovery_ticket`, `domashka_replace_backup_codes`, `domashka_account_rate` доступны только серверной роли. `domashka_backup_status` проверяет действующего родителя. Прямое чтение `backup_codes` для `anon`/`authenticated` запрещено. Проверены 1700 карточек / 4881 упражнение, RLS и закрытый bucket `domashka-photos` (2 МБ/фото).
- **0 пользователей / 0 резервных кодов** — исторический результат сразу после миграции, **не текущая статистика**. Реальные пароли/коды агент не создавал, не запрашивал и не печатал в чат.
- Публичный Site key **`0x4AAAAAAF-W-DrwguvGPskV`** сохранён. Ранее подтверждены `security_captcha_enabled=true`, provider `turnstile` и наличие Edge secret `DOMASHKA_TURNSTILE_SECRET_KEY`. Секрет не переносится в HTML/документацию.
- Владелец сообщил о сохранении **Minimum password length = 8** и **Require current password when updating = ON** и об исправлении hostname Turnstile. Повторного чтения после ручных изменений не было. Прежние 6 / OFF — не текущее подтверждённое состояние; повторять настройку без ошибки не нужно.
- При прежней ошибке Turnstile **110200** использовался точный hostname `gentle-fog-7c3b.jr-polyakoff.workers.dev`, без схемы/пути. Нового виджета/ключа для Git-сборки не требуется. Исторически `TAVILY_API_KEY` отсутствовал; в исходнике 4.4 он необязателен.

Оставить **`disable_signup=true`**: это запрет прямого `auth.signUp`, а не защищённой публичной регистрации через `account-access`. **`external_email_enabled=true`** нужен для технических парольных идентичностей, не настоящей почты; `mailer_autoconfirm=false` можно оставить. Email-уведомления для `.invalid`-адресов не включать. Не отключать CAPTCHA/защиты ради проверки. Коннектор Cloudflare в этом сеансе не поддерживается; настройки Builds владелец проверяет в панели, не пересылая секреты.

## 4. Резервная ручная поставка — не обязательна при настроенных Builds

`Domashka_PRO_Cloudflare.zip` сохранён как отдельная воспроизводимая поставка. `Domashka_PRO_Portable.zip` — локальная программа, **не** облачный сайт. Для ручной пересборки через прежний `prepare_cloud.py` нужны четыре **публичные** переменные:

```text
DOMASHKA_SUPABASE_URL=https://zgfjfngcwtupqyirwfha.supabase.co
DOMASHKA_SUPABASE_PUBLISHABLE_KEY=sb_publishable_LNQuFvv9MW97eqMjPIdp1g_p0qnlL9M
DOMASHKA_SITE_URL=auto
DOMASHKA_TURNSTILE_SITE_KEY=0x4AAAAAAF-W-DrwguvGPskV
```

Экспортировать их в окружение процесса (PowerShell: `$env:ИМЯ = 'значение'`), затем:

```sh
npm ci
npm run build:standalone
python3 scripts/prepare_cloud.py --zip Domashka_PRO_Cloudflare.zip
```

Результат — `.cache/cloud-site` и ZIP; это **не deploy**. Если панель существующего Worker предлагает ручную загрузку assets, загружать содержимое этого ZIP: `index.html` и `_headers` в корне, без внешней папки. Не загружать репозиторий, `.env`, SQL или `.git`. Старый pinned ZIP остаётся старой версией. Runtime-переменная Worker не меняет уже собранный статический HTML.

`siteUrl:auto` определяет origin браузера, но не настраивает Auth/Edge/Turnstile. Внутренний `/Domashka_PRO.html` остаётся локальным. Для общих аккаунтов на iPhone использовать тот же HTTPS-сайт в Safari, не HTML Viewer.

## 5. Приёмка на опубликованном сайте

Сначала вымышленные учебные данные, без фотографий детей:

1. Без сеанса открывается **«Регистрация»**, правила под полями, **«Вход» под формой** и Turnstile. Регистрация родителя без email: **все 10** кодов сразу, скачать TXT, проверить файл, подтвердить сохранение, войти. Начальный экран после входа — базовый чат; переключение интерфейса сохраняет историю/черновики.
2. На другом устройстве восстановить пароль первым кодом: осталось 9, повтор отказан; второй оставляет 8. Проверить отзыв старых сеансов.
3. Перевыпустить набор с текущим паролем: 10 новых, старые недействительны. Проверить отказ неверному паролю и число оставшихся.
4. Создать ребёнка, войти по полному логину, сбросить пароль родителем. Проверить другую семью, отзыв связей и ограничения.
5. Дневник/тетрадь/фото на ПК и телефоне, конфликт, сеть/offline queue, карточки и задания: [полный список](CLOUD_SETUP.md#6-обязательный-приёмочный-прогон-на-настоящем-проекте).

При обрыве регистрации/сброса/перевыпуска сначала проверить вход с новым паролем, не повторять запрос/расход следующего кода автоматически. Вход с паролем позволяет перевыпустить потерянный набор через минуту. Никому не присылать пароль или TXT с кодами.

Локальные тесты, dry-run и даже успешный deployment **не заменяют** живой GoTrue/Turnstile/Storage и физический iPhone. [Протокол и проверки кодов](AUTH_USERNAME.md) · [Поиск и ограничения](AI_FEATURES.md#поиск-tavily).
