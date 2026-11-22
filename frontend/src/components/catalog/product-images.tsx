'use client';

import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  IMAGE_MAX_BYTES,
  useBindImage,
  useDeleteImage,
  useOrderImages,
  useProductImages,
  useUploadImage,
} from '@/hooks/product-images';
import { errorMessage } from '@/lib/api';
import type { Product } from '@/lib/types';

const TYPES = 'image/jpeg,image/png,image/webp';

/** Product images (IMG-01): upload, order, bind to a variant, delete. */
export function ProductImages({ product, readOnly }: { product: Product; readOnly: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const images = useProductImages(product.id);
  const upload = useUploadImage(product.id);
  const order = useOrderImages(product.id);
  const bind = useBindImage(product.id);
  const remove = useDeleteImage(product.id);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const list = images.data ?? [];
  const busy = upload.isPending || order.isPending || bind.isPending || remove.isPending;

  const onFiles = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      if (file.size > IMAGE_MAX_BYTES) {
        toast.error(`${file.name}: görsel en çok 8 MB olabilir`);
        continue;
      }
      try {
        await upload.mutateAsync(file);
        toast.success(`${file.name} yüklendi`);
      } catch (e) {
        toast.error(`${file.name}: ${errorMessage(e)}`);
      }
    }
    if (input.current) input.current.value = '';
  };

  const move = (index: number, by: -1 | 1) => {
    const ids = list.map((i) => i.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    order.mutate(ids, { onError: (e) => toast.error(errorMessage(e)) });
  };

  return (
    <section aria-label="Görseller" className="space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-brand-navy">Görseller ({list.length})</h2>
          <p className="text-sm text-muted-foreground">
            JPEG, PNG veya WebP; en çok 8 MB. İlk görsel kapaktır.
          </p>
        </div>
        {!readOnly && (
          <>
            <input
              ref={input}
              type="file"
              accept={TYPES}
              multiple
              className="sr-only"
              aria-label="Görsel dosyası seç"
              tabIndex={-1}
              onChange={(e) => void onFiles(e.target.files)}
            />
            <Button variant="brand" className="h-10" disabled={busy} onClick={() => input.current?.click()}>
              {upload.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="size-4" aria-hidden />
              )}
              Görsel ekle
            </Button>
          </>
        )}
      </div>
      {images.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(images.error)}</AlertDescription>
        </Alert>
      ) : images.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Henüz görsel yok</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((img, i) => (
            <li key={img.id} className="space-y-2 rounded-lg border p-2">
              {/* Signed, short-lived URL from object storage: next/image must not cache or proxy it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={`${product.name} görsel ${i + 1}`}
                width={img.width}
                height={img.height}
                className="aspect-square w-full rounded-md bg-muted object-contain"
              />
              {readOnly ? null : (
                <>
                  <select
                    aria-label={`Görsel ${i + 1} varyantı`}
                    className="h-10 w-full rounded-md border bg-background px-2 text-sm"
                    value={img.variantId ?? ''}
                    disabled={busy}
                    onChange={(e) =>
                      bind.mutate(
                        { imageId: img.id, variantId: e.target.value || null },
                        { onError: (err) => toast.error(errorMessage(err)) },
                      )
                    }
                  >
                    <option value="">Tüm ürün</option>
                    {product.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.sku}
                      </option>
                    ))}
                  </select>
                  {confirmId === img.id ? (
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        className="h-10 flex-1"
                        disabled={busy}
                        onClick={() =>
                          remove.mutate(img.id, {
                            onSuccess: () => toast.success('Görsel silindi'),
                            onError: (e) => toast.error(errorMessage(e)),
                            onSettled: () => setConfirmId(null),
                          })
                        }
                      >
                        Sil
                      </Button>
                      <Button variant="outline" className="h-10 flex-1" onClick={() => setConfirmId(null)}>
                        Vazgeç
                      </Button>
                    </div>
                  ) : (
                    <div className="flex justify-between">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        aria-label={`Görsel ${i + 1} öne al`}
                        disabled={busy || i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowLeft className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        aria-label={`Görsel ${i + 1} sona al`}
                        disabled={busy || i === list.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowRight className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-10 text-destructive"
                        aria-label={`Görsel ${i + 1} sil`}
                        disabled={busy}
                        onClick={() => setConfirmId(img.id)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
