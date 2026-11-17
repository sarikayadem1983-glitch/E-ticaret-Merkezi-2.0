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
import { hardNavigate } from '@/lib/navigation';
import type { InvitationLookup } from '@/lib/types';

const INVALID = 'Bu davet bağlantısı geçersiz veya süresi dolmuş.';

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'newAccount' | 'existingAccount'; invitation: InvitationLookup }
  | { kind: 'signedIn'; invitation: InvitationLookup; email: string }
  | { kind: 'signedInOtherEmail'; email: string }
  | { kind: 'done'; tenantName: string; tenantId?: string };

/**
 * The signed-in user's e-mail, or null without a session. A plain fetch: the
 * shared request() would send a visitor without a session to the login page.
 */
async function sessionEmail(): Promise<string | null> {
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { user?: { email?: unknown } } };
    const email = body.data?.user?.email;
    return typeof email === 'string' ? email : null;
  } catch {
    return null;
  }
}

/**
 * Session-less acceptance. The token stays in the URL path only; it goes to
 * the BFF in a request body and the page sends no Referer (next.config).
 */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      request<{ data: InvitationLookup }>('/api/invitations/lookup', {
        method: 'POST',
        body: { token },
      }),
      sessionEmail(),
    ])
      .then(([{ data }, email]) => {
        if (cancelled) return;
        // USR-T13b: signed in, the session account can accept without a password
        // (the backend refuses any account but the invited one).
        if (email && data.accountExists) {
          setState({ kind: 'signedIn', invitation: data, email });
          return;
        }
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
    return <Done tenantName={state.tenantName} tenantId={state.tenantId} />;
  }

  if (state.kind === 'signedInOtherEmail') {
    return (
      <div className="text-center">
        <XCircle className="mx-auto size-10 text-destructive" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-brand-navy">Davet başka bir hesaba ait</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {state.email} hesabıyla oturum açıksınız. Bu davet başka bir e-posta adresine
          gönderilmiş. Çıkış yapıp davet edilen hesapla devam edin.
        </p>
        <SignOutButton />
      </div>
    );
  }

  if (state.kind === 'signedIn') {
    const { invitation, email } = state;
    return (
      <AcceptAsCurrent
        token={token}
        invitation={invitation}
        email={email}
        onDone={(tenantName, tenantId) => setState({ kind: 'done', tenantName, tenantId })}
        onOtherAccount={() => setState({ kind: 'signedInOtherEmail', email })}
        onInvalid={() => setState({ kind: 'invalid', message: INVALID })}
      />
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

function Done({ tenantName, tenantId }: { tenantName: string; tenantId?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Accepted while signed in: the session still points at the old store.
  const switchStore = async () => {
    if (!tenantId) return;
    setPending(true);
    setError(null);
    try {
      await request('/api/session/tenant', { method: 'POST', body: { tenantId } });
      hardNavigate('/');
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };
  return (
    <div className="text-center">
      <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold text-brand-navy">
        {tenantName} mağazasına katıldınız
      </h1>
      {tenantId ? (
        <>
          {error && (
            <Alert variant="destructive" className="mt-4 text-left">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button
            variant="brand"
            className="mt-8 h-10 w-full"
            disabled={pending}
            onClick={switchStore}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Mağazaya geç
          </Button>
          <Button asChild variant="outline" className="mt-2 h-10 w-full">
            <Link href="/">Şimdilik mevcut mağazada kal</Link>
          </Button>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">Devam etmek için giriş yapın.</p>
          <Button asChild variant="brand" className="mt-8 h-10 w-full">
            <Link href="/login">Giriş yap</Link>
          </Button>
        </>
      )}
    </div>
  );
}

function SignOutButton() {
  const [pending, setPending] = useState(false);
  const signOut = async () => {
    setPending(true);
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      // Reload: without a session the page shows the password form.
      window.location.reload();
    }
  };
  return (
    <Button variant="outline" className="mt-8" disabled={pending} onClick={signOut}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      Çıkış yap
    </Button>
  );
}

function InvitationHeader({ invitation }: { invitation: InvitationLookup }) {
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
    </>
  );
}

function AcceptAsCurrent({
  token,
  invitation,
  email,
  onDone,
  onOtherAccount,
  onInvalid,
}: {
  token: string;
  invitation: InvitationLookup;
  email: string;
  onDone: (tenantName: string, tenantId: string) => void;
  onOtherAccount: () => void;
  onInvalid: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const accept = async () => {
    setError(null);
    setPending(true);
    try {
      const { data } = await request<{ data: { tenantId: string; tenantName: string } }>(
        '/api/bff/invitations/accept-as-current',
        { method: 'POST', body: { token } },
      );
      onDone(data.tenantName || invitation.tenantName, data.tenantId);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVITATION_OTHER_ACCOUNT') {
        onOtherAccount();
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        onInvalid();
        return;
      }
      setError(errorMessage(err));
      setPending(false);
    }
  };
  return (
    <>
      <InvitationHeader invitation={invitation} />
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p className="mb-4 text-sm text-muted-foreground">{email} hesabıyla oturum açıksınız.</p>
      <Button variant="brand" className="h-10 w-full" disabled={pending} onClick={accept}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Bu hesapla kabul et
      </Button>
      <div className="text-center">
        <SignOutButton />
      </div>
    </>
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
      <InvitationHeader invitation={invitation} />
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
