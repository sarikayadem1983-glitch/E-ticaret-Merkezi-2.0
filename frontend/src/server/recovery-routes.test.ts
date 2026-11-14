import { POST as verify } from '@/app/api/auth/email/verify/route';
import { POST as forgot } from '@/app/api/auth/password/forgot/route';
import { POST as reset } from '@/app/api/auth/password/reset/route';
import { backendFetch } from './backend-client';
import { currentSession, startSession } from './session';

vi.mock('./backend-client', () => ({ backendFetch: vi.fn() }));
vi.mock('./session', () => ({ currentSession: vi.fn(), startSession: vi.fn() }));

const fetchMock = vi.mocked(backendFetch);
const APP = 'http://localhost:3000';
const TOKEN = 'b'.repeat(43);
const valid = {
  origin: APP,
  'x-tm-csrf': '1',
  'sec-fetch-site': 'same-origin',
  'content-type': 'application/json',
  'x-tm-client-ip': '203.0.113.9',
};
const post = (path: string, body: unknown, headers: Record<string, string> = valid) =>
  new Request(`${APP}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

beforeEach(() => fetchMock.mockReset());

describe.each([
  ['forgot', forgot, '/api/auth/password/forgot', 'auth/password/forgot', { email: 'a@b.co' }],
  ['reset', reset, '/api/auth/password/reset', 'auth/password/reset', { token: TOKEN, password: 'Correct-Horse-9' }],
  ['verify', verify, '/api/auth/email/verify', 'auth/email/verify', { token: TOKEN }],
] as const)('POST recovery %s (USR-19)', (_n, handler, url, backendPath, body) => {
  it('forwards only the known fields, without a session, with the client IP', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await handler(post(url, { ...body, userId: 'x', tenantId: 'y' }));
    expect(res.status).toBe(204);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe(backendPath);
    expect(init.body).toEqual(body);
    expect(init.accessToken).toBeUndefined();
    expect(init.client.ip).toBe('203.0.113.9');
    expect(vi.mocked(currentSession)).not.toHaveBeenCalled();
    expect(vi.mocked(startSession)).not.toHaveBeenCalled();
  });

  it('refuses cross-site requests (CSRF) without calling the backend', async () => {
    const res = await handler(post(url, body, { ...valid, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
