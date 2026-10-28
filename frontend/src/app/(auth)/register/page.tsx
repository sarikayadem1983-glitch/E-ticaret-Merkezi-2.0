'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormField, fieldAria } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, errorMessage, request } from '@/lib/api';
import { hardNavigate } from '@/lib/navigation';

const schema = z.object({
  tenantName: z.string().trim().min(2, 'En az 2 karakter').max(100),
  tenantSlug: z
    .string()
    .trim()
    .min(3, 'En az 3 karakter')
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Küçük harf, rakam ve tire kullanın'),
  name: z.string().trim().min(2, 'En az 2 karakter').max(100),
  email: z.email('Geçerli bir email girin'),
  password: z.string().min(8, 'En az 8 karakter').max(128),
});
type Values = z.infer<typeof schema>;

const FIELDS: {
  name: keyof Values;
  label: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
}[] = [
  { name: 'tenantName', label: 'Mağaza adı', autoComplete: 'organization' },
  {
    name: 'tenantSlug',
    label: 'Mağaza kısa adı',
    hint: 'Örn. ornek-magaza',
  },
  { name: 'name', label: 'Ad soyad', autoComplete: 'name' },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  {
    name: 'password',
    label: 'Şifre',
    type: 'password',
    autoComplete: 'new-password',
    hint: 'En az 8 karakter',
  },
];

export default function RegisterPage() {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request('/api/auth/register', { method: 'POST', body: values });
      hardNavigate('/dashboard');
    } catch (e) {
      if (e instanceof ApiError) {
        for (const d of e.details) {
          if (d.field in schema.shape) {
            form.setError(d.field as keyof Values, { message: d.message });
          }
        }
      }
      setError(errorMessage(e));
    }
  });

  return (
    <>
      <h1 className="text-2xl font-semibold text-brand-navy">
        Mağazanızı oluşturun
      </h1>
      <p className="mt-1.5 mb-8 text-sm text-muted-foreground">
        Hesabınız oluşturulur ve mağaza sahibi olarak giriş yaparsınız.
      </p>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {FIELDS.map((f) => (
          <FormField
            key={f.name}
            id={f.name}
            label={f.label}
            hint={f.hint}
            error={errors[f.name]?.message}
          >
            <Input
              {...fieldAria(f.name, errors[f.name]?.message)}
              type={f.type ?? 'text'}
              autoComplete={f.autoComplete}
              className="h-10"
              {...form.register(f.name)}
            />
          </FormField>
        ))}
        <Button
          type="submit"
          variant="brand"
          className="h-10 w-full"
          disabled={isSubmitting}
        >
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          Hesap oluştur
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Zaten hesabınız var mı?{' '}
        <Link
          href="/login"
          className="font-medium text-brand-navy underline-offset-4 hover:underline"
        >
          Giriş yapın
        </Link>
      </p>
    </>
  );
}
