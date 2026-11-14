'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage, request } from '@/lib/api';

/**
 * USR-19: the token comes from the e-mail link (the page is served with
 * Referrer-Policy: no-referrer, next.config). Success ends every session of the user.
 */
export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8 || password.length > 128) return setError('Şifre 8–128 karakter olmalı');
    if (password !== again) return setError('Şifreler aynı değil');
    setBusy(true);
    try {
      await request('/api/auth/password/reset', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-brand-navy">Yeni şifre belirle</h1>
      {done ? (
        <>
          <Alert>
            <AlertDescription>Şifreniz değişti. Güvenlik için tüm oturumlarınız kapatıldı; yeni şifrenizle giriş yapın.</AlertDescription>
          </Alert>
          <Button asChild variant="brand" className="h-10 w-full">
            <Link href="/login">Giriş yap</Link>
          </Button>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                {error} Bağlantının süresi dolduysa veya kullanıldıysa{' '}
                <Link href="/forgot-password" className="underline">
                  yeni bağlantı isteyin
                </Link>
                .
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="password">Yeni şifre</Label>
            <Input id="password" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="again">Yeni şifre (tekrar)</Label>
            <Input id="again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className="h-10" />
          </div>
          <Button type="submit" variant="brand" className="h-10 w-full" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Şifreyi kaydet
          </Button>
        </form>
      )}
    </div>
  );
}
