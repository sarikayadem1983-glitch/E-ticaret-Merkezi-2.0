/** Query ran without a tenant context. Always a developer bug, never user input. */
export class TenantContextMissingError extends Error {
  readonly code = 'TENANT_CONTEXT_MISSING';
  constructor(operation: string) {
    super(`Tenant bağlamı olmadan sorgu çalıştırılamaz: ${operation}`);
  }
}

/** Query tried to read or write another tenant's data. Always a developer bug. */
export class TenantViolationError extends Error {
  readonly code = 'TENANT_VIOLATION';
  constructor(operation: string, detail: string) {
    super(`Tenant ihlali (${operation}): ${detail}`);
  }
}
