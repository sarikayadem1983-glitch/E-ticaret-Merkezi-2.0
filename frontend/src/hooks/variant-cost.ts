'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bff } from '@/lib/api';

/** Current purchase cost of a variant (RPT-02), VAT excluded. Null when not entered. */
export interface VariantCost {
  amount: string;
  currency: string;
  updatedAt: string;
}

const key = (productId: string, variantId: string) =>
  ['variant-cost', productId, variantId] as const;
const path = (productId: string, variantId: string) =>
  `products/${productId}/variants/${variantId}/cost`;

export function useVariantCost(productId: string, variantId: string) {
  return useQuery({
    queryKey: key(productId, variantId),
    queryFn: () => bff<{ data: VariantCost | null }>(path(productId, variantId)),
    select: (r) => r.data,
    retry: false,
  });
}

export function useSetVariantCost(productId: string, variantId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { amount: string; currency: string }) =>
      bff<{ data: VariantCost }>(path(productId, variantId), { method: 'PUT', body }),
    onSuccess: (r) => client.setQueryData(key(productId, variantId), r),
  });
}
