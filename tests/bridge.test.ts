import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalBridge } from '../src/bridge.ts';

type Reply = { status: number; body: unknown; headers: Record<string, unknown> };
async function call(bridge: LocalBridge, options: {
  path?: string; method?: string; token?: string; host?: string; origin?: string;
  contentType?: string; body?: string | Buffer; chunks?: Buffer[];
} = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Host: options.host ?? `127.0.0.1:${bridge.port}`,
      Authorization: `Bearer ${options.token ?? bridge.token}`,
    };
    if (options.origin !== undefined) headers.Origin = options.origin;
    if (options.body !== undefined || options.chunks) headers['Content-Type'] = options.contentType ?? 'application/json';
    const req = request({ hostname: '127.0.0.1', port: bridge.port, path: options.path ?? '/state', method: options.method ?? 'GET', headers }, res => {
      const parts: Buffer[] = [];
      res.on('data', part => parts.push(part));
      res.on('error', reject);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(parts).toString('utf8')), headers: res.headers }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    void (async () => {
      if (options.chunks) {
        req.flushHeaders();
        for (const chunk of options.chunks) { req.write(chunk); await delay(8); }
        req.end();
      } else req.end(options.body);
    })().catch(reject);
  });
}

test('authenticated loopback state/action bridge returns no-store JSON', async t => {
  const actions: unknown[] = [];
  const bridge = new LocalBridge(async () => ({ tasks: ['今日'] }), async action => { actions.push(action); });
  await bridge.start();
  t.after(() => bridge.close());
  const port = bridge.port;
  await bridge.start();
  assert.equal(bridge.port, port);
  const state = await call(bridge);
  assert.equal(state.status, 200);
  assert.deepEqual(state.body, { tasks: ['今日'] });
  assert.equal(state.headers['cache-control'], 'no-store');
  assert.match(String(state.headers['content-type']), /application\/json.*utf-8/);
  const action = await call(bridge, { method: 'POST', path: '/action', body: JSON.stringify({ type: 'add', text: '中文待办' }) });
  assert.equal(action.status, 200);
  assert.deepEqual(actions, [{ type: 'add', text: '中文待办' }]);
});

test('rejects wrong bearer token, any Origin, and non-loopback Host', async t => {
  let called = false;
  const bridge = new LocalBridge(async () => { called = true; return {}; }, async () => { called = true; });
  await bridge.start(); t.after(() => bridge.close());
  for (const options of [
    { token: 'wrong' }, { token: 'x'.repeat(64) }, { origin: 'https://example.com' },
    { origin: 'null' }, { host: `localhost:${bridge.port}` }, { host: `rebind.example:${bridge.port}` },
  ]) assert.equal((await call(bridge, options)).status, 403);
  assert.equal(called, false);
});

test('rejects unsupported routes, content types, invalid JSON, and oversized bodies', async t => {
  const actions: unknown[] = [];
  const bridge = new LocalBridge(async () => ({}), async action => { actions.push(action); });
  await bridge.start(); t.after(() => bridge.close());
  assert.equal((await call(bridge, { path: '/unknown' })).status, 404);
  assert.equal((await call(bridge, { method: 'GET', path: '/action' })).status, 404);
  assert.equal((await call(bridge, { method: 'POST', path: '/action', body: '{}', contentType: 'text/plain' })).status, 415);
  assert.equal((await call(bridge, { method: 'POST', path: '/action', body: '{broken' })).status, 409);
  assert.equal((await call(bridge, { method: 'POST', path: '/action', body: JSON.stringify({ text: 'x'.repeat(40_000) }) })).status, 413);
  assert.deepEqual(actions, []);
});

test('preserves Chinese characters split across incoming UTF-8 chunks', async t => {
  let received: unknown;
  const bridge = new LocalBridge(async () => ({}), async action => { received = action; });
  await bridge.start(); t.after(() => bridge.close());
  const body = Buffer.from(JSON.stringify({ type: 'add', text: '今天完成浮窗' }));
  const chinese = body.indexOf(Buffer.from('今'));
  // The first three-byte Chinese character is deliberately split over three writes.
  const chunks = [body.subarray(0, chinese + 1), body.subarray(chinese + 1, chinese + 2), body.subarray(chinese + 2)];
  const reply = await call(bridge, { method: 'POST', path: '/action', chunks });
  assert.equal(reply.status, 200);
  assert.deepEqual(received, { type: 'add', text: '今天完成浮窗' });
});

test('reports action failures without exposing a stack and remains usable', async t => {
  const bridge = new LocalBridge(async () => ({ ready: true }), async () => { throw new Error('日记发生冲突'); });
  await bridge.start(); t.after(() => bridge.close());
  const failed = await call(bridge, { method: 'POST', path: '/action', body: '{}' });
  assert.equal(failed.status, 409);
  assert.deepEqual(failed.body, { ok: false, error: '日记发生冲突' });
  assert.equal((await call(bridge)).status, 200);
});
