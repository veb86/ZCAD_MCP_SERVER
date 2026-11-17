# ZCAD MCP Server

Независимый TypeScript-мост: **MCP-клиент → MCP Server → HTTP Adapter →
HTTPServer ZCAD → ZCAD**. Использует официальный
[MCP TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk)
как npm-зависимости (`@modelcontextprotocol/server`, `@modelcontextprotocol/node`;
`@modelcontextprotocol/client` для тестов). Код SDK и ZCAD не копируется и не изменяется.

Поддерживает stdio и Streamable HTTP, MCP initialize handshake 2025 года
и согласование протокола SDK v2. Конкретная версия Kimi должна поддерживать
выбранный MCP-транспорт; установка Kimi для работы сервера не требуется.

## Установка и запуск

Требуется Node.js **22+**, npm и отдельно установленный ZCAD с HTTPServer.

```bash
npm ci
npm run build
# В командной строке ZCAD: HTTPStart 127.0.0.1 5000
node dist/cli.js
```

Default — stdio: клиент запускает процесс и общается через stdin/stdout.
Конфигурация для MCP-клиента, поддерживающего такой формат:

```json
{
  "mcpServers": {
    "zcad": {
      "command": "node",
      "args": ["/absolute/path/ZCAD_MCP_SERVER/dist/cli.js"],
      "env": { "ZCAD_HTTP_URL": "http://127.0.0.1:5000" }
    }
  }
}
```

Используйте абсолютный путь: cwd клиента может отличаться. Не используйте
`npm start` как stdio-команду клиента: служебный вывод npm может попасть
в протокольный stdout. Сам сервер пишет диагностику только в stderr.
Закрытие stdin (EOF) закрывает соединения и отменяет HTTP-запросы на всех
платформах. В Linux/macOS это также делают обработчики SIGINT/SIGTERM.
В Windows вызов Node.js `child.kill('SIGTERM')` принудительно завершает процесс
без вызова JavaScript-обработчика; для штатной остановки stdio закройте stdin.
Остановка MCP не останавливает ZCAD.

Streamable HTTP:

```bash
MCP_TRANSPORT=streamable-http MCP_HTTP_PORT=3000 node dist/cli.js
```

URL клиента: `http://127.0.0.1:3000/mcp`. Каждый запрос получает отдельный
экземпляр SDK сервера (stateless); несколько клиентов могут работать параллельно.
Legacy session GET/DELETE не поддерживаются (405). Listener ограничен loopback;
Host/Origin проверяются официальным Node adapter. Для удалённого доступа
нужен отдельно защищённый proxy; собственного remote auth в приложении нет.

## Конфигурация без перекомпиляции

Скопируйте `config.example.json` в `config.local.json`, задайте
`ZCAD_MCP_CONFIG=/absolute/path/config.local.json`. Приоритет:
**defaults < JSON-файл < env**; применяется при следующем запуске.
Неизвестные поля, неверные URL/headers/числа/transport останавливают запуск.
CLI не печатает значения секретов при ошибке конфигурации.

| JSON-поле | Env | Default |
| --- | --- | --- |
| — | `ZCAD_MCP_CONFIG` | нет файла |
| `zcad.baseUrl` | `ZCAD_HTTP_URL` | `http://127.0.0.1:5000`, адрес и порт ZCAD |
| `zcad.timeoutMs` | `ZCAD_HTTP_TIMEOUT_MS` | 35000, весь запрос вместе с телом |
| `zcad.maxResponseBytes` | `ZCAD_HTTP_MAX_RESPONSE_BYTES` | 8388608 (8 МиБ) |
| `zcad.maxRequestBytes` | `ZCAD_HTTP_MAX_REQUEST_BYTES` | 1048576 (1 МиБ) |
| `zcad.headers` | `ZCAD_HTTP_HEADERS` | `{}`, JSON-объект строковых headers |
| `zcad.token` | `ZCAD_HTTP_TOKEN` | отсутствует, поле token в POST-конверте |
| `zcad.allowedCommands` | `ZCAD_ALLOWED_COMMANDS` | любые имена; `[]` запрещает все |
| `mcp.transport` | `MCP_TRANSPORT` | `stdio` или `streamable-http` |
| `mcp.host` | `MCP_HTTP_HOST` | `127.0.0.1`, также `localhost` / `::1` |
| `mcp.port` | `MCP_HTTP_PORT` | 3000; 0 выбирает свободный порт |
| `mcp.maxRequestBytes` | `MCP_MAX_REQUEST_BYTES` | 1048576, входной MCP HTTP-запрос |
| `mcp.shutdownTimeoutMs` | `MCP_SHUTDOWN_TIMEOUT_MS` | 5000, затем закрыть HTTP sockets |
| `debug` | `ZCAD_MCP_DEBUG` | `false`, допустимо `true` / `false` |

URL — HTTP(S) origin без пути/query/credentials. Для auth-proxy доступен
`ZCAD_HTTP_HEADERS='{"Authorization":"Bearer ..."}'`. Проверка TLS включена.
Redirects не выполняются; команды автоматически не повторяются. Debug показывает
метод, маршрут, статус, bytes и длительность без query/headers/body.

