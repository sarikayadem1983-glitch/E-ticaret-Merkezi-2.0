'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { bff } from '@/lib/api';
import type { Page } from '@/lib/types';

export interface Warehouse {
  id: string;
  companyId: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface StockLevel {
  id: string;
  companyId: string;
  warehouseId: string;
  warehouseName: string;
  variantId: string;
  sku: string | null;
  productName: string | null;
  onHand: number;
  reserved: number;
  available: number;
  threshold: number | null;
  updatedAt: string;
}

export interface LowStockRow {
  variantId: string;
  companyId: string;
  sku: string | null;
  productName: string | null;
  threshold: number;
  available: number;
}

export const MOVEMENT_REASONS = {
  opening: 'Açılış stoku',
  purchase: 'Satın alma (giriş)',
  adjustment: 'Düzeltme',
  count: 'Sayım farkı',
} as const;
export type MovementReason = keyof typeof MOVEMENT_REASONS;

export const inventoryKeys = {
  all: ['inventory'] as const,
  warehouses: (companyId: string) => ['inventory', 'warehouses', companyId] as const,
  levels: (params: Record<string, string>) => ['inventory', 'levels', params] as const,
  low: (companyId: string) => ['inventory', 'low', companyId] as const,
};

export function useWarehouses(companyId: string) {
  const q = companyId ? `?company_id=${companyId}` : '';
  return useQuery({
    queryKey: inventoryKeys.warehouses(companyId),
    queryFn: () => bff<{ data: Warehouse[] }>(`warehouses${q}`),
    select: (r) => r.data,
  });
}

export function useStockLevels(p: { page: number; companyId: string; warehouseId: string }) {
  const params = new URLSearchParams({ page: String(p.page), per_page: '50' });
  if (p.companyId) params.set('company_id', p.companyId);
  if (p.warehouseId) params.set('warehouse_id', p.warehouseId);
  return useQuery({
    queryKey: inventoryKeys.levels(Object.fromEntries(params)),
    queryFn: () => bff<Page<StockLevel>>(`stock-levels?${params}`),
    placeholderData: keepPreviousData,
  });
}

export function useLowStock(companyId: string) {
  const q = companyId ? `?company_id=${companyId}` : '';
  return useQuery({
    queryKey: inventoryKeys.low(companyId),
    queryFn: () => bff<{ data: LowStockRow[] }>(`stock-levels/low${q}`),
    select: (r) => r.data,
  });
}

function useInventoryMutation<T>(fn: (input: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: inventoryKeys.all }),
  });
}

export function useCreateWarehouse() {
  return useInventoryMutation((input: { companyId: string; name: string; isDefault: boolean }) =>
    bff('warehouses', { method: 'POST', body: input }),
  );
}

export function useCreateMovement() {
  return useInventoryMutation(
    (input: { warehouseId: string; variantId: string; quantity: number; reason: MovementReason }) =>
      bff('stock-movements', { method: 'POST', body: input }),
  );
}

export function useSetThreshold() {
  return useInventoryMutation((input: { variantId: string; threshold: number | null }) =>
    bff(`stock-thresholds/${input.variantId}`, {
      method: 'PUT',
      body: { threshold: input.threshold },
    }),
  );
}

/** INV-04: two movements (transfer_out / transfer_in) with one reference. */
export function useStockTransfer() {
  return useInventoryMutation(
    (input: { fromWarehouseId: string; toWarehouseId: string; variantId: string; quantity: number }) =>
      bff<{ data: { transferId: string; quantity: number } }>('stock-transfers', { method: 'POST', body: input }),
  );
}

/** INV-04: counted quantity; the backend writes only the difference. */
export function useStockCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { warehouseId: string; variantId: string; counted: number }) =>
      bff<{ data: { counted: number; difference: number } }>('stock-counts', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inventoryKeys.all }),
  });
}

