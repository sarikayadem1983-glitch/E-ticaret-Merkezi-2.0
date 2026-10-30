'use client';

import { Loader2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormField, fieldAria } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useCreateInvitation } from '@/hooks/queries';
import { type AccessValue, accessError } from '@/lib/access';
import { errorMessage } from '@/lib/api';
import { AccessEditor } from './access-editor';

const EMPTY: AccessValue = { companyRoles: [{ companyId: '', roleKey: 'viewer' }] };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteDialog({ canGrantAdmin }: { canGrantAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [access, setAccess] = useState<AccessValue>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string>();
  const create = useCreateInvitation();

  const reset = () => {
    setEmail('');
    setAccess(EMPTY);
    setError(null);
    setEmailError(undefined);
    create.reset();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    setEmailError(EMAIL.test(trimmed) ? undefined : 'Geçerli bir email girin');
    const invalid = accessError(access);
    if (!EMAIL.test(trimmed) || invalid) {
      setError(invalid);
      return;
    }
    try {
      const { data } = await create.mutateAsync({ email: trimmed, ...access });
      if (data.replacesInactiveMembership) {
        toast.warning(
          'Bu kişinin bu mağazadaki eski rol ve firma erişimleri bu davettekilerle değiştirilecek.',
        );
      }
      if (data.delivery === 'failed') {
        setError('E-posta gönderilemedi. Yeniden gönderin.');
        return;
      }
      toast.success('Davet gönderildi');
      setOpen(false);
      reset();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="brand">
          <UserPlus className="size-4" aria-hidden />
          Kullanıcı davet et
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Kullanıcı davet et</DialogTitle>
            <DialogDescription>
              Davet bağlantısı e-postayla gönderilir.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <FormField id="invite-email" label="Email" error={emailError}>
            <Input
              {...fieldAria('invite-email', emailError)}
              type="email"
              autoComplete="off"
              className="h-10"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <AccessEditor
            idPrefix="invite"
            value={access}
            onChange={setAccess}
            canGrantAdmin={canGrantAdmin}
          />
          <DialogFooter>
            <Button type="submit" variant="brand" disabled={create.isPending}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              Davet gönder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
