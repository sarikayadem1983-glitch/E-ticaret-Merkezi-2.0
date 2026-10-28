'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { bff, request } from '@/lib/api';
import { hardNavigate } from '@/lib/navigation';
import type { Company, CompanySummary, Page, SessionInfo } from '@/lib/types';

export const keys = {
  session: ['session'] as const,
  companies: ['companies'] as const,
  companyList: (params: Record<string, string | number>) =>
    ['companies', 'list', params] as const,
  company: (id: string) => ['companies', 'one', id] as const,
  summary: ['companies', 'summary'] as const,
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
