import { forwardInvitation } from '@/server/public-invitation';

const FIELDS = ['token'] as const;

/** Confirms an e-mail address with a single-use token. Session-less; see forwardInvitation. */
export async function POST(req: Request) {
  return forwardInvitation(req, 'auth/email/verify', FIELDS);
}
