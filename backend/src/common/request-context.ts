import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestStore {
  /** X-Request-Id: sent back in the response header and written on every log line. */
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestStore>();

const USER_AGENT_MAX = 512;

/** Per-request metadata (who, from where) read by the audit log. Separate from TenantContext on purpose. */
export const RequestContext = {
  enter<T>(
    meta: { ipAddress?: string; userAgent?: string; requestId?: string },
    fn: () => T,
  ): T {
    return storage.run(
      {
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent?.slice(0, USER_AGENT_MAX),
      },
      fn,
    );
  },

  /** Called by the auth guard once the access token is verified. */
  setUser(userId: string): void {
    const store = storage.getStore();
    if (store) store.userId = userId;
  },

  get(): Readonly<RequestStore> {
    return storage.getStore() ?? {};
  },
};
