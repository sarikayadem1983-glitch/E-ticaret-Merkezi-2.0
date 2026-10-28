DROP TRIGGER IF EXISTS "audit_logs_no_truncate" ON "audit_logs";
DROP TRIGGER IF EXISTS "audit_logs_no_update_delete" ON "audit_logs";
DROP FUNCTION IF EXISTS "audit_logs_immutable"();
DROP TABLE "audit_logs";
DROP TYPE "audit_action";
