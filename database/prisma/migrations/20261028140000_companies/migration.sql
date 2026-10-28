-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_name" VARCHAR(250) NOT NULL,
    "tax_number" VARCHAR(11) NOT NULL,
    "tax_office" VARCHAR(100) NOT NULL,
    "address_line" VARCHAR(500) NOT NULL,
    "district" VARCHAR(100) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "postal_code" VARCHAR(10),
    "country" CHAR(2) NOT NULL DEFAULT 'TR',
    "phone" VARCHAR(30),
    "email" VARCHAR(254),
    "e_invoice_enabled" BOOLEAN NOT NULL DEFAULT false,
    "e_invoice_alias" VARCHAR(250),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_company_roles" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_company_roles_pkey" PRIMARY KEY ("user_id","company_id","role_id")
);

-- CreateIndex
CREATE INDEX "companies_tenant_id_is_active_legal_name_idx" ON "companies"("tenant_id", "is_active", "legal_name");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenant_id_tax_number_key" ON "companies"("tenant_id", "tax_number");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenant_id_id_key" ON "companies"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "user_company_roles_tenant_id_idx" ON "user_company_roles"("tenant_id");

-- CreateIndex
CREATE INDEX "user_company_roles_company_id_idx" ON "user_company_roles"("company_id");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tax number is a 10-digit VKN or an 11-digit TCKN (checksums are validated in the application).
ALTER TABLE "companies" ADD CONSTRAINT "companies_tax_number_format" CHECK ("tax_number" ~ '^[0-9]{10,11}$');
