'use client';

import { Loader2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { NativeSelect } from '@/components/catalog/common';
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
import {
  useAddVariant,
  useAttributes,
  useDeletePrice,
  useDeleteVariant,
  useGenerateVariants,
  useSetPrice,
  useUpdateVariant,
} from '@/hooks/catalog';
import { errorMessage } from '@/lib/api';
import {
  combinationCount,
  MAX_COMBINATIONS,
  skuPrefix,
  variantLabel,
} from '@/lib/catalog';
import {
  CHANNEL,
  channelLabel,
  CURRENCIES,
  formatAmount,
  LIST_CHANNEL,
  parseAmount,
} from '@/lib/money';
import type { Product, Variant } from '@/lib/types';

/** Variants of one product: SKU/barcode, attributes, list and channel prices. */
export function VariantEditor({
  product,
  readOnly,
}: {
  product: Product;
  readOnly: boolean;
}) {
  const [generating, setGenerating] = useState(false);
  const [adding, setAdding] = useState(false);

  return (
    <section aria-labelledby="variants-title" className="rounded-xl border bg-card shadow-xs">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="variants-title" className="font-semibold text-brand-navy">
            Varyantlar ({product.variants.length})
          </h2>
          <p className="text-sm text-muted-foreground">
            Fiyatlar KDV dahildir{product.vatRate ? ` (KDV %${Number.parseInt(product.vatRate, 10)})` : '; KDV oranı girilmedi'}.
          </p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              Varyant ekle
            </Button>
            <Button variant="brand" className="h-10" onClick={() => setGenerating(true)}>
              <Sparkles className="size-4" aria-hidden />
              Eksenlerden üret
            </Button>
          </div>
        )}
      </div>
      <ul className="divide-y">
        {product.variants.map((v) => (
          <VariantRow
            key={v.id}
            product={product}
            variant={v}
            readOnly={readOnly}
            canDelete={product.variants.length > 1}
          />
        ))}
      </ul>
      {adding && <AddVariantDialog product={product} onClose={() => setAdding(false)} />}
      {generating && <GenerateDialog product={product} onClose={() => setGenerating(false)} />}
    </section>
  );
}

