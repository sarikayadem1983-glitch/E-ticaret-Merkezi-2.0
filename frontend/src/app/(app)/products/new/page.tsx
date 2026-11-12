'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ProductForm } from '@/components/catalog/product-form';
import { PageHeader } from '@/components/page-header';
import { useSaveProduct } from '@/hooks/catalog';

export default function NewProductPage() {
  const router = useRouter();
  const save = useSaveProduct();

  return (
    <>
      <PageHeader title="Yeni ürün" description="Ürünü ilk varyantı ve liste fiyatıyla ekleyin." />
      <ProductForm
        submitLabel="Ürünü kaydet"
        onCancel={() => router.push('/products')}
        onSubmit={async (input) => {
          const { data } = await save.mutateAsync(input);
          toast.success('Ürün eklendi');
          router.push(`/products/${data.id}`);
        }}
      />
    </>
  );
}
