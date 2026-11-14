-- INV-01 inventory schema: warehouses, stock_levels, stock_movements. Additive only. Undo: down.sql.
-- Generated with `prisma migrate diff`, then CHECKs, partial uniques, the stock trigger, column
-- grants and grants added by hand. Stock = sum of movements; movements are append-only.
-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" VARCHAR(30) NOT NULL,
    "reference_type" VARCHAR(30),
    "reference_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouses_tenant_id_company_id_idx" ON "warehouses"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_id_key" ON "warehouses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_company_id_id_key" ON "warehouses"("tenant_id", "company_id", "id");

-- CreateIndex
CREATE INDEX "stock_levels_tenant_id_variant_id_idx" ON "stock_levels"("tenant_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_tenant_id_id_key" ON "stock_levels"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_tenant_id_warehouse_id_variant_id_key" ON "stock_levels"("tenant_id", "warehouse_id", "variant_id");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_variant_id_created_at_idx" ON "stock_movements"("tenant_id", "variant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_warehouse_id_created_at_idx" ON "stock_movements"("tenant_id", "warehouse_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_tenant_id_id_key" ON "stock_movements"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_company_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_company_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "variant_id") REFERENCES "product_variants"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_company_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_company_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "variant_id") REFERENCES "product_variants"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Partial uniques ------------------------------------------------------------------
CREATE UNIQUE INDEX "warehouses_tenant_id_company_id_lower_name_key" ON "warehouses"("tenant_id", "company_id", lower("name"));
CREATE UNIQUE INDEX "warehouses_tenant_id_company_id_default_key" ON "warehouses"("tenant_id", "company_id") WHERE "is_default";
-- An order line decreases stock at most once per warehouse and variant. Returns, cancellations
-- and transfers may legitimately repeat for one reference (partial returns), so they are not unique.
CREATE UNIQUE INDEX "stock_movements_order_reference_key" ON "stock_movements"("tenant_id", "reference_type", "reference_id", "warehouse_id", "variant_id") WHERE "reason" = 'order' AND "reference_id" IS NOT NULL;

-- SQL-only CHECKs ------------------------------------------------------------------
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_on_hand_non_negative" CHECK ("on_hand" >= 0);
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_reserved_non_negative" CHECK ("reserved" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_non_zero" CHECK ("quantity" <> 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reason_known" CHECK ("reason" IN ('opening', 'adjustment', 'count', 'purchase', 'order', 'order_cancel', 'return', 'transfer_in', 'transfer_out'));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reference_type_known" CHECK ("reference_type" IS NULL OR "reference_type" IN ('order', 'order_item', 'sync_job', 'transfer', 'manual'));
-- A reference id exists exactly when the reference type points at a record (not manual / none).
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reference_complete" CHECK ((COALESCE("reference_type", 'manual') = 'manual') = ("reference_id" IS NULL));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_direction_matches_reason" CHECK (
  ("reason" IN ('opening', 'purchase', 'order_cancel', 'return', 'transfer_in') AND "quantity" > 0)
  OR ("reason" IN ('order', 'transfer_out') AND "quantity" < 0)
  OR "reason" NOT IN ('opening', 'purchase', 'order_cancel', 'return', 'transfer_in', 'order', 'transfer_out'));
-- Manual corrections carry their author (or the sync job that counted).
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_manual_has_actor" CHECK (
  "reason" NOT IN ('adjustment', 'count') OR "created_by" IS NOT NULL OR COALESCE("reference_type", '') = 'sync_job');

-- Stock = sum of movements. Each movement adds its quantity to stock_levels.on_hand in the
-- same transaction (row lock via UPDATE), so on_hand can never drift or go negative
-- (CHECK above aborts the movement). Runs as the table owner; tm_app cannot write on_hand.
CREATE FUNCTION "stock_movements_apply"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Update first: INSERT .. ON CONFLICT checks CHECKs on the proposed row, which would reject
  -- a valid decrease. UPDATE takes the row lock, so concurrent decreases are serialized.
  UPDATE stock_levels SET on_hand = on_hand + NEW.quantity, updated_at = now()
   WHERE tenant_id = NEW.tenant_id AND warehouse_id = NEW.warehouse_id AND variant_id = NEW.variant_id;
  IF NOT FOUND THEN
    -- First movement for this warehouse/variant. A negative first movement fails the CHECK (no stock).
    -- Known race: two simultaneous first movements, one negative: the negative one is rejected
    -- (CHECK runs on the proposed row before ON CONFLICT). on_hand never drifts; it is a false refusal.
    INSERT INTO stock_levels (id, tenant_id, company_id, warehouse_id, variant_id, on_hand, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.company_id, NEW.warehouse_id, NEW.variant_id, NEW.quantity, now(), now())
    ON CONFLICT (tenant_id, warehouse_id, variant_id)
    DO UPDATE SET on_hand = stock_levels.on_hand + EXCLUDED.on_hand, updated_at = now();
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION "stock_movements_apply"() FROM PUBLIC;
CREATE TRIGGER "stock_movements_apply" AFTER INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "stock_movements_apply"();

-- Guards for every role, the owner included: movements are never changed or removed, and
-- on_hand changes only through the trigger above. Test cleanup and down.sql set
-- app.allow_stock_purge = 'on' locally. (A superuser can still bypass triggers; that is out of
-- scope, like for audit_logs.)
CREATE FUNCTION "stock_guard"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(current_setting('app.allow_stock_purge', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_TABLE_NAME = 'stock_levels' AND TG_OP = 'UPDATE' THEN
    IF NEW.on_hand IS DISTINCT FROM OLD.on_hand AND pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'stock_levels.on_hand yalnızca stok hareketiyle değişir' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% üzerinde % yasak: stok hareketleri değiştirilemez/silinemez', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
REVOKE ALL ON FUNCTION "stock_guard"() FROM PUBLIC;
CREATE TRIGGER "stock_movements_guard" BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "stock_guard"();
CREATE TRIGGER "stock_movements_guard_truncate" BEFORE TRUNCATE ON "stock_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION "stock_guard"();
CREATE TRIGGER "stock_levels_guard" BEFORE UPDATE OR DELETE ON "stock_levels"
  FOR EACH ROW EXECUTE FUNCTION "stock_guard"();
CREATE TRIGGER "stock_levels_guard_truncate" BEFORE TRUNCATE ON "stock_levels"
  FOR EACH STATEMENT EXECUTE FUNCTION "stock_guard"();

-- Application role privileges ------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON "warehouses", "stock_levels", "stock_movements" FROM tm_app;
    GRANT SELECT, INSERT, UPDATE ON "warehouses" TO tm_app;
    -- Levels: read only. on_hand and new rows come from the trigger; reserved will change only
    -- through tenant-checked SECURITY DEFINER functions in INV-02 (no direct UPDATE grant).
    GRANT SELECT ON "stock_levels" TO tm_app;
    -- Movements are append-only.
    GRANT SELECT, INSERT ON "stock_movements" TO tm_app;
  END IF;
END $$;
