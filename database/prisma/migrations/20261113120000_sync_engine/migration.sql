-- INT-02 sync engine: sync_jobs (log + state of every marketplace sync job) and
-- channel_external_refs (external record -> local record; one row per account, type and
-- external id, so the same order is never imported twice). Additive only. Undo: down.sql.
-- Generated with `prisma migrate diff`, then CHECKs, the company/account FK and grants added by hand.

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel_account_id" UUID NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "idempotency_key" VARCHAR(200) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(80),
    "stats" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "queued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_external_refs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel_account_id" UUID NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "external_id" VARCHAR(100) NOT NULL,
    "local_id" UUID,
    "external_updated_at" TIMESTAMPTZ,
    "payload_hash" CHAR(64) NOT NULL,
    "last_sync_job_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "channel_external_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_jobs_tenant_id_channel_account_id_queued_at_idx" ON "sync_jobs"("tenant_id", "channel_account_id", "queued_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sync_jobs_tenant_id_id_key" ON "sync_jobs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_jobs_tenant_id_channel_account_id_kind_idempotency_key_key" ON "sync_jobs"("tenant_id", "channel_account_id", "kind", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "channel_external_refs_tenant_id_id_key" ON "channel_external_refs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_external_refs_tenant_id_channel_account_id_entity_t_key" ON "channel_external_refs"("tenant_id", "channel_account_id", "entity_type", "external_id");

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_tenant_id_channel_account_id_fkey" FOREIGN KEY ("tenant_id", "channel_account_id") REFERENCES "channel_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_external_refs" ADD CONSTRAINT "channel_external_refs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_external_refs" ADD CONSTRAINT "channel_external_refs_tenant_id_channel_account_id_fkey" FOREIGN KEY ("tenant_id", "channel_account_id") REFERENCES "channel_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A sync job's company must be the company of its channel account.
CREATE UNIQUE INDEX "channel_accounts_tenant_id_company_id_id_key" ON "channel_accounts"("tenant_id", "company_id", "id");
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_account_company_fkey" FOREIGN KEY ("tenant_id", "company_id", "channel_account_id") REFERENCES "channel_accounts"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL-only CHECKs ------------------------------------------------------------------
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_status_known" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed'));
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_kind_format" CHECK ("kind" ~ '^[a-z0-9][a-z0-9.-]{0,59}$');
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_idempotency_key_not_blank" CHECK (length(btrim("idempotency_key")) > 0);
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_attempts_non_negative" CHECK ("attempts" >= 0);
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_error_code_format" CHECK ("error_code" IS NULL OR "error_code" ~ '^[A-Z][A-Z0-9_:]{0,79}$');
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_payload_object" CHECK (jsonb_typeof("payload") = 'object');
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_stats_object" CHECK (jsonb_typeof("stats") = 'object');
ALTER TABLE "channel_external_refs" ADD CONSTRAINT "channel_external_refs_entity_type_known" CHECK ("entity_type" IN ('order', 'product', 'variant'));
ALTER TABLE "channel_external_refs" ADD CONSTRAINT "channel_external_refs_external_id_not_blank" CHECK (length(btrim("external_id")) > 0);
ALTER TABLE "channel_external_refs" ADD CONSTRAINT "channel_external_refs_payload_hash_hex" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$');

-- Application role privileges: logs and references are kept, never deleted by the app.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON "sync_jobs", "channel_external_refs" FROM tm_app;
    GRANT SELECT, INSERT, UPDATE ON "sync_jobs", "channel_external_refs" TO tm_app;
  END IF;
END $$;
