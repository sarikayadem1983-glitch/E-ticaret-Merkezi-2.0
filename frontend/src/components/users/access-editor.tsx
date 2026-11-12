'use client';

import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCompanies } from '@/hooks/queries';
import { type AccessValue, COMPANY_ROLES } from '@/lib/access';
import type { CompanyRoleKey } from '@/lib/types';

/**
 * The "Admin" switch, or one "company + role" row per company. Admin is
 * offered only when the actor may grant it (owners grant Admin).
 */
export function AccessEditor({
  value,
  onChange,
  canGrantAdmin,
  idPrefix,
}: {
  value: AccessValue;
  onChange: (value: AccessValue) => void;
  canGrantAdmin: boolean;
  idPrefix: string;
}) {
  const companies = useCompanies({
    page: 1,
    search: '',
    status: 'active',
    perPage: 100,
  });
  const options = companies.data?.data ?? [];
  const isAdmin = 'tenantRole' in value;
  const rows = 'companyRoles' in value ? value.companyRoles : [];

  const setRows = (next: typeof rows) => onChange({ companyRoles: next });
  const update = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      {canGrantAdmin && (
        <div className="flex items-start gap-3 rounded-lg border p-3">
          <Checkbox
            id={`${idPrefix}-admin`}
            checked={isAdmin}
            onCheckedChange={(checked) =>
              onChange(
                checked === true
                  ? { tenantRole: 'admin' }
                  : { companyRoles: [{ companyId: '', roleKey: 'viewer' }] },
              )
            }
          />
          <div className="space-y-0.5">
            <Label htmlFor={`${idPrefix}-admin`}>Admin</Label>
            <p className="text-xs text-muted-foreground">
              Tüm firmalara ve kullanıcı yönetimine erişir.
            </p>
          </div>
        </div>
      )}

      {!isAdmin && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Firma erişimi</legend>
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select
                value={row.companyId}
                onValueChange={(companyId) => update(i, { companyId })}
              >
                <SelectTrigger
                  aria-label={`Firma ${i + 1}`}
                  className="h-10 min-w-0 flex-1"
                >
                  <SelectValue placeholder="Firma seçin" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.legalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={row.roleKey}
                onValueChange={(roleKey) =>
                  update(i, { roleKey: roleKey as CompanyRoleKey })
                }
              >
                <SelectTrigger aria-label={`Rol ${i + 1}`} className="h-10 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPANY_ROLES.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Satır ${i + 1} kaldır`}
                disabled={rows.length === 1}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows([...rows, { companyId: '', roleKey: 'viewer' }])}
          >
            <Plus className="size-4" aria-hidden />
            Firma ekle
          </Button>
          {companies.isSuccess && options.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Aktif firma yok. Önce bir firma ekleyin.
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}
