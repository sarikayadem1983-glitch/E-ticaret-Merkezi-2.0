'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CompanyForm } from '@/components/company-form';
import { PageHeader } from '@/components/page-header';
import { useSaveCompany } from '@/hooks/queries';

export default function NewCompanyPage() {
  const router = useRouter();
  const save = useSaveCompany();

  return (
    <>
      <PageHeader
        title="Yeni firma"
        description="Mağazanıza bağlı yeni bir işletme ekleyin."
      />
      <CompanyForm
        submitLabel="Firmayı kaydet"
        onCancel={() => router.push('/companies')}
        onSubmit={async (values) => {
          const { data } = await save.mutateAsync(values);
          toast.success('Firma eklendi');
          router.push(`/companies/${data.id}`);
        }}
      />
    </>
  );
}
