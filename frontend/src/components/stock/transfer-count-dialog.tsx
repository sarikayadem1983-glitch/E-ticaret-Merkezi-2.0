'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { NativeSelect } from '@/components/catalog/common';
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
import { useProducts } from '@/hooks/catalog';
import { useStockCount, useStockTransfer, useWarehouses } from '@/hooks/inventory';
import { errorMessage } from '@/lib/api';
import { variantLabel } from '@/lib/catalog';
import { cn } from '@/lib/utils';

type Mode = 'transfer' | 'count';

/** INV-04: move stock between two warehouses of a company, or record a count. */
export function TransferCountDialog({
  companies,
  onClose,
}: {
  companies: { id: string; legalName: string }[];
  onClose: () => void;
}) {
  const transfer = useStockTransfer();
  const count = useStockCount();
  const [mode, setMode] = useState<Mode>('transfer');
  const [companyId, setCompanyId] = useState(companies.length === 1 ? companies[0].id : '');
  const warehouses = useWarehouses(companyId);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const products = useProducts({ page: 1, perPage: 10, search, status: 'all', companyId, categoryId: '', brandId: '' });
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = transfer.isPending || count.isPending;
  const variants = (products.data?.data ?? []).flatMap((p) =>
    p.variants.map((v) => ({
      id: v.id,
      label: `${p.name}${variantLabel(v) ? ` · ${variantLabel(v)}` : ''} (${v.sku})`,
    })),
  );

  const submit = () => {
    setError(null);
    if (!variantId || !from || (mode === 'transfer' && !to)) return setError('Depo ve varyant seçin.');
    if (!/^\d+$/.test(quantity.trim())) return setError('Miktar 0 veya pozitif tam sayı olmalı.');
    const q = Number(quantity);
    const done = (text: string) => {
      toast.success(text);
      onClose();
    };
    const fail = (e: unknown) => setError(errorMessage(e));
    if (mode === 'transfer') {
      if (from === to) return setError('Kaynak ve hedef depo farklı olmalı.');
      if (q < 1) return setError('Transfer miktarı en az 1 olmalı.');
      transfer.mutate(
        { fromWarehouseId: from, toWarehouseId: to, variantId, quantity: q },
        { onSuccess: () => done(`${q} adet transfer edildi`), onError: fail },
      );
    } else {
      count.mutate(
        { warehouseId: from, variantId, counted: q },
        {
          onSuccess: (res) =>
            done(
              res.data.difference === 0
                ? 'Sayım stokla aynı; hareket yazılmadı'
                : `Sayım farkı ${res.data.difference > 0 ? '+' : ''}${res.data.difference} kaydedildi`,
            ),
          onError: fail,
        },
      );
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer / sayım</DialogTitle>
          <DialogDescription>
            Transfer iki hareket olarak kaydedilir; sayım yalnızca farkı yazar. Hareketler silinemez.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div role="tablist" aria-label="İşlem" className="flex h-10 rounded-md border p-0.5">
            {(
              [
                ['transfer', 'Depolar arası transfer'],
                ['count', 'Stok sayımı'],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={mode === v}
                onClick={() => setMode(v)}
                className={cn(
                  'flex-1 rounded text-sm font-medium transition-colors',
                  mode === v ? 'bg-brand-navy text-white' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <NativeSelect
            aria-label="Firma"
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setFrom('');
              setTo('');
              setVariantId('');
            }}
          >
            <option value="">Firma seçin</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </NativeSelect>
          <div className={cn('grid gap-3', mode === 'transfer' && 'sm:grid-cols-2')}>
            <NativeSelect aria-label={mode === 'transfer' ? 'Kaynak depo' : 'Depo'} value={from} onChange={(e) => setFrom(e.target.value)} disabled={!companyId}>
              <option value="">{mode === 'transfer' ? 'Kaynak depo' : 'Depo seçin'}</option>
              {(warehouses.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
            {mode === 'transfer' && (
              <NativeSelect aria-label="Hedef depo" value={to} onChange={(e) => setTo(e.target.value)} disabled={!companyId}>
                <option value="">Hedef depo</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
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
          <Input
            aria-label={mode === 'transfer' ? 'Transfer miktarı' : 'Sayılan miktar'}
            inputMode="numeric"
            placeholder={mode === 'transfer' ? 'Transfer miktarı' : 'Sayılan miktar (depodaki gerçek adet)'}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="h-10"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="brand" disabled={busy} onClick={submit}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
