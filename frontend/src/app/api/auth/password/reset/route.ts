import { forwardInvitation } from '@/server/public-invitation';

const FIELDS = ['token', 'password'] as const;

/** Sets a new password with a single-use token; every session of the user ends (backend). Session-less; see forwardInvitation. */
export async function POST(req: Request) {
  return forwardInvitation(req, 'auth/password/reset', FIELDS);
}
