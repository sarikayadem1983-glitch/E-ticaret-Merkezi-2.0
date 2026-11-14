'use client';

import { ArrowLeft, Pencil, Plug, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AccountDialog } from '@/components/integrations/account-dialog';
import { SyncLog } from '@/components/integrations/sync-log';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import {
  useChannelAccounts,
  useChannelDefinitions,
  useCompany,
  useDeleteChannelAccount,
  useSaveChannelAccount,
  useTestConnection,
} from '@/hooks/queries';
import { ApiError, errorMessage } from '@/lib/api';
import type { ChannelAccount, ConnectionTestResult } from '@/lib/integrations';

export default function IntegrationsPage() {
  const { id: companyId } = useParams<{ id: string }>();
  const company = useCompany(companyId);
  const definitions = useChannelDefinitions();
  const accounts = useChannelAccounts(companyId);
  const save = useSaveChannelAccount(companyId);
  const remove = useDeleteChannelAccount(companyId);
  const test = useTestConnection(companyId);
  const [dialog, setDialog] = useState<{
    open: boolean;
    account?: ChannelAccount;
  }>({
    open: false,
  });
  const [toDelete, setToDelete] = useState<ChannelAccount | null>(null);
  const [results, setResults] = useState<Record<string, ConnectionTestResult>>({});

  const error = accounts.error ?? definitions.error;
  if (error) {
    const forbidden = error instanceof ApiError && error.status === 403;
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {forbidden
            ? 'Entegrasyonları yalnızca mağaza sahibi ve Admin yönetebilir.'
            : errorMessage(error)}
        </AlertDescription>
      </Alert>
    );
  }
  if (!accounts.data || !definitions.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const channelName = (code: string) => definitions.data.find((d) => d.code === code)?.name ?? code;

  const runTest = (account: ChannelAccount) =>
    test.mutate(account.id, {
      onSuccess: (r) => setResults((all) => ({ ...all, [account.id]: r })),
      onError: (e) => toast.error(errorMessage(e)),
    });

  const setActive = (account: ChannelAccount, isActive: boolean) =>
    save.mutate(
      { id: account.id, body: { isActive } },
      {
        onSuccess: () => toast.success(isActive ? 'Hesap aktifleştirildi' : 'Hesap pasife alındı'),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <>
      <Link
        href={`/companies/${companyId}`}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> {company.data?.legalName ?? 'Firma'}
      </Link>
      <PageHeader
        title="Entegrasyonlar"
        description="Pazaryeri hesaplarını bağlayın, bağlantıyı test edin ve senkron işlerini izleyin."
        actions={
          <Button variant="brand" onClick={() => setDialog({ open: true })}>
            <Plus className="size-4" aria-hidden />
            Kanal hesabı ekle
          </Button>
        }
      />

      {accounts.data.length === 0 ? (
        <section className="rounded-xl border bg-card p-8 text-center shadow-xs">
          <Plug className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 font-medium">Henüz bağlı pazaryeri hesabı yok</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Trendyol satıcı panelindeki Satıcı ID, API Key ve API Secret ile hesap ekleyin.
          </p>
        </section>
      ) : (
        <div className="space-y-6">
          {accounts.data.map((account) => {
            const result = results[account.id];
            const definition = definitions.data.find((d) => d.code === account.channel);
            return (
              <section key={account.id} className="rounded-xl border bg-card shadow-xs">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
                  <div>
                    <h2 className="font-semibold text-brand-navy">{account.name}</h2>
                    <p className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
                      {channelName(account.channel)}
                      <Badge variant={account.isActive ? 'success' : 'muted'}>
                        {account.isActive ? 'Aktif' : 'Pasif'}
                      </Badge>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {definition?.connectionTest && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={test.isPending || !account.isActive}
                        onClick={() => runTest(account)}
                      >
                        <Plug aria-hidden />
                        Bağlantıyı test et
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDialog({ open: true, account })}
                    >
                      <Pencil aria-hidden />
                      Düzenle
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={save.isPending}
                      onClick={() => setActive(account, !account.isActive)}
                    >
                      {account.isActive ? <PowerOff aria-hidden /> : <Power aria-hidden />}
                      {account.isActive ? 'Pasife al' : 'Aktifleştir'}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => setToDelete(account)}>
                      <Trash2 aria-hidden />
                      Sil
                    </Button>
                  </div>
                </div>
                <div className="space-y-5 p-5">
                  <dl className="grid gap-4 sm:grid-cols-3">
                    {definition?.credentialFields.map((f) => (
                      <div key={f.key}>
                        <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          {f.label}
                        </dt>
                        <dd className="mt-1 font-mono text-sm">
                          {account.credentials[f.key] ?? '••••'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {result && (
                    <Alert variant={result.ok ? 'default' : 'destructive'} role="status">
                      <AlertDescription>{result.message}</AlertDescription>
                    </Alert>
                  )}
                  <SyncLog companyId={companyId} accountId={account.id} />
                </div>
              </section>
            );
          })}
        </div>
      )}

      {dialog.open && (
        <AccountDialog
          key={dialog.account?.id ?? 'new'}
          open
          onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
          companyId={companyId}
          definitions={definitions.data}
          account={dialog.account}
        />
      )}

      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kanal hesabı silinsin mi?</DialogTitle>
            <DialogDescription>
              {toDelete?.name} hesabı ve kayıtlı kimlik bilgileri kaldırılır. Pazaryerindeki ürün ve
              siparişleriniz etkilenmez.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                toDelete &&
                remove.mutate(toDelete.id, {
                  onSuccess: () => {
                    setToDelete(null);
                    toast.success('Kanal hesabı silindi');
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              Sil
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
