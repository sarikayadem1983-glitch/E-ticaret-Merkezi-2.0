import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * runAsSystem disables tenant filtering. Every caller is listed here on purpose:
 * adding one must fail this test and go through code review.
 */
const ALLOWED = new Set([
  'auth/auth.service.ts',
  'database/database-role.check.ts',
  'health/health.service.ts',
]);

const SRC = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === 'generated' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

describe('TenantContext.runAsSystem allowlist', () => {
  it('is only called from reviewed files', () => {
    const callers = sourceFiles(SRC)
      .filter((file) => !file.endsWith(join('tenancy', 'tenant-context.ts')))
      .filter((file) => readFileSync(file, 'utf8').includes('runAsSystem('))
      .map((file) => relative(SRC, file).replaceAll('\\', '/'));

    expect(callers.filter((file) => !ALLOWED.has(file))).toEqual([]);
  });
});
