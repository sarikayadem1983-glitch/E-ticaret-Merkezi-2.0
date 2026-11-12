-- Undo of 20261112210000_user_tokens. Run as tm_migrator, then remove the row from
-- _prisma_migrations. Tokens are short-lived; dropping them only invalidates open links.

BEGIN;
LOCK TABLE "user_tokens" IN ACCESS EXCLUSIVE MODE;
DROP TABLE "user_tokens";
COMMIT;
