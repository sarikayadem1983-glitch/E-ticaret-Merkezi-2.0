import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';
import request from 'supertest';
import { Public } from './../src/auth/decorators.js';
import { RequestContext } from './../src/common/request-context.js';
import { createTestApp } from './helpers.js';

/** Test-only routes: echo what the server believes about the client. */
@Public()
@Controller('__test')
class ProbeController {
  @Get('client')
  client(@Req() req: Request) {
    return {
      ip: req.ip,
      secure: req.secure,
      auditIp: RequestContext.get().ipAddress,
    };
  }

  @Post('echo')
  echo(@Body() body: unknown) {
    return { size: JSON.stringify(body).length };
  }

  @Get('boom')
  boom() {
    throw new Error('connection string postgres://secret@db leaked');
  }
}

const LOCAL = /^(::ffff:)?127\.0\.0\.1$|^::1$/;

async function withApp(
  env: Record<string, string>,
  fn: (http: () => request.Agent) => Promise<void>,
) {
  const app: NestExpressApplication = await createTestApp(env, {
    controllers: [ProbeController],
  });
  try {
    await fn(() => request.agent(app.getHttpServer()));
  } finally {
    await app.close();
  }
}

describe('HTTP security (e2e)', () => {
  describe('client IP and trusted proxies', () => {
    it('ignores X-Forwarded-For when no proxy is trusted', () =>
      withApp({}, async (http) => {
        const res = await http()
          .get('/api/v1/__test/client')
          .set('X-Forwarded-For', '203.0.113.9')
          .expect(200);
        expect(res.body.ip).toMatch(LOCAL);
        expect(res.body.auditIp).toMatch(LOCAL);
      }));

    it('uses X-Forwarded-For from a trusted proxy', () =>
      withApp({ TRUST_PROXY: 'loopback' }, async (http) => {
        const res = await http()
          .get('/api/v1/__test/client')
          .set('X-Forwarded-For', '203.0.113.9')
          .expect(200);
        expect(res.body.ip).toBe('203.0.113.9');
        expect(res.body.auditIp).toBe('203.0.113.9');
      }));

    it('ignores the header when the peer is not in the trusted list', () =>
      withApp({ TRUST_PROXY: '10.0.0.0/8' }, async (http) => {
        const res = await http()
          .get('/api/v1/__test/client')
          .set('X-Forwarded-For', '203.0.113.9')
          .expect(200);
        expect(res.body.ip).toMatch(LOCAL);
      }));

    it('a client cannot spoof its IP by prepending to the chain', () =>
      withApp({ TRUST_PROXY: 'loopback' }, async (http) => {
        // Client sent "1.1.1.1"; the trusted proxy appended the real client 203.0.113.9.
        const res = await http()
          .get('/api/v1/__test/client')
          .set('X-Forwarded-For', '1.1.1.1, 203.0.113.9')
          .expect(200);
        expect(res.body.ip).toBe('203.0.113.9');
      }));

    it('refuses to start with an unsafe TRUST_PROXY', async () => {
      await expect(createTestApp({ TRUST_PROXY: 'true' })).rejects.toThrow(
        /TRUST_PROXY/,
      );
    });
  });

  describe('HTTPS enforcement', () => {
    const https = { ENFORCE_HTTPS: 'true' };

    it('rejects plain HTTP with 426', () =>
      withApp(https, async (http) => {
        const res = await http().get('/api/v1/__test/client').expect(426);
        expect(res.body.error.code).toBe('HTTPS_REQUIRED');
      }));

    it('accepts HTTPS terminated at a trusted proxy', () =>
      withApp({ ...https, TRUST_PROXY: 'loopback' }, async (http) => {
        const res = await http()
          .get('/api/v1/__test/client')
          .set('X-Forwarded-Proto', 'https')
          .expect(200);
        expect(res.body.secure).toBe(true);
      }));

    it('ignores a spoofed X-Forwarded-Proto from an untrusted peer', () =>
      withApp(https, async (http) => {
        await http()
          .get('/api/v1/__test/client')
          .set('X-Forwarded-Proto', 'https')
          .expect(426);
      }));

    it('keeps the health probe reachable over HTTP', () =>
      withApp(https, async (http) => {
        await http().get('/api/v1/health').expect(200);
      }));
  });

  describe('headers', () => {
    it('sets security headers and hides the framework', () =>
      withApp({}, async (http) => {
        const res = await http().get('/api/v1/health').expect(200);
        expect(res.headers['x-powered-by']).toBeUndefined();
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(res.headers['content-security-policy']).toBe(
          "default-src 'none';frame-ancestors 'none'",
        );
        expect(res.headers['referrer-policy']).toBe('no-referrer');
        expect(res.headers['strict-transport-security']).toBeUndefined();
      }));

    it('sends HSTS in production', () =>
      withApp(
        {
          NODE_ENV: 'production',
          TRUST_PROXY: 'loopback',
          CORS_ORIGINS: 'https://panel.example.com',
        },
        async (http) => {
          const res = await http()
            .get('/api/v1/health')
            .set('X-Forwarded-Proto', 'https')
            .expect(200);
          expect(res.headers['strict-transport-security']).toBe(
            'max-age=31536000; includeSubDomains',
          );
        },
      ));
  });

  describe('CORS', () => {
    const env = { CORS_ORIGINS: 'https://panel.example.com' };

    it('allows a listed origin', () =>
      withApp(env, async (http) => {
        const res = await http()
          .options('/api/v1/auth/login')
          .set('Origin', 'https://panel.example.com')
          .set('Access-Control-Request-Method', 'POST')
          .expect(204);
        expect(res.headers['access-control-allow-origin']).toBe(
          'https://panel.example.com',
        );
        expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      }));

    it('does not allow an unlisted origin', () =>
      withApp(env, async (http) => {
        const res = await http()
          .options('/api/v1/auth/login')
          .set('Origin', 'https://evil.example.com')
          .set('Access-Control-Request-Method', 'POST');
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      }));
  });

  describe('request bodies', () => {
    it('rejects bodies over BODY_LIMIT with 413 in the standard format', () =>
      withApp({ BODY_LIMIT: '1kb' }, async (http) => {
        const res = await http()
          .post('/api/v1/__test/echo')
          .send({ data: 'x'.repeat(2048) })
          .expect(413);
        expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      }));

    it('accepts bodies under the limit', () =>
      withApp({ BODY_LIMIT: '1kb' }, async (http) => {
        await http()
          .post('/api/v1/__test/echo')
          .send({ data: 'x'.repeat(100) })
          .expect(201);
      }));

    it('returns 400 for malformed JSON without parser internals', () =>
      withApp({}, async (http) => {
        const res = await http()
          .post('/api/v1/__test/echo')
          .set('Content-Type', 'application/json')
          .send('{"broken":')
          .expect(400);
        expect(res.body.error).toEqual({
          code: 'BAD_REQUEST',
          message: 'İstek gövdesi geçerli JSON değil',
          details: [],
        });
      }));
  });

  describe('error disclosure', () => {
    it('never leaks internal error messages', () =>
      withApp({}, async (http) => {
        const res = await http().get('/api/v1/__test/boom').expect(500);
        expect(JSON.stringify(res.body)).not.toMatch(/postgres|secret|stack/);
        expect(res.body.error.code).toBe('INTERNAL_ERROR');
      }));

    it('hides internal error codes in production', () =>
      withApp(
        {
          NODE_ENV: 'production',
          TRUST_PROXY: 'loopback',
          CORS_ORIGINS: 'https://panel.example.com',
        },
        async (http) => {
          const res = await http()
            .get('/api/v1/__test/boom')
            .set('X-Forwarded-Proto', 'https')
            .expect(500);
          expect(res.body.error).toEqual({
            code: 'INTERNAL_ERROR',
            message: 'Sunucu hatası',
            details: [],
          });
        },
      ));
  });
});
