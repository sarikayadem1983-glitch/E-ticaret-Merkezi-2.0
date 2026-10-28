import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

config({ path: '../.env' });

export default defineConfig({
  schema: '../database/prisma/schema.prisma',
  migrations: { path: '../database/prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
