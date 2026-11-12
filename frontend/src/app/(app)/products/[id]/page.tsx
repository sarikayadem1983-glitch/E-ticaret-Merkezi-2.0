'use client';

import { ArrowLeft, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ProductStatusBadge } from '@/components/catalog/common';
import { ProductForm } from '@/components/catalog/product-form';
import { VariantEditor } from '@/components/catalog/variant-editor';
import { PageHeader } from '@/components/page-header';
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
import { useDeleteProduct, useProduct, useSaveProduct } from '@/hooks/catalog';
import { useSession } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const product = useProduct(id);
  const session = useSession();
  const save = useSaveProduct(id);
  const remove = useDeleteProduct(id);
  const [confirming, setConfirming] = useState(false);
  // The backend decides per company; this only hides controls a viewer cannot use.
  const perms = session.data?.user.permissions ?? [];
  const readOnly = !perms.includes('*') && !perms.includes('products:write');

  if (product.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (product.isError || !product.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(product.error)}</AlertDescription>
      </Alert>
    );
  }
  const p = product.data;

  return (
    <div className="space-y-6">
      <Link href="/products" className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Ürünler
      </Link>
      <PageHeader
        title={p.name}
        description={<ProductStatusBadge status={p.status} />}
        actions={
          !readOnly && (
            <Button variant="outline" className="h-10 text-destructive" onClick={() => setConfirming(true)}>
              <Trash2 className="size-4" aria-hidden />
              Ürünü sil
            </Button>
          )
        }
      />
      {readOnly ? (
        <p className="text-sm text-muted-foreground">Bu ürünü yalnızca görüntüleyebilirsiniz.</p>
      ) : (
        <ProductForm
          key={p.updatedAt}
          product={p}
          submitLabel="Değişiklikleri kaydet"
          onCancel={() => router.push('/products')}
          onSubmit={async (input) => {
            await save.mutateAsync(input);
            toast.success('Ürün güncellendi');
          }}
        />
      )}
      <VariantEditor product={p} readOnly={readOnly} />

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ürün silinsin mi?</DialogTitle>
            <DialogDescription>
              Ürün ve {p.variants.length} varyantı silinir. SKU ve barkodlar yeniden kullanılamaz. Satışı durdurmak için arşivlemeyi tercih edebilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => {
                    toast.success('Ürün silindi');
                    router.push('/products');
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
    </div>
  );
}
