/**
 * Masks personal data and secrets in log text (OPS-01). Applied to every log message and
 * stack trace by AppLogger, so a careless `logger.error(JSON.stringify(dto))` cannot leak.
 * Conservative on purpose: better a masked UUID-looking value than a leaked token.
 */

const RULES: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  // Authorization headers and bare bearer tokens.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [GİZLİ]'],
  // JWTs (three base64url parts).
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[JWT]'],
  // key=value / "key": "value" for secret-looking keys.
  [
    /(["']?)(password|passwd|pwd|parola|şifre|sifre|secret|token|api[_-]?key|apikey|api[_-]?secret|authorization|cookie|credentials?|private[_-]?key|kek|dek)\1(\s*[:=]\s*)(["']?)([^"'\s,;}&]+)\4/gi,
    (_m, q, key, sep, vq) => `${q}${key}${q}${sep}${vq}[GİZLİ]${vq}`,
  ],
  // Connection strings with credentials: postgresql://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^:/\s@]+):([^@\s/]+)@/gi, '$1$2:[GİZLİ]@'],
  // E-mail addresses: keep the first letter and the domain (like maskEmail).
  [
    /\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    '$1***@$2',
  ],
  // Turkish IBAN.
  [/\bTR\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi, '[IBAN]'],
  // Phone numbers: +90 5xx xxx xx xx, 05xx..., 5xxxxxxxxx (10–13 digits with separators).
  [
    /(?<![\w-])(?:\+?90[\s-]?)?0?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?![\w-])/g,
    '[TELEFON]',
  ],
  // 11-digit TCKN (not part of a longer number or an id).
  [/(?<![\w-])[1-9]\d{10}(?![\w-])/g, '[TCKN]'],
  // Long hex / base64 secrets (keys, hashes): 32+ chars, not a UUID.
  [
    /(?<![\w-])(?:[A-Fa-f0-9]{40,}|[A-Za-z0-9+/]{40,}={0,2})(?![\w-])/g,
    '[ANAHTAR]',
  ],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement as string);
  }
  return out;
}
