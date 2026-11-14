-- ORD-01 order schema: orders, order_items, order_status_history. Additive only. Undo: down.sql.
-- Generated with `prisma migrate diff`, then CHECKs, partial uniques, the account/company/channel
-- FK, the sync job FK and grants added by hand. Amounts are stored as the channel reports
-- them (channel rounds per line), so there is no equality CHECK between totals. No personal customer data (CRM-01).
-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel" VARCHAR(50) NOT NULL,
    "channel_account_id" UUID,
    "external_order_no" VARCHAR(100),
    "status" VARCHAR(30) NOT NULL DEFAULT 'created',
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "channel_discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipping_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "ordered_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID,
    "external_line_id" VARCHAR(100),
    "sku" VARCHAR(100) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vat_rate" DECIMAL(5,2),
    "line_total" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" VARCHAR(30),
    "to_status" VARCHAR(30) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "changed_by" UUID,
    "sync_job_id" UUID,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_tenant_id_company_id_ordered_at_idx" ON "orders"("tenant_id", "company_id", "ordered_at" DESC);

-- CreateIndex
CREATE INDEX "orders_tenant_id_status_ordered_at_idx" ON "orders"("tenant_id", "status", "ordered_at" DESC);

-- CreateIndex
CREATE INDEX "orders_tenant_id_channel_account_id_idx" ON "orders"("tenant_id", "channel_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_id_key" ON "orders"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_company_id_id_key" ON "orders"("tenant_id", "company_id", "id");

-- CreateIndex
CREATE INDEX "order_items_tenant_id_order_id_idx" ON "order_items"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "order_items_tenant_id_variant_id_idx" ON "order_items"("tenant_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_tenant_id_id_key" ON "order_items"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "order_status_history_tenant_id_order_id_changed_at_idx" ON "order_status_history"("tenant_id", "order_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_status_history_tenant_id_id_key" ON "order_status_history"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenant_id_company_id_id_key" ON "product_variants"("tenant_id", "company_id", "id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_channel_account_id_fkey" FOREIGN KEY ("tenant_id", "channel_account_id") REFERENCES "channel_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_company_id_order_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "order_id") REFERENCES "orders"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_company_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "variant_id") REFERENCES "product_variants"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- An order's channel account must belong to the order's company and channel.
CREATE UNIQUE INDEX "channel_accounts_tenant_id_company_id_channel_id_key" ON "channel_accounts"("tenant_id", "company_id", "channel", "id");
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_company_channel_fkey" FOREIGN KEY ("tenant_id", "company_id", "channel", "channel_account_id") REFERENCES "channel_accounts"("tenant_id", "company_id", "channel", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- History rows written by a sync job point at it (same tenant).
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_tenant_id_sync_job_id_fkey" FOREIGN KEY ("tenant_id", "sync_job_id") REFERENCES "sync_jobs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Marketplace numbers are unique per tenant and channel: the same order is never imported twice.
CREATE UNIQUE INDEX "orders_tenant_id_channel_external_order_no_key" ON "orders"("tenant_id", "channel", "external_order_no") WHERE "external_order_no" IS NOT NULL;
CREATE UNIQUE INDEX "order_items_tenant_id_order_id_external_line_id_key" ON "order_items"("tenant_id", "order_id", "external_line_id") WHERE "external_line_id" IS NOT NULL;

-- SQL-only CHECKs ------------------------------------------------------------------
ALTER TABLE "orders" ADD CONSTRAINT "orders_channel_format" CHECK ("channel" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_known" CHECK ("status" IN ('awaiting', 'created', 'picking', 'invoiced', 'unpacked', 'repack', 'shipped', 'at_collection_point', 'delivered', 'undelivered', 'cancelled', 'unsupplied', 'returned'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "orders" ADD CONSTRAINT "orders_external_order_no_not_blank" CHECK ("external_order_no" IS NULL OR length(btrim("external_order_no")) > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_has_external_no" CHECK ("channel_account_id" IS NULL OR "external_order_no" IS NOT NULL);
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_non_negative" CHECK ("subtotal" >= 0 AND "discount_total" >= 0 AND "channel_discount_total" >= 0 AND "shipping_total" >= 0 AND "total" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_amounts_non_negative" CHECK ("unit_price" >= 0 AND "discount" >= 0 AND "line_total" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_vat_rate_range" CHECK ("vat_rate" IS NULL OR ("vat_rate" >= 0 AND "vat_rate" <= 100));
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sku_not_blank" CHECK (length(btrim("sku")) > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_external_line_id_not_blank" CHECK ("external_line_id" IS NULL OR length(btrim("external_line_id")) > 0);
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_from_status_known" CHECK ("from_status" IS NULL OR "from_status" IN ('awaiting', 'created', 'picking', 'invoiced', 'unpacked', 'repack', 'shipped', 'at_collection_point', 'delivered', 'undelivered', 'cancelled', 'unsupplied', 'returned'));
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_to_status_known" CHECK ("to_status" IN ('awaiting', 'created', 'picking', 'invoiced', 'unpacked', 'repack', 'shipped', 'at_collection_point', 'delivered', 'undelivered', 'cancelled', 'unsupplied', 'returned'));
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_source_known" CHECK ("source" IN ('channel', 'user', 'system'));
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_user_source_has_actor" CHECK ("source" <> 'user' OR "changed_by" IS NOT NULL);

-- Application role privileges: orders are never deleted by the app; history is append-only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON "orders", "order_items", "order_status_history" FROM tm_app;
    GRANT SELECT, INSERT, UPDATE ON "orders", "order_items" TO tm_app;
    GRANT SELECT, INSERT ON "order_status_history" TO tm_app;
  END IF;
END $$;
