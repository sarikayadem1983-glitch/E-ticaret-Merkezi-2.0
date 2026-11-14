'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { NativeSelect } from '@/components/catalog/common';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
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
import { channelName } from '@/lib/orders';
import { cn } from '@/lib/utils';

type GroupBy = 'day' | 'channel' | 'product';

interface ReportRow {
  key: string;
  label: string;
  currency: string;
  orders: number;
  quantity: number;
  revenue: string;
  returned: number;
}

interface SalesReport {
  data: ReportRow[];
  meta: {
    from: string;
    to: string;
    groupBy: GroupBy;
    totals: { currency: string; orders: number; revenue: string; returned: number }[];
  };
}

const GROUPS: { value: GroupBy; label: string }[] = [
  { value: 'day', label: 'Gün' },
  { value: 'channel', label: 'Kanal' },
  { value: 'product', label: 'Ürün' },
];

/** "YYYY-MM-DD" of a date in Istanbul time. */
function day(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export default function ReportsPage() {
  const today = new Date();
  const [from, setFrom] = useState(day(new Date(today.getTime() - 29 * 86_400_000)));
  const [to, setTo] = useState(day(today));
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [companyId, setCompanyId] = useState('');
  const companies = useCompanies({ page: 1, search: '', status: 'all', perPage: 100 });

  const params = new URLSearchParams({ from, to, group_by: groupBy });
  if (companyId) params.set('company_id', companyId);
  const report = useQuery({
    queryKey: ['reports', 'sales', Object.fromEntries(params)],
    queryFn: () => bff<SalesReport>(`reports/sales?${params}`),
    placeholderData: keepPreviousData,
    enabled: from !== '' && to !== '',
  });

  const rows = report.data?.data ?? [];
  const label = (r: ReportRow) =>
    groupBy === 'day' ? formatDay(r.key) : groupBy === 'channel' ? channelName(r.key) : r.label;

  return (
    <>
      <PageHeader
        title="Raporlar"
        description="Satışlar (iptal ve tedarik edilemeyen siparişler hariç; iadeler ayrı sayılır)"
      />

      <div className="rounded-xl border bg-card shadow-xs">
        <div className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="from" className="text-xs">
              Başlangıç
            </Label>
            <Input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to" className="text-xs">
              Bitiş
            </Label>
            <Input id="to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-10" />
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
          <div className="space-y-1">
            <span className="text-xs font-medium">Gruplama</span>
            <div role="tablist" aria-label="Gruplama" className="flex h-10 rounded-md border p-0.5">
              {GROUPS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  role="tab"
                  aria-selected={groupBy === g.value}
                  onClick={() => setGroupBy(g.value)}
                  className={cn(
                    'flex-1 rounded text-sm font-medium transition-colors',
                    groupBy === g.value ? 'bg-brand-navy text-white' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {report.data && report.data.meta.totals.length > 0 && (
          <div className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-3">
            {report.data.meta.totals.map((t) => (
              <div key={t.currency} className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Ciro ({t.currency})</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-brand-navy">
                  {formatAmount(t.revenue, t.currency)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t.orders} sipariş{t.returned > 0 && ` · ${t.returned} iade`}
                </p>
              </div>
            ))}
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
            <BarChart3 className="mx-auto size-10 text-brand-orange" aria-hidden />
            <p className="mt-3 font-medium text-brand-navy">Bu dönemde satış yok</p>
            <p className="mt-1 text-sm text-muted-foreground">Tarih aralığını veya firmayı değiştirin.</p>
          </div>
        ) : (
          <>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{GROUPS.find((g) => g.value === groupBy)?.label}</TableHead>
                  {groupBy === 'product' && <TableHead>SKU</TableHead>}
                  <TableHead className="text-right">Sipariş</TableHead>
                  <TableHead className="text-right">Adet</TableHead>
                  <TableHead className="text-right">İade</TableHead>
                  <TableHead className="pr-4 text-right">Ciro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.currency}|${r.key}`}>
                    <TableCell className="pl-4 font-medium">{label(r)}</TableCell>
                    {groupBy === 'product' && <TableCell className="font-mono text-xs">{r.key}</TableCell>}
                    <TableCell className="text-right tabular-nums">{r.orders}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.returned || '—'}</TableCell>
                    <TableCell className="pr-4 text-right font-medium tabular-nums">
                      {formatAmount(r.revenue, r.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ul className="divide-y md:hidden">
              {rows.map((r) => (
                <li key={`${r.currency}|${r.key}`} className="p-4">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">{label(r)}</span>
                    <span className="font-medium tabular-nums">{formatAmount(r.revenue, r.currency)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {r.orders} sipariş · {r.quantity} adet{r.returned > 0 && ` · ${r.returned} iade`}
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
