import { loadInvitationsConfig } from './invitations.config.js';

describe('loadInvitationsConfig', () => {
  it('defaults to 7 days', () => {
    expect(loadInvitationsConfig({}).ttlMs).toBe(7 * 24 * 3600 * 1000);
  });

  it.each(['0', '-1', '1.5', 'x', '721'])(
    'rejects INVITATION_TTL_HOURS=%s',
    (v) => {
      expect(() =>
        loadInvitationsConfig({ INVITATION_TTL_HOURS: v }),
      ).toThrow();
    },
  );

  it('requires an https APP_ORIGIN in production', () => {
    expect(() =>
      loadInvitationsConfig({
        NODE_ENV: 'production',
        APP_ORIGIN: 'http://shop.example.com',
      }),
    ).toThrow();
    expect(
      loadInvitationsConfig({
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://shop.example.com',
      }).appOrigin,
    ).toBe('https://shop.example.com');
  });

  it('refuses an origin with a path', () => {
    expect(() =>
      loadInvitationsConfig({ APP_ORIGIN: 'http://localhost:3000/x' }),
    ).toThrow();
  });
});
