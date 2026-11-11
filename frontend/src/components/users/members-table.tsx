'use client';

import { Loader2, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CompanyStatus } from '@/components/page-header';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSetUserActive, useUpdateAccess } from '@/hooks/queries';
import {
  type AccessValue,
  accessError,
  describeAccess,
  toAccessValue,
} from '@/lib/access';
import { errorMessage } from '@/lib/api';
import type { Member } from '@/lib/types';
import { AccessEditor } from './access-editor';

/**
 * Nobody edits their own access or an owner's; only an owner changes an
 * admin. The backend enforces the same rules; this only hides dead actions.
 */
function editable(member: Member, selfId: string, actorIsOwner: boolean) {
  if (member.userId === selfId) return false;
  if ('tenantRole' in member.access) {
    return member.access.tenantRole === 'admin' && actorIsOwner;
  }
  return true;
}

export function MembersTable({
  members,
  selfId,
  actorIsOwner,
}: {
  members: Member[];
  selfId: string;
  actorIsOwner: boolean;
}) {
  const [editing, setEditing] = useState<Member | null>(null);
  const setActive = useSetUserActive();

  const toggle = async (m: Member) => {
    const active = m.status !== 'active';
    try {
      await setActive.mutateAsync({ userId: m.userId, active });
      toast.success(active ? 'Kullanıcı aktifleştirildi' : 'Kullanıcı pasife alındı');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Ad soyad</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Erişim</TableHead>
            <TableHead>Durum</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">İşlemler</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => {
            const canEdit = editable(m, selfId, actorIsOwner);
            const isOwner =
              'tenantRole' in m.access && m.access.tenantRole === 'owner';
            // An owner who is not the last active owner may be deactivated (backend decides).
            const canToggle = m.userId !== selfId && (canEdit || (isOwner && actorIsOwner));
            return (
              <TableRow key={m.userId}>
                <TableCell className="pl-4 font-medium">
                  {m.name}
                  {m.userId === selfId && (
                    <span className="ml-2 text-xs text-muted-foreground">(siz)</span>
                  )}
                </TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell>
                  <ul className="space-y-0.5 text-sm">
                    {describeAccess(m.access).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell>
                  <CompanyStatus active={m.status === 'active'} />
                </TableCell>
                <TableCell>
                  {(canEdit || canToggle) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${m.name} işlemleri`}
                          disabled={setActive.isPending}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canEdit && (
                          <DropdownMenuItem onSelect={() => setEditing(m)}>
                            Erişimi düzenle
                          </DropdownMenuItem>
                        )}
                        {canToggle && (
                          <DropdownMenuItem onSelect={() => toggle(m)}>
                            {m.status === 'active' ? 'Pasife al' : 'Aktifleştir'}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {editing && (
        <EditAccessDialog
          member={editing}
          canGrantAdmin={actorIsOwner}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function EditAccessDialog({
  member,
  canGrantAdmin,
  onClose,
}: {
  member: Member;
  canGrantAdmin: boolean;
  onClose: () => void;
}) {
  const [value, setValue] = useState<AccessValue>(() => toAccessValue(member.access));
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateAccess(member.userId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = accessError(value);
    setError(invalid);
    if (invalid) return;
    try {
      await update.mutateAsync(value);
      toast.success('Erişim güncellendi');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Erişimi düzenle</DialogTitle>
            <DialogDescription>
              {member.name} ({member.email}). Kaydedince eski erişimin tamamı değişir.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <AccessEditor
            idPrefix={`edit-${member.userId}`}
            value={value}
            onChange={setValue}
            canGrantAdmin={canGrantAdmin}
          />
          <DialogFooter>
            <Button type="submit" variant="brand" disabled={update.isPending}>
              {update.isPending && <Loader2 className="size-4 animate-spin" />}
              Kaydet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
