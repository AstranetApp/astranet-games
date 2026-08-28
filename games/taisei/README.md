# Taisei Project для Astranet Games

Автономный web-only хост официальной Emscripten/WebAssembly-сборки
[Taisei Project](https://taisei-project.org/). Один URL работает как обычная
desktop-страница и как содержимое iframe Astranet. Меню Astranet и регистрация
вкладки находятся в другом репозитории и сюда не входят.

## Статус

- **Техническая готовность:** acquisition, standalone, локальный test-host,
  Astranet identity, гостевой режим, IDBFS, ограниченная account-save
  синхронизация, тесты и Docker реализованы.
- **Интеграция с Astranet:** настоящий production web-client ещё должен открыть
  опубликованный URL и подтвердить origin/headers/focus/fullscreen. Локальный
  test-host не заменяет эту проверку.
- **Лицензии:** upstream notices сохранены, но перед production-публикацией
  нужна отдельная юридическая проверка ресурсов и актуальных правил Touhou.
  Этот README не является юридическим заключением.

## Почему self-hosted

`https://play.taisei-project.org/` отвечает `X-Frame-Options: sameorigin`,
поэтому cross-origin iframe Astranet его блокирует. Runtime загружается только
на этапе подготовки с официального GitHub Release; запущенная игра не зависит
от `play.taisei-project.org`.

Зафиксирован официальный релиз:

| Поле | Значение |
| --- | --- |
| Версия | `v1.4.6` |
| Asset | `Taisei-1.4.6-emscripten-wasm32.tar.xz` |
| Размер | `200035100` байт (около 191 MiB) |
| SHA-256 | `a6b742b6db2dd835f8cf199b4fa4e6a213eb09e68e50e89dd55a5254a39298af` |

Скрипт принимает только точный официальный release URL, показывает прогресс,
пишет во временный `.part`, проверяет размер и SHA-256 и лишь затем атомарно
публикует архив. Другая версия автоматически не выбирается.

## Подтверждённая структура upstream

Анализ официального архива v1.4.6 и исходников tag commit
`5bfc9b842fe6d9bb8d1610f76f442ba07c72c4cf` установил:

- launcher: `taisei.html`;
- Emscripten glue: `taisei.js`;
- WebAssembly: `taisei.wasm`;
- ресурсы: 531 content-addressed файл в `data/`;
- upstream license/disclaimer: `COPYING.txt`;
- IDBFS mount: `/persistent`;
- storage: `/persistent/storage`;
- cache: `/persistent/cache`, fetch cache: `/persistent/res-cache`;
- настройки: `/persistent/storage/config`;
- прогресс: `/persistent/storage/progress.zst` (legacy reader также знает
  `progress.dat`);
- replay: `/persistent/storage/replays/*.tsr`;
- screenshots: `/persistent/storage/screenshots/*.png`.

Upstream `emscripten/preamble.js` вызывает `FS.syncfs()`. C-код вызывает load
при VFS startup и store при входе в event loop, commit данных, сохранении replay
и shutdown. Оболочка дополнительно сериализует все syncfs-вызовы, восстанавливает
account-save до `callMain()` и синхронизирует при скрытии и по изменениям.

## Архитектура

```text
scripts/            pin, download, checksum, extraction, runtime validation
runtime/upstream/   официальный runtime после npm run prepare (Git ignored)
web/shell/          capability checks, Emscripten boot, identity, save adapter
web/test-host/      локальный parent iframe и identity.response
server/             node:http + node:sqlite, API и streaming static files
tests/              node:test и реальный Playwright/Chromium smoke
THIRD_PARTY/        копия upstream copyright/license/asset attribution
```

Taisei не переписан и `taisei.js` не модифицируется. Phaser, PixiJS, React и
runtime npm-зависимости не добавлены.

## Требования и подготовка

- Node.js 24;
- npm;
- распаковщик `.tar.xz`: `tar` с xz на Linux/macOS либо 7-Zip на Windows;
- для e2e — Chromium, устанавливаемый Playwright.

```bash
cd games/taisei
npm ci
npm run prepare
npm run check
npm test
npm start
```

`npm run prepare` скачает около 191 MiB при первом запуске. Повторный запуск
не скачивает архив, если кеш имеет правильные размер и SHA-256.

После старта сервер печатает standalone URL, test-host URL, каталог SQLite,
версию runtime и активный `frame-ancestors`. Bearer-токены не печатаются.

## Локальная проверка

- Standalone: `http://127.0.0.1:8098/` — через 3 секунды без parent bridge
  используется гостевой UUID из `localStorage`.
- Test host: `http://127.0.0.1:8098/test-host/` — iframe получает фиксированный
  development identity. Значение токена не показывается.

Test-host показывает события загрузки/request/response/reload, разрешает
fullscreen, перезагружает iframe и открывает standalone в новой вкладке.
Клавиатурный фокус переводится на canvas кликом или кнопкой **Focus game**.

## Identity

Запрос и ответ соответствуют `docs/web-tab-sdk.md`. Оболочка проверяет форму,
correlation id, `event.source === window.parent`, точный origin и 22-символьный
base64url token. Listener удаляется после ответа или таймаута.

Разрешённый parent origin задаётся `ASTRANET_PARENT_ORIGIN`. Без него безопасный
default — текущий same-origin, достаточный для `/test-host/`. Неизвестный
cross-origin parent не получает доверия: identity завершается таймаутом и игра
переходит в guest mode.

Backend принимает только:

```text
X-Player: astra <22-char pairwise token>
X-Player: guest <UUID>
```

SQLite хранит только `sha256(salt + "|" + kind + ":" + bearer)` и тип.
Соль создаётся один раз в `meta`. Raw token не входит в URL, UI, IndexedDB,
localStorage, SQLite или логи.

## Сохранения

Локально официальный Taisei сохраняет весь `/persistent` через IDBFS/IndexedDB:
настройки, прогресс, replay, screenshots и кеши.

На сервер отправляется строгий allowlist:

| Путь относительно `/persistent/storage` | Лимит | Назначение |
| --- | ---: | --- |
| `config` | 64 KiB | настройки и key bindings |
| `progress.zst` | 1 MiB | unlocks, high scores, прохождения |

Payload имеет `schemaVersion: 1`, общий лимит 1.1 MiB и request limit 1.6 MB.
Пути, дубли, абсолютные имена, `..`, обратные слеши и неверный base64
отклоняются. Сжатие сервером не применяется, поэтому zip-bomb поверхности нет.

Каждый save имеет revision и ETag. PUT с устаревшей `baseRevision` получает
409. Повтор идентичного payload идемпотентен. При конфликте или повреждённом
ответе локальная IDBFS-копия не удаляется; UI показывает предупреждение, а
автоматический upload останавливается до reload/разрешения конфликта.

### Replay

Replay `*.tsr` остаются только в локальном IndexedDB. Upstream не задаёт им
жёсткий суммарный лимит, поэтому первая версия не включает их в account blob.
Перенос replay между браузерами **не заявляется**. Турнирной таблицы и
серверной валидации результатов также нет: browser save не является античитом.

## API

| Метод | Endpoint | Результат |
| --- | --- | --- |
| `GET` | `/healthz` | здоровье и runtime version |
| `POST` | `/api/hello` | identity mode и save revision |
| `GET` | `/api/save` | revisioned allowlisted payload |
| `PUT` | `/api/save` | idempotent revision-checked write |

Все `/api/*` требуют `X-Player`, имеют rate limit и `Cache-Control: no-store`.

## HTTP и iframe

- `.wasm` → `application/wasm`;
- CSP `script-src` разрешает только same-origin scripts и узкий
  `'wasm-unsafe-eval'` для компиляции WebAssembly (не JavaScript `eval`);
- `X-Content-Type-Options: nosniff`;
- HTML/test-host → `Cache-Control: no-cache`;
- content-addressed `data/<sha256>` → immutable один год;
- unversioned `taisei.js`/`taisei.wasm` → один день;
- GET/HEAD и streaming Range (`206`/`416`) без чтения больших файлов в память;
- нет `X-Frame-Options: SAMEORIGIN`;
- default CSP: `frame-ancestors 'self'`;
- COOP/COEP не включены: v1.4.6 build single-threaded и не использует
  `SharedArrayBuffer`.

Production example с условным, а не выдуманным origin:

```bash
FRAME_ANCESTORS="'self' https://actual-astranet-origin.example" \
ASTRANET_PARENT_ORIGIN="https://actual-astranet-origin.example" \
DATA_DIR=/data PORT=8098 node server/server.js
```

Фактический origin должен предоставить владелец основного web-client. Также
нужно проверить, что reverse proxy/CDN не добавляет конфликтующий X-Frame-Options.

## Тесты

```bash
npm run check
npm test
npx playwright install chromium
npm run test:e2e
```

`npm test` проверяет auth, SQLite, отсутствие raw token, empty/read/write save,
idempotency, 409, 413, allowlist, traversal, HEAD, Range, MIME, cache и CSP.
`npm run test:e2e` требует подготовленный реальный runtime и ждёт не просто
canvas, а `onFirstFrame`: проверяет WASM/WebGL 2, guest fallback, focus, IDBFS
reload, iframe identity/reload, server restore в новом browser context и
безопасный отказ fullscreen.

## Docker

```bash
docker build -t astranet-taisei games/taisei
docker run --rm -p 127.0.0.1:8098:8098 -v taisei-test-data:/data astranet-taisei
curl http://127.0.0.1:8098/healthz
```

Build stage загружает и проверяет тот же v1.4.6. Финальный Node 24 Alpine image
работает как `node`, не содержит release archive/npm cache/extraction tools.
SQLite лежит в `/data/taisei.db` и сопровождается WAL-файлами на том же volume.

## Очистка, обновление и откат

Очистить только генерируемый runtime/cache:

```powershell
Remove-Item -Recurse -Force .cache, runtime/upstream
npm run prepare
```

```bash
rm -rf .cache runtime/upstream
npm run prepare
```

Для обновления Taisei отдельно меняются version, asset name, byte size и
SHA-256 в `scripts/upstream.mjs`; затем проверяются структура архива, upstream
save paths, `syncfs`, лицензии, browser smoke и Docker. Автоматического latest
нет. Для отката возвращается предыдущий pin и заново готовится runtime; SQLite
не откатывается автоматически, поэтому schema compatibility проверяется до
production rollback.

## Лицензии

Копия точного `COPYING.txt` v1.4.6 лежит в
`THIRD_PARTY/Taisei-COPYING.txt` и также сохраняется/раздаётся внутри runtime.
Taisei — неофициальная fan-made игра по Touhou Project. Upstream указывает:

- код — MIT;
- soundtrack Tuck V — CC BY 4.0;
- portraits afensorm — CC BY 4.0;
- дополнительные public-domain/CC0 credits и disclaimer — в `COPYING.txt`.

MIT-лицензия Astranet Games не объявляется лицензией на upstream assets.
Перед production нужны актуальная проверка
[Touhou derivative-work guidelines](https://touhou-project.news/guidelines_en/)
и юридическое подтверждение публикации конкретного release asset.

## Не входит в задачу

- меню/реестр вкладок и deployment основного Astranet;
- Android WebView, iOS WKWebView и touch controls;
- изменение движка или generated `taisei.js`;
- leaderboard/античит;
- server replay sync и screenshots;
- DNS, production URL, TLS/CDN/reverse-proxy configuration.
