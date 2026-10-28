'use client';

import { ArrowLeft, Pencil, Power, PowerOff } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { CompanyStatus, PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useCompany, useSetCompanyActive } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';

const dateFormat = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm break-words">{value || '—'}</dd>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card shadow-xs">
      <h2 className="border-b px-5 py-4 font-semibold text-brand-navy">{title}</h2>
      <dl className="grid gap-5 p-5 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const company = useCompany(id);
  const setActive = useSetCompanyActive(id);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (company.isError) {
    return (
      <>
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(company.error)}</AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/companies">Firmalara dön</Link>
        </Button>
      </>
    );
  }
  if (!company.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const c = company.data;
  const toggle = (active: boolean) =>
    setActive.mutate(active, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast.success(active ? 'Firma aktifleştirildi' : 'Firma pasife alındı');
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <>
      <Link
        href="/companies"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Firmalar
      </Link>
      <PageHeader
        title={c.legalName}
        description={<CompanyStatus active={c.isActive} />}
        actions={
          <>
            {c.isActive ? (
              <Button variant="outline" onClick={() => setConfirmOpen(true)}>
                <PowerOff className="size-4" aria-hidden />
                Pasife al
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={setActive.isPending}
                onClick={() => toggle(true)}
              >
                <Power className="size-4" aria-hidden />
                Aktifleştir
              </Button>
            )}
            <Button asChild variant="brand">
              <Link href={`/companies/${c.id}/edit`}>
                <Pencil className="size-4" aria-hidden />
                Düzenle
              </Link>
            </Button>
          </>
        }
      />

      {!c.isActive && (
        <Alert className="mb-6">
          <AlertDescription>
            Bu firma pasif. Kayıtları korunur ancak yeni işlemlerde seçilemez.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Firma bilgileri">
          <Item label="Ticari unvan" value={c.legalName} />
          <Item label={c.taxNumber.length === 10 ? 'VKN' : 'TCKN'} value={c.taxNumber} />
          <Item label="Vergi dairesi" value={c.taxOffice} />
          <Item label="Ülke" value={c.country === 'TR' ? 'Türkiye' : c.country} />
        </Card>
        <Card title="Adres">
          <div className="sm:col-span-2">
            <Item label="Adres" value={c.addressLine} />
          </div>
          <Item label="İlçe / İl" value={`${c.district} / ${c.city}`} />
          <Item label="Posta kodu" value={c.postalCode} />
        </Card>
        <Card title="İletişim ve e-Fatura">
          <Item label="Telefon" value={c.phone} />
          <Item label="Email" value={c.email} />
          <Item label="e-Fatura" value={c.eInvoiceEnabled ? 'Mükellef' : 'Mükellef değil'} />
          <Item label="Posta kutusu etiketi" value={c.eInvoiceAlias} />
        </Card>
        <Card title="Kayıt">
          <Item label="Oluşturulma" value={dateFormat.format(new Date(c.createdAt))} />
          <Item label="Son güncelleme" value={dateFormat.format(new Date(c.updatedAt))} />
        </Card>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Firma pasife alınsın mı?</DialogTitle>
            <DialogDescription>
              {c.legalName} pasife alınır. Firma silinmez; kayıtları korunur ve
              istediğiniz zaman yeniden aktifleştirebilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              disabled={setActive.isPending}
              onClick={() => toggle(false)}
            >
              Pasife al
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
