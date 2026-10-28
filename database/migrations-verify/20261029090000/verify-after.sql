-- Verification AFTER migration 20261029090000_tenant_memberships (spec "Migration güvenliği" 4).
-- Read-only; safe to re-run. Every row: check_name | ok | detail. All rows must be ok = true.
-- Requires the _mig_snapshot_* tables from snapshot-before.sql.

WITH
expected_memberships AS (
  SELECT s.id, s.tenant_id, CASE WHEN s.is_active THEN 'active' ELSE 'inactive' END AS status
  FROM _mig_snapshot_users s
),
membership_diff AS (
  SELECT
    (SELECT count(*) FROM expected_memberships e
      WHERE (SELECT count(*) FROM tenant_memberships m
             WHERE m.user_id = e.id AND m.tenant_id = e.tenant_id AND m.status::text = e.status) <> 1) AS missing,
    (SELECT count(*) FROM tenant_memberships m
      WHERE NOT EXISTS (SELECT 1 FROM expected_memberships e WHERE e.id = m.user_id AND e.tenant_id = m.tenant_id)) AS extra
),
checks(check_name, ok, detail) AS (
  SELECT 'memberships_match_users',
         d.missing = 0 AND d.extra = 0,
         format('missing_or_wrong=%s extra=%s', d.missing, d.extra)
  FROM membership_diff d

  UNION ALL
  SELECT 'users_identity_unchanged', count(*) = 0, format('changed_or_missing=%s', count(*))
  FROM _mig_snapshot_users s
  LEFT JOIN users u ON u.id = s.id
  WHERE u.id IS NULL OR u.tenant_id IS DISTINCT FROM s.tenant_id
     OR u.last_tenant_id IS DISTINCT FROM s.tenant_id OR u.is_active IS DISTINCT FROM s.is_active

  UNION ALL
  SELECT 'password_hashes_unchanged', count(*) = 0, format('changed_or_missing=%s', count(*))
  FROM _mig_snapshot_users s
  LEFT JOIN users u ON u.id = s.id
  WHERE u.id IS NULL OR md5(u.password_hash) <> s.password_md5

  UNION ALL
  SELECT 'emails_lowercase', count(*) = 0, format('not_lowercase=%s', count(*))
  FROM users WHERE email <> lower(email)

  UNION ALL
  SELECT 'user_roles_unchanged', count(*) = 0, format('differences=%s', count(*))
  FROM (
    (SELECT tenant_id, user_id, role_id FROM _mig_snapshot_user_roles
     EXCEPT SELECT tenant_id, user_id, role_id FROM user_roles)
    UNION ALL
    (SELECT tenant_id, user_id, role_id FROM user_roles
     EXCEPT SELECT tenant_id, user_id, role_id FROM _mig_snapshot_user_roles)
  ) x

  UNION ALL
  SELECT 'user_company_roles_unchanged', count(*) = 0, format('differences=%s', count(*))
  FROM (
    (SELECT tenant_id, user_id, company_id, role_id FROM _mig_snapshot_user_company_roles
     EXCEPT SELECT tenant_id, user_id, company_id, role_id FROM user_company_roles)
    UNION ALL
    (SELECT tenant_id, user_id, company_id, role_id FROM user_company_roles
     EXCEPT SELECT tenant_id, user_id, company_id, role_id FROM _mig_snapshot_user_company_roles)
  ) x

  UNION ALL
  SELECT 'refresh_tokens_unchanged', count(*) = 0, format('differences=%s', count(*))
  FROM (
    (SELECT id, tenant_id, user_id FROM _mig_snapshot_refresh_tokens
     EXCEPT SELECT id, tenant_id, user_id FROM refresh_tokens)
    UNION ALL
    (SELECT id, tenant_id, user_id FROM refresh_tokens
     EXCEPT SELECT id, tenant_id, user_id FROM _mig_snapshot_refresh_tokens)
  ) x

  UNION ALL
  SELECT 'assignments_have_membership', count(*) = 0, format('orphans=%s', count(*))
  FROM (
    SELECT tenant_id, user_id FROM user_roles
    UNION ALL SELECT tenant_id, user_id FROM user_company_roles
    UNION ALL SELECT tenant_id, user_id FROM refresh_tokens
  ) a
  WHERE NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = a.tenant_id AND m.user_id = a.user_id)

  UNION ALL
  SELECT 'role_scopes_respected', count(*) = 0, format('wrong_scope=%s', count(*))
  FROM (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.scope <> 'tenant'
    UNION ALL
    SELECT 1 FROM user_company_roles ucr JOIN roles r ON r.id = ucr.role_id WHERE r.scope <> 'company'
  ) x

  UNION ALL
  SELECT 'foreign_keys_validated', count(*) = 0,
         format('not_validated=%s', coalesce(string_agg(conname, ', '), '-'))
  FROM pg_constraint
  WHERE contype = 'f' AND NOT convalidated AND connamespace = 'public'::regnamespace

  UNION ALL
  SELECT 'membership_foreign_keys_present', count(*) = 6, format('present=%s/6', count(*))
  FROM pg_constraint
  WHERE contype = 'f' AND conname IN (
    'user_roles_tenant_id_user_id_fkey', 'user_company_roles_tenant_id_user_id_fkey',
    'refresh_tokens_tenant_id_user_id_fkey', 'user_roles_tenant_id_role_id_role_scope_fkey',
    'user_company_roles_tenant_id_role_id_role_scope_fkey', 'tenant_memberships_user_id_fkey')
    AND (conname NOT LIKE '%tenant_id_user_id_fkey' OR confrelid = 'tenant_memberships'::regclass)

  UNION ALL
  SELECT 'system_roles_per_tenant', count(*) = 0,
         format('tenants_missing_roles=%s', count(*))
  FROM tenants t
  WHERE (SELECT count(*) FROM roles r
         WHERE r.tenant_id = t.id AND r.is_system AND (r.key, r.scope::text) IN (
           ('owner', 'tenant'), ('admin', 'tenant'), ('operations', 'company'),
           ('accounting', 'company'), ('viewer', 'company'))) <> 5

  UNION ALL
  SELECT 'owners_linked_to_owner_key', count(*) = 0, format('owner_assignments_without_key=%s', count(*))
  FROM _mig_snapshot_user_roles s
  JOIN roles r ON r.id = s.role_id
  WHERE s.role_name = 'owner' AND r.key IS DISTINCT FROM 'owner'

  UNION ALL
  SELECT 'roles_without_key', count(*) = 0,
         format('custom_roles=%s (%s)', count(*), coalesce(string_agg(name, ', '), '-'))
  FROM roles WHERE key IS NULL

  UNION ALL
  SELECT 'audit_logs_unchanged',
         a.row_count = s.row_count AND a.id_md5 = s.id_md5 AND a.rows_md5 = s.rows_md5,
         format('before=%s after=%s', s.row_count, a.row_count)
  FROM _mig_snapshot_audit s,
       (SELECT count(*) AS row_count,
               md5(coalesce(string_agg(id::text, '' ORDER BY id), '')) AS id_md5,
               md5(coalesce(string_agg(l::text, '' ORDER BY id), '')) AS rows_md5
        FROM audit_logs l) a
)
SELECT check_name, ok, detail FROM checks;
