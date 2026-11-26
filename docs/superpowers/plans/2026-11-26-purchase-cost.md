# Purchase cost prerequisite implementation plan

> **For agentic workers:** Use superpowers:executing-plans task by task; independent CRITICAL review uses a fresh-context agent.

**Goal:** Record real manually supplied unit purchase costs before RPT-02 valuation.
**Architecture:** Nullable variant fields; existing ProductsService, CatalogRepository, catalogWrite and AuditService. Dedicated endpoints; omit costs from generic responses.
**Tech Stack:** NestJS, Prisma, PostgreSQL, Vitest.
**Spec:** docs/superpowers/specs/2026-11-26-purchase-cost-design.md

## Constraints / review focus
Decimal strings; unknown versus zero; tenant/company/variant parent isolation; confidentiality; passive company; audit atomicity; rollback/data preservation. No dev DB changes.

## Task 1 — Cost API
- [x] Failing unit tests and API coverage: missing/zero cost, money validation, permission denial, passive company, audit rollback, generic response omission.
- [x] Three nullable schema columns, CHECK migration, verify.sql, guarded down.sql; locally generate client.
- [x] Implement dedicated cost methods/routes and documented validation.
- [x] Targeted 9/9, typecheck and lint; backend unit 660/660 (2026-11-26).

## Task 2 — Database proof / review
- [x] CI API tests 7/7; disposable migration database up/down/reapply checks 4/4.
- [x] Independent reviewer: P1 audit-value disclosure and P2 env bootstrap closed; no open static finding.
- [x] PR #103 opened draft while checks ran. RPT-02 stays IN-PROGRESS until full report is delivered; merge/deploy require separate authorization.

## Execution record
- Base: main 885345b, isolated worktree tm2-b-rpt02. Existing Claude workspace and old reconciliation worktree left unchanged.
- RED: missing cost service; audit-value disclosure regression subsequently failed 1/9. GREEN: 9/9. Existing money/sales baseline 24/24.
- Independent review: audit disclosure P1 fixed by recording only operation metadata; local env bootstrap P2 fixed. DB/API integration proof pending CI; Docker daemon unavailable here.
- Ruling: implement cost recording as the prerequisite slice before stock valuation, following the user's purchase-cost decision. RPT-02 remains unfinished; no completion counts increased.

## Verification evidence
Code commit `b931188`, GitHub Actions run `45890503589`: backend, frontend and integration all successful. New HTTP API 7/7; migration rehearsal 4/4 (preservation, CHECK constraints, refusal with data, empty rollback and reapply); real MinIO/image integration 17/17; production HTTPS Playwright 23/23. Local backend unit 660/660, typecheck and lint passed. No dev/prod migration, deploy or merge. Subsequent changes in this branch only update documentation.
