import { accessError, describeAccess, toAccessValue } from './access';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('accessError', () => {
  it('accepts Admin', () => {
    expect(accessError({ tenantRole: 'admin' })).toBeNull();
  });

  it('accepts distinct company rows', () => {
    expect(
      accessError({
        companyRoles: [
          { companyId: A, roleKey: 'viewer' },
          { companyId: B, roleKey: 'accounting' },
        ],
      }),
    ).toBeNull();
  });

  it('rejects no rows, a row without company and a repeated company', () => {
    expect(accessError({ companyRoles: [] })).toMatch(/En az bir/);
    expect(
      accessError({ companyRoles: [{ companyId: '', roleKey: 'viewer' }] }),
    ).toMatch(/firma seçin/);
    expect(
      accessError({
        companyRoles: [
          { companyId: A, roleKey: 'viewer' },
          { companyId: A, roleKey: 'operations' },
        ],
      }),
    ).toMatch(/bir kez/);
  });
});

describe('describeAccess / toAccessValue', () => {
  it('labels tenant and company roles', () => {
    expect(describeAccess({ tenantRole: 'owner' })).toEqual(['Mağaza sahibi']);
    expect(
      describeAccess({
        companyRoles: [{ companyId: A, companyName: null, roleKey: 'accounting' }],
      }),
    ).toEqual(['Muhasebe — Bilinmeyen firma']);
  });

  it('drops company names from the editor value', () => {
    expect(
      toAccessValue({
        companyRoles: [{ companyId: A, companyName: 'A', roleKey: 'viewer' }],
      }),
    ).toEqual({ companyRoles: [{ companyId: A, roleKey: 'viewer' }] });
  });
});
