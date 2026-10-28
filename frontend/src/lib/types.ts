export interface Company {
  id: string;
  legalName: string;
  taxNumber: string;
  taxOffice: string;
  addressLine: string;
  district: string;
  city: string;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  eInvoiceEnabled: boolean;
  eInvoiceAlias: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  data: T[];
  meta: { page: number; per_page: number; total: number };
}

export interface CompanySummary {
  total: number;
  active: number;
  inactive: number;
}

export interface SessionInfo {
  user: {
    id: string;
    tenantId: string;
    name: string;
    email: string;
    permissions: string[];
    tenant: { id: string; name: string; slug: string } | null;
  };
  selectedCompanyId: string | null;
}
