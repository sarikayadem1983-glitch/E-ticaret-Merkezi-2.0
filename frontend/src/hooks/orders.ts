'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { bff } from '@/lib/api';
import type { OrderStatus } from '@/lib/orders';
import type { Order, OrderDetail, Page } from '@/lib/types';

export const orderKeys = {
  orders: ['orders'] as const,
  list: (params: Record<string, string>) => ['orders', 'list', params] as const,
  one: (id: string) => ['orders', 'one', id] as const,
};

export interface OrderListParams {
  page: number;
  perPage?: number;
  search: string;
  status: OrderStatus | 'all';
  companyId: string;
  channel: string;
}

export function useOrders(p: OrderListParams) {
  const params = new URLSearchParams({
    page: String(p.page),
    per_page: String(p.perPage ?? 20),
  });
  if (p.search) params.set('search', p.search);
  if (p.status !== 'all') params.set('status', p.status);
  if (p.companyId) params.set('company_id', p.companyId);
  if (p.channel) params.set('channel', p.channel);
  return useQuery({
    queryKey: orderKeys.list(Object.fromEntries(params)),
    queryFn: () => bff<Page<Order>>(`orders?${params}`),
    placeholderData: keepPreviousData,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: orderKeys.one(id),
    queryFn: () => bff<{ data: OrderDetail }>(`orders/${id}`),
    select: (r) => r.data,
    retry: false,
  });
}

export function useChangeOrderStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: OrderStatus) =>
      bff<{ data: OrderDetail }>(`orders/${id}/status`, {
        method: 'POST',
        body: { status },
      }),
    onSuccess: (res) => {
      qc.setQueryData(orderKeys.one(id), res);
      return qc.invalidateQueries({ queryKey: [...orderKeys.orders, 'list'] });
    },
  });
}

export interface CreateOrderInput {
  companyId: string;
  currency: string;
  discountTotal?: string;
  shippingTotal?: string;
  items: { variantId: string; quantity: number; unitPrice: string; discount?: string }[];
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrderInput) =>
      bff<{ data: OrderDetail }>('orders', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: orderKeys.orders }),
  });
}
