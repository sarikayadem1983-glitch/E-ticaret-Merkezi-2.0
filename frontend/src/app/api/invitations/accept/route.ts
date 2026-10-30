import { forwardInvitation } from '@/server/public-invitation';

const FIELDS = ['token', 'name', 'password'] as const;

/** Accepts an invitation with a new account or with the password of the existing account. Session-less; see forwardInvitation. */
export async function POST(req: Request) {
  return forwardInvitation(req, 'invitations/accept', FIELDS);
}
