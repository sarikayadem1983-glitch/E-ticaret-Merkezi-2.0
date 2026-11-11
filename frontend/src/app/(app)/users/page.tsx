'use client';

import { Users } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { InviteDialog } from '@/components/users/invite-dialog';
import { MembersTable } from '@/components/users/members-table';
import { useSession, useUsers } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';

export default function UsersPage() {
  const session = useSession();
  const canManage = session.data?.user.canManageUsers === true;
  const users = useUsers();
  const selfId = session.data?.user.id ?? '';
  const self = users.data?.find((m) => m.userId === selfId);
  const actorIsOwner =
    !!self && 'tenantRole' in self.access && self.access.tenantRole === 'owner';

  if (session.isSuccess && !canManage) {
    return (
      <>
        <PageHeader title="Kullanıcılar" />
        <Alert>
          <AlertDescription>Bu sayfayı görme yetkiniz yok.</AlertDescription>
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Kullanıcılar"
        description="Mağazanıza erişebilen kişiler ve rolleri"
        actions={canManage && <InviteDialog canGrantAdmin={actorIsOwner} />}
      />
      <div className="rounded-xl border bg-card shadow-xs">
        {users.isError ? (
          <Alert variant="destructive" className="m-4 w-auto">
            <AlertDescription>{errorMessage(users.error)}</AlertDescription>
          </Alert>
        ) : users.isLoading || session.isLoading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (users.data ?? []).length === 0 ? (
          <div className="px-4 py-16 text-center">
            <Users className="mx-auto size-10 text-brand-orange" aria-hidden />
            <p className="mt-3 font-medium text-brand-navy">Henüz kullanıcı yok</p>
          </div>
        ) : (
          <MembersTable
            members={users.data ?? []}
            selfId={selfId}
            actorIsOwner={actorIsOwner}
          />
        )}
      </div>
    </>
  );
}
