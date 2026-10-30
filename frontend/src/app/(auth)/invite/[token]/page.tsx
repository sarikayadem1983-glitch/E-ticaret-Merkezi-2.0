'use client';

import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FormField, fieldAria } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, errorMessage, request } from '@/lib/api';
import type { InvitationLookup } from '@/lib/types';

const INVALID = 'Bu davet bağlantısı geçersiz veya süresi dolmuş.';

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'newAccount' | 'existingAccount'; invitation: InvitationLookup }
  | { kind: 'done'; tenantName: string };

/**
 * Session-less acceptance. The token stays in the URL path only; it goes to
 * the BFF in a request body and the page sends no Referer (next.config).
 */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    request<{ data: InvitationLookup }>('/api/invitations/lookup', {
      method: 'POST',
      body: { token },
    })
      .then(({ data }) => {
        if (cancelled) return;
        setState({
          kind: data.accountExists ? 'existingAccount' : 'newAccount',
          invitation: data,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Rate limit keeps its own message; every other failure looks the same.
        const message = e instanceof ApiError && e.status === 429 ? errorMessage(e) : INVALID;
        setState({ kind: 'invalid', message });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Davet kontrol ediliyor…
      </p>
    );
  }

  if (state.kind === 'invalid') {
    return (
      <div className="text-center">
        <XCircle className="mx-auto size-10 text-destructive" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-brand-navy">Davet açılamadı</h1>
        <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
        <Button asChild variant="outline" className="mt-8">
          <Link href="/login">Giriş sayfasına git</Link>
        </Button>
      </div>
    );
  }

  if (state.kind === 'done') {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-brand-navy">
          {state.tenantName} mağazasına katıldınız
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Devam etmek için giriş yapın.
        </p>
        <Button asChild variant="brand" className="mt-8 h-10 w-full">
          <Link href="/login">Giriş yap</Link>
        </Button>
      </div>
    );
  }

  return (
    <AcceptForm
      token={token}
      invitation={state.invitation}
      newAccount={state.kind === 'newAccount'}
      onDone={(tenantName) => setState({ kind: 'done', tenantName })}
      onInvalid={() => setState({ kind: 'invalid', message: INVALID })}
    />
  );
}

function AcceptForm({
  token,
  invitation,
  newAccount,
  onDone,
  onInvalid,
}: {
  token: string;
  invitation: InvitationLookup;
  newAccount: boolean;
  onDone: (tenantName: string) => void;
  onInvalid: () => void;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const next: typeof errors = {};
    if (newAccount && (name.trim().length < 2 || name.trim().length > 100)) {
      next.name = 'Ad 2–100 karakter olmalı';
    }
    if (newAccount ? password.length < 8 || password.length > 128 : password === '') {
      next.password = newAccount ? 'En az 8 karakter' : 'Şifrenizi girin';
    }
    setErrors(next);
    if (next.name || next.password) return;
    setPending(true);
    try {
      const { data } = await request<{ data: { tenantName: string } }>(
        '/api/invitations/accept',
        {
          method: 'POST',
          body: newAccount ? { token, name: name.trim(), password } : { token, password },
        },
      );
      onDone(data.tenantName || invitation.tenantName);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        onInvalid();
        return;
      }
      if (err instanceof ApiError) {
        const fields: typeof errors = {};
        for (const d of err.details) {
          if (d.field === 'name' || d.field === 'password') fields[d.field] = d.message;
        }
        setErrors(fields);
      }
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <h1 className="text-2xl font-semibold text-brand-navy">
        {invitation.tenantName} mağazasına davet
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {invitation.inviterName} sizi davet etti: {invitation.roleSummary}
      </p>
      <p className="mt-1 mb-8 text-sm text-muted-foreground">
        Davet edilen: {invitation.maskedEmail}
      </p>
      {invitation.replacesInactiveMembership && (
        <Alert className="mb-4">
          <AlertDescription>
            Bu kişinin bu mağazadaki eski rol ve firma erişimleri bu davettekilerle
            değiştirilecek.
          </AlertDescription>
        </Alert>
      )}
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {newAccount && (
          <FormField id="name" label="Ad soyad" error={errors.name}>
            <Input
              {...fieldAria('name', errors.name)}
              autoComplete="name"
              className="h-10"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
        )}
        <FormField
          id="password"
          label={newAccount ? 'Şifre' : 'Mevcut hesabınızın şifresi'}
          hint={newAccount ? 'En az 8 karakter' : undefined}
          error={errors.password}
        >
          <Input
            {...fieldAria('password', errors.password)}
            type="password"
            autoComplete={newAccount ? 'new-password' : 'current-password'}
            className="h-10"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <Button type="submit" variant="brand" className="h-10 w-full" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {newAccount ? 'Hesap oluştur ve katıl' : 'Daveti kabul et'}
        </Button>
      </form>
    </>
  );
}
