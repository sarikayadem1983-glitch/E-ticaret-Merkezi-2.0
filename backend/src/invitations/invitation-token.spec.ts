import { hashInvitationToken, newInvitationToken } from './invitation-token.js';

describe('invitation tokens', () => {
  it('are 32 random bytes, url-safe, and stored only as their SHA-256', () => {
    const { token, hash } = newInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashInvitationToken(token)).toBe(hash);
  });

  it('never repeat', () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => newInvitationToken().token),
    );
    expect(tokens.size).toBe(100);
  });
});
