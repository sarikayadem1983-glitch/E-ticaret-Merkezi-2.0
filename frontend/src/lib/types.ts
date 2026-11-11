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

export interface Membership {
  tenantId: string;
  name: string;
  slug: string;
  current: boolean;
}

// ---- catalog (CAT-04) ----

export type ProductStatus = 'draft' | 'active' | 'archived';

export interface VariantAttribute {
  attributeId: string;
  attributeName: string;
  valueId: string;
  value: string;
}

/** Amounts are decimal strings ("199.90"), never numbers. */
export interface VariantPrice {
  channel: string;
  amount: string;
  currency: string;
  netAmount: string | null;
  vatAmount: string | null;
  updatedAt: string;
}

export interface Variant {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  attributes: VariantAttribute[];
  prices: VariantPrice[];
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  companyId: string;
  categoryId: string | null;
  brandId: string | null;
  name: string;
  description: string | null;
  status: ProductStatus;
  vatRate: string | null;
  variants: Variant[];
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
}

export interface Brand {
  id: string;
  name: string;
}

export interface Attribute {
  id: string;
  name: string;
  values: { id: string; value: string; sortOrder: number }[];
}
