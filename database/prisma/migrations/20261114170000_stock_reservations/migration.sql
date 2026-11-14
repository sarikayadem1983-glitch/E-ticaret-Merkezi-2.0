-- INV-02 stock reservations: reserve / release / consume per order line, concurrency safe.
-- Generated with `prisma migrate diff`, then CHECKs, the partial unique, functions and grants
-- added by hand. Reserved stock cannot be sold twice: reserved <= on_hand (CHECK).
-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_reservations_tenant_id_order_item_id_idx" ON "stock_reservations"("tenant_id", "order_item_id");

-- CreateIndex
CREATE INDEX "stock_reservations_tenant_id_warehouse_id_variant_id_idx" ON "stock_reservations"("tenant_id", "warehouse_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_tenant_id_id_key" ON "stock_reservations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_tenant_id_company_id_id_key" ON "order_items"("tenant_id", "company_id", "id");

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_company_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_company_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "variant_id") REFERENCES "product_variants"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_company_id_order_item_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "order_item_id") REFERENCES "order_items"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One active reservation per order line and warehouse.
CREATE UNIQUE INDEX "stock_reservations_active_key" ON "stock_reservations"("tenant_id", "order_item_id", "warehouse_id") WHERE "status" = 'active';

-- SQL-only CHECKs ------------------------------------------------------------------
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_status_known" CHECK ("status" IN ('active', 'released', 'consumed'));
-- Reserved stock is never more than stock on hand: a reserved unit cannot be sold, adjusted
-- or counted away (the movement is rejected) until its reservation is released or consumed.
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_reserved_within_on_hand" CHECK ("reserved" <= "on_hand");

-- Reservation functions --------------------------------------------------------------
-- The application runs them through TenantContext.runAsSystem and passes its tenant id;
-- every row they read or write is filtered by that tenant id, so a caller can never touch
-- another tenant's stock. Errors carry a stable code as the message (mapped to HTTP 409/404).
-- The level row is locked (FOR UPDATE) before it is checked, so concurrent reservations of
-- the same stock are serialized: available = on_hand - reserved can never go below zero.

CREATE FUNCTION "stock_reserve"(p_tenant uuid, p_order_item uuid, p_warehouse uuid, p_quantity integer)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_item order_items%ROWTYPE;
  v_level stock_levels%ROWTYPE;
  v_existing stock_reservations%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_tenant IS NULL OR p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'STOCK_INVALID_REQUEST' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_item FROM order_items WHERE tenant_id = p_tenant AND id = p_order_item;
  IF NOT FOUND OR v_item.variant_id IS NULL THEN
    RAISE EXCEPTION 'STOCK_ORDER_ITEM_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM warehouses
   WHERE tenant_id = p_tenant AND company_id = v_item.company_id AND id = p_warehouse AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STOCK_WAREHOUSE_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_existing FROM stock_reservations
   WHERE tenant_id = p_tenant AND order_item_id = p_order_item AND warehouse_id = p_warehouse AND status = 'active'
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.quantity = p_quantity THEN
      RETURN v_existing.id; -- idempotent repeat
    END IF;
    RAISE EXCEPTION 'STOCK_ALREADY_RESERVED' USING ERRCODE = 'unique_violation';
  END IF;
  SELECT * INTO v_level FROM stock_levels
   WHERE tenant_id = p_tenant AND warehouse_id = p_warehouse AND variant_id = v_item.variant_id
   FOR UPDATE;
  IF NOT FOUND OR v_level.on_hand - v_level.reserved < p_quantity THEN
    RAISE EXCEPTION 'STOCK_INSUFFICIENT' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE stock_levels SET reserved = reserved + p_quantity, updated_at = now() WHERE id = v_level.id;
  INSERT INTO stock_reservations (id, tenant_id, company_id, warehouse_id, variant_id, order_item_id, quantity, status, created_at, updated_at)
  VALUES (gen_random_uuid(), p_tenant, v_item.company_id, p_warehouse, v_item.variant_id, p_order_item, p_quantity, 'active', now(), now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Releases every active reservation of an order line (cancellation). Returns how many.
CREATE FUNCTION "stock_release"(p_tenant uuid, p_order_item uuid)
  RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r stock_reservations%ROWTYPE;
  n integer := 0;
BEGIN
  FOR r IN SELECT * FROM stock_reservations
    WHERE tenant_id = p_tenant AND order_item_id = p_order_item AND status = 'active'
    ORDER BY warehouse_id FOR UPDATE
  LOOP
    UPDATE stock_levels SET reserved = reserved - r.quantity, updated_at = now()
     WHERE tenant_id = p_tenant AND warehouse_id = r.warehouse_id AND variant_id = r.variant_id;
    UPDATE stock_reservations SET status = 'released', updated_at = now() WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Turns every active reservation of an order line into an 'order' stock movement (shipping):
-- reserved goes down first, then the movement lowers on_hand, so reserved <= on_hand holds.
CREATE FUNCTION "stock_consume"(p_tenant uuid, p_order_item uuid, p_created_by uuid)
  RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r stock_reservations%ROWTYPE;
  n integer := 0;
BEGIN
  FOR r IN SELECT * FROM stock_reservations
    WHERE tenant_id = p_tenant AND order_item_id = p_order_item AND status = 'active'
    ORDER BY warehouse_id FOR UPDATE
  LOOP
    UPDATE stock_levels SET reserved = reserved - r.quantity, updated_at = now()
     WHERE tenant_id = p_tenant AND warehouse_id = r.warehouse_id AND variant_id = r.variant_id;
    INSERT INTO stock_movements (id, tenant_id, company_id, warehouse_id, variant_id, quantity, reason, reference_type, reference_id, created_by, created_at)
    VALUES (gen_random_uuid(), p_tenant, r.company_id, r.warehouse_id, r.variant_id, -r.quantity, 'order', 'order_item', p_order_item, p_created_by, now());
    UPDATE stock_reservations SET status = 'consumed', updated_at = now() WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION "stock_reserve"(uuid, uuid, uuid, integer), "stock_release"(uuid, uuid), "stock_consume"(uuid, uuid, uuid) FROM PUBLIC;

-- Application role privileges ------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON "stock_reservations" FROM tm_app;
    GRANT SELECT ON "stock_reservations" TO tm_app;
    GRANT EXECUTE ON FUNCTION "stock_reserve"(uuid, uuid, uuid, integer), "stock_release"(uuid, uuid), "stock_consume"(uuid, uuid, uuid) TO tm_app;
  END IF;
END $$;
