'use client';

import { Loader2, MailX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { useInvitationAction, useInvitations } from '@/hooks/queries';
import { roleLabel } from '@/lib/access';
import { errorMessage } from '@/lib/api';
import type { PendingInvitation } from '@/lib/types';

const DATE = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

/** "Admin" or "Muhasebe · 2 firma" without company names (the list has only ids). */
export function describeInvitation(inv: PendingInvitation): string {
  if (inv.tenantRole) return 'Admin';
  const roles = [...new Set(inv.companyRoles.map((c) => c.roleKey).filter((k) => k !== null))];
  const count = inv.companyRoles.length;
  return `${roles.map(roleLabel).join(', ') || 'Firma rolü'} · ${count} firma`;
}

/**
 * USR-T13b: pending invitations with resend and revoke. Resend issues a new
 * link (the old one stops working); revoke asks for confirmation first.
 */
export function InvitationsPanel() {
  const invitations = useInvitations(true);
  const action = useInvitationAction();
  const [revoking, setRevoking] = useState<PendingInvitation | null>(null);

  const resend = async (inv: PendingInvitation) => {
    try {
      const { data } = await action.mutateAsync({ id: inv.id, action: 'resend' });
      if (data.delivery === 'failed') {
        toast.warning('Davet yenilendi ama e-posta gönderilemedi. Yeniden gönderin.');
      } else {
        toast.success(`${inv.email} adresine davet yeniden gönderildi`);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    try {
      await action.mutateAsync({ id: revoking.id, action: 'revoke' });
      toast.success('Davet iptal edildi');
      setRevoking(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const rows = invitations.data ?? [];

  return (
    <section className="mt-6 rounded-xl border bg-card shadow-xs" aria-labelledby="invitations-title">
      <h2 id="invitations-title" className="border-b px-4 py-3 font-medium text-brand-navy">
        Bekleyen davetler
      </h2>
      {invitations.isError ? (
        <Alert variant="destructive" className="m-4 w-auto">
          <AlertDescription>{errorMessage(invitations.error)}</AlertDescription>
        </Alert>
      ) : invitations.isLoading ? (
        <div className="space-y-3 p-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          <MailX className="mx-auto mb-2 size-8 text-brand-orange" aria-hidden />
          Bekleyen davet yok
        </div>
      ) : (
        <ul className="divide-y">
          {rows.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{inv.email}</p>
                <p className="text-sm text-muted-foreground">
                  {describeInvitation(inv)} · Son geçerlilik {DATE.format(new Date(inv.expiresAt))}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {inv.status === 'expired' ? (
                    <Badge variant="secondary">Süresi doldu</Badge>
                  ) : (
                    <Badge variant="outline">Bekliyor</Badge>
                  )}
                  {inv.lastSendError && <Badge variant="destructive">E-posta gönderilemedi</Badge>}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={action.isPending}
                  onClick={() => resend(inv)}
                >
                  Yeniden gönder
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={action.isPending}
                  onClick={() => setRevoking(inv)}
                >
                  İptal et
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Davet iptal edilsin mi?</DialogTitle>
            <DialogDescription>
              {revoking?.email} adresine gönderilen bağlantı çalışmaz hale gelir. Gerekirse yeni
              davet gönderebilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>
              Vazgeç
            </Button>
            <Button variant="destructive" disabled={action.isPending} onClick={revoke}>
              {action.isPending && <Loader2 className="size-4 animate-spin" />}
              Daveti iptal et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
