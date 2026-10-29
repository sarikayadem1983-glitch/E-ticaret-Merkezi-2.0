import { ConflictException, ForbiddenException } from '@nestjs/common';
import { assertNotLastOwner, assertNotSelf, canGrant } from './access.rules.js';
import type { RoleKey } from './roles.catalog.js';

const COMPANY_ROLES: RoleKey[] = ['operations', 'accounting', 'viewer'];

describe('canGrant', () => {
  it('admin can grant company roles but not admin or owner', () => {
    for (const role of COMPANY_ROLES)
      expect(canGrant('admin', role)).toBe(true);
    expect(canGrant('admin', 'admin')).toBe(false);
    expect(canGrant('admin', 'owner')).toBe(false);
  });

  it('owner can grant admin and company roles but not owner', () => {
    expect(canGrant('owner', 'admin')).toBe(true);
    for (const role of COMPANY_ROLES)
      expect(canGrant('owner', role)).toBe(true);
    expect(canGrant('owner', 'owner')).toBe(false);
  });

  it('company roles grant nothing', () => {
    for (const actor of COMPANY_ROLES)
      for (const target of [...COMPANY_ROLES, 'admin', 'owner'] as RoleKey[])
        expect(canGrant(actor, target)).toBe(false);
  });
});

describe('assertNotLastOwner', () => {
  it('last owner cannot be deactivated or demoted', () => {
    expect(() => assertNotLastOwner('owner', 1)).toThrow(ConflictException);
    expect(() => assertNotLastOwner('owner', 0)).toThrow(ConflictException);
  });

  it('allows it while another active owner remains', () => {
    expect(() => assertNotLastOwner('owner', 2)).not.toThrow();
  });

  it('does not apply to other roles', () => {
    expect(() => assertNotLastOwner('admin', 1)).not.toThrow();
    expect(() => assertNotLastOwner(null, 0)).not.toThrow();
  });
});

describe('assertNotSelf', () => {
  it('refuses changes to the actor themselves', () => {
    expect(() => assertNotSelf('u1', 'u1')).toThrow(ForbiddenException);
    expect(() => assertNotSelf('u1', 'u2')).not.toThrow();
  });
});
