# Verification evidence

## Issue #3: Windows lifecycle assertion

The report uses Windows 10 / Node.js 24.13.1. The original test treated EOF and
`child.kill('SIGTERM')` as normal zero-code exits. On Windows, Node terminates
the child forcibly and emits `exit` with `[null, 'SIGTERM']`; JavaScript signal
handlers do not run. The assertion at the original integration test line 162
therefore failed even though the process terminated as requested. See the
[Node 24.13.1 signal documentation](https://nodejs.org/download/release/v24.13.1/docs/api/process.html#signal-events).

The test now checks both code and signal, with individually named subtests:

| Stop condition | Linux/macOS expected `[code, signal]` | Windows expected `[code, signal]` |
| --- | --- | --- |
| stdin EOF | `[0, null]` | `[0, null]` |
| `child.kill('SIGTERM')` | `[0, null]` | `[null, 'SIGTERM']` |
| Invalid configuration | `[1, null]` | `[1, null]` |

All startup handshakes, failure cleanup, time bounds and secret-redaction
checks remain. The invalid-configuration test waits for `close` so stderr has
finished before checking it. Application/SDK code does not need a change.

Verification on Linux / Node 26.13.0, 2026-11-17:

- Original focused lifecycle test: passes on Linux, confirming the OS-specific
  expectation mismatch.
- Original test with the bounded Windows signal simulation: fails at line 162
  with `AssertionError`, actual `null`, expected `0`, reproducing the report.
- Fixed lifecycle test with the same simulation: all 3 subtests pass.
- `npm run verify`: TypeScript build and **30 tests pass**, 0 failures or skips
  (27 top-level tests, including the 3 named lifecycle subtests), ~6 seconds.
- No native Windows environment is available here. The simulation verifies the
  assertion against forced termination and the documented Windows exit tuple;
  it does not claim native Windows verification. No CI workflows/checks exist.

To reproduce on Windows, run `npm ci` and `npm run verify`. To exercise the
Windows assertion on Linux without additional runtimes, after building run:

```bash
node --import ./experiments/windows-sigterm.mjs --test --test-timeout=15000 --test-name-pattern='stdio lifecycle' tests/integration.test.mjs
```

The preloader affects only that test process: it forces SIGKILL instead of
SIGTERM, reports the requested SIGTERM in child exit events, and selects the
Windows expectation. The real CLI child still performs an MCP initialize
handshake before termination. Use EOF for graceful stdio shutdown on Windows.

## Original issue #1 verification

2026-11-17, Node v26.13.0 / npm 11.20.0, Linux. Commands run sequentially;
no ZCAD build or unbounded stress tests. Dependency install: 21 packages,
`npm install --no-fund`, audit reported zero vulnerabilities.

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Independent TypeScript + official SDK (§2, §3.1) | package/lock, strict tsconfig, src/server.ts | TypeScript build; SDK client tests |
| Lifecycle, clients, tools, params, results, MCP errors (§3.2) | src/application.ts, cli.ts, tools.ts | stdio/HTTP × legacy/auto handshake tests; EOF/SIGTERM, registry extension and input validation tests |
| Generic HTTP transport (§3.3) | src/http-adapter.ts | method/query/header/JSON forwarding; status, connection, deadline, cancellation, UTF-8/JSON and size tests |
| Large/chunked response handling (§3.3) | bounded reader, configurable request/response limits | 120 KB Unicode chunked response, byte splits, Content-Length and chunked overflow checks |
| Analysis and separate upstream spec (§4) | httpserver-analysis.md, httpserver-spec.md | Pinned source links, current route/queue/handler review; spec submitted in PR #2 for approval |
| External configuration (§5) | config.ts, config.example.json | defaults/file/env precedence; invalid URL/header/key/number/transport tests |
| Separation of responsibilities (§6) | ZcadClient translates /ipc, adapter only transports | exact nested args/UUID forwarding; no CAD algorithms, upstream files or unsupported routes |
| Fixture interaction and error scenarios (§7) | tests/*.test.mjs | `npm run verify`: build + **27 tests passed**, 0 failed, ~6 seconds |
| Real HTTPServer ZCAD receives/responds (§7.5) | examples/smoke.mjs | **UNFINISHED / BLOCKED** — see below |
| Installation/config/startup instructions (§8) | README.md | documented stdio/HTTP clients, env matrix, smoke and extension procedure |

## Reproduce automated verification

```bash
npm ci
npm run verify
```

The integration suite starts the actual compiled MCP process for stdio, or the
application listener for HTTP, connects the official SDK client, lists tools,
calls health and PING, and inspects the requests received by a local HTTP fixture.
It checks both default 2025-era handshake and SDK v2 auto-negotiation. The fixture
models the inspected `/ipc` contract; it is not a running ZCAD instance.

The first full test run had one test-only failure: fetch replaced a supplied
Host header, so the intended hostile header never reached the server. That
test now uses node:http and verifies the actual 403. Final suite: all pass.

## Live acceptance remains blocked

Executed `npm run smoke` with default target `http://127.0.0.1:5000`.
MCP connection and tool discovery completed, but `zcad_health` returned:

```json
{"status":"error","error":{"code":"CONNECTION_ERROR","message":"Cannot complete the HTTP request to the configured ZCAD server"}}
```

The scenario exited 1, as required on failure. No running ZCAD endpoint or
installed GUI build is available in this environment, and the upstream ZCAD
repository publishes no GitHub releases to download. Source inspection also
shows PING absent from the inspected build's module list and inconsistent
registration names in the standalone system module (see analysis).

Unfinished criterion: issue §7 step 5 and a successful full live round trip.
Resolving it requires a running ZCAD build exposing the inspected API. The
health-only scenario exercises the complete MCP → real HTTPServer round trip;
the additional command-execution scenario requires registered PING, or
separately approved upstream stage A followed by a live run.
No HTTPServer changes, command emulation or TCP/GUI fallback were introduced.

Live reproduction: start ZCAD, run `HTTPStart 127.0.0.1 5000`, then run
`ZCAD_HTTP_URL=http://127.0.0.1:5000 npm run smoke`. The health-only variant
(`npm run smoke -- --health-only`) checks availability without claiming PING works.

## CI

The upstream repository currently has no GitHub Actions workflows and no runs
on the PR branch. Checks must not be reported as passing CI. Automated checks
are provided locally via `npm run verify`; no CI/release workflow was added.
For owner consideration:
[CI/CD best practices](https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md).
