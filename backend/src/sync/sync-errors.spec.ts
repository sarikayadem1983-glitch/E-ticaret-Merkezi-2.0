import { ratePolicies } from './channel-rate-limiter.js';
import {
  classifyFailure,
  DEFAULT_RETRY_AFTER_MS,
  httpFailure,
  MAX_RETRY_AFTER_MS,
  parseRetryAfter,
  SyncError,
} from './sync-errors.js';
import { syncErrorMessage } from './sync.types.js';

describe('httpFailure', () => {
  it.each([
    [401, 'auth', 'CHANNEL_AUTH_FAILED'],
    [403, 'auth', 'CHANNEL_FORBIDDEN'],
    [400, 'permanent', 'CHANNEL_REJECTED_400'],
    [422, 'permanent', 'CHANNEL_REJECTED_422'],
    [408, 'transient', 'CHANNEL_TIMEOUT'],
    [500, 'transient', 'CHANNEL_HTTP_500'],
    [503, 'transient', 'CHANNEL_HTTP_503'],
    [429, 'rate_limited', 'CHANNEL_RATE_LIMITED'],
  ])('%i → %s (%s)', (status, kind, code) => {
    const error = httpFailure(status);
    expect(error.kind).toBe(kind);
    expect(error.code).toBe(code);
  });

  it('honours Retry-After seconds on 429 and falls back without it', () => {
    expect(httpFailure(429, '7').retryAfterMs).toBe(7000);
    expect(httpFailure(429, null).retryAfterMs).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(httpFailure(429, 'garbage').retryAfterMs).toBe(
      DEFAULT_RETRY_AFTER_MS,
    );
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');
  it('reads delta-seconds and HTTP dates, clamps to [0, max]', () => {
    expect(parseRetryAfter('0', now)).toBe(0);
    expect(parseRetryAfter('120', now)).toBe(120_000);
    expect(parseRetryAfter('Fri, 13 Nov 2026 10:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Fri, 13 Nov 2026 09:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('999999', now)).toBe(MAX_RETRY_AFTER_MS);
    expect(parseRetryAfter('', now)).toBeUndefined();
    expect(parseRetryAfter('-5', now)).toBeUndefined();
  });
});

describe('classifyFailure', () => {
  it('keeps SyncErrors, maps network codes to transient, unknown to transient', () => {
    const own = new SyncError('CHANNEL_FORBIDDEN', 'auth');
    expect(classifyFailure(own)).toBe(own);
    const net = Object.assign(new Error('connect ETIMEDOUT 1.2.3.4'), {
      code: 'ETIMEDOUT',
    });
    expect(classifyFailure(net)).toMatchObject({
      kind: 'transient',
      code: 'NETWORK_ETIMEDOUT',
    });
    expect(classifyFailure(new Error('apiSecret=abc leaked'))).toMatchObject({
      kind: 'transient',
      code: 'SYNC_UNEXPECTED_ERROR',
    });
  });

  it('never keeps a free-text message as the code', () => {
    const leaked = new SyncError('CHANNEL_REJECTED_apiSecret=abc', 'permanent');
    expect(leaked.code).toBe('SYNC_ERROR');
    expect(classifyFailure(leaked).code).toBe('SYNC_ERROR');
    expect(new SyncError('token abc123 hatalı', 'permanent').message).toBe(
      'SYNC_ERROR',
    );
  });
});

describe('ratePolicies', () => {
  it('defaults Trendyol and accepts overrides; rejects bad values', () => {
    expect(ratePolicies({}).trendyol).toEqual({
      capacity: 10,
      refillPerSecond: 5,
    });
    expect(ratePolicies({ SYNC_RATE_TRENDYOL: '20:2.5' }).trendyol).toEqual({
      capacity: 20,
      refillPerSecond: 2.5,
    });
    expect(() => ratePolicies({ SYNC_RATE_TRENDYOL: '0:1' })).toThrow();
    expect(() => ratePolicies({ SYNC_RATE_TRENDYOL: 'hızlı' })).toThrow();
  });
});

describe('syncErrorMessage', () => {
  it('maps known, family and unknown codes to Turkish text', () => {
    expect(syncErrorMessage(null)).toBeNull();
    expect(syncErrorMessage('CHANNEL_AUTH_FAILED')).toMatch(/kimlik/);
    expect(syncErrorMessage('CHANNEL_HTTP_502')).toMatch(/geçici/);
    expect(syncErrorMessage('CHANNEL_REJECTED_400')).toMatch(/reddetti/);
    expect(syncErrorMessage('XYZ')).toBe('Senkron işi başarısız oldu.');
  });
});
