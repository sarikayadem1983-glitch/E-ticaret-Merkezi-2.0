import { AppLogger, logFormat } from './app-logger.js';
import { requestIdFrom } from './request-context.middleware.js';
import { RequestContext } from './request-context.js';

describe('AppLogger (OPS-01)', () => {
  const capture = () => {
    const lines: { line: string; level: string }[] = [];
    const logger = new AppLogger('json', (line, level) =>
      lines.push({ line, level }),
    );
    return { logger, lines, json: () => lines.map((l) => JSON.parse(l.line)) };
  };

  it('writes one JSON object per line with request id and user', () => {
    const { logger, json } = capture();
    RequestContext.enter({ requestId: 'req-12345678' }, () => {
      RequestContext.setUser('user-1');
      logger.log('Sipariş oluşturuldu', 'OrdersService');
    });
    expect(json()).toEqual([
      expect.objectContaining({
        level: 'log',
        context: 'OrdersService',
        msg: 'Sipariş oluşturuldu',
        requestId: 'req-12345678',
        userId: 'user-1',
        time: expect.any(String),
      }),
    ]);
  });

  it('masks secrets and personal data in messages, objects and stack traces', () => {
    const { logger, lines } = capture();
    const err = new Error(
      'login failed for ayse@example.com password=Hunter-22',
    );
    logger.error(err.message, err.stack, 'AuthService');
    logger.warn(
      { apiKey: 'ak-999', phone: '+90 532 123 45 67' },
      'ChannelsService',
    );
    const all = lines.map((l) => l.line).join('\n');
    for (const secret of ['ayse@', 'Hunter-22', 'ak-999', '532 123 45 67']) {
      expect(all).not.toContain(secret);
    }
    expect(lines[0].level).toBe('error');
    expect(JSON.parse(lines[0].line).stack).toBeDefined();
  });

  it('chooses JSON in production unless LOG_FORMAT says otherwise', () => {
    expect(logFormat({ NODE_ENV: 'production' })).toBe('json');
    expect(logFormat({ NODE_ENV: 'development' })).toBe('text');
    expect(logFormat({ NODE_ENV: 'production', LOG_FORMAT: 'text' })).toBe(
      'text',
    );
  });

  it('keeps a safe caller request id, replaces anything else', () => {
    expect(requestIdFrom('abc-12345')).toBe('abc-12345');
    for (const bad of [
      'short',
      'x'.repeat(65),
      'bad id with spaces',
      'a\nb-12345678',
      undefined,
    ]) {
      const id = requestIdFrom(bad);
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
