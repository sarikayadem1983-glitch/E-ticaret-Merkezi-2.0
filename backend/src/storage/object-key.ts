/**
 * Tenant-prefixed object keys (INF-12). Every object lives under `tenants/<tenantId>/`;
 * the storage service refuses any key outside the caller's prefix, so one tenant can never
 * read, sign or delete another tenant's object even with a guessed key.
 */
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** One path segment chosen by code (e.g. 'products', a company id). */
const SEGMENT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const EXTENSION = /^[a-z0-9]{1,8}$/;
/** Whole key as accepted back from callers (e.g. read from the database). */
const KEY =
  /^tenants\/[0-9a-f-]{36}(\/[a-z0-9][a-z0-9-]{0,62})+\/[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/;

export class ObjectKeyError extends Error {}

export function tenantPrefix(tenantId: string): string {
  if (!UUID.test(tenantId)) throw new ObjectKeyError('Geçersiz tenant kimliği');
  return `tenants/${tenantId}/`;
}

/**
 * New unique key: tenants/<tenantId>/<segments...>/<uuid>[.ext]. Segments and the extension
 * are fixed by code, never taken from a user's file name.
 */
export function newObjectKey(
  tenantId: string,
  segments: string[],
  extension?: string,
): string {
  if (segments.length === 0) throw new ObjectKeyError('Anahtar bölümü gerekli');
  for (const s of segments) {
    if (!SEGMENT.test(s))
      throw new ObjectKeyError(`Geçersiz anahtar bölümü: ${s}`);
  }
  if (extension !== undefined && !EXTENSION.test(extension)) {
    throw new ObjectKeyError('Geçersiz dosya uzantısı');
  }
  const ext = extension ? `.${extension}` : '';
  return `${tenantPrefix(tenantId)}${segments.join('/')}/${randomUUID()}${ext}`;
}

/** Throws unless `key` is well-formed and inside the tenant's prefix. */
export function assertTenantKey(tenantId: string, key: string): void {
  if (!KEY.test(key) || !key.startsWith(tenantPrefix(tenantId))) {
    throw new ObjectKeyError('Nesne bu tenant’a ait değil');
  }
}
