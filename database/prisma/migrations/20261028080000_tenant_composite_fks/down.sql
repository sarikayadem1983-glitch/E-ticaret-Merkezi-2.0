-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_tenant_id_user_id_fkey";
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_tenant_id_role_id_fkey";
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_tenant_id_user_id_fkey";

-- DropIndex
DROP INDEX "users_tenant_id_id_key";
DROP INDEX "roles_tenant_id_id_key";

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
