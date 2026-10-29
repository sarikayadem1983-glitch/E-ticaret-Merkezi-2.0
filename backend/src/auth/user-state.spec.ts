import { disabledReason } from './user-state.js';

describe('disabledReason', () => {
  it('is null for an active, not deleted user', () => {
    expect(disabledReason({ isActive: true, deletedAt: null })).toBeNull();
  });
  it('flags a deactivated user', () => {
    expect(disabledReason({ isActive: false, deletedAt: null })).toBe(
      'user_inactive',
    );
  });
  it('flags a soft-deleted user, also when still active', () => {
    expect(disabledReason({ isActive: true, deletedAt: new Date() })).toBe(
      'user_deleted',
    );
    expect(disabledReason({ isActive: false, deletedAt: new Date() })).toBe(
      'user_deleted',
    );
  });
});
