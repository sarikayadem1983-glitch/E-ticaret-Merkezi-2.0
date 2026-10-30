import { forwardInvitation } from '@/server/public-invitation';

const FIELDS = ['token'] as const;

/** What an invitation offers (store, role, whether the account exists). Session-less; see forwardInvitation. */
export async function POST(req: Request) {
  return forwardInvitation(req, 'invitations/lookup', FIELDS);
}
