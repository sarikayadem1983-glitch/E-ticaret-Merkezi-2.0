import { forwardInvitation } from '@/server/public-invitation';

const FIELDS = ['email'] as const;

/** Asks for a reset e-mail. Same 202 for known and unknown addresses (backend). Session-less; see forwardInvitation. */
export async function POST(req: Request) {
  return forwardInvitation(req, 'auth/password/forgot', FIELDS);
}
