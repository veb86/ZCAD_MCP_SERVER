import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { HttpAdapter } from '../dist/http-adapter.js';
import { ZcadClient } from '../dist/zcad-client.js';
import { createMcpServer } from '../dist/server.js';
import { startApplication } from '../dist/application.js';
import { config, fixture, json, body, connect, data } from './helpers.mjs';

for (const transport of ['stdio', 'streamable-http']) {
  for (const mode of ['legacy', 'auto']) {
    test(`${transport} (${mode}): SDK client lists tools and calls HTTP health and command`, { timeout: 6000 }, async (t) => {
      const received = [];
      const url = await fixture(t, async (req, res) => {
        assert.equal(req.url, '/ipc');
        if (req.method === 'GET') return json(res, { status: 'ok', message: 'ZCAD HTTP server is available' });
        const command = await body(req);
        received.push(command);
        assert.equal(command.cmd, 'PING');
        assert.equal(command.token, 'test-token');
        json(res, { id: command.id, status: 'ok', result: 'pong' });
      });
      let client;
      if (transport === 'stdio') {
        client = new Client({ name: 'test-client', version: '1.0.0' }, { versionNegotiation: { mode } });
        const channel = new StdioClientTransport({ command: process.execPath, args: ['dist/cli.js'], env: { ...process.env, MCP_TRANSPORT: 'stdio', ZCAD_HTTP_URL: url, ZCAD_HTTP_TOKEN: 'test-token', ZCAD_MCP_DEBUG: 'true' }, stderr: 'pipe' });
        const logs = [];
        channel.stderr.on('data', (chunk) => logs.push(chunk.toString()));
        t.after(() => client.close());
        t.after(() => assert.doesNotMatch(logs.join(''), /test-token/));
        await client.connect(channel, { timeout: 2000 });
      } else {
        ({ client } = await connect(t, config(url, { zcad: { token: 'test-token' } }), mode));
      }
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name), ['zcad_health', 'zcad_execute']);
      assert.equal(data(await client.callTool({ name: 'zcad_health', arguments: {} })).status, 'ok');
      const args = [1, 'Привет 🙂', { nested: ['value'] }];
      const result = await client.callTool({ name: 'zcad_execute', arguments: { command: 'PING', args } });
      assert.equal(result.isError, undefined);
      assert.equal(data(result).result, 'pong');
      assert.match(received[0].id, /^[a-f0-9-]{36}$/);
      assert.deepEqual(received[0].args, args);
    });
  }
}

test('MCP errors include malformed envelopes, ZCAD failures, deadlines and HTTP errors', { timeout: 6000 }, async (t) => {
  let respond = (_req, res) => json(res, { status: 'ok' });
  const url = await fixture(t, (req, res) => respond(req, res));
  const { client } = await connect(t, config(url, { zcad: { timeoutMs: 80 } }));
  const execute = () => client.callTool({ name: 'zcad_execute', arguments: { command: 'PING' } });
  for (const value of [null, [], {}, { status: 'ok', id: 'wrong', result: 'pong' }, { status: 'ok', id: '', result: 1 }]) {
    respond = (_req, res) => json(res, value);
    const result = await execute();
    assert.equal(result.isError, true);
    assert.equal(data(result).error.code, 'INVALID_RESPONSE');
  }
  respond = async (req, res) => { const request = await body(req); json(res, { status: 'error', id: request.id, error: 'Command timeout' }); };
  assert.equal(data(await execute()).error, 'Command timeout');
  assert.equal((await execute()).isError, true);
  respond = (_req, res) => json(res, { id: '', status: 'error', error: 'HTTP IPC command queue is not initialized' });
  assert.equal((await execute()).isError, true);
  respond = (_req, res) => res.writeHead(500).end('oops');
  assert.deepEqual(data(await execute()).error, { code: 'HTTP_ERROR', message: 'HTTP server returned 500', httpStatus: 500 });
  respond = () => {};
  const timeout = await execute();
  assert.equal(data(timeout).error.code, 'TIMEOUT');
  assert.match(data(timeout).error.message, /Do not automatically retry/);
  respond = (_req, res) => json(res, { status: 'ok', message: 'ready' });
  assert.equal(data(await client.callTool({ name: 'zcad_health' })).status, 'ok');
});

test('invalid tool inputs and denied commands never reach ZCAD', { timeout: 3000 }, async (t) => {
  let requests = 0;
  const url = await fixture(t, (_req, res) => { requests++; json(res, {}); });
  const { client } = await connect(t, config(url, { zcad: { allowedCommands: ['PING'] } }));
  for (const args of [{ command: 'lowercase' }, { command: 'PING', args: {} }, { command: 'PING', unexpected: true }]) {
    // SDK revisions may surface validation as a tool error or JSON-RPC error.
    try {
      assert.equal((await client.callTool({ name: 'zcad_execute', arguments: args })).isError, true);
    } catch (error) { assert.match(error.message, /valid|argument|parameter/i); }
  }
  const denied = await client.callTool({ name: 'zcad_execute', arguments: { command: 'SAVE' } });
  assert.equal(data(denied).error.code, 'COMMAND_NOT_ALLOWED');
  assert.equal(requests, 0);
  await assert.rejects(client.callTool({ name: 'unknown_tool' }));
});

