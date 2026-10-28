import { resolve } from 'node:path';
import { loadEnvConfig } from '@next/env';

/** Loads the repository .env (REDIS_URL) for the test helpers. */
export default async function globalSetup() {
  loadEnvConfig(resolve(__dirname, '..', '..'));
}
