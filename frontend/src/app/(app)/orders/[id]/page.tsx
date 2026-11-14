'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { OrderStatusBadge } from '@/components/orders/common';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useChangeOrderStatus, useOrder, useReserveOrder } from '@/hooks/orders';
import { useCompany, useSession } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatAmount } from '@/lib/money';
import {
  channelName,
  FINAL_STATUSES,
  formatDateTime,
  HISTORY_SOURCE_LABEL,
  isOrderStatus,
  nextStatuses,
  ORDER_STATUS_LABEL,
  type OrderStatus,
} from '@/lib/orders';

/** Statuses before shipping: stock can still be reserved (backend checks again). */
const RESERVABLE: readonly OrderStatus[] = ['awaiting', 'created', 'picking', 'invoiced', 'unpacked', 'repack'];

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const order = useOrder(id);
  const session = useSession();
  const change = useChangeOrderStatus(id);
  const reserve = useReserveOrder(id);
  const company = useCompany(order.data?.companyId ?? '');
  const [confirm, setConfirm] = useState<OrderStatus | null>(null);
  const perms = session.data?.user.permissions ?? [];
  const canWrite = perms.includes('*') || perms.includes('orders:write');
  const canStock = perms.includes('*') || perms.includes('inventory:write');

  if (order.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (order.isError || !order.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(order.error)}</AlertDescription>
      </Alert>
    );
  }
  const o = order.data;
  const next = canWrite ? nextStatuses(o) : [];
  const title = o.externalOrderNo ?? `Sipariş #${o.id.slice(0, 8)}`;

  const apply = (status: OrderStatus) =>
    change.mutate(status, {
      onSuccess: () => {
        toast.success(`Durum: ${ORDER_STATUS_LABEL[status]}`);
        setConfirm(null);
      },
      onError: (e) => {
        toast.error(errorMessage(e));
        setConfirm(null);
      },
    });

  return (
    <div className="space-y-6">
      <Link
        href="/orders"
        className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Siparişler
      </Link>
      <PageHeader
        title={title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={o.status} />
            <span>
              {channelName(o.channel)} · {formatDateTime(o.orderedAt)}
              {company.data ? ` · ${company.data.legalName}` : ''}
            </span>
          </span>
        }
      />

      {o.channel !== 'manual' && (
        <Alert>
          <AlertDescription>
            Bu sipariş pazaryerinden geliyor; durumu pazaryerinden güncellenir. Buradan
            pazaryerine hiçbir değişiklik gönderilmez.
          </AlertDescription>
        </Alert>
      )}

      {canStock && RESERVABLE.includes(o.status) && (
        <section aria-label="Stok" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-xs">
          <p className="text-sm text-muted-foreground">
            Stok, firmanın varsayılan deposundan ayrılır; kargoya verilince düşülür, iptalde serbest kalır.
          </p>
          <Button
            variant="outline"
            className="min-h-10"
            disabled={reserve.isPending}
            onClick={() =>
              reserve.mutate(undefined, {
                onSuccess: () => toast.success('Stok ayrıldı'),
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            Stok ayır
          </Button>
        </section>
      )}

      {next.length > 0 && (
        <section aria-label="Durum değiştir" className="rounded-xl border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-medium text-brand-navy">Durumu değiştir</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {next.map((s) => (
              <Button
                key={s}
                variant={FINAL_STATUSES.includes(s) ? 'outline' : 'secondary'}
                className="min-h-10"
                disabled={change.isPending}
                onClick={() => (FINAL_STATUSES.includes(s) ? setConfirm(s) : apply(s))}
              >
                {ORDER_STATUS_LABEL[s]}
              </Button>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border bg-card shadow-xs">
        <h2 className="border-b px-4 py-3 text-sm font-medium text-brand-navy">Ürünler</h2>
        <Table className="hidden md:table">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Ürün</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Adet</TableHead>
              <TableHead className="text-right">Birim fiyat</TableHead>
              <TableHead className="text-right">İndirim</TableHead>
              <TableHead className="text-right">KDV</TableHead>
              <TableHead className="pr-4 text-right">Tutar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {o.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="pl-4 font-medium">
                  {i.name}
                  {!i.variantId && (
                    <span className="ml-2 text-xs text-amber-700">(eşleşmedi)</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{i.sku}</TableCell>
                <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(i.unitPrice, o.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(i.discount, o.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {i.vatRate === null ? '—' : `%${i.vatRate.replace(/\.00$/, '')}`}
                </TableCell>
                <TableCell className="pr-4 text-right font-medium tabular-nums">
                  {formatAmount(i.lineTotal, o.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ul className="divide-y md:hidden">
          {o.items.map((i) => (
            <li key={i.id} className="p-4">
              <div className="flex justify-between gap-3">
                <span className="font-medium">{i.name}</span>
                <span className="font-medium tabular-nums">
                  {formatAmount(i.lineTotal, o.currency)}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{i.sku}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {i.quantity} × {formatAmount(i.unitPrice, o.currency)}
                {i.discount !== '0.00' && ` − ${formatAmount(i.discount, o.currency)}`}
              </p>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t px-4 py-3 text-sm">
          {(
            [
              ['Ara toplam', o.subtotal],
              ['Satıcı indirimi', o.discountTotal],
              ['Pazaryeri indirimi', o.channelDiscountTotal],
              ['Kargo', o.shippingTotal],
            ] as const
          )
            .filter(([label, v]) => label === 'Ara toplam' || v !== '0.00')
            .map(([label, v]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{formatAmount(v, o.currency)}</dd>
              </div>
            ))}
          <div className="flex justify-between gap-3 pt-1 font-semibold">
            <dt>Toplam</dt>
            <dd className="tabular-nums">{formatAmount(o.total, o.currency)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border bg-card shadow-xs">
        <h2 className="border-b px-4 py-3 text-sm font-medium text-brand-navy">Durum geçmişi</h2>
        <ol className="divide-y">
          {[...o.statusHistory].reverse().map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="inline-flex items-center gap-2">
                {isOrderStatus(h.toStatus) ? <OrderStatusBadge status={h.toStatus} /> : h.toStatus}
                <span className="text-muted-foreground">
                  {HISTORY_SOURCE_LABEL[h.source] ?? h.source}
                </span>
              </span>
              <span className="tabular-nums text-muted-foreground">{formatDateTime(h.changedAt)}</span>
            </li>
          ))}
        </ol>
      </section>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm ? `Sipariş “${ORDER_STATUS_LABEL[confirm]}” olarak işaretlensin mi?` : ''}
            </DialogTitle>
            <DialogDescription>
              Bu son bir durumdur; sonrasında sipariş durumu değiştirilemez.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              disabled={change.isPending}
              onClick={() => confirm && apply(confirm)}
            >
              Onayla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
