-- INT-01 channel accounts: marketplace accounts per company with envelope-encrypted
-- credentials. Additive only; no existing table changes except roles.permissions
-- (informational copy; runtime source is roles.catalog.ts). Undo: down.sql.

-- CreateTable
CREATE TABLE "channel_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "credentials_ciphertext" BYTEA NOT NULL,
    "credentials_iv" BYTEA NOT NULL,
    "credentials_tag" BYTEA NOT NULL,
    "wrapped_dek" BYTEA NOT NULL,
    "dek_iv" BYTEA NOT NULL,
    "dek_tag" BYTEA NOT NULL,
    "kek_id" VARCHAR(32) NOT NULL,
    "credentials_hint" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "channel_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_accounts_tenant_id_company_id_idx" ON "channel_accounts"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_accounts_tenant_id_id_key" ON "channel_accounts"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL-only unique index and CHECKs ------------------------------------------------
CREATE UNIQUE INDEX "channel_accounts_company_channel_name_active_key" ON "channel_accounts"("tenant_id", "company_id", "channel", lower("name")) WHERE "deleted_at" IS NULL;
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_channel_format" CHECK ("channel" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_kek_id_format" CHECK ("kek_id" ~ '^[a-z0-9][a-z0-9_-]{0,31}$');
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_crypto_sizes" CHECK (
  octet_length("credentials_iv") = 12 AND octet_length("credentials_tag") = 16
  AND octet_length("dek_iv") = 12 AND octet_length("dek_tag") = 16
  AND octet_length("wrapped_dek") = 32 AND octet_length("credentials_ciphertext") > 0
);
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_hint_object" CHECK (jsonb_typeof("credentials_hint") = 'object');

-- System role permissions (runtime source is roles.catalog.ts) --------------------
UPDATE "roles" SET "permissions" = "permissions" || ARRAY['channels:manage']
WHERE "key" = 'admin' AND NOT ('channels:manage' = ANY("permissions"));

-- Application role privileges: accounts are soft-deleted, never deleted.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON "channel_accounts" FROM tm_app;
    GRANT SELECT, INSERT, UPDATE ON "channel_accounts" TO tm_app;
  END IF;
END $$;
