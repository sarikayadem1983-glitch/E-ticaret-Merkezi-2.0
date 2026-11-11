'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { NativeSelect } from '@/components/catalog/common';
import { FormField, fieldAria } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { type ProductInput, useBrands, useCategories } from '@/hooks/catalog';
import { useCompanies } from '@/hooks/queries';
import { ApiError, errorMessage } from '@/lib/api';
import { STATUS_LABEL } from '@/lib/catalog';
import { CURRENCIES, LIST_CHANNEL, parseAmount, VAT_RATES } from '@/lib/money';
import type { Product } from '@/lib/types';

const orNull = (v: string) => (v === '' ? null : v);

const schema = z
  .object({
    companyId: z.string(),
    name: z.string().trim().min(1, 'Ürün adı zorunlu').max(250),
    description: z.string().max(10000),
    status: z.enum(['draft', 'active', 'archived']),
    categoryId: z.string(),
    brandId: z.string(),
    vatRate: z.string(),
    // First variant: only when creating.
    sku: z.string().trim().max(100),
    barcode: z.string().trim().max(50),
    price: z.string(),
    currency: z.enum(CURRENCIES),
  })
  .superRefine((v, ctx) => {
    if (v.price.trim() !== '' && parseAmount(v.price) === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['price'],
        message: 'Tutar en çok 2 ondalık basamaklı olmalı (ör. 199,90)',
      });
    }
  });

type Values = z.infer<typeof schema>;

/**
 * Product fields. On create also the company and the first variant (SKU,
 * barcode, list price); later variants are managed in the variant editor.
 */
export function ProductForm({
  product,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  product?: Product;
  submitLabel: string;
  onSubmit: (input: ProductInput) => Promise<void>;
  onCancel: () => void;
}) {
  const creating = !product;
  const companies = useCompanies({ page: 1, search: '', status: 'active', perPage: 100 });
  const categories = useCategories();
  const brands = useBrands();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      companyId: product?.companyId ?? '',
      name: product?.name ?? '',
      description: product?.description ?? '',
      status: product?.status ?? 'draft',
      categoryId: product?.categoryId ?? '',
      brandId: product?.brandId ?? '',
      vatRate: product?.vatRate ? String(Number.parseInt(product.vatRate, 10)) : '',
      sku: '',
      barcode: '',
      price: '',
      currency: 'TRY',
    },
  });

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    if (creating && v.companyId === '') {
      setError('companyId', { message: 'Firma seçin' });
      return;
    }
    if (creating && v.sku === '') {
      setError('sku', { message: 'SKU zorunlu' });
      return;
    }
    const input: ProductInput = {
      name: v.name,
      description: orNull(v.description.trim()),
      status: v.status,
      categoryId: orNull(v.categoryId),
      brandId: orNull(v.brandId),
      vatRate: orNull(v.vatRate),
    };
    if (creating) {
      const amount = parseAmount(v.price);
      input.companyId = v.companyId;
      input.variants = [
        {
          sku: v.sku,
          barcode: orNull(v.barcode),
          prices: amount
            ? [{ channel: LIST_CHANNEL, amount, currency: v.currency }]
            : [],
        },
      ];
    }
    try {
      await onSubmit(input);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SKU_TAKEN') {
        setError('sku', { message: error.message });
      } else if (error instanceof ApiError && error.code === 'BARCODE_TAKEN') {
        setError('barcode', { message: error.message });
      } else {
        setFormError(errorMessage(error));
      }
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-6 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {creating && (
          <FormField id="companyId" label="Firma" required error={errors.companyId?.message} className="sm:col-span-2">
            <NativeSelect {...register('companyId')} {...fieldAria('companyId', errors.companyId?.message)}>
              <option value="">Firma seçin</option>
              {(companies.data?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        <FormField id="name" label="Ürün adı" required error={errors.name?.message} className="sm:col-span-2">
          <Input {...register('name')} {...fieldAria('name', errors.name?.message)} className="h-10" />
        </FormField>
        <FormField id="status" label="Durum">
          <NativeSelect id="status" {...register('status')}>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="vatRate" label="KDV oranı" hint="Fiyatlar KDV dahildir">
          <NativeSelect id="vatRate" {...register('vatRate')}>
            <option value="">Belirtilmedi</option>
            {VAT_RATES.map((r) => (
              <option key={r} value={r}>
                %{r}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="categoryId" label="Kategori">
          <NativeSelect id="categoryId" {...register('categoryId')}>
            <option value="">Kategorisiz</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="brandId" label="Marka">
          <NativeSelect id="brandId" {...register('brandId')}>
            <option value="">Markasız</option>
            {(brands.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="description" label="Açıklama" error={errors.description?.message} className="sm:col-span-2">
          <Textarea rows={4} {...register('description')} {...fieldAria('description', errors.description?.message)} />
        </FormField>
      </div>

      {creating && (
        <fieldset className="grid gap-4 border-t pt-6 sm:grid-cols-2">
          <legend className="mb-2 font-semibold text-brand-navy">İlk varyant</legend>
          <FormField id="sku" label="SKU" required error={errors.sku?.message}>
            <Input {...register('sku')} {...fieldAria('sku', errors.sku?.message)} className="h-10 font-mono" autoCapitalize="characters" />
          </FormField>
          <FormField id="barcode" label="Barkod" error={errors.barcode?.message}>
            <Input {...register('barcode')} {...fieldAria('barcode', errors.barcode?.message)} className="h-10 font-mono" inputMode="numeric" />
          </FormField>
          <FormField id="price" label="Liste fiyatı (KDV dahil)" error={errors.price?.message}>
            <Input {...register('price')} {...fieldAria('price', errors.price?.message)} className="h-10" inputMode="decimal" placeholder="199,90" />
          </FormField>
          <FormField id="currency" label="Para birimi">
            <NativeSelect id="currency" {...register('currency')}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Renk/beden gibi eksenlerden varyantları ürün kaydedildikten sonra üretebilirsiniz.
          </p>
        </fieldset>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Vazgeç
        </Button>
        <Button type="submit" variant="brand" className="h-10" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
