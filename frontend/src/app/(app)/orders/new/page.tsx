'use client';

import { ArrowLeft, Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { NativeSelect } from '@/components/catalog/common';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useProducts } from '@/hooks/catalog';
import { useCreateOrder } from '@/hooks/orders';
import { useCompanies } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { variantLabel } from '@/lib/catalog';
import { CURRENCIES, LIST_CHANNEL, parseAmount } from '@/lib/money';
import type { Product } from '@/lib/types';

interface Line {
  variantId: string;
  label: string;
  sku: string;
  quantity: string;
  unitPrice: string;
}

/** Listed price of a variant in the chosen currency, as a starting value. */
function listPrice(p: Product, variantId: string, currency: string): string {
  const v = p.variants.find((x) => x.id === variantId);
  return (
    v?.prices.find((x) => x.channel === LIST_CHANNEL && x.currency === currency)?.amount ?? ''
  );
}

export default function NewOrderPage() {
  const router = useRouter();
  const create = useCreateOrder();
  const companies = useCompanies({ page: 1, search: '', status: 'active', perPage: 100 });
  const [companyId, setCompanyId] = useState('');
  const [currency, setCurrency] = useState('TRY');
  const [lines, setLines] = useState<Line[]>([]);
  const [shipping, setShipping] = useState('');
  const [discount, setDiscount] = useState('');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const products = useProducts({
    page: 1,
    perPage: 10,
    search,
    status: 'all',
    companyId,
    categoryId: '',
    brandId: '',
  });

  const companyList = companies.data?.data ?? [];

  const changeCompany = (id: string) => {
    setCompanyId(id);
    setLines([]); // lines belong to one company's variants
  };

  const add = (p: Product, variantId: string) => {
    if (lines.some((l) => l.variantId === variantId)) return;
    const v = p.variants.find((x) => x.id === variantId)!;
    const attrs = variantLabel(v);
    setLines((ls) => [
      ...ls,
      {
        variantId,
        label: attrs ? `${p.name} (${attrs})` : p.name,
        sku: v.sku,
        quantity: '1',
        unitPrice: listPrice(p, variantId, currency),
      },
    ]);
  };

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = () => {
    setError(null);
    if (!companyId) return setError('Firma seçin.');
    if (lines.length === 0) return setError('En az bir ürün ekleyin.');
    const items = [];
    for (const l of lines) {
      const qty = Number.parseInt(l.quantity, 10);
      const price = parseAmount(l.unitPrice);
      if (!/^\d+$/.test(l.quantity) || qty < 1 || qty > 100000) {
        return setError(`${l.sku}: adet 1 ile 100000 arasında tam sayı olmalı.`);
      }
      if (price === null) return setError(`${l.sku}: birim fiyat geçersiz (ör. 199,90).`);
      items.push({ variantId: l.variantId, quantity: qty, unitPrice: price });
    }
    const shippingTotal = shipping.trim() ? parseAmount(shipping) : '0';
    const discountTotal = discount.trim() ? parseAmount(discount) : '0';
    if (shippingTotal === null) return setError('Kargo tutarı geçersiz.');
    if (discountTotal === null) return setError('İndirim tutarı geçersiz.');
    create.mutate(
      { companyId, currency, items, shippingTotal, discountTotal },
      {
        onSuccess: (res) => {
          toast.success('Sipariş oluşturuldu');
          router.push(`/orders/${res.data.id}`);
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <div className="space-y-6">
      <Link
        href="/orders"
        className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Siparişler
      </Link>
      <PageHeader
        title="Elle sipariş"
        description="Telefon, mağaza veya web sitesi siparişi. Pazaryerine hiçbir şey gönderilmez."
      />

      <section className="grid gap-4 rounded-xl border bg-card p-4 shadow-xs sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="company">Firma</Label>
          <NativeSelect id="company" value={companyId} onChange={(e) => changeCompany(e.target.value)}>
            <option value="">Firma seçin</option>
            {companyList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">Para birimi</Label>
          <NativeSelect id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </div>
      </section>

      {companyId && (
        <section className="rounded-xl border bg-card shadow-xs">
          <div className="border-b p-4">
            <Label htmlFor="product-search">Ürün ekle</Label>
            <div className="relative mt-2">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="product-search"
                type="search"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ad, SKU veya barkod"
                className="h-10 pl-9"
              />
            </div>
          </div>
          <ul className="max-h-72 divide-y overflow-y-auto">
            {(products.data?.data ?? []).flatMap((p) =>
              p.variants.map((v) => {
                const attrs = variantLabel(v);
                const added = lines.some((l) => l.variantId === v.id);
                return (
                  <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {p.name}
                        {attrs && <span className="text-muted-foreground"> · {attrs}</span>}
                      </span>
                      <span className="block font-mono text-xs text-muted-foreground">{v.sku}</span>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-10 shrink-0"
                      disabled={added}
                      onClick={() => add(p, v.id)}
                    >
                      <Plus className="size-4" aria-hidden />
                      {added ? 'Eklendi' : 'Ekle'}
                    </Button>
                  </li>
                );
              }),
            )}
            {products.data && products.data.data.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">Ürün bulunamadı</li>
            )}
          </ul>
        </section>
      )}

      {lines.length > 0 && (
        <section className="rounded-xl border bg-card shadow-xs">
          <h2 className="border-b px-4 py-3 text-sm font-medium text-brand-navy">Sipariş kalemleri</h2>
          <ul className="divide-y">
            {lines.map((l, i) => {
              const price = parseAmount(l.unitPrice);
              return (
                <li key={l.variantId} className="grid gap-3 p-4 sm:grid-cols-[1fr_7rem_9rem_auto] sm:items-end">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{l.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">{l.sku}</p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`qty-${i}`} className="text-xs">
                      Adet
                    </Label>
                    <Input
                      id={`qty-${i}`}
                      inputMode="numeric"
                      value={l.quantity}
                      onChange={(e) => update(i, { quantity: e.target.value })}
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`price-${i}`} className="text-xs">
                      Birim fiyat (KDV dahil)
                    </Label>
                    <Input
                      id={`price-${i}`}
                      inputMode="decimal"
                      value={l.unitPrice}
                      onChange={(e) => update(i, { unitPrice: e.target.value })}
                      placeholder="0,00"
                      aria-invalid={l.unitPrice !== '' && price === null}
                      className="h-10"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-10"
                    aria-label={`${l.sku} kalemini kaldır`}
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="shipping">Kargo ücreti</Label>
              <Input
                id="shipping"
                inputMode="decimal"
                value={shipping}
                onChange={(e) => setShipping(e.target.value)}
                placeholder="0,00"
                className="h-10"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="discount">Sipariş indirimi</Label>
              <Input
                id="discount"
                inputMode="decimal"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                placeholder="0,00"
                className="h-10"
              />
            </div>
          </div>
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            Toplamı sunucu kuruşu kuruşuna hesaplar: adet × birim fiyat, eksi indirim, artı kargo.
          </p>
        </section>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        <Button asChild variant="outline" className="min-h-10">
          <Link href="/orders">Vazgeç</Link>
        </Button>
        <Button variant="brand" className="min-h-10" disabled={create.isPending} onClick={submit}>
          Siparişi oluştur
        </Button>
      </div>
    </div>
  );
}
