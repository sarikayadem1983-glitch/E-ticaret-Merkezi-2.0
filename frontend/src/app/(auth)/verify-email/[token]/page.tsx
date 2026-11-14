'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage, request } from '@/lib/api';

/**
 * USR-19: verification needs one click on purpose: mail scanners that open links
 * must not use up the single-use token.
 */
export default function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    setState('busy');
    try {
      await request('/api/auth/email/verify', { method: 'POST', body: { token } });
      setState('done');
    } catch (err) {
      setError(errorMessage(err));
      setState('idle');
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-brand-navy">Email doğrulama</h1>
      {state === 'done' ? (
        <Alert>
          <AlertDescription>Email adresiniz doğrulandı.</AlertDescription>
        </Alert>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Email adresinizi doğrulamak için düğmeye basın.</p>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error} Bağlantının süresi dolmuş veya kullanılmış olabilir; uygulamadan yeni doğrulama isteyin.</AlertDescription>
            </Alert>
          )}
          <Button variant="brand" className="h-10 w-full" disabled={state === 'busy'} onClick={() => void confirm()}>
            {state === 'busy' && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Email adresimi doğrula
          </Button>
        </>
      )}
      <p className="text-center text-sm">
        <Link href="/login" className="font-medium text-brand-navy hover:underline">
          Girişe dön
        </Link>
      </p>
    </div>
  );
}
