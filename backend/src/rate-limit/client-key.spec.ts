import { accountKey, ipBucket } from './client-key.js';

describe('ipBucket', () => {
  it('keeps IPv4 addresses as they are', () => {
    expect(ipBucket('203.0.113.7')).toBe('203.0.113.7');
  });

  it('unwraps IPv4-mapped IPv6 addresses', () => {
    expect(ipBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('groups IPv6 addresses by /64', () => {
    const a = ipBucket('2001:db8:aa:bb:1:2:3:4');
    expect(a).toBe('2001:db8:aa:bb::/64');
    expect(ipBucket('2001:0db8:00aa:00bb:ffff::1')).toBe(a);
  });

  it('expands compressed IPv6 before grouping', () => {
    expect(ipBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipBucket('::1')).toBe('0:0:0:0::/64');
  });

  it('uses a shared bucket when the IP is unknown', () => {
    expect(ipBucket(undefined)).toBe('unknown');
  });
});

describe('accountKey', () => {
  it('is case and whitespace insensitive and does not contain the email', () => {
    const key = accountKey(' User@Example.com ');
    expect(key).toBe(accountKey('user@example.com'));
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain('example');
  });
});
