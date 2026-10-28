import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

config({ path: '../.env' });

export default defineConfig({
  schema: '../database/prisma/schema.prisma',
  migrations: { path: '../database/prisma/migrations' },
  // CLI only (migrate/diff). The running app uses DATABASE_URL with the least-privileged role.
  datasource: { url: env('MIGRATION_DATABASE_URL') },
});
