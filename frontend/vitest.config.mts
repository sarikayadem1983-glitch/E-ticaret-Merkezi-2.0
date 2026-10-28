import { resolve } from 'node:path';
import nextEnv from '@next/env';
import { defineConfig } from 'vitest/config';

nextEnv.loadEnvConfig(resolve(import.meta.dirname, '..'));

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      'server-only': resolve(import.meta.dirname, 'test/server-only-stub.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
