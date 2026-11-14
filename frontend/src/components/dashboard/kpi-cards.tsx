'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, Boxes, PlugZap, Truck } from 'lucide-react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { bff } from '@/lib/api';
import { formatAmount } from '@/lib/money';
import { cn } from '@/lib/utils';

interface Kpis {
  day: string;
  todaySales: { currency: string; orders: number; revenue: string; returned: number }[] | null;
  pendingShipment: number | null;
  lowStock: number | null;
  integrationErrors: number | null;
}

/** DSH-02: each card hides itself when the member may not see that number (null). */
export function KpiCards() {
  const kpis = useQuery({
    queryKey: ['dashboard', 'kpis'],
    queryFn: () => bff<{ data: Kpis }>('dashboard/kpis'),
    select: (r) => r.data,
    refetchInterval: 60_000,
  });
  if (kpis.isLoading) {
    return (
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  const k = kpis.data;
  if (!k) return null;
  const sales = k.todaySales ?? [];
  const orders = sales.reduce((n, s) => n + s.orders, 0);
  const cards = [
    k.todaySales !== null && {
      key: 'sales',
      label: 'Bugünkü satış',
      icon: Banknote,
      href: '/reports',
      value: sales.length ? sales.map((s) => formatAmount(s.revenue, s.currency)).join(' · ') : formatAmount('0', 'TRY'),
      sub: `${orders} sipariş`,
      tone: 'navy',
    },
    k.pendingShipment !== null && {
      key: 'pending',
      label: 'Kargo bekleyen',
      icon: Truck,
      href: '/orders',
      value: String(k.pendingShipment),
      sub: 'Henüz kargoya verilmedi',
      tone: k.pendingShipment > 0 ? 'orange' : 'green',
    },
    k.lowStock !== null && {
      key: 'low',
      label: 'Düşük stok',
      icon: k.lowStock > 0 ? AlertTriangle : Boxes,
      href: '/stock',
      value: String(k.lowStock),
      sub: 'Eşiğin altındaki ürün',
      tone: k.lowStock > 0 ? 'amber' : 'green',
    },
    k.integrationErrors !== null && {
      key: 'errors',
      label: 'Entegrasyon hatası',
      icon: PlugZap,
      href: '/companies',
      value: String(k.integrationErrors),
      sub: 'Son 7 gün',
      tone: k.integrationErrors > 0 ? 'red' : 'green',
    },
  ].filter(Boolean) as {
    key: string;
    label: string;
    icon: typeof Truck;
    href: string;
    value: string;
    sub: string;
    tone: 'navy' | 'orange' | 'green' | 'amber' | 'red';
  }[];
  const tones = {
    navy: 'bg-brand-navy-50 text-brand-navy',
    orange: 'bg-brand-orange-50 text-brand-orange-600',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <section aria-label="Bugün" className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(({ key, label, icon: Icon, href, value, sub, tone }) => (
        <Link key={key} href={href} className="rounded-xl border bg-card p-5 shadow-xs transition-colors hover:bg-muted/40">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <span className={cn('grid size-9 place-items-center rounded-lg', tones[tone])}>
              <Icon className="size-4.5" aria-hidden />
            </span>
          </div>
          <p className="mt-2 truncate text-2xl font-semibold text-brand-navy tabular-nums">{value}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        </Link>
      ))}
    </section>
  );
}