**Проверенный HTTPServer ZCAD не проверяет token.** Не считайте его авторизацией;
см. [анализ исходников](docs/httpserver-analysis.md).

## Инструменты

| Tool | Параметры | Действие |
| --- | --- | --- |
| `zcad_health` | `{}` | `GET /ipc`: только HTTP availability, без проверки drawing/queue |
| `zcad_execute` | `{"command":"PING","args":[]}` | `POST /ipc`: новый UUID, команда и позиционные JSON args |

Имена команд uppercase: LINE/CIRCLE/INSERT_DEV и другие, если зарегистрированы
в вашей сборке. Default args `[]`; вложенные JSON arrays/objects передаются
точно. Пример `{"command":"LINE","args":[0,0,100,100]}` исполняется в ZCAD;
геометрия в мосте не создаётся. При необходимости задайте allowlist:
`ZCAD_ALLOWED_COMMANDS='["PING","LINE","CIRCLE"]'`.

Результат — конверт ZCAD в текстовом JSON и `structuredContent`.
`status:"error"` даёт MCP `isError:true` даже при HTTP 200. Транспортные ошибки:
`error:{code,message,httpStatus?}`, коды `CONNECTION_ERROR`, `TIMEOUT`, `CANCELLED`,
`HTTP_ERROR`, `INVALID_RESPONSE`, `REQUEST_TOO_LARGE`, `RESPONSE_TOO_LARGE`,
`COMMAND_NOT_ALLOWED`. Аргументы/неизвестный tool проверяет SDK.

**Timeout/cancel не доказывает отмену CAD-команды:** ZCAD может исполнить её
позже. Проверьте drawing до повтора mutation. Мост не обещает наличие PING
или других handlers в конкретной сборке. Не все модули подключены;
ARC/POLYLINE — upstream stubs.

HTTP chunks читаются с контролем размера, включая ответы без Content-Length.
JSON собирается в памяти в заданном пределе; повышайте лимит по необходимости
с учётом памяти. `/ipc` не имеет пагинации, мост её не имитирует и не запрашивает
весь drawing без необходимости.

## Проверка взаимодействия

```bash
npm run verify
```

TypeScript build и конечные последовательные Node tests проверяют SDK client →
MCP (оба транспорта/режима протокола) → adapter → локальный **HTTP fixture** →
ответ. Проверяются args/UUID/token, concurrency, расширение tools, connection
refusal, HTTP 500, invalid JSON/UTF-8/envelope/ID, header/body timeout, chunked
ответы/bounds, cancel/shutdown. Это не тест GUI ZCAD. `npm test` использует
уже собранный dist; после изменения TypeScript запускайте `npm run verify`.

Lifecycle-тест отдельно проверяет EOF, SIGTERM и ошибочную конфигурацию.
Для EOF ожидаются код `0` и отсутствие сигнала на всех платформах; для
SIGTERM — то же в Linux/macOS, а в Windows — код `null` и сигнал `SIGTERM`,
как описано в [документации Node.js](https://nodejs.org/download/release/v24.13.1/docs/api/process.html#signal-events).
Прежнее ожидание кода `0` после `child.kill('SIGTERM')` вызывало ложную ошибку
`null !== 0` в `npm run verify` на Windows.

Сценарий для **живого ZCAD**, запускаемого владельцем:

```bash
# HTTPStart 127.0.0.1 5000 в ZCAD
ZCAD_HTTP_URL=http://127.0.0.1:5000 npm run smoke -- --health-only
# Полный сценарий, если в сборке зарегистрирован PING:
ZCAD_HTTP_URL=http://127.0.0.1:5000 npm run smoke
# Или через уже запущенный MCP HTTP server:
MCP_SMOKE_URL=http://127.0.0.1:3000/mcp npm run smoke
```

SDK client подключается, получает tools, вызывает health, затем PING,
проверяет pong, закрывает соединение. Connection error: проверить HTTPStart,
URL/порт/firewall. Timeout: GUI/queue и неопределённый исход. Unknown command
PING: handler отсутствует. Для диагностики `ZCAD_MCP_DEBUG=true`.

**Live-приёмка не выполнена:** в среде разработки нет запущенного ZCAD, а
в проверенной upstream конфигурации PING не подключён. Подготовлено
[отдельное ТЗ на согласование](docs/httpserver-spec.md). До утверждения
HTTPServer не изменяется. Fixture tests не закрывают приёмку с настоящим ZCAD.

## Структура и расширение

```text
src/config.ts        JSON/env и validation
src/http-adapter.ts  JSON HTTP transport, bounds/deadline/cancel
src/zcad-client.ts   существующий /ipc контракт
src/tools.ts         MCP schemas/registration/errors
src/server.ts        SDK factory и список registrars
src/application.ts   transport/listener/lifecycle
src/cli.ts           entry point/signals/stderr
tests/               автоматические проверки
examples/smoke.mjs   SDK client для живого ZCAD
docs/                анализ HTTPServer и отдельное ТЗ
```

Добавьте `ToolRegistrar` в tools.ts или отдельном модуле и включите в список
`createMcpServer`, используя существующие registrars как пример. Известные
HTTP routes добавляются в `ZcadClient`; adapter/transports не меняются.
Команды, геометрия, очередь и drawing logic остаются в ZCAD.
