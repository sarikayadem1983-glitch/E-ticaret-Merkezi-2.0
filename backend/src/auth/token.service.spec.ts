import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service.js';

const SECRET = 'x'.repeat(32);

function service() {
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: '15m', algorithm: 'HS256' },
    verifyOptions: { algorithms: ['HS256'] },
  });
  return { jwt, tokens: new TokenService(jwt, new ConfigService({})) };
}

describe('TokenService', () => {
  it('round-trips ver in the access token', async () => {
    const { tokens } = service();
    const { token } = await tokens.signAccess({
      sub: 'u1',
      tid: 't1',
      perms: ['*'],
      ver: 3,
    });
    await expect(tokens.verifyAccess(token)).resolves.toMatchObject({
      sub: 'u1',
      tid: 't1',
      perms: ['*'],
      ver: 3,
    });
  });

  it('access token without ver is parsed as version 0', async () => {
    const { jwt, tokens } = service();
    // Shape of tokens issued before memberships existed.
    const legacy = await jwt.signAsync({ sub: 'u1', tid: 't1', perms: ['*'] });
    await expect(tokens.verifyAccess(legacy)).resolves.toMatchObject({
      sub: 'u1',
      tid: 't1',
      ver: 0,
    });
  });

  it('rejects a non-integer ver', async () => {
    const { jwt, tokens } = service();
    const bad = await jwt.signAsync({
      sub: 'u1',
      tid: 't1',
      perms: [],
      ver: 'x',
    });
    await expect(tokens.verifyAccess(bad)).rejects.toThrow();
  });
});
