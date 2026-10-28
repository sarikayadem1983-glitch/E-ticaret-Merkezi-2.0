'use client';

import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useCompanies,
  useCompany,
  useSelectCompany,
  useSession,
} from '@/hooks/queries';
import { errorMessage } from '@/lib/api';

/**
 * Picks the company the user is working on. The choice is stored in the
 * server-side session (after the backend confirms access), not in the browser.
 */
export function CompanySelector() {
  const session = useSession();
  const selectedId = session.data?.selectedCompanyId ?? null;
  const companies = useCompanies({
    page: 1,
    search: '',
    status: 'active',
    perPage: 50,
  });
  const selected = useCompany(selectedId ?? '');
  const select = useSelectCompany();

  const label = selectedId
    ? (selected.data?.legalName ?? 'Firma yükleniyor…')
    : 'Tüm firmalar';

  const choose = (id: string | null) =>
    select.mutate(id, {
      onSuccess: () => toast.success('Çalışılan firma değiştirildi'),
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-9 max-w-[16rem] min-w-0 justify-between gap-2 bg-white"
          aria-label="Firma seç"
        >
          <Building2 className="size-4 shrink-0 text-brand-orange" aria-hidden />
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Çalışılan firma</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => choose(null)}>
          <span className="flex-1">Tüm firmalar</span>
          {!selectedId && <Check className="size-4" aria-hidden />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {companies.isLoading && (
          <DropdownMenuItem disabled>Yükleniyor…</DropdownMenuItem>
        )}
        {companies.data?.data.length === 0 && (
          <DropdownMenuItem disabled>Aktif firma yok</DropdownMenuItem>
        )}
        <div className="max-h-64 overflow-y-auto">
          {companies.data?.data.map((c) => (
            <DropdownMenuItem key={c.id} onSelect={() => choose(c.id)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.legalName}</span>
                <span className="block text-xs text-muted-foreground">
                  {c.taxNumber}
                </span>
              </span>
              {selectedId === c.id && <Check className="size-4" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/companies/new">
            <Plus className="size-4" aria-hidden />
            Yeni firma ekle
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
