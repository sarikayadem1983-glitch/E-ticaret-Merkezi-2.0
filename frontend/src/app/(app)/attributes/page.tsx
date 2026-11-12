'use client';

import { Plus, Tags } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAddAttributeValue, useAttributes, useCreateAttribute } from '@/hooks/catalog';
import { errorMessage } from '@/lib/api';
import type { Attribute } from '@/lib/types';

/** Comma-separated values, trimmed, empty ones dropped. */
const splitValues = (s: string) =>
  s
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export default function AttributesPage() {
  const attributes = useAttributes();
  const create = useCreateAttribute();
  const [name, setName] = useState('');
  const [values, setValues] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Özellikler"
        description="Renk, beden gibi varyant eksenleri. Tüm firmalar ortak kullanır; ekleme yalnızca mağaza yöneticisine açıktır."
      />
      <form
        className="mb-6 grid gap-3 rounded-xl border bg-card p-4 shadow-xs sm:grid-cols-[1fr_2fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate(
            { name: name.trim(), values: splitValues(values) },
            {
              onSuccess: () => {
                toast.success('Özellik eklendi');
                setName('');
                setValues('');
              },
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="attr-name">Özellik adı</Label>
          <Input id="attr-name" className="h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder="Renk" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="attr-values">Değerler (virgülle)</Label>
          <Input id="attr-values" className="h-10" value={values} onChange={(e) => setValues(e.target.value)} placeholder="Kırmızı, Mavi, Yeşil" />
        </div>
        <Button type="submit" variant="brand" className="h-10" disabled={create.isPending || name.trim() === ''}>
          <Plus className="size-4" aria-hidden />
          Ekle
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive sm:col-span-3">
            {error}
          </p>
        )}
      </form>

      {attributes.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(attributes.error)}</AlertDescription>
        </Alert>
      ) : attributes.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (attributes.data ?? []).length === 0 ? (
        <div className="rounded-xl border bg-card px-4 py-16 text-center">
          <Tags className="mx-auto size-10 text-brand-orange" aria-hidden />
          <p className="mt-3 font-medium text-brand-navy">Henüz özellik yok</p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {(attributes.data ?? []).map((a) => (
            <AttributeCard key={a.id} attribute={a} />
          ))}
        </ul>
      )}
    </>
  );
}

function AttributeCard({ attribute }: { attribute: Attribute }) {
  const add = useAddAttributeValue(attribute.id);
  const [value, setValue] = useState('');
  return (
    <li className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
      <h2 className="font-semibold text-brand-navy">{attribute.name}</h2>
      <div className="flex flex-wrap gap-2">
        {attribute.values.map((v) => (
          <span key={v.id} className="rounded-full bg-muted px-3 py-1 text-sm">
            {v.value}
          </span>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(value.trim(), {
            onSuccess: () => setValue(''),
            onError: (err) => toast.error(errorMessage(err)),
          });
        }}
      >
        <Input
          aria-label={`${attribute.name} için yeni değer`}
          className="h-10"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Yeni değer"
        />
        <Button type="submit" variant="outline" className="h-10" disabled={add.isPending || value.trim() === ''}>
          Ekle
        </Button>
      </form>
    </li>
  );
}
