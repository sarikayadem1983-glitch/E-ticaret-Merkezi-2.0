-- USR-19: single-use, expiring tokens for password reset and e-mail verification.
-- Global table (no tenant); only SHA-256 hashes are stored. Additive only. Undo: down.sql.

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" VARCHAR(20) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_token_hash_key" ON "user_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "user_tokens_user_id_purpose_idx" ON "user_tokens"("user_id", "purpose");

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL-only CHECKs ------------------------------------------------------------------
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_purpose_valid" CHECK ("purpose" IN ('password_reset', 'email_verify'));
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_expiry_after_create" CHECK ("expires_at" > "created_at");

-- Application role privileges: tokens are marked used, never deleted by the app.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON "user_tokens" FROM tm_app;
    GRANT SELECT, INSERT ON "user_tokens" TO tm_app;
    -- Only used_at may change: a closed token can never be reopened or re-pointed.
    GRANT UPDATE ("used_at") ON "user_tokens" TO tm_app;
  END IF;
END $$;
