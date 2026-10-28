import {
  loadSecurityConfig,
  parseBodyLimit,
  parseCorsOrigins,
  parseTrustProxy,
  SecurityConfigError,
} from './security.config.js';

describe('parseTrustProxy', () => {
  it.each([undefined, '', 'false', '  '])('%o disables proxy trust', (v) => {
    expect(parseTrustProxy(v)).toBe(false);
  });

  it('accepts IPs, CIDRs and named subnets', () => {
    expect(parseTrustProxy('10.0.0.1, 172.16.0.0/12,loopback, ::1')).toEqual([
      '10.0.0.1',
      '172.16.0.0/12',
      'loopback',
      '::1',
    ]);
  });

  it.each(['true', '1', '2', 'loopback,true'])(
    'refuses the unsafe value %s',
    (v) => {
      expect(() => parseTrustProxy(v)).toThrow(SecurityConfigError);
    },
  );

  it.each(['10.0.0.300', 'not-an-ip', '10.0.0.0/99'])(
    'refuses invalid address %s',
    (v) => {
      expect(() => parseTrustProxy(v)).toThrow(SecurityConfigError);
    },
  );
});

describe('parseCorsOrigins', () => {
  it('accepts exact origins', () => {
    expect(
      parseCorsOrigins(
        'https://panel.example.com, https://a.example.com',
        true,
      ),
    ).toEqual(['https://panel.example.com', 'https://a.example.com']);
  });

  it.each(['*', 'https://*.example.com'])('refuses wildcard %s', (v) => {
    expect(() => parseCorsOrigins(v, false)).toThrow(SecurityConfigError);
  });

  it.each(['https://a.example.com/', 'https://a.example.com/path', 'nope'])(
    'refuses non-origin %s',
    (v) => {
      expect(() => parseCorsOrigins(v, false)).toThrow(SecurityConfigError);
    },
  );

  it('requires https in production only', () => {
    expect(parseCorsOrigins('http://localhost:3000', false)).toHaveLength(1);
    expect(() => parseCorsOrigins('http://localhost:3000', true)).toThrow(
      SecurityConfigError,
    );
  });
});

describe('parseBodyLimit', () => {
  it('defaults to 100kb', () => {
    expect(parseBodyLimit(undefined)).toBe('100kb');
  });

  it.each(['512b', '64KB', '1mb', '10mb'])('accepts %s', (v) => {
    expect(parseBodyLimit(v)).toBe(v.toLowerCase());
  });

  it.each(['11mb', '0kb', '1gb', 'big', '-1kb'])('refuses %s', (v) => {
    expect(() => parseBodyLimit(v)).toThrow(SecurityConfigError);
  });
});

describe('loadSecurityConfig', () => {
  it('uses safe local defaults', () => {
    expect(loadSecurityConfig({})).toEqual({
      production: false,
      trustProxy: false,
      enforceHttps: false,
      corsOrigins: [],
      bodyLimit: '100kb',
    });
  });

  it('turns HTTPS enforcement on in production by default', () => {
    expect(loadSecurityConfig({ NODE_ENV: 'production' }).enforceHttps).toBe(
      true,
    );
  });

  it('refuses to disable HTTPS in production', () => {
    expect(() =>
      loadSecurityConfig({ NODE_ENV: 'production', ENFORCE_HTTPS: 'false' }),
    ).toThrow(SecurityConfigError);
  });

  it('falls back to FRONTEND_URL for CORS', () => {
    expect(
      loadSecurityConfig({ FRONTEND_URL: 'http://localhost:3000' }).corsOrigins,
    ).toEqual(['http://localhost:3000']);
  });

  it('refuses non-boolean ENFORCE_HTTPS', () => {
    expect(() => loadSecurityConfig({ ENFORCE_HTTPS: 'yes' })).toThrow(
      SecurityConfigError,
    );
  });
});