test('parallel SDK calls retain independent command IDs', { timeout: 3000 }, async (t) => {
  const ids = new Set();
  const url = await fixture(t, async (req, res) => {
    const command = await body(req);
    ids.add(command.id);
    json(res, { id: command.id, status: 'ok', result: String(command.args[0]) });
  });
  const { client } = await connect(t, config(url));
  const results = await Promise.all([1, 2, 3].map((i) => client.callTool({ name: 'zcad_execute', arguments: { command: 'PING', args: [i] } })));
  assert.equal(ids.size, 3);
  assert.deepEqual(results.map((r) => data(r).result), ['1', '2', '3']);
});

test('HTTP transport rejects wrong routes, untrusted hosts/origins and oversized bodies', { timeout: 3000 }, async (t) => {
  const url = await fixture(t);
  const app = await startApplication(config(url, { mcp: { maxRequestBytes: 128 } }));
  t.after(() => app.close());
  assert.equal((await fetch(app.url.replace('/mcp', '/wrong'))).status, 404);
  // Use node:http: fetch may replace the supplied Host with the URL's host.
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = request(app.url, { headers: { host: 'attacker.invalid' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await fetch(app.url, { headers: { origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await fetch(app.url, { method: 'POST', body: ' '.repeat(256), headers: { 'content-type': 'application/json' } })).status, 413);
  const malformed = await fetch(app.url, { method: 'POST', body: '{bad', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } });
  assert.equal(malformed.status, 400);
});

test('tool registry can be extended without changing transports', { timeout: 3000 }, async (t) => {
  const cfg = config('http://127.0.0.1:1');
  const adapter = new HttpAdapter(cfg.zcad);
  const server = createMcpServer(new ZcadClient(adapter, cfg.zcad), [(instance) => {
    instance.registerTool('custom', {}, async () => ({ content: [{ type: 'text', text: 'custom-result' }] }));
  }]);
  const client = new Client({ name: 'extension-test', version: '1' });
  const [serverChannel, clientChannel] = InMemoryTransport.createLinkedPair();
  t.after(async () => { adapter.close(); await client.close(); await server.close(); });
  await server.connect(serverChannel);
  await client.connect(clientChannel);
  assert.equal((await client.callTool({ name: 'custom' })).content[0].text, 'custom-result');
});

test('stdio lifecycle: EOF, SIGTERM and invalid configuration', { timeout: 5000 }, async (t) => {
  const children = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
    }
  });
  for (const signal of [undefined, 'SIGTERM']) {
    await t.test(signal ?? 'EOF', async () => {
      const child = spawn(process.execPath, ['dist/cli.js'], { env: { ...process.env, MCP_TRANSPORT: 'stdio' }, stdio: ['pipe', 'pipe', 'pipe'] });
      children.push(child);
      // Complete one request to prove startup before terminating.
      const response = once(child.stdout, 'data');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n');
      await response;
      const exited = once(child, 'exit');
      if (signal) child.kill(signal); else child.stdin.end();
      // Windows child.kill() forcibly terminates the process without running its
      // JavaScript signal handler. EOF remains a graceful stop on every platform.
      const expected = signal && process.platform === 'win32' ? [null, signal] : [0, null];
      assert.deepEqual(await exited, expected);
    });
  }
  await t.test('invalid configuration', async () => {
    const invalid = spawn(process.execPath, ['dist/cli.js'], { env: { ...process.env, MCP_TRANSPORT: 'invalid-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(invalid);
    let stderr = '';
    invalid.stderr.on('data', (chunk) => { stderr += chunk; });
    assert.deepEqual(await once(invalid, 'close'), [1, null]);
    assert.doesNotMatch(stderr, /invalid-secret/);
  });
});

test('MCP reports connection refusal as a tool error', { timeout: 3000 }, async (t) => {
  const { createServer } = await import('node:http');
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const unavailable = `http://127.0.0.1:${listener.address().port}`;
  await new Promise((resolve) => listener.close(resolve));
  const { client } = await connect(t, config(unavailable));
  const result = await client.callTool({ name: 'zcad_health' });
  assert.equal(result.isError, true);
  assert.equal(data(result).error.code, 'CONNECTION_ERROR');
});

test('HTTP shutdown aborts pending upstream work and is idempotent', { timeout: 3000 }, async (t) => {
  let accepted;
  const requestArrived = new Promise((resolve) => { accepted = resolve; });
  const url = await fixture(t, () => accepted());
  const { client, app } = await connect(t, config(url));
  const pending = client.callTool({ name: 'zcad_health' }).catch(() => undefined);
  await requestArrived;
  await Promise.all([app.close(), app.close()]);
  await pending;
  await assert.rejects(fetch(app.url));
});
