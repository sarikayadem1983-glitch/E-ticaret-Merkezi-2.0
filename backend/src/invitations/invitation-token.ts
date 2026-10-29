import { createHash, randomBytes } from 'node:crypto';

/** SHA-256 hex of the token: the only form stored (invitations.token_hash). */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 32 random bytes, base64url. The plain token only ever travels in the e-mail. */
export function newInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInvitationToken(token) };
}
