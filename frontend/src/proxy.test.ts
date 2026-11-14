import { NextRequest } from 'next/server';
import { proxy } from './proxy';

const TOKEN = 'a'.repeat(43);

function visit(path: string, cookie?: string) {
  const req = new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
  return proxy(req);
}

describe('proxy', () => {
  it('opens an invitation link without a session', () => {
    const res = visit(`/invite/${TOKEN}`);
    expect(res.headers.get('location')).toBeNull();
  });

  it('sends other pages to sign-in without a session', () => {
    const res = visit('/users');
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/login?next=%2Fusers',
    );
  });

  it('never puts an invitation token into a redirect', () => {
    for (const path of [`/invite/${TOKEN}`, `/invite/${TOKEN}/x`]) {
      expect(visit(path).headers.get('location') ?? '').not.toContain(TOKEN);
    }
  });

  it('opens recovery pages and token links without a session (USR-19)', () => {
    for (const path of ['/forgot-password', `/reset-password/${TOKEN}`, `/verify-email/${TOKEN}`]) {
      const res = visit(path);
      expect(res.headers.get('location')).toBeNull();
    }
  });
});
