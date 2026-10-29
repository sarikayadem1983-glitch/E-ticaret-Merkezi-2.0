/**
 * Global account state. A deactivated (is_active = false) or soft-deleted
 * (deleted_at set) user gets no tokens: login and refresh answer exactly like
 * a wrong password / an unknown refresh token. Deleted wins over inactive.
 */
export type DisabledReason = 'user_inactive' | 'user_deleted';

export function disabledReason(user: {
  isActive: boolean;
  deletedAt: Date | null;
}): DisabledReason | null {
  if (user.deletedAt !== null) return 'user_deleted';
  if (!user.isActive) return 'user_inactive';
  return null;
}
