'use client';

import { Check, ChevronsUpDown, Store } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMemberships, useSwitchTenant } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';

/**
 * Switches between the stores the user is an active member of. Hidden for
 * users with a single store. A switch reloads the whole page.
 */
export function TenantSelector() {
  const memberships = useMemberships();
  const switchTenant = useSwitchTenant();
  const stores = memberships.data ?? [];
  if (stores.length < 2) return null;
  const current = stores.find((m) => m.current);

  const choose = (tenantId: string) => {
    if (tenantId === current?.tenantId || switchTenant.isPending) return;
    switchTenant.mutate(tenantId, {
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-9 max-w-[14rem] min-w-0 justify-between gap-2 bg-white"
          aria-label="Mağaza seç"
          disabled={switchTenant.isPending}
        >
          <Store className="size-4 shrink-0 text-brand-orange" aria-hidden />
          <span className="truncate">{current?.name ?? 'Mağaza'}</span>
          <ChevronsUpDown
            className="size-3.5 shrink-0 opacity-60"
            aria-hidden
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Mağaza</DropdownMenuLabel>
        <div className="max-h-64 overflow-y-auto">
          {stores.map((m) => (
            <DropdownMenuItem
              key={m.tenantId}
              onSelect={() => choose(m.tenantId)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{m.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {m.slug}
                </span>
              </span>
              {m.current && <Check className="size-4" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
