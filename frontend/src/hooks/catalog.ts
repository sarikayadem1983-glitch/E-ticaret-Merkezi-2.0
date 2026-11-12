'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { bff } from '@/lib/api';
import type {
  Attribute,
  Brand,
  Category,
  Page,
  Product,
  ProductStatus,
  Variant,
} from '@/lib/types';

export const catalogKeys = {
  products: ['products'] as const,
  productList: (params: Record<string, string>) =>
    ['products', 'list', params] as const,
  product: (id: string) => ['products', 'one', id] as const,
  categories: ['categories'] as const,
  brands: ['brands'] as const,
  attributes: ['attributes'] as const,
};

export interface ProductListParams {
  page: number;
  search: string;
  status: ProductStatus | 'all';
  companyId: string;
  categoryId: string;
  brandId: string;
  perPage?: number;
}

export function useProducts(p: ProductListParams) {
  const params = new URLSearchParams({
    page: String(p.page),
    per_page: String(p.perPage ?? 20),
  });
  if (p.search) params.set('search', p.search);
  if (p.status !== 'all') params.set('status', p.status);
  if (p.companyId) params.set('company_id', p.companyId);
  if (p.categoryId) params.set('category_id', p.categoryId);
  if (p.brandId) params.set('brand_id', p.brandId);
  return useQuery({
    queryKey: catalogKeys.productList(Object.fromEntries(params)),
    queryFn: () => bff<Page<Product>>(`products?${params}`),
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: catalogKeys.product(id),
    queryFn: () => bff<{ data: Product }>(`products/${id}`),
    select: (r) => r.data,
    retry: false,
    enabled: id !== '',
  });
}

/** First 100 entries of a tenant-wide list (categories, brands, attributes). */
function useLookup<T>(key: readonly string[], path: string) {
  return useQuery({
    queryKey: key,
    queryFn: () => bff<Page<T>>(`${path}?per_page=100`),
    select: (r) => r.data,
    staleTime: 60_000,
  });
}

export const useCategories = () =>
  useLookup<Category>(catalogKeys.categories, 'categories');
export const useBrands = () => useLookup<Brand>(catalogKeys.brands, 'brands');
export const useAttributes = () =>
  useLookup<Attribute>(catalogKeys.attributes, 'attributes');

export interface PriceInput {
  channel: string;
  amount: string;
  currency: string;
}

export interface VariantInput {
  sku: string;
  barcode?: string | null;
  attributes?: { attributeId: string; valueId: string }[];
  prices?: PriceInput[];
}

export interface ProductInput {
  companyId?: string;
  name: string;
  description: string | null;
  status: ProductStatus;
  categoryId: string | null;
  brandId: string | null;
  vatRate: string | null;
  variants?: VariantInput[];
}

/** Every catalog write refreshes the product and the lists. */
function useCatalogMutation<I, R>(
  productId: string | undefined,
  fn: (input: I) => Promise<R>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: catalogKeys.products }),
        productId
          ? qc.invalidateQueries({ queryKey: catalogKeys.product(productId) })
          : undefined,
      ]),
  });
}

export function useSaveProduct(id?: string) {
  return useCatalogMutation(id, (input: Partial<ProductInput>) =>
    bff<{ data: Product }>(id ? `products/${id}` : 'products', {
      method: id ? 'PATCH' : 'POST',
      body: input,
    }),
  );
}

export function useDeleteProduct(id: string) {
  return useCatalogMutation(id, () =>
    bff<void>(`products/${id}`, { method: 'DELETE' }),
  );
}

export function useAddVariant(productId: string) {
  return useCatalogMutation(productId, (input: VariantInput) =>
    bff<{ data: Variant }>(`products/${productId}/variants`, {
      method: 'POST',
      body: input,
    }),
  );
}

export function useUpdateVariant(productId: string) {
  return useCatalogMutation(
    productId,
    ({ id, ...input }: { id: string } & Partial<VariantInput>) =>
      bff<{ data: Variant }>(`products/${productId}/variants/${id}`, {
        method: 'PATCH',
        body: input,
      }),
  );
}

export function useDeleteVariant(productId: string) {
  return useCatalogMutation(productId, (id: string) =>
    bff<void>(`products/${productId}/variants/${id}`, { method: 'DELETE' }),
  );
}

export function useGenerateVariants(productId: string) {
  return useCatalogMutation(
    productId,
    (input: {
      skuPrefix: string;
      axes: { attributeId: string; valueIds: string[] }[];
    }) =>
      bff<{ data: { created: Variant[]; skipped: number } }>(
        `products/${productId}/variants/generate`,
        { method: 'POST', body: input },
      ),
  );
}

export function useSetPrice(productId: string) {
  return useCatalogMutation(
    productId,
    ({
      variantId,
      channel,
      ...body
    }: { variantId: string; channel: string; amount: string; currency: string }) =>
      bff<{ data: Variant }>(
        `products/${productId}/variants/${variantId}/prices/${channel}`,
        { method: 'PUT', body },
      ),
  );
}

export function useDeletePrice(productId: string) {
  return useCatalogMutation(
    productId,
    ({ variantId, channel }: { variantId: string; channel: string }) =>
      bff<void>(
        `products/${productId}/variants/${variantId}/prices/${channel}`,
        { method: 'DELETE' },
      ),
  );
}

export function useCreateAttribute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; values: string[] }) =>
      bff<{ data: Attribute }>('attributes', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKeys.attributes }),
  });
}

export function useAddAttributeValue(attributeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: string) =>
      bff<{ data: Attribute }>(`attributes/${attributeId}/values`, {
        method: 'POST',
        body: { value },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKeys.attributes }),
  });
}
