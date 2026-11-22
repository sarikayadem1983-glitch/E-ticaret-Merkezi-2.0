'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bff } from '@/lib/api';

/** Same limit as the backend and the BFF (IMG-01). */
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export interface ProductImage {
  id: string;
  variantId: string | null;
  width: number;
  height: number;
  position: number;
  /** Signed and short-lived (5 minutes by default). */
  url: string;
}

const key = (productId: string) => ['product-images', productId] as const;
const path = (productId: string) => `products/${productId}/images`;

export function useProductImages(productId: string) {
  return useQuery({
    queryKey: key(productId),
    queryFn: () => bff<{ data: ProductImage[] }>(path(productId)),
    select: (r) => r.data,
    retry: false,
    // Signed URLs expire: fetch fresh ones before that.
    refetchInterval: 4 * 60_000,
  });
}

function useImageMutation<T>(productId: string, fn: (input: T) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => client.invalidateQueries({ queryKey: key(productId) }),
  });
}

export const useUploadImage = (productId: string) =>
  useImageMutation(productId, (file: File) =>
    bff(path(productId), { method: 'POST', raw: file }),
  );

export const useOrderImages = (productId: string) =>
  useImageMutation(productId, (imageIds: string[]) =>
    bff(`${path(productId)}/order`, { method: 'PUT', body: { imageIds } }),
  );

export const useBindImage = (productId: string) =>
  useImageMutation(
    productId,
    ({ imageId, variantId }: { imageId: string; variantId: string | null }) =>
      bff(`${path(productId)}/${imageId}`, { method: 'PATCH', body: { variantId } }),
  );

export const useDeleteImage = (productId: string) =>
  useImageMutation(productId, (imageId: string) =>
    bff(`${path(productId)}/${imageId}`, { method: 'DELETE' }),
  );
