'use client';

import { ChevronLeft, ChevronRight, Package, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { NativeSelect, ProductStatusBadge } from '@/components/catalog/common';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  type ProductListParams,
  useBrands,
  useCategories,
  useProducts,
} from '@/hooks/catalog';
import { useCompanies } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { STATUS_LABEL } from '@/lib/catalog';
import { formatAmount, LIST_CHANNEL } from '@/lib/money';
import type { Product } from '@/lib/types';

const PER_PAGE = 20;

/** Lowest list price among the variants, or "—". Compared as strings of equal scale. */
function listPrice(p: Product): string {
  const prices = p.variants
    .flatMap((v) => v.prices)
    .filter((x) => x.channel === LIST_CHANNEL);
  if (prices.length === 0) return '—';
  const key = (a: string) => a.padStart(14, '0');
  const min = prices.reduce((m, x) => (key(x.amount) < key(m.amount) ? x : m));
  const many = new Set(prices.map((x) => x.amount)).size > 1;
  return `${many ? 'en az ' : ''}${formatAmount(min.amount, min.currency)}`;
}

export default function ProductsPage() {
  const [input, setInput] = useState('');
  const [filters, setFilters] = useState<Omit<ProductListParams, 'page'>>({
    search: '',
    status: 'all',
    companyId: '',
    categoryId: '',
    brandId: '',
    perPage: PER_PAGE,
  });
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ({ ...f, search: input.trim() }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const set = <K extends keyof typeof filters>(k: K, v: (typeof filters)[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const list = useProducts({ ...filters, page });
  const companies = useCompanies({ page: 1, search: '', status: 'all', perPage: 100 });
  const categories = useCategories();
  const brands = useBrands();
  const companyName = new Map(
    (companies.data?.data ?? []).map((c) => [c.id, c.legalName]),
  );
  const total = list.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const rows = list.data?.data ?? [];
  const filtered =
    filters.search !== '' ||
    filters.status !== 'all' ||
    filters.companyId !== '' ||
    filters.categoryId !== '' ||
    filters.brandId !== '';

  return (
    <>
      <PageHeader
        title="Ürünler"
        description="Firmalarınızın ürünleri, varyantları ve fiyatları"
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/attributes">Özellikler</Link>
            </Button>
            <Button asChild variant="brand">
              <Link href="/products/new">
                <Plus className="size-4" aria-hidden />
                Yeni ürün
              </Link>
            </Button>
          </>
        }
      />

      <div className="rounded-xl border bg-card shadow-xs">
        <div className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ad, SKU veya barkod"
              aria-label="Ürün ara"
              className="h-10 pl-9"
            />
          </div>
          <NativeSelect
            aria-label="Durum"
            value={filters.status}
            onChange={(e) => set('status', e.target.value as ProductListParams['status'])}
          >
            <option value="all">Tüm durumlar</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Firma"
            value={filters.companyId}
            onChange={(e) => set('companyId', e.target.value)}
          >
            <option value="">Tüm firmalar</option>
            {(companies.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Kategori"
            value={filters.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
          >
            <option value="">Tüm kategoriler</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Marka"
            value={filters.brandId}
            onChange={(e) => set('brandId', e.target.value)}
          >
            <option value="">Tüm markalar</option>
            {(brands.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        {list.isError ? (
          <Alert variant="destructive" className="m-4 w-auto">
            <AlertDescription>{errorMessage(list.error)}</AlertDescription>
          </Alert>
        ) : list.isLoading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <Package className="mx-auto size-10 text-brand-orange" aria-hidden />
            <p className="mt-3 font-medium text-brand-navy">
              {filtered ? 'Sonuç bulunamadı' : 'Henüz ürün yok'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered
                ? 'Arama veya filtreleri değiştirmeyi deneyin.'
                : 'İlk ürününüzü ekleyerek başlayın.'}
            </p>
          </div>
        ) : (
          <>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Ürün</TableHead>
                  <TableHead>Firma</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Varyant</TableHead>
                  <TableHead className="text-right">Liste fiyatı</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-4 font-medium">
                      <Link href={`/products/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell>{companyName.get(p.companyId) ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.variants[0]?.sku ?? '—'}
                      {p.variants.length > 1 && ' …'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.variants.length}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {listPrice(p)}
                    </TableCell>
                    <TableCell>
                      <ProductStatusBadge status={p.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ul className="divide-y md:hidden">
              {rows.map((p) => (
                <li key={p.id}>
                  <Link href={`/products/${p.id}`} className="block p-4 hover:bg-muted/60">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium">{p.name}</span>
                      <ProductStatusBadge status={p.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {p.variants.length} varyant · {listPrice(p)}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {p.variants.map((v) => v.sku).join(', ')}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {total > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              {total} ürün · Sayfa {page}/{pages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="size-10"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Önceki sayfa"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="size-10"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Sonraki sayfa"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
