'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSaveChannelAccount } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { buildCredentials, type ChannelAccount, type ChannelDefinition } from '@/lib/integrations';

/**
 * Create or edit a channel account. Credentials are write-only: the form never
 * shows stored values (only the masked hint as a placeholder) and keeps them
 * in component state only until the request is sent. The page mounts it only
 * while open, so closing it forgets everything that was typed.
 */
export function AccountDialog({
  open,
  onOpenChange,
  companyId,
  definitions,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  definitions: ChannelDefinition[];
  account?: ChannelAccount;
}) {
  const save = useSaveChannelAccount(companyId);
  const mode = account ? 'edit' : 'create';
  const [channel, setChannel] = useState(account?.channel ?? definitions[0]?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const definition = definitions.find((d) => d.code === channel);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!definition) return;
    if (name.trim() === '') {
      setError('Hesap adı zorunlu');
      return;
    }
    const built = buildCredentials(definition.credentialFields, values, mode);
    if (built.error) {
      setError(built.error);
      return;
    }
    const body = account
      ? {
          name: name.trim(),
          ...(built.credentials ? { credentials: built.credentials } : {}),
        }
      : { channel, name: name.trim(), credentials: built.credentials };
    save.mutate(
      { id: account?.id, body },
      {
        onSuccess: () => {
          setValues({});
          onOpenChange(false);
          toast.success(account ? 'Kanal hesabı güncellendi' : 'Kanal hesabı eklendi');
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} autoComplete="off" className="space-y-4">
          <DialogHeader>
            <DialogTitle>{account ? 'Kanal hesabını düzenle' : 'Kanal hesabı ekle'}</DialogTitle>
            <DialogDescription>
              Kimlik bilgileri şifrelenerek saklanır ve bir daha gösterilmez.
              {account && ' Değiştirmek istemiyorsanız alanları boş bırakın.'}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!account && (
            <FormField id="channel" label="Pazaryeri" required>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger id="channel" className="w-full">
                  <SelectValue placeholder="Seçin" />
                </SelectTrigger>
                <SelectContent>
                  {definitions.map((d) => (
                    <SelectItem key={d.code} value={d.code}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          <FormField id="account-name" label="Hesap adı" required>
            <Input
              id="account-name"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              placeholder="Örn. Ana mağaza"
            />
          </FormField>

          {definition?.credentialFields.map((field) => (
            <FormField
              key={field.key}
              id={`cred-${field.key}`}
              label={field.label}
              required={!account}
              hint={account ? `Kayıtlı: ${account.credentials[field.key] ?? '••••'}` : undefined}
            >
              <Input
                id={`cred-${field.key}`}
                type={field.secret ? 'password' : 'text'}
                autoComplete={field.secret ? 'new-password' : 'off'}
                spellCheck={false}
                maxLength={field.maxLength}
                value={values[field.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              />
            </FormField>
          ))}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Vazgeç
            </Button>
            <Button type="submit" variant="brand" disabled={save.isPending || !definition}>
              {account ? 'Kaydet' : 'Ekle'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
