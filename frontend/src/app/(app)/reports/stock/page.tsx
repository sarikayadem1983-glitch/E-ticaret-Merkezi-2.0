'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Boxes } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { NativeSelect } from '@/components/catalog/common';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCompanies } from '@/hooks/queries';
import { bff, errorMessage } from '@/lib/api';
import { formatAmount } from '@/lib/money';

interface StockRow {
  variantId: string;
  sku: string;
  name: string;
  onHand: number;
  available: number;
  soldUnits: number;
  turnover: string | null;
  daysOfCover: number | null;
  outOfStock: boolean;
  unitCost: string | null;
  value: string | null;
  currency: string | null;
}

interface StockReport {
  data: StockRow[];
  meta: {
    days: number;
    totals: {
      variants: number;
      outOfStock: number;
      onHand: number;
      soldUnits: number;
      value: { currency: string; amount: string }[];
      missingCost: number;
    };
  };
}

const PERIODS = [7, 30, 90, 365];

export default function StockReportPage() {
  const [days, setDays] = useState(30);
  const [companyId, setCompanyId] = useState('');
  const [onlyOut, setOnlyOut] = useState(false);
  const companies = useCompanies({ page: 1, search: '', status: 'all', perPage: 100 });

  const params = new URLSearchParams({ days: String(days) });
  if (companyId) params.set('company_id', companyId);
  const report = useQuery({
    queryKey: ['reports', 'stock', Object.fromEntries(params)],
    queryFn: () => bff<StockReport>(`reports/stock?${params}`),
    placeholderData: keepPreviousData,
  });

  const all = report.data?.data ?? [];
  const rows = onlyOut ? all.filter((r) => r.outOfStock) : all;
  const totals = report.data?.meta.totals;
  const value = (r: StockRow) => (r.value && r.currency ? formatAmount(r.value, r.currency) : '—');

  return (
    <>
      <Link href="/reports" className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Raporlar
      </Link>
      <PageHeader
        title="Stok raporu"
        description="Stok değeri güncel alış maliyetiyle (KDV hariç) hesaplanır; satış, dönemdeki net sipariş çıkışıdır."
      />

      <div className="rounded-xl border bg-card shadow-xs">
        <div className="grid gap-3 border-b p-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="days" className="text-xs">
              Satış dönemi
            </Label>
            <NativeSelect id="days" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
              {PERIODS.map((d) => (
                <option key={d} value={d}>
                  Son {d} gün
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="company" className="text-xs">
              Firma
            </Label>
            <NativeSelect id="company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Tüm firmalar</option>
              {(companies.data?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
            </NativeSelect>
          </div>
          <label className="flex min-h-10 items-center gap-2 self-end text-sm">
            <input type="checkbox" className="size-4" checked={onlyOut} onChange={(e) => setOnlyOut(e.target.checked)} />
            Yalnız stoksuz olanlar
          </label>
        </div>

        {totals && (
          <div className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-4">
            {totals.value.map((t) => (
              <div key={t.currency} className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Stok değeri ({t.currency})</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-brand-navy">{formatAmount(t.amount, t.currency)}</p>
              </div>
            ))}
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Stoksuz varyant</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-brand-navy">
                {totals.outOfStock} / {totals.variants}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Eldeki / satılan adet</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-brand-navy">
                {totals.onHand} / {totals.soldUnits}
              </p>
            </div>
            {totals.missingCost > 0 && (
              <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-4">
                {totals.missingCost} varyantın alış maliyeti girilmedi; değere katılmadı. Maliyeti ürün sayfasından girebilirsiniz.
              </p>
            )}
          </div>
        )}

        {report.isError ? (
          <Alert variant="destructive" className="m-4 w-auto">
            <AlertDescription>{errorMessage(report.error)}</AlertDescription>
          </Alert>
        ) : report.isLoading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <Boxes className="mx-auto size-10 text-brand-orange" aria-hidden />
            <p className="mt-3 font-medium text-brand-navy">{onlyOut ? 'Stoksuz varyant yok' : 'Varyant yok'}</p>
          </div>
        ) : (
          <>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Ürün</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Eldeki</TableHead>
                  <TableHead className="text-right">Satılabilir</TableHead>
                  <TableHead className="text-right">Satılan</TableHead>
                  <TableHead className="text-right">Devir</TableHead>
                  <TableHead className="text-right">Yeter (gün)</TableHead>
                  <TableHead className="pr-4 text-right">Değer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.variantId}>
                    <TableCell className="pl-4 font-medium">
                      {r.name} {r.outOfStock && <Badge variant="destructive">Stoksuz</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.onHand}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.available}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.soldUnits}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.turnover ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.daysOfCover ?? '—'}</TableCell>
                    <TableCell className="pr-4 text-right font-medium tabular-nums">{value(r)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ul className="divide-y md:hidden">
              {rows.map((r) => (
                <li key={r.variantId} className="p-4">
                  <div className="flex justify-between gap-3">
                    <span className="min-w-0 font-medium">{r.name}</span>
                    <span className="font-medium tabular-nums">{value(r)}</span>
                  </div>
                  <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{r.sku}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {r.outOfStock && <Badge variant="destructive" className="mr-2">Stoksuz</Badge>}
                    {r.onHand} eldeki · {r.soldUnits} satılan
                    {r.daysOfCover !== null && ` · ${r.daysOfCover} gün yeter`}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
