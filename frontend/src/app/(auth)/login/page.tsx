'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormField, fieldAria } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage, request } from '@/lib/api';
import { hardNavigate } from '@/lib/navigation';

const schema = z.object({
  email: z.email('Geçerli bir email girin'),
  password: z.string().min(1, 'Şifre gerekli'),
});
type Values = z.infer<typeof schema>;

/** Only same-app paths, so ?next= cannot send the user to another site. */
function safeNext(value: string | null): string {
  return value && /^\/(?!\/)[\w\-/]*$/.test(value) ? value : '/dashboard';
}

function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request('/api/auth/login', { method: 'POST', body: values });
      hardNavigate(safeNext(params.get('next')));
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input
          {...fieldAria('email', errors.email?.message)}
          type="email"
          autoComplete="email"
          autoFocus
          className="h-10"
          {...form.register('email')}
        />
      </FormField>
      <FormField id="password" label="Şifre" error={errors.password?.message}>
        <Input
          {...fieldAria('password', errors.password?.message)}
          type="password"
          autoComplete="current-password"
          className="h-10"
          {...form.register('password')}
        />
      </FormField>
      <Button
        type="submit"
        variant="brand"
        className="h-10 w-full"
        disabled={isSubmitting}
      >
        {isSubmitting && <Loader2 className="size-4 animate-spin" />}
        Giriş yap
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold text-brand-navy">Giriş yap</h1>
      <p className="mt-1.5 mb-8 text-sm text-muted-foreground">
        Hesabınıza giriş yaparak yönetim paneline ulaşın.
      </p>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Hesabınız yok mu?{' '}
        <Link
          href="/register"
          className="font-medium text-brand-navy underline-offset-4 hover:underline"
        >
          Mağazanızı oluşturun
        </Link>
      </p>
    </>
  );
}
