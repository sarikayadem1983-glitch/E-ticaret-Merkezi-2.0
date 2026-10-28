'use client';

import {
  Building2,
  FileText,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Store,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandLogo } from '@/components/brand-logo';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/companies', label: 'Firmalar', icon: Building2 },
  { href: '/profile', label: 'Profil', icon: UserRound },
] as const;

/** Planned modules, shown so the menu reflects the roadmap; not clickable yet. */
const SOON = [
  { label: 'Siparişler', icon: ShoppingCart },
  { label: 'Ürünler ve Stok', icon: Package },
  { label: 'Pazaryerleri', icon: Store },
  { label: 'e-Fatura', icon: FileText },
] as const;

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 py-5">
        <BrandLogo inverted />
      </div>
      <nav aria-label="Ana menü" className="flex-1 space-y-6 px-3">
        <ul className="space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
                    active
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'hover:bg-sidebar-accent hover:text-white',
                  )}
                >
                  <Icon className="size-4.5" aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div>
          <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-sidebar-foreground/60 uppercase">
            Yakında
          </p>
          <ul className="space-y-1">
            {SOON.map(({ label, icon: Icon }) => (
              <li
                key={label}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground/55"
              >
                <Icon className="size-4.5" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <p className="px-5 py-4 text-xs text-sidebar-foreground/50">
        © {new Date().getFullYear()} Ticaret Merkezi 2.0
      </p>
    </div>
  );
}
