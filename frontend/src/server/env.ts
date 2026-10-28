import 'server-only';

export interface ServerEnv {
  production: boolean;
  backendUrl: URL;
  /** The app's own origin; the only Origin accepted on state-changing requests. */
  appOrigin: string;
  redisUrl: string;
  sessionSecret: string;
}

let cached: ServerEnv | undefined;

/** Read and validated once. Invalid configuration stops requests with a clear error. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const production = process.env.NODE_ENV === 'production';

  const sessionSecret = process.env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET en az 32 karakter olmalı');
  }

  const backendUrl = new URL(process.env.BACKEND_URL ?? 'http://127.0.0.1:4000');
  const appOrigin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000')
    .origin;
  if (production && !appOrigin.startsWith('https://')) {
    throw new Error("Production'da APP_ORIGIN https olmalı");
  }

  cached = {
    production,
    backendUrl,
    appOrigin,
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    sessionSecret,
  };
  return cached;
}
