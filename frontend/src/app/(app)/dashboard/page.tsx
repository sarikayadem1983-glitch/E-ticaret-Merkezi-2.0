'use client';

import {
  ArrowRight,
  Building2,
  CircleCheck,
  CirclePause,
  FileText,
  Package,
  Plus,
  ShoppingCart,
  Store,
} from 'lucide-react';
import Link from 'next/link';
import { CompanyStatus, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCompanies, useCompanySummary, useSession } from '@/hooks/queries';
import { cn } from '@/lib/utils';

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  loading,
}: {
  label: string;
  value: number | undefined;
  icon: typeof Building2;
  tone: 'navy' | 'orange' | 'green' | 'muted';
  loading: boolean;
}) {
  const tones = {
    navy: 'bg-brand-navy-50 text-brand-navy',
    orange: 'bg-brand-orange-50 text-brand-orange-600',
    green: 'bg-emerald-50 text-emerald-700',
    muted: 'bg-muted text-muted-foreground',
  };
  return (
    <div className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={cn('grid size-9 place-items-center rounded-lg', tones[tone])}>
          <Icon className="size-4.5" aria-hidden />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-16" />
      ) : (
        <p className="mt-2 text-3xl font-semibold text-brand-navy tabular-nums">
          {value ?? 0}
        </p>
      )}
    </div>
  );
}

const MODULES = [
  { label: 'Siparişler', text: 'Tüm kanallardan gelen siparişler', icon: ShoppingCart },
  { label: 'Ürünler ve Stok', text: 'Ürün kataloğu ve stok takibi', icon: Package },
  { label: 'Pazaryerleri', text: 'Trendyol, Hepsiburada ve diğerleri', icon: Store },
  { label: 'e-Fatura', text: 'e-Fatura ve e-Arşiv entegrasyonu', icon: FileText },
];

export default function DashboardPage() {
  const session = useSession();
  const summary = useCompanySummary();
  const recent = useCompanies({ page: 1, search: '', status: 'all', perPage: 5 });
  const firstName = session.data?.user.name.split(' ')[0];

  return (
    <>
      <PageHeader
        title={firstName ? `Hoş geldiniz, ${firstName}` : 'Hoş geldiniz'}
        description={session.data?.user.tenant?.name}
        actions={
          <Button asChild variant="brand">
            <Link href="/companies/new">
              <Plus className="size-4" aria-hidden />
              Yeni firma
            </Link>
          </Button>
        }
      />

      <section aria-label="Firma özeti" className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Toplam firma"
          value={summary.data?.total}
          icon={Building2}
          tone="navy"
          loading={summary.isLoading}
        />
        <StatCard
          label="Aktif firma"
          value={summary.data?.active}
          icon={CircleCheck}
          tone="green"
          loading={summary.isLoading}
        />
        <StatCard
          label="Pasif firma"
          value={summary.data?.inactive}
          icon={CirclePause}
          tone="muted"
          loading={summary.isLoading}
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <section className="rounded-xl border bg-card shadow-xs lg:col-span-3">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h2 className="font-semibold text-brand-navy">Firmalar</h2>
            <Link
              href="/companies"
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-navy hover:underline"
            >
              Tümü <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
          {recent.isLoading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : recent.data?.data.length ? (
            <ul className="divide-y">
              {recent.data.data.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/companies/${c.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-muted/60"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-navy-50 text-brand-navy">
                      <Building2 className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {c.legalName}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {c.city} · VKN/TCKN {c.taxNumber}
                      </span>
                    </span>
                    <CompanyStatus active={c.isActive} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 py-12 text-center">
              <Building2 className="mx-auto size-10 text-brand-orange" aria-hidden />
              <p className="mt-3 font-medium text-brand-navy">Henüz firma eklenmedi</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Faturalama ve pazaryeri işlemleri için ilk firmanızı ekleyin.
              </p>
              <Button asChild variant="brand" className="mt-4">
                <Link href="/companies/new">Firma ekle</Link>
              </Button>
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-card shadow-xs lg:col-span-2">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold text-brand-navy">Modüller</h2>
            <p className="text-xs text-muted-foreground">
              Geliştirme planındaki modüller
            </p>
          </div>
          <ul className="divide-y">
            {MODULES.map(({ label, text, icon: Icon }) => (
              <li key={label} className="flex items-center gap-3 px-5 py-3.5">
                <span className="grid size-9 place-items-center rounded-lg bg-brand-orange-50 text-brand-orange-600">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{text}</span>
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Yakında
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
