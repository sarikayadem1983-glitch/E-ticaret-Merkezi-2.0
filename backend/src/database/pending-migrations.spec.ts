import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PHASE2 = join(
  __dirname,
  '../../../database/migrations-pending/phase2_drop_legacy_user_columns/migration.sql',
);

/** SQL statements only: comments are dropped so they cannot hide a match. */
const statements = () =>
  readFileSync(PHASE2, 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

describe('pending phase 2 migration', () => {
  it('drops users.tenant_id', () => {
    expect(statements()).toMatch(/DROP COLUMN "tenant_id"/);
  });

  it('keeps users.is_active, which login, refresh and JwtAuthGuard read', () => {
    expect(statements()).not.toMatch(/is_active/i);
  });
});
