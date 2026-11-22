// Test only: terminates TLS in front of a local HTTP port, like the production proxy does.
//   node tls-proxy.mjs <key.pem> <cert.pem> <listen>:<target> [...]
// Binds and forwards to loopback only. X-Forwarded-* from the client is replaced, never passed on.
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:https';

const [keyFile, certFile, ...routes] = process.argv.slice(2);
const tls = { key: readFileSync(keyFile), cert: readFileSync(certFile) };

for (const route of routes) {
  const [listen, target] = route.split(':').map(Number);
  createServer(tls, (req, res) => {
    const headers = {
      ...req.headers,
      'x-forwarded-for': req.socket.remoteAddress,
      'x-forwarded-proto': 'https',
    };
    const upstream = request(
      { host: '127.0.0.1', port: target, method: req.method, path: req.url, headers },
      (r) => {
        res.writeHead(r.statusCode, r.rawHeaders);
        r.pipe(res);
      },
    );
    upstream.on('error', () => (res.headersSent ? res.destroy() : res.writeHead(502).end()));
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  }).listen(listen, 'localhost', () => console.log(`https://localhost:${listen} -> ${target}`));
}
