'use client';

import { AlertTriangle, Boxes, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { NativeSelect } from '@/components/catalog/common';
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
import { useProducts } from '@/hooks/catalog';
import {
  type MovementReason,
  MOVEMENT_REASONS,
  type StockLevel,
  useCreateMovement,
  useCreateWarehouse,
  useLowStock,
  useSetThreshold,
  useStockLevels,
  useWarehouses,
} from '@/hooks/inventory';
import { useCompanies, useSession } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { variantLabel } from '@/lib/catalog';
import { cn } from '@/lib/utils';

type Tab = 'all' | 'low';

function LowBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
      <AlertTriangle className="size-3" aria-hidden />
      Düşük
    </span>
  );
}

const isLow = (l: { available: number; threshold: number | null }) =>
  l.threshold !== null && l.available <= l.threshold;

export default function StockPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [companyId, setCompanyId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<'warehouse' | 'movement' | null>(null);
  const [thresholdFor, setThresholdFor] = useState<{ variantId: string; sku: string | null; current: number | null } | null>(null);
  const session = useSession();
  const perms = session.data?.user.permissions ?? [];
  const canWrite = perms.includes('*') || perms.includes('inventory:write');

  const companies = useCompanies({ page: 1, search: '', status: 'all', perPage: 100 });
  const warehouses = useWarehouses(companyId);
  const levels = useStockLevels({ page, companyId, warehouseId });
  const low = useLowStock(companyId);
  const total = levels.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 50));
  const rows = levels.data?.data ?? [];
  const lowRows = low.data ?? [];

  return (
    <>
      <PageHeader
        title="Stok"
        description="Depolardaki stok, ayrılmış ve kullanılabilir miktarlar. Pazaryerine hiçbir şey gönderilmez."
        actions={
          canWrite && (
            <>
              <Button variant="outline" onClick={() => setDialog('warehouse')}>
                <Plus className="size-4" aria-hidden />
                Depo
              </Button>
              <Button variant="brand" onClick={() => setDialog('movement')}>
                <Plus className="size-4" aria-hidden />
                Stok hareketi
              </Button>
            </>
          )
        }
      />

      {lowRows.length > 0 && tab === 'all' && (
        <Alert className="mb-4">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertDescription>
            {lowRows.length} ürün eşiğin altında.{' '}
            <button type="button" className="font-medium underline" onClick={() => setTab('low')}>
              Listeyi gör
            </button>
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-xl border bg-card shadow-xs">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
          <div role="tablist" aria-label="Görünüm" className="flex h-10 rounded-md border p-0.5 lg:w-64">
            {(
              [
                ['all', 'Tüm stok'],
                ['low', `Düşük stok${lowRows.length ? ` (${lowRows.length})` : ''}`],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={tab === v}
                onClick={() => setTab(v)}
                className={cn(
                  'flex-1 rounded text-sm font-medium transition-colors',
                  tab === v ? 'bg-brand-navy text-white' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <NativeSelect
              aria-label="Firma"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setWarehouseId('');
                setPage(1);
              }}
            >
              <option value="">Tüm firmalar</option>
              {(companies.data?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
            </NativeSelect>
            {tab === 'all' && (
              <NativeSelect
                aria-label="Depo"
                value={warehouseId}
                onChange={(e) => {
                  setWarehouseId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Tüm depolar</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.isDefault ? ' (varsayılan)' : ''}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
        </div>

        {tab === 'low' ? (
          low.isError ? (
            <Alert variant="destructive" className="m-4 w-auto">
              <AlertDescription>{errorMessage(low.error)}</AlertDescription>
            </Alert>
          ) : lowRows.length === 0 ? (
            <Empty title="Eşiğin altında ürün yok" text="Ürünlere eşik tanımlamak için Tüm stok sekmesinde Eşik düğmesini kullanın." />
          ) : (
            <ul className="divide-y">
              {lowRows.map((r) => (
                <li key={r.variantId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <span className="min-w-0">
                    <span className="block font-medium">{r.productName ?? '—'}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{r.sku}</span>
                  </span>
                  <span className="flex items-center gap-3 text-sm">
                    <LowBadge />
                    <span className="tabular-nums">
                      {r.available} / eşik {r.threshold}
                    </span>
                    {canWrite && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-10"
                        onClick={() => setThresholdFor({ variantId: r.variantId, sku: r.sku, current: r.threshold })}
                      >
                        Eşik
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : levels.isError ? (
          <Alert variant="destructive" className="m-4 w-auto">
            <AlertDescription>{errorMessage(levels.error)}</AlertDescription>
          </Alert>
        ) : levels.isLoading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty
            title="Henüz stok yok"
            text="Önce bir depo ekleyin, sonra açılış stoku hareketi girin."
          />
        ) : (
          <>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Ürün</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Depo</TableHead>
                  <TableHead className="text-right">Eldeki</TableHead>
                  <TableHead className="text-right">Ayrılmış</TableHead>
                  <TableHead className="text-right">Kullanılabilir</TableHead>
                  <TableHead className="pr-4 text-right">Eşik</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-4 font-medium">{l.productName ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                    <TableCell>{l.warehouseName}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.onHand}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.reserved || '—'}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      <span className="inline-flex items-center gap-2">
                        {isLow(l) && <LowBadge />}
                        {l.available}
                      </span>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <ThresholdButton level={l} canWrite={canWrite} onEdit={setThresholdFor} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ul className="divide-y md:hidden">
              {rows.map((l) => (
                <li key={l.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">{l.productName ?? '—'}</span>
                    {isLow(l) && <LowBadge />}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {l.sku} · {l.warehouseName}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                    <span className="tabular-nums text-muted-foreground">
                      Eldeki {l.onHand} · Ayrılmış {l.reserved} ·{' '}
                      <span className="font-medium text-foreground">Kullanılabilir {l.available}</span>
                    </span>
                    <ThresholdButton level={l} canWrite={canWrite} onEdit={setThresholdFor} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === 'all' && total > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              {total} stok satırı · Sayfa {page}/{pages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="size-10" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Önceki sayfa">
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="sm" className="size-10" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Sonraki sayfa">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {dialog === 'warehouse' && (
        <WarehouseDialog companies={companies.data?.data ?? []} onClose={() => setDialog(null)} />
      )}
      {dialog === 'movement' && (
        <MovementDialog companies={companies.data?.data ?? []} onClose={() => setDialog(null)} />
      )}
      {thresholdFor && <ThresholdDialog target={thresholdFor} onClose={() => setThresholdFor(null)} />}
    </>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="px-4 py-16 text-center">
      <Boxes className="mx-auto size-10 text-brand-orange" aria-hidden />
      <p className="mt-3 font-medium text-brand-navy">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function ThresholdButton({
  level,
  canWrite,
  onEdit,
}: {
  level: StockLevel;
  canWrite: boolean;
  onEdit: (t: { variantId: string; sku: string | null; current: number | null }) => void;
}) {
  const text = level.threshold === null ? '—' : String(level.threshold);
  if (!canWrite) return <span className="tabular-nums">{text}</span>;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="min-h-10 tabular-nums"
      aria-label={`${level.sku ?? ''} eşiğini düzenle`}
      onClick={() => onEdit({ variantId: level.variantId, sku: level.sku, current: level.threshold })}
    >
      {text === '—' ? 'Eşik' : text}
    </Button>
  );
}

function ThresholdDialog({
  target,
  onClose,
}: {
  target: { variantId: string; sku: string | null; current: number | null };
  onClose: () => void;
}) {
  const save = useSetThreshold();
  const [value, setValue] = useState(target.current === null ? '' : String(target.current));
  const [error, setError] = useState<string | null>(null);
  const submit = (threshold: number | null) =>
    save.mutate(
      { variantId: target.variantId, threshold },
      {
        onSuccess: () => {
          toast.success(threshold === null ? 'Eşik kaldırıldı' : 'Eşik kaydedildi');
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Düşük stok eşiği</DialogTitle>
          <DialogDescription>
            {target.sku}: tüm depolardaki kullanılabilir stok bu sayıya eşit veya altındaysa uyarı gösterilir.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="threshold">Eşik (adet)</Label>
          <Input id="threshold" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className="h-10" />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          {target.current !== null && (
            <Button variant="outline" disabled={save.isPending} onClick={() => submit(null)}>
              Eşiği kaldır
            </Button>
          )}
          <Button
            variant="brand"
            disabled={save.isPending}
            onClick={() => {
              if (!/^\d+$/.test(value) || Number(value) > 1_000_000) {
                return setError('0 ile 1000000 arasında tam sayı girin.');
              }
              submit(Number(value));
            }}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WarehouseDialog({
  companies,
  onClose,
}: {
  companies: { id: string; legalName: string }[];
  onClose: () => void;
}) {
  const create = useCreateWarehouse();
  const [companyId, setCompanyId] = useState(companies.length === 1 ? companies[0].id : '');
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yeni depo</DialogTitle>
          <DialogDescription>Her firmanın en çok bir varsayılan deposu olur; sipariş rezervasyonu oradan yapılır.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="wh-company">Firma</Label>
            <NativeSelect id="wh-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Firma seçin</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="wh-name">Depo adı</Label>
            <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="h-10" />
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="size-4" />
            Varsayılan depo
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="brand"
            disabled={create.isPending}
            onClick={() => {
              if (!companyId || !name.trim()) return setError('Firma ve depo adı gerekli.');
              create.mutate(
                { companyId, name: name.trim(), isDefault },
                {
                  onSuccess: () => {
                    toast.success('Depo eklendi');
                    onClose();
                  },
                  onError: (e) => setError(errorMessage(e)),
                },
              );
            }}
          >
            Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovementDialog({
  companies,
  onClose,
}: {
  companies: { id: string; legalName: string }[];
  onClose: () => void;
}) {
  const create = useCreateMovement();
  const [companyId, setCompanyId] = useState(companies.length === 1 ? companies[0].id : '');
  const warehouses = useWarehouses(companyId);
  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const products = useProducts({ page: 1, perPage: 10, search, status: 'all', companyId, categoryId: '', brandId: '' });
  const [variantId, setVariantId] = useState('');
  const [reason, setReason] = useState<MovementReason>('opening');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const variants = (products.data?.data ?? []).flatMap((p) =>
    p.variants.map((v) => ({ id: v.id, label: `${p.name}${variantLabel(v) ? ` · ${variantLabel(v)}` : ''} (${v.sku})` })),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stok hareketi</DialogTitle>
          <DialogDescription>
            Hareketler silinemez; yanlış giriş yeni bir düzeltme hareketiyle geri alınır.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <NativeSelect aria-label="Firma" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setWarehouseId(''); setVariantId(''); }}>
            <option value="">Firma seçin</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Depo" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={!companyId}>
            <option value="">Depo seçin</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </NativeSelect>
          <Input
            type="search"
            aria-label="Ürün ara"
            placeholder="Ürün adı veya SKU ile ara"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={!companyId}
            className="h-10"
          />
          <NativeSelect aria-label="Varyant" value={variantId} onChange={(e) => setVariantId(e.target.value)} disabled={!companyId}>
            <option value="">Varyant seçin</option>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </NativeSelect>
          <div className="grid gap-3 sm:grid-cols-2">
            <NativeSelect aria-label="Neden" value={reason} onChange={(e) => setReason(e.target.value as MovementReason)}>
              {Object.entries(MOVEMENT_REASONS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
            <Input
              aria-label="Miktar"
              inputMode="numeric"
              placeholder={reason === 'adjustment' || reason === 'count' ? 'ör. -2 veya 5' : 'ör. 10'}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-10"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="brand"
            disabled={create.isPending}
            onClick={() => {
              const q = Number(quantity);
              if (!warehouseId || !variantId) return setError('Depo ve varyant seçin.');
              if (!/^-?\d+$/.test(quantity.trim()) || q === 0) return setError('Miktar sıfırdan farklı tam sayı olmalı.');
              create.mutate(
                { warehouseId, variantId, quantity: q, reason },
                {
                  onSuccess: () => {
                    toast.success('Stok hareketi kaydedildi');
                    onClose();
                  },
                  onError: (e) => setError(errorMessage(e)),
                },
              );
            }}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
