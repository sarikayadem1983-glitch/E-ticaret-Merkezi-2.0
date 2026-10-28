'use client';

import { Building2, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CompanyStatus, PageHeader } from '@/components/page-header';
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
import { type CompanyListParams, useCompanies } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const PER_PAGE = 20;
const STATUSES: { value: CompanyListParams['status']; label: string }[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'active', label: 'Aktif' },
  { value: 'inactive', label: 'Pasif' },
];

export default function CompaniesPage() {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CompanyListParams['status']>('all');
  const [page, setPage] = useState(1);

  // Debounced search: one request after typing stops.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(input.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const list = useCompanies({ page, search, status, perPage: PER_PAGE });
  const total = list.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const rows = list.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Firmalar"
        description="Mağazanıza bağlı işletmeler"
        actions={
          <Button asChild variant="brand">
            <Link href="/companies/new">
              <Plus className="size-4" aria-hidden />
              Yeni firma
            </Link>
          </Button>
        }
      />

      <div className="rounded-xl border bg-card shadow-xs">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Unvan veya vergi numarası ara"
              aria-label="Firma ara"
              className="h-10 pl-9"
            />
          </div>
          <div role="group" aria-label="Durum filtresi" className="inline-flex rounded-lg border p-0.5">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-pressed={status === s.value}
                onClick={() => {
                  setStatus(s.value);
                  setPage(1);
                }}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  status === s.value
                    ? 'bg-brand-navy text-white'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
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
            <Building2 className="mx-auto size-10 text-brand-orange" aria-hidden />
            <p className="mt-3 font-medium text-brand-navy">
              {search || status !== 'all' ? 'Sonuç bulunamadı' : 'Henüz firma yok'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {search || status !== 'all'
                ? 'Arama veya filtreyi değiştirmeyi deneyin.'
                : 'İlk firmanızı ekleyerek başlayın.'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop: table */}
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Ticari unvan</TableHead>
                  <TableHead>VKN / TCKN</TableHead>
                  <TableHead>Vergi dairesi</TableHead>
                  <TableHead>İl</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer">
                    <TableCell className="pl-4 font-medium">
                      <Link href={`/companies/${c.id}`} className="hover:underline">
                        {c.legalName}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">{c.taxNumber}</TableCell>
                    <TableCell>{c.taxOffice}</TableCell>
                    <TableCell>{c.city}</TableCell>
                    <TableCell>
                      <CompanyStatus active={c.isActive} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {/* Mobile: cards */}
            <ul className="divide-y md:hidden">
              {rows.map((c) => (
                <li key={c.id}>
                  <Link href={`/companies/${c.id}`} className="block p-4 hover:bg-muted/60">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium">{c.legalName}</span>
                      <CompanyStatus active={c.isActive} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {c.taxNumber} · {c.taxOffice} · {c.city}
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
              {total} firma · Sayfa {page}/{pages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Önceki sayfa"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
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
