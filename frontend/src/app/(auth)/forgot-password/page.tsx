'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage, request } from '@/lib/api';

/** USR-19: the answer is the same whether the address exists or not (no enumeration). */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Geçerli bir email girin');
    setBusy(true);
    try {
      await request('/api/auth/password/forgot', { method: 'POST', body: { email: email.trim() } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Şifremi unuttum</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hesabınızın email adresini girin; şifre belirleme bağlantısı gönderelim.
        </p>
      </div>
      {sent ? (
        <Alert>
          <AlertDescription>
            Bu adrese kayıtlı bir hesap varsa birkaç dakika içinde bir bağlantı gelecek. Bağlantı tek kullanımlıktır ve
            süresi sınırlıdır. Gelen kutunuzu ve istenmeyen klasörünü kontrol edin.
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
          </div>
          <Button type="submit" variant="brand" className="h-10 w-full" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Bağlantı gönder
          </Button>
        </form>
      )}
      <p className="text-center text-sm">
        <Link href="/login" className="font-medium text-brand-navy hover:underline">
          Girişe dön
        </Link>
      </p>
    </div>
  );
}
