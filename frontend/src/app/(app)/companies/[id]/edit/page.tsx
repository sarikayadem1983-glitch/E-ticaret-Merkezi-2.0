'use client';

import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CompanyForm } from '@/components/company-form';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useCompany, useSaveCompany } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';

export default function EditCompanyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const company = useCompany(id);
  const save = useSaveCompany(id);

  if (company.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(company.error)}</AlertDescription>
      </Alert>
    );
  }
  if (!company.data) return <Skeleton className="h-96 w-full" />;

  return (
    <>
      <PageHeader title="Firmayı düzenle" description={company.data.legalName} />
      <CompanyForm
        company={company.data}
        submitLabel="Değişiklikleri kaydet"
        onCancel={() => router.push(`/companies/${id}`)}
        onSubmit={async (values) => {
          await save.mutateAsync(values);
          toast.success('Firma güncellendi');
          router.push(`/companies/${id}`);
        }}
      />
    </>
  );
}
