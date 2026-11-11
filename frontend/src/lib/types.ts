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
    canManageUsers?: boolean;
  };
  selectedCompanyId: string | null;
}

export interface Membership {
  tenantId: string;
  name: string;
  slug: string;
  current: boolean;
}

export type CompanyRoleKey = 'operations' | 'accounting' | 'viewer';

/** A member's whole access: one tenant role or a list of company roles. */
export type MemberAccess =
  | { tenantRole: 'owner' | 'admin' }
  | {
      companyRoles: {
        companyId: string;
        companyName: string | null;
        roleKey: CompanyRoleKey;
      }[];
    };

export interface Member {
  userId: string;
  name: string;
  email: string;
  status: 'active' | 'inactive';
  access: MemberAccess;
}

export interface CreatedInvitation {
  id: string;
  status: 'pending';
  delivery: 'sent' | 'failed';
  replacesInactiveMembership: boolean;
}

export interface InvitationLookup {
  tenantName: string;
  inviterName: string;
  roleSummary: string;
  maskedEmail: string;
  accountExists: boolean;
  replacesInactiveMembership: boolean;
}
