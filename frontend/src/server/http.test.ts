import { checkCsrf, readJsonBody } from './http';

const APP = 'http://localhost:3000';

function req(method: string, headers: Record<string, string> = {}, body?: string) {
  return new Request(`${APP}/api/bff/companies`, { method, headers, body });
}

const valid = { origin: APP, 'x-tm-csrf': '1', 'sec-fetch-site': 'same-origin' };

describe('checkCsrf', () => {
  it('lets safe methods through', () => {
    expect(checkCsrf(req('GET'), APP)).toBeNull();
  });

  it('accepts a same-origin request with the CSRF header', () => {
    expect(checkCsrf(req('POST', valid), APP)).toBeNull();
    const { 'sec-fetch-site': _, ...noFetchMeta } = valid;
    expect(checkCsrf(req('PATCH', noFetchMeta), APP)).toBeNull();
  });

  it.each([
    ['missing Origin', { 'x-tm-csrf': '1' }],
    ['foreign Origin', { ...valid, origin: 'https://evil.example' }],
    ['look-alike Origin', { ...valid, origin: `${APP}.evil.example` }],
    ['null Origin', { ...valid, origin: 'null' }],
    ['cross-site fetch metadata', { ...valid, 'sec-fetch-site': 'cross-site' }],
    ['same-site (other subdomain)', { ...valid, 'sec-fetch-site': 'same-site' }],
    ['missing CSRF header', { origin: APP }],
  ])('rejects %s with 403', async (_name, headers) => {
    const res = checkCsrf(req('POST', headers), APP);
    expect(res?.status).toBe(403);
    expect((await res!.json()).error.code).toBe('CSRF_REJECTED');
  });

  it('protects every state-changing method', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(checkCsrf(req(method), APP)?.status).toBe(403);
    }
  });
});

describe('readJsonBody', () => {
  it('parses JSON', async () => {
    const r = await readJsonBody(req('POST', { 'content-type': 'application/json' }, '{"a":1}'));
    expect(r).toEqual({ ok: true, body: { a: 1 } });
  });

  it('rejects other content types (415), malformed JSON (400) and >64 KB (413)', async () => {
    const form = await readJsonBody(req('POST', { 'content-type': 'text/plain' }, 'a=1'));
    expect(!form.ok && form.response.status).toBe(415);
    const bad = await readJsonBody(req('POST', { 'content-type': 'application/json' }, '{'));
    expect(!bad.ok && bad.response.status).toBe(400);
    const big = await readJsonBody(
      req('POST', { 'content-type': 'application/json' }, JSON.stringify({ x: 'a'.repeat(70_000) })),
    );
    expect(!big.ok && big.response.status).toBe(413);
  });
});
