'use client';

import { useMutation } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { initials } from '@/components/shell/user-menu';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLogout, useSession } from '@/hooks/queries';
import { bff, errorMessage } from '@/lib/api';

export default function ProfilePage() {
  const { data } = useSession();
  const logout = useLogout();
  const user = data?.user;
  const sendVerification = useMutation({
    mutationFn: () => bff('auth/email/verification', { method: 'POST' }),
    onSuccess: () => toast.success('Doğrulama bağlantısı email adresinize gönderildi'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader title="Profil" description="Hesap ve oturum bilgileriniz" />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border bg-card p-6 text-center shadow-xs">
          {user ? (
            <>
              <span className="mx-auto grid size-16 place-items-center rounded-full bg-brand-navy text-xl font-semibold text-white">
                {initials(user.name)}
              </span>
              <p className="mt-3 font-semibold text-brand-navy">{user.name}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </>
          ) : (
            <Skeleton className="mx-auto h-28 w-40" />
          )}
          <Button
            variant="outline"
            className="mt-6 w-full"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut className="size-4" aria-hidden />
            Çıkış yap
          </Button>
        </section>
        <section className="rounded-xl border bg-card shadow-xs lg:col-span-2">
          <h2 className="border-b px-5 py-4 font-semibold text-brand-navy">
            Hesap bilgileri
          </h2>
          <dl className="grid gap-5 p-5 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase">Ad soyad</dt>
              <dd className="mt-1 text-sm">{user?.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase">Email</dt>
              <dd className="mt-1 text-sm">{user?.email}</dd>
              {user && user.emailVerified === true && (
                <dd className="mt-1 text-xs font-medium text-emerald-700">Doğrulandı</dd>
              )}
              {user && user.emailVerified === false && (
                <dd className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-amber-700">Doğrulanmadı</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-10"
                    disabled={sendVerification.isPending || sendVerification.isSuccess}
                    onClick={() => sendVerification.mutate()}
                  >
                    {sendVerification.isSuccess ? 'Gönderildi' : 'Doğrulama emaili gönder'}
                  </Button>
                </dd>
              )}
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase">Mağaza</dt>
              <dd className="mt-1 text-sm">{user?.tenant?.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase">Rol</dt>
              <dd className="mt-1 text-sm">
                {user?.permissions.includes('*') ? 'Mağaza sahibi (tüm yetkiler)' : user?.permissions.join(', ')}
              </dd>
            </div>
          </dl>
          <p className="border-t px-5 py-4 text-xs text-muted-foreground">
            Oturumunuz 2 saat işlem yapılmadığında veya girişten 12 saat sonra
            güvenlik için sonlandırılır.
          </p>
        </section>
      </div>
    </>
  );
}
