# RPT-02 prerequisite: current unit purchase cost

User decision (2026-11-26): use purchase cost for stock valuation, establishing cost recording first. This prerequisite does not complete RPT-02.

Store optional current unit purchase cost, currency TRY/USD/EUR, and cost update time on a variant. Enter costs manually, VAT-exclusive. Missing is null, zero is valid. This is a current-cost snapshot, not FIFO, weighted-average costing, historical COGS or landed-cost accounting. No currency conversion or VAT inference.

Dedicated GET/PUT `products/:id/variants/:variantId/cost`; both require `products:write` and a fresh company permission check. Hide cost fields from general product/variant/export payloads. Tenant/company/parent mismatch is 404; insufficient company permission is 403. Passive company reads are allowed; writes return 409. PUT and before/after audit use the existing serializable catalog transaction.

Three nullable additive columns, nonnegative NUMERIC(12,2), pair/currency consistency CHECK. Existing rows remain unknown. Rollback refuses to discard populated cost records. No dev/prod migration or deploy. Reuse existing dependencies and money validation.

Audit records actor, time, variant, whether a cost existed and changed field names; private amounts/currency are not stored in general audit payloads. This deliberately does not provide a historical cost ledger. Next slice: stock quantities multiplied by recorded costs, separated by currency; missing costs explicitly exposed and current valuation basis labelled. Do not claim historical accounting value.
