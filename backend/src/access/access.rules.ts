import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ROLE_CATALOG, type RoleKey } from './roles.catalog.js';

/**
 * Who may grant which role. Owner is given only at registration, so nobody
 * grants it. Only an owner grants admin. Owner and admin grant company roles.
 */
export function canGrant(actor: RoleKey, target: RoleKey): boolean {
  if (target === 'owner') return false;
  if (target === 'admin') return actor === 'owner';
  return (
    ROLE_CATALOG[target].scope === 'company' &&
    (actor === 'owner' || actor === 'admin')
  );
}

/**
 * The tenant's last active owner can be neither deactivated nor demoted.
 * `activeOwnerCount` counts active memberships only, the target included.
 */
export function assertNotLastOwner(
  targetRole: RoleKey | null,
  activeOwnerCount: number,
): void {
  if (targetRole === 'owner' && activeOwnerCount <= 1) {
    throw new ConflictException({
      code: 'LAST_OWNER',
      message: 'Mağazanın son sahibi pasife alınamaz veya rolü düşürülemez',
    });
  }
}

/** Nobody changes their own role or access. */
export function assertNotSelf(actorId: string, targetId: string): void {
  if (actorId === targetId) {
    throw new ForbiddenException({
      code: 'SELF_CHANGE',
      message: 'Kendi erişiminizi değiştiremezsiniz',
    });
  }
}
