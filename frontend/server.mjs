// Entry point for dev and production. Next.js passes a client-supplied
// X-Forwarded-For through unchanged, so the real client address is decided
// here from the socket and the trusted proxy list, before Next.js sees the request.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import nextEnv from '@next/env';
import proxyaddr from 'proxy-addr';

const dev = process.argv.includes('--dev');
// Must be set before Next.js loads; `node server.mjs` without --dev is production.
process.env.NODE_ENV ??= dev ? 'development' : 'production';
const { default: next } = await import('next');
nextEnv.loadEnvConfig(resolve(import.meta.dirname, '..'), dev);
nextEnv.loadEnvConfig(import.meta.dirname, dev);

const production = process.env.NODE_ENV === 'production';
const port = Number.parseInt(process.env.FRONTEND_PORT ?? '3000', 10);

/** Same rules as the backend's TRUST_PROXY: explicit addresses only, never `true` or hop counts. */
function trustedProxies(value) {
  const entries = (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const entry of entries) {
    if (entry === 'true' || /^\d+$/.test(entry)) {
      throw new Error(
        `BFF_TRUST_PROXY='${entry}' güvenli değil; proxy IP/CIDR listesi veya loopback/linklocal/uniquelocal kullanın`,
      );
    }
  }
  return entries;
}

const trust = proxyaddr.compile(trustedProxies(process.env.BFF_TRUST_PROXY));

/** Headers a client must never be able to set; they are rebuilt below. */
const SPOOFABLE = [
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-real-ip',
  'forwarded',
  'x-tm-client-ip',
  'x-tm-proto',
];

const app = next({ dev });
const handle = app.getRequestHandler();
await app.prepare();

createServer((req, res) => {
  const clientIp = proxyaddr(req, trust);
  const fromTrustedProxy = trust(req.socket.remoteAddress ?? '', 0);
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim();
  const proto = req.socket.encrypted
    ? 'https'
    : fromTrustedProxy && forwardedProto === 'https'
      ? 'https'
      : 'http';

  for (const name of SPOOFABLE) delete req.headers[name];
  req.headers['x-tm-client-ip'] = clientIp;
  req.headers['x-tm-proto'] = proto;

  if (production) {
    if (proto !== 'https') {
      // Plain HTTP is never served in production: redirect reads, refuse writes.
      const host = req.headers.host ?? '';
      if (req.method === 'GET' || req.method === 'HEAD') {
        res.writeHead(308, { Location: `https://${host}${req.url ?? '/'}` });
      } else {
        res.writeHead(426, { 'Content-Type': 'application/json' });
        res.write(
          JSON.stringify({
            error: {
              code: 'HTTPS_REQUIRED',
              message: 'Bu uygulama yalnızca HTTPS üzerinden kullanılabilir',
              details: [],
            },
          }),
        );
      }
      res.end();
      return;
    }
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }

  handle(req, res);
}).listen(port, () => {
  console.log(
    `> Ticaret Merkezi frontend: http://localhost:${port} (${dev ? 'development' : process.env.NODE_ENV})`,
  );
});
