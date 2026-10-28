/**
 * Makes values safe to persist in audit_logs: secrets are redacted, size is
 * bounded, and non-JSON types are converted. Applied to every before/after value.
 */

export const REDACTED = '[REDACTED]';

/** Key names that must never reach the audit log, matched anywhere in the key. */
const SENSITIVE_KEY =
  /pass(word|wd|phrase)?|secret|token|hash|authorization|cookie|session|api[-_]?key|credential|private[-_]?key|card[-_]?number|cvv|cvc|iban|otp/i;

/** Values that look like credentials regardless of their key. */
const SENSITIVE_VALUE = [
  /^Bearer\s+/i,
  /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/, // JWT
  /^\$argon2|^\$2[aby]\$/, // password hashes
];

const MAX_DEPTH = 5;
const MAX_ARRAY = 50;
const MAX_STRING = 1000;
export const MAX_JSON_BYTES = 16 * 1024;

/** Fields that change on every write and carry no audit value. */
const IGNORED_DIFF_KEYS = new Set(['updatedAt']);

export type AuditJson =
  string | number | boolean | null | AuditJson[] | { [key: string]: AuditJson };

function isPlainRecord(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function clean(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): AuditJson | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      if (SENSITIVE_VALUE.some((re) => re.test(value))) return REDACTED;
      return value.length > MAX_STRING
        ? `${value.slice(0, MAX_STRING)}…`
        : value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
  }

  const obj = value as object;
  if (obj instanceof Date)
    return Number.isNaN(obj.getTime()) ? null : obj.toISOString();
  if (Buffer.isBuffer(obj) || ArrayBuffer.isView(obj)) return '[BINARY]';
  if (seen.has(obj)) return '[CIRCULAR]';
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';

  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const items = obj
        .slice(0, MAX_ARRAY)
        .map((item) => clean(item, depth + 1, seen) ?? null);
      if (obj.length > MAX_ARRAY)
        items.push(`[+${obj.length - MAX_ARRAY} öğe]`);
      return items;
    }
    // Prisma.Decimal and similar value objects serialize via toString.
    if (!isPlainRecord(obj)) {
      const toString = (obj as { toString?: () => string }).toString;
      return typeof toString === 'function' &&
        toString !== Object.prototype.toString
        ? clean(toString.call(obj), depth, seen)
        : '[OBJECT]';
    }
    const out: Record<string, AuditJson> = {};
    for (const [key, child] of Object.entries(obj)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = REDACTED;
        continue;
      }
      const cleaned = clean(child, depth + 1, seen);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

/** Redacts and bounds a value for storage. Returns undefined when there is nothing to store. */
export function sanitize(value: unknown): AuditJson | undefined {
  const cleaned = clean(value, 0, new WeakSet());
  if (cleaned === undefined) return undefined;
  const size = Buffer.byteLength(JSON.stringify(cleaned));
  return size > MAX_JSON_BYTES ? { _truncated: true, _bytes: size } : cleaned;
}

/** Keeps only top-level fields whose value changed, so UPDATE logs store the minimum. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const key of keys) {
    if (IGNORED_DIFF_KEYS.has(key)) continue;
    const a = sanitize(before[key]);
    const b = sanitize(after[key]);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (key in before) changedBefore[key] = before[key];
    if (key in after) changedAfter[key] = after[key];
  }
  return { before: changedBefore, after: changedAfter };
}
