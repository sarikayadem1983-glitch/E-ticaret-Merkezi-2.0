'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { FormField, fieldAria } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { CompanyInput } from '@/hooks/queries';
import { ApiError, errorMessage } from '@/lib/api';
import { isValidTaxNumber } from '@/lib/tax-number';
import type { Company } from '@/lib/types';

const optional = (schema: z.ZodType<string>) =>
  z.union([z.literal(''), schema]).transform((v) => (v === '' ? null : v));

export const companySchema = z.object({
  legalName: z.string().trim().min(2, 'En az 2 karakter').max(250),
  taxNumber: z
    .string()
    .trim()
    .regex(/^\d{10,11}$/, 'VKN 10, TCKN 11 haneli olmalı')
    .refine(isValidTaxNumber, 'Vergi numarası geçersiz (kontrol hanesi tutmuyor)'),
  taxOffice: z.string().trim().min(2, 'En az 2 karakter').max(100),
  addressLine: z.string().trim().min(5, 'En az 5 karakter').max(500),
  district: z.string().trim().min(2, 'En az 2 karakter').max(100),
  city: z.string().trim().min(2, 'En az 2 karakter').max(100),
  postalCode: optional(z.string().trim().regex(/^\d{5}$/, 'Posta kodu 5 haneli olmalı')),
  phone: optional(z.string().trim().regex(/^\+?[0-9 ()-]{7,30}$/, 'Geçerli bir telefon girin')),
  email: optional(z.email('Geçerli bir email girin').max(254)),
  eInvoiceEnabled: z.boolean(),
  eInvoiceAlias: optional(z.string().trim().max(250)),
});

type FormInput = z.input<typeof companySchema>;
type FormOutput = z.output<typeof companySchema>;

function defaults(company?: Company): FormInput {
  return {
    legalName: company?.legalName ?? '',
    taxNumber: company?.taxNumber ?? '',
    taxOffice: company?.taxOffice ?? '',
    addressLine: company?.addressLine ?? '',
    district: company?.district ?? '',
    city: company?.city ?? '',
    postalCode: company?.postalCode ?? '',
    phone: company?.phone ?? '',
    email: company?.email ?? '',
    eInvoiceEnabled: company?.eInvoiceEnabled ?? false,
    eInvoiceAlias: company?.eInvoiceAlias ?? '',
  };
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-6 border-b py-6 first:pt-0 last:border-b-0 md:grid-cols-3">
      <div>
        <h2 className="font-semibold text-brand-navy">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 md:col-span-2">{children}</div>
    </section>
  );
}

/** Create and edit form. The tax number is fixed after creation (backend rule). */
export function CompanyForm({
  company,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  company?: Company;
  submitLabel: string;
  onSubmit: (values: Partial<CompanyInput>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(companySchema),
    defaultValues: defaults(company),
  });
  const { errors, isSubmitting } = form.formState;
  const eInvoice = useWatch({ control: form.control, name: 'eInvoiceEnabled' });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    const { taxNumber, ...rest } = values;
    try {
      await onSubmit(company ? rest : { ...rest, taxNumber });
    } catch (e) {
      if (e instanceof ApiError) {
        for (const d of e.details) {
          form.setError(d.field as keyof FormInput, { message: d.message });
        }
        if (e.status === 409) {
          form.setError('taxNumber', {
            message: 'Bu vergi numarasıyla kayıtlı bir firma zaten var',
          });
        }
      }
      setError(errorMessage(e));
    }
  });

  const field = (
    name: Exclude<keyof FormInput, 'eInvoiceEnabled'>,
    label: string,
    props: React.ComponentProps<typeof Input> & { required?: boolean; hint?: string } = {},
  ) => {
    const { required, hint, className, ...inputProps } = props;
    const message = errors[name]?.message;
    return (
      <FormField id={name} label={label} required={required} error={message} hint={hint} className={className}>
        <Input {...fieldAria(name, message)} className="h-10" {...inputProps} {...form.register(name)} />
      </FormField>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border bg-card p-5 shadow-xs sm:p-6">
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Section title="Firma bilgileri" description="Resmi unvan ve vergi kimlik bilgileri.">
        {field('legalName', 'Ticari unvan', { required: true, className: 'sm:col-span-2' })}
        {field('taxNumber', 'VKN / TCKN', {
          required: true,
          inputMode: 'numeric',
          maxLength: 11,
          disabled: Boolean(company),
          hint: company ? 'Vergi numarası değiştirilemez' : 'Şirketler için VKN, şahıs firmaları için TCKN',
        })}
        {field('taxOffice', 'Vergi dairesi', { required: true })}
      </Section>

      <Section title="Adres" description="Fatura ve yazışmalarda kullanılacak adres.">
        <FormField
          id="addressLine"
          label="Adres"
          required
          error={errors.addressLine?.message}
          className="sm:col-span-2"
        >
          <Textarea
            {...fieldAria('addressLine', errors.addressLine?.message)}
            rows={2}
            {...form.register('addressLine')}
          />
        </FormField>
        {field('district', 'İlçe', { required: true })}
        {field('city', 'İl', { required: true })}
        {field('postalCode', 'Posta kodu', { inputMode: 'numeric', maxLength: 5 })}
      </Section>

      <Section title="İletişim ve e-Fatura" description="İsteğe bağlı iletişim ve e-Fatura bilgileri.">
        {field('phone', 'Telefon', { type: 'tel', autoComplete: 'tel' })}
        {field('email', 'Email', { type: 'email' })}
        <div className="flex items-center gap-2.5 sm:col-span-2">
          <Checkbox
            id="eInvoiceEnabled"
            checked={eInvoice}
            onCheckedChange={(v) => form.setValue('eInvoiceEnabled', v === true, { shouldDirty: true })}
          />
          <Label htmlFor="eInvoiceEnabled">e-Fatura mükellefi</Label>
        </div>
        {eInvoice &&
          field('eInvoiceAlias', 'e-Fatura posta kutusu etiketi', {
            className: 'sm:col-span-2',
            placeholder: 'urn:mail:defaultpk@ornek.com.tr',
          })}
      </Section>

      <div className="flex flex-col-reverse gap-2 pt-6 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Vazgeç
        </Button>
        <Button type="submit" variant="brand" className="h-10" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
