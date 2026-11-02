import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export class LocalBridge {
  readonly token = randomBytes(32).toString('hex');
  private server?: Server;
  port = 0;

  constructor(private readState: () => Promise<unknown>, private act: (action: unknown) => Promise<void>) {}

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => { void this.handle(req, res); });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.keepAliveTimeout = 1000;
    this.server = server;
    try { await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    }); } catch (error) { this.server = undefined; server.close(); throw error; }
    this.port = (server.address() as { port: number }).port;
  }

  close(): void {
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (code: number, value: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    const expected = Buffer.from(`Bearer ${this.token}`);
    const actual = Buffer.from(req.headers.authorization ?? '');
    // Native URLSession only: reject web pages, including same-machine DNS rebinding.
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || req.headers.origin || req.headers.host !== `127.0.0.1:${this.port}`) {
      send(403, { ok: false, error: 'Forbidden' });
      return;
    }
    try {
      if (req.method === 'GET' && req.url === '/state') { send(200, await this.readState()); return; }
      if (req.method !== 'POST' || req.url !== '/action') { send(404, { ok: false, error: 'Not found' }); return; }
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) { send(415, { ok: false, error: 'Expected JSON' }); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 32_768) { send(413, { ok: false, error: '请求过长' }); return; }
        chunks.push(Buffer.from(chunk));
      }
      // Buffer complete bytes before UTF-8 decoding (chunk boundaries can split Chinese).
      await this.act(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      send(200, { ok: true });
    } catch (error) {
      send(409, { ok: false, error: error instanceof Error ? error.message : '操作失败' });
    }
  }
}
