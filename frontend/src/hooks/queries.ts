'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { bff, request } from '@/lib/api';
import { hardNavigate } from '@/lib/navigation';
import type { AccessValue } from '@/lib/access';
import type {
  ChannelAccount,
  ChannelDefinition,
  ConnectionTestResult,
  SyncJob,
  SyncStatus,
} from '@/lib/integrations';
import type {
  Company,
  CompanySummary,
  CreatedInvitation,
  Member,
  Membership,
  Page,
  SessionInfo,
} from '@/lib/types';

export const keys = {
  session: ['session'] as const,
  memberships: ['memberships'] as const,
  companies: ['companies'] as const,
  companyList: (params: Record<string, string | number>) =>
    ['companies', 'list', params] as const,
  company: (id: string) => ['companies', 'one', id] as const,
  summary: ['companies', 'summary'] as const,
  users: ['users'] as const,
};

export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: () => request<{ data: SessionInfo }>('/api/session'),
    select: (r) => r.data,
    staleTime: 60_000,
  });
}

export interface CompanyListParams {
  page: number;
  search: string;
  status: 'active' | 'inactive' | 'all';
  perPage?: number;
}

export function useCompanies(p: CompanyListParams) {
  const params = new URLSearchParams({
    page: String(p.page),
    per_page: String(p.perPage ?? 20),
    status: p.status,
  });
  if (p.search) params.set('search', p.search);
  return useQuery({
    queryKey: keys.companyList(Object.fromEntries(params)),
    queryFn: () => bff<Page<Company>>(`companies?${params}`),
    placeholderData: keepPreviousData,
  });
}

export function useCompany(id: string) {
  return useQuery({
    queryKey: keys.company(id),
    queryFn: () => bff<{ data: Company }>(`companies/${id}`),
    select: (r) => r.data,
    retry: false,
    enabled: id !== '',
  });
}

export function useCompanySummary() {
  return useQuery({
    queryKey: keys.summary,
    queryFn: () => bff<{ data: CompanySummary }>('companies/summary'),
    select: (r) => r.data,
  });
}

export type CompanyInput = Omit<
  Company,
  'id' | 'country' | 'isActive' | 'createdAt' | 'updatedAt'
>;

export function useSaveCompany(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CompanyInput>) =>
      bff<{ data: Company }>(id ? `companies/${id}` : 'companies', {
        method: id ? 'PATCH' : 'POST',
        body: input,
      }),
    onSuccess: ({ data }) => {
      qc.setQueryData(keys.company(data.id), { data });
      return qc.invalidateQueries({ queryKey: keys.companies });
    },
  });
}

export function useSetCompanyActive(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (active: boolean) =>
      bff<{ data: Company }>(
        `companies/${id}/${active ? 'activate' : 'deactivate'}`,
        { method: 'POST' },
      ),
    onSuccess: ({ data }) => {
      qc.setQueryData(keys.company(data.id), { data });
      return qc.invalidateQueries({ queryKey: keys.companies });
    },
  });
}

export function useSelectCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (companyId: string | null) =>
      request('/api/session/company', { method: 'PUT', body: { companyId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.session }),
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => request('/api/auth/logout', { method: 'POST' }),
    onSettled: () => hardNavigate('/login'),
  });
}

export function useMemberships() {
  return useQuery({
    queryKey: keys.memberships,
    queryFn: () => bff<{ data: Membership[] }>('auth/memberships'),
    select: (r) => r.data,
    staleTime: 60_000,
  });
}

/**
 * Moves the session to another store. A full page load follows, so no cached
 * data of the previous store stays in memory.
 */
export function useSwitchTenant() {
  return useMutation({
    mutationFn: (tenantId: string) =>
      request('/api/session/tenant', { method: 'POST', body: { tenantId } }),
    onSuccess: () => hardNavigate('/dashboard'),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: keys.users,
    queryFn: () => bff<{ data: Member[] }>('users'),
    select: (r) => r.data,
  });
}

export function useUpdateAccess(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: AccessValue) =>
      bff(`users/${userId}/access`, { method: 'PUT', body: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.users }),
  });
}

export function useSetUserActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, active }: { userId: string; active: boolean }) =>
      bff(`users/${userId}/${active ? 'activate' : 'deactivate'}`, {
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.users }),
  });
}

export function useCreateInvitation() {
  return useMutation({
    mutationFn: (input: { email: string } & AccessValue) =>
      bff<{ data: CreatedInvitation }>('invitations', {
        method: 'POST',
        body: input,
      }),
  });
}

// INT-03 integrations ---------------------------------------------------------

const integrationKeys = {
  definitions: ['channel-definitions'] as const,
  accounts: (companyId: string) => ['channel-accounts', companyId] as const,
  jobs: (companyId: string, accountId: string, status: string) =>
    ['sync-jobs', companyId, accountId, status] as const,
};

export function useChannelDefinitions() {
  return useQuery({
    queryKey: integrationKeys.definitions,
    queryFn: () => bff<{ data: ChannelDefinition[] }>('channel-definitions'),
    select: (r) => r.data,
    staleTime: 10 * 60_000,
  });
}

export function useChannelAccounts(companyId: string) {
  return useQuery({
    queryKey: integrationKeys.accounts(companyId),
    queryFn: () => bff<{ data: ChannelAccount[] }>(`companies/${companyId}/channel-accounts`),
    select: (r) => r.data,
  });
}

export interface ChannelAccountInput {
  channel?: string;
  name?: string;
  isActive?: boolean;
  credentials?: Record<string, string>;
}

export function useSaveChannelAccount(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ChannelAccountInput }) =>
      bff<{ data: ChannelAccount }>(
        `companies/${companyId}/channel-accounts${id ? `/${id}` : ''}`,
        { method: id ? 'PATCH' : 'POST', body },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationKeys.accounts(companyId) }),
  });
}

export function useDeleteChannelAccount(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      bff(`companies/${companyId}/channel-accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationKeys.accounts(companyId) }),
  });
}

export function useTestConnection(companyId: string) {
  return useMutation({
    mutationFn: (id: string) =>
      bff<{ data: ConnectionTestResult }>(
        `companies/${companyId}/channel-accounts/${id}/test-connection`,
        { method: 'POST' },
      ).then((r) => r.data),
  });
}

export function useSyncJobs(companyId: string, accountId: string, status: SyncStatus | 'all') {
  return useQuery({
    queryKey: integrationKeys.jobs(companyId, accountId, status),
    queryFn: () =>
      bff<{ data: SyncJob[]; nextCursor: string | null }>(
        `companies/${companyId}/channel-accounts/${accountId}/sync-jobs?limit=20${
          status === 'all' ? '' : `&status=${status}`
        }`,
      ),
    refetchInterval: 15_000,
  });
}

export function useRetrySyncJob(companyId: string, accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      bff(`companies/${companyId}/channel-accounts/${accountId}/sync-jobs/${jobId}/retry`, {
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sync-jobs', companyId, accountId] }),
  });
}
