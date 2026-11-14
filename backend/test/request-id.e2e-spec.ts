import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './helpers.js';

describe('Request id (e2e, OPS-01)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('every response carries an X-Request-Id', async () => {
    const res = await http().get('/api/v1/health').expect(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps a safe caller id and replaces an unsafe one', async () => {
    const kept = await http()
      .get('/api/v1/health')
      .set('X-Request-Id', 'lb-req-0001')
      .expect(200);
    expect(kept.headers['x-request-id']).toBe('lb-req-0001');
    const replaced = await http()
      .get('/api/v1/health')
      .set('X-Request-Id', 'x"; DROP TABLE logs; --')
      .expect(200);
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('errors carry it too, without changing the error body shape', async () => {
    const res = await http().get('/api/v1/orders').expect(401);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(Object.keys(res.body)).toEqual(['error']);
  });
});
