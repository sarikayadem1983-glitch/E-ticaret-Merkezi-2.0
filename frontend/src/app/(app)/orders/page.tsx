'use client';

import { ChevronLeft, ChevronRight, Plus, Search, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { NativeSelect } from '@/components/catalog/common';
import { OrderStatusBadge } from '@/components/orders/common';
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
import { type OrderListParams, useOrders } from '@/hooks/orders';
import { useCompanies, useSession } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatAmount } from '@/lib/money';
import { channelName, formatDateTime, ORDER_STATUS_LABEL } from '@/lib/orders';

const PER_PAGE = 20;

export default function OrdersPage() {
  const [input, setInput] = useState('');
  const [filters, setFilters] = useState<Omit<OrderListParams, 'page'>>({
    search: '',
    status: 'all',
    companyId: '',
    channel: '',
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

  const list = useOrders({ ...filters, page });
  const session = useSession();
  const companies = useCompanies({ page: 1, search: '', status: 'all', perPage: 100 });
  const companyName = new Map((companies.data?.data ?? []).map((c) => [c.id, c.legalName]));
  // The backend decides per company; this only hides a button a viewer cannot use.
  const perms = session.data?.user.permissions ?? [];
  const canWrite = perms.includes('*') || perms.includes('orders:write');
  const total = list.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const rows = list.data?.data ?? [];
  const filtered =
    filters.search !== '' ||
    filters.status !== 'all' ||
    filters.companyId !== '' ||
    filters.channel !== '';

  return (
    <>
      <PageHeader
        title="Siparişler"
        description="Pazaryeri ve elle girilen siparişler"
        actions={
          canWrite && (
            <Button asChild variant="brand">
              <Link href="/orders/new">
                <Plus className="size-4" aria-hidden />
                Elle sipariş
              </Link>
            </Button>
          )
        }
      />

      <div className="rounded-xl border bg-card shadow-xs">
        <div className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pazaryeri sipariş no"
              aria-label="Sipariş ara"
              className="h-10 pl-9"
            />
          </div>
          <NativeSelect
            aria-label="Durum"
            value={filters.status}
            onChange={(e) => set('status', e.target.value as OrderListParams['status'])}
          >
            <option value="all">Tüm durumlar</option>
            {Object.entries(ORDER_STATUS_LABEL).map(([v, l]) => (
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
            aria-label="Kanal"
            value={filters.channel}
            onChange={(e) => set('channel', e.target.value)}
          >
            <option value="">Tüm kanallar</option>
            <option value="trendyol">Trendyol</option>
            <option value="manual">Elle</option>
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
            <ShoppingCart className="mx-auto size-10 text-brand-orange" aria-hidden />
            <p className="mt-3 font-medium text-brand-navy">
              {filtered ? 'Sonuç bulunamadı' : 'Henüz sipariş yok'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered
                ? 'Arama veya filtreleri değiştirmeyi deneyin.'
                : 'Pazaryeri siparişleri entegrasyon bağlandığında burada görünür.'}
            </p>
          </div>
        ) : (
          <>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Tarih</TableHead>
                  <TableHead>Sipariş</TableHead>
                  <TableHead>Kanal</TableHead>
                  <TableHead>Firma</TableHead>
                  <TableHead className="text-right">Tutar</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="pl-4 whitespace-nowrap tabular-nums">
                      {formatDateTime(o.orderedAt)}
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/orders/${o.id}`} className="hover:underline">
                        {o.externalOrderNo ?? `#${o.id.slice(0, 8)}`}
                      </Link>
                    </TableCell>
                    <TableCell>{channelName(o.channel)}</TableCell>
                    <TableCell>{companyName.get(o.companyId) ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatAmount(o.total, o.currency)}
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={o.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ul className="divide-y md:hidden">
              {rows.map((o) => (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="block p-4 hover:bg-muted/60">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium">
                        {o.externalOrderNo ?? `#${o.id.slice(0, 8)}`}
                      </span>
                      <OrderStatusBadge status={o.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {channelName(o.channel)} · {formatDateTime(o.orderedAt)}
                    </p>
                    <p className="mt-0.5 flex justify-between gap-3 text-sm">
                      <span className="truncate text-muted-foreground">
                        {companyName.get(o.companyId) ?? '—'}
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatAmount(o.total, o.currency)}
                      </span>
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
              {total} sipariş · Sayfa {page}/{pages}
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