function VariantRow({
  product,
  variant,
  readOnly,
  canDelete,
}: {
  product: Product;
  variant: Variant;
  readOnly: boolean;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteVariant(product.id);
  const label = variantLabel(variant);

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-sm font-medium break-all">{variant.sku}</p>
          <p className="text-sm text-muted-foreground">
            {label || 'Özelliksiz'}
            {variant.barcode && ` · Barkod ${variant.barcode}`}
          </p>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="size-10"
              aria-label={`${variant.sku} düzenle`}
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="outline"
              className="size-10 text-destructive"
              aria-label={`${variant.sku} sil`}
              disabled={!canDelete}
              title={canDelete ? undefined : 'Son varyant silinemez'}
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
      </div>
      <PriceList product={product} variant={variant} readOnly={readOnly} />
      {editing && (
        <EditVariantDialog product={product} variant={variant} onClose={() => setEditing(false)} />
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Varyant silinsin mi?</DialogTitle>
            <DialogDescription>
              {variant.sku} silinir. SKU ve barkod yeniden kullanılamaz.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(variant.id, {
                  onSuccess: () => {
                    toast.success('Varyant silindi');
                    setConfirming(false);
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              Sil
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/** Prices of a variant: list price first, then channel prices; inline add/update. */
function PriceList({
  product,
  variant,
  readOnly,
}: {
  product: Product;
  variant: Variant;
  readOnly: boolean;
}) {
  const setPrice = useSetPrice(product.id);
  const deletePrice = useDeletePrice(product.id);
  const hasList = variant.prices.some((p) => p.channel === LIST_CHANNEL);
  const [channel, setChannel] = useState(hasList ? '' : LIST_CHANNEL);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>('TRY');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const code = channel.trim().toLowerCase();
    const parsed = parseAmount(amount);
    if (!CHANNEL.test(code) || code.length > 50) {
      setError('Kanal kodu küçük harf, rakam ve tire içerebilir (ör. trendyol)');
      return;
    }
    if (parsed === null) {
      setError('Tutar en çok 2 ondalık basamaklı olmalı (ör. 199,90)');
      return;
    }
    setError(null);
    setPrice.mutate(
      { variantId: variant.id, channel: code, amount: parsed, currency },
      {
        onSuccess: () => {
          setAmount('');
          setChannel('');
          toast.success('Fiyat kaydedildi');
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <div className="space-y-2">
      {variant.prices.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {variant.prices.map((p) => (
            <li key={p.channel} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{channelLabel(p.channel)}</p>
                <p className="font-medium tabular-nums">{formatAmount(p.amount, p.currency)}</p>
                {p.netAmount && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Net {formatAmount(p.netAmount, p.currency)} · KDV {formatAmount(p.vatAmount ?? '0', p.currency)}
                  </p>
                )}
              </div>
              {!readOnly && (
                <Button
                  variant="ghost"
                  className="size-10 shrink-0"
                  aria-label={`${channelLabel(p.channel)} fiyatını sil`}
                  disabled={deletePrice.isPending}
                  onClick={() =>
                    deletePrice.mutate(
                      { variantId: variant.id, channel: p.channel },
                      { onError: (e) => toast.error(errorMessage(e)) },
                    )
                  }
                >
                  <X className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Fiyat girilmedi.</p>
      )}
      {!readOnly && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_6rem_auto]">
          <Input
            aria-label="Kanal"
            list="price-channels"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="list veya kanal (trendyol)"
            className="h-10"
          />
          <Input
            aria-label="Tutar (KDV dahil)"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="199,90"
            className="h-10"
          />
          <NativeSelect aria-label="Para birimi" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
          <Button variant="outline" className="h-10" disabled={setPrice.isPending} onClick={save}>
            {setPrice.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Fiyatı yaz
          </Button>
          <datalist id="price-channels">
            <option value={LIST_CHANNEL}>Liste fiyatı</option>
            <option value="trendyol" />
            <option value="hepsiburada" />
            <option value="amazon" />
          </datalist>
          {error && (
            <p role="alert" className="text-xs text-destructive sm:col-span-4">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Attribute pickers (one value per attribute) shared by the add/edit dialogs. */
function AttributePicker({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const attributes = useAttributes();
  if ((attributes.data ?? []).length === 0) {
    return <p className="text-sm text-muted-foreground">Tanımlı özellik yok.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(attributes.data ?? []).map((a) => (
        <div key={a.id} className="space-y-1.5">
          <Label htmlFor={`attr-${a.id}`}>{a.name}</Label>
          <NativeSelect
            id={`attr-${a.id}`}
            value={value[a.id] ?? ''}
            onChange={(e) => onChange({ ...value, [a.id]: e.target.value })}
          >
            <option value="">—</option>
            {a.values.map((v) => (
              <option key={v.id} value={v.id}>
                {v.value}
              </option>
            ))}
          </NativeSelect>
        </div>
      ))}
    </div>
  );
}

const toPairs = (m: Record<string, string>) =>
  Object.entries(m)
    .filter(([, valueId]) => valueId !== '')
    .map(([attributeId, valueId]) => ({ attributeId, valueId }));

function AddVariantDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const add = useAddVariant(product.id);
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Varyant ekle</DialogTitle>
          <DialogDescription>SKU zorunlu; özellikler isteğe bağlı.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-sku">SKU</Label>
              <Input id="new-sku" className="h-10 font-mono" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-barcode">Barkod</Label>
              <Input id="new-barcode" className="h-10 font-mono" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </div>
          </div>
          <AttributePicker value={attrs} onChange={setAttrs} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="brand"
            disabled={add.isPending || sku.trim() === ''}
            onClick={() =>
              add.mutate(
                { sku: sku.trim(), barcode: barcode.trim() || null, attributes: toPairs(attrs) },
                {
                  onSuccess: () => {
                    toast.success('Varyant eklendi');
                    onClose();
                  },
                  onError: (e) => setError(errorMessage(e)),
                },
              )
            }
          >
            Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditVariantDialog({
  product,
  variant,
  onClose,
}: {
  product: Product;
  variant: Variant;
  onClose: () => void;
}) {
  const update = useUpdateVariant(product.id);
  const [sku, setSku] = useState(variant.sku);
  const [barcode, setBarcode] = useState(variant.barcode ?? '');
  const [attrs, setAttrs] = useState<Record<string, string>>(
    Object.fromEntries(variant.attributes.map((a) => [a.attributeId, a.valueId])),
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Varyantı düzenle</DialogTitle>
          <DialogDescription>Bir eksen kaldırılamaz; değeri değiştirilebilir.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-sku">SKU</Label>
              <Input id="edit-sku" className="h-10 font-mono" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-barcode">Barkod</Label>
              <Input id="edit-barcode" className="h-10 font-mono" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </div>
          </div>
          <AttributePicker value={attrs} onChange={setAttrs} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="brand"
            disabled={update.isPending || sku.trim() === ''}
            onClick={() => {
              const pairs = toPairs(attrs);
              update.mutate(
                {
                  id: variant.id,
                  sku: sku.trim(),
                  barcode: barcode.trim() || null,
                  ...(pairs.length ? { attributes: pairs } : {}),
                },
                {
                  onSuccess: () => {
                    toast.success('Varyant güncellendi');
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

/** Pick up to 3 attributes and their values; the backend creates the missing combinations. */
function GenerateDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const attributes = useAttributes();
  const generate = useGenerateVariants(product.id);
  const [prefix, setPrefix] = useState(skuPrefix(product.name));
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  const axes = Object.entries(selected)
    .filter(([, ids]) => ids.length > 0)
    .map(([attributeId, valueIds]) => ({ attributeId, valueIds }));
  const count = combinationCount(axes);
  const tooMany = axes.length > 3 || count > MAX_COMBINATIONS;

  const toggle = (attributeId: string, valueId: string) =>
    setSelected((s) => {
      const cur = s[attributeId] ?? [];
      return {
        ...s,
        [attributeId]: cur.includes(valueId) ? cur.filter((x) => x !== valueId) : [...cur, valueId],
      };
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Eksenlerden varyant üret</DialogTitle>
          <DialogDescription>
            Seçilen değerlerin tüm kombinasyonları üretilir; var olanlar atlanır. En çok 3 eksen ve {MAX_COMBINATIONS} kombinasyon.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="sku-prefix">SKU öneki</Label>
            <Input id="sku-prefix" className="h-10 font-mono" value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/\s/g, ''))} />
            <p className="text-xs text-muted-foreground">Örnek: {prefix || 'ONEK'}-KIRMIZI-XL</p>
          </div>
          {(attributes.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Önce Özellikler sayfasından renk, beden gibi özellik ekleyin.
            </p>
          )}
          {(attributes.data ?? []).map((a) => (
            <fieldset key={a.id} className="space-y-2">
              <legend className="text-sm font-medium">{a.name}</legend>
              <div className="flex flex-wrap gap-2">
                {a.values.map((v) => {
                  const on = (selected[a.id] ?? []).includes(v.id);
                  return (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(a.id, v.id)}
                      className={
                        on
                          ? 'min-h-10 rounded-lg bg-brand-navy px-3 text-sm font-medium text-white'
                          : 'min-h-10 rounded-lg border px-3 text-sm hover:bg-muted'
                      }
                    >
                      {v.value}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <p className={tooMany ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'} aria-live="polite">
            {count} kombinasyon{tooMany ? ' — sınırı aşıyor' : ''}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="brand"
            disabled={generate.isPending || count === 0 || tooMany || prefix === ''}
            onClick={() =>
              generate.mutate(
                { skuPrefix: prefix, axes },
                {
                  onSuccess: ({ data }) => {
                    toast.success(`${data.created.length} varyant üretildi${data.skipped ? `, ${data.skipped} zaten vardı` : ''}`);
                    onClose();
                  },
                  onError: (e) => setError(errorMessage(e)),
                },
              )
            }
          >
            {generate.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Üret
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
