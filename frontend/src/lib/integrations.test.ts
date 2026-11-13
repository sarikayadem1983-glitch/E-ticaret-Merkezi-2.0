import { buildCredentials, statsSummary, type CredentialField } from './integrations';

const FIELDS: CredentialField[] = [
  { key: 'supplierId', label: 'Satıcı ID', secret: false, maxLength: 20 },
  { key: 'apiKey', label: 'API Key', secret: true, maxLength: 200 },
  { key: 'apiSecret', label: 'API Secret', secret: true, maxLength: 200 },
];

describe('buildCredentials', () => {
  it('create: requires every field and trims values', () => {
    expect(
      buildCredentials(FIELDS, { supplierId: ' 1 ', apiKey: 'k', apiSecret: 's' }, 'create'),
    ).toEqual({
      credentials: { supplierId: '1', apiKey: 'k', apiSecret: 's' },
    });
    expect(buildCredentials(FIELDS, { supplierId: '1' }, 'create').error).toMatch(
      /API Key, API Secret/,
    );
  });

  it('edit: all empty keeps the stored credentials; partial is refused', () => {
    expect(buildCredentials(FIELDS, {}, 'edit')).toEqual({});
    expect(buildCredentials(FIELDS, { apiKey: '  ' }, 'edit')).toEqual({});
    expect(buildCredentials(FIELDS, { apiKey: 'new' }, 'edit').error).toMatch(/tüm alanları/);
  });

  it('refuses values over the field limit', () => {
    expect(
      buildCredentials(
        FIELDS,
        { supplierId: '1'.repeat(21), apiKey: 'k', apiSecret: 's' },
        'create',
      ).error,
    ).toMatch(/Satıcı ID en fazla 20/);
  });
});

describe('statsSummary', () => {
  it('lists only non-zero counters in a fixed order', () => {
    expect(statsSummary({ processed: 3, created: 2, unchanged: 1, stale: 0 })).toBe(
      '3 işlendi · 2 yeni · 1 değişmedi',
    );
    expect(statsSummary({})).toBe('');
  });
});
