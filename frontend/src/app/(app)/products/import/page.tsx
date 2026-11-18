'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { NativeSelect } from '@/components/catalog/common';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCompanies } from '@/hooks/queries';
import { bff, errorMessage } from '@/lib/api';
import { IMPORT_COLUMN_LABEL, IMPORT_MAX_BYTES, importTemplate } from '@/lib/product-import';
import { XlsxImportError, xlsxToCsv } from '@/lib/xlsx-to-csv';

interface ImportReport {
  rows: number;
  products: number;
  variants: number;
  errors: { row: number; column: string | null; message: string }[];
  dryRun: boolean;
  created: number;
}

export default function ProductImportPage() {
  const qc = useQueryClient();
  const companies = useCompanies({ page: 1, search: '', status: 'active', perPage: 100 });
  const [companyId, setCompanyId] = useState('');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      bff<{ data: ImportReport }>('imports/products', {
        method: 'POST',
        body: { companyId, csv: file?.text ?? '', dryRun },
      }),
    onSuccess: (res) => {
      setReport(res.data);
      if (!res.data.dryRun && res.data.created > 0) {
        toast.success(`${res.data.created} ürün oluşturuldu`);
        void qc.invalidateQueries({ queryKey: ['products'] });
      }
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const download = () => {
    const url = URL.createObjectURL(new Blob([importTemplate()], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'urun-sablonu.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const pick = async (f: File | undefined) => {
    setReport(null);
    setError(null);
    if (!f) return setFile(null);
    const tooBig = `Dosya çok büyük (en çok ${Math.floor(IMPORT_MAX_BYTES / 1000)} KB, yaklaşık 1000 satır). Dosyayı bölün.`;
    if (/\.xlsx$/i.test(f.name)) {
      try {
        const text = await xlsxToCsv(f);
        if (new TextEncoder().encode(text).length > IMPORT_MAX_BYTES) {
          setFile(null);
          return setError(tooBig);
        }
        return setFile({ name: f.name, text });
      } catch (e) {
        setFile(null);
        return setError(e instanceof XlsxImportError ? e.message : 'Excel dosyası okunamadı.');
      }
    }
    if (f.size > IMPORT_MAX_BYTES) {
      setFile(null);
      return setError(tooBig);
    }
    setFile({ name: f.name, text: await f.text() });
  };

  const check = (dryRun: boolean) => {
    setError(null);
    if (!companyId) return setError('Firma seçin.');
    if (!file) return setError('CSV veya Excel (.xlsx) dosyası seçin.');
    run.mutate(dryRun);
  };

  const clean = report && report.errors.length === 0;

  return (
    <div className="space-y-6">
      <Link href="/products" className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Ürünler
      </Link>
      <PageHeader
        title="Toplu ürün içe aktarma"
        description="CSV veya Excel (.xlsx) dosyasından ürün ve varyant oluşturun. Önce kontrol edilir; hata yoksa içe aktarılır. Pazaryerine hiçbir şey gönderilmez."
        actions={
          <Button variant="outline" onClick={download}>
            <Download className="size-4" aria-hidden />
            Şablonu indir
          </Button>
        }
      />

      <section className="space-y-2 rounded-xl border bg-card p-4 text-sm shadow-xs">
        <p className="font-medium text-brand-navy">Dosya biçimi</p>
        <ul className="list-inside list-disc space-y-1 text-muted-foreground">
          <li>Her satır bir varyanttır; aynı ürün adlı satırlar tek ürünün varyantları olur.</li>
          {Object.entries(IMPORT_COLUMN_LABEL).map(([k, l]) => (
            <li key={k}>
              <code className="text-foreground">{k}</code>: {l}
            </li>
          ))}
          <li>Excel dosyasını (.xlsx) doğrudan seçebilirsiniz; yalnızca ilk sayfa okunur. Ya da &quot;CSV UTF-8 (virgül/noktalı virgülle ayrılmış)&quot; olarak kaydedin.</li>
          <li>Formül içeren ve =, +, -, @ ile başlayan hücreler güvenlik için reddedilir; değeri yazın.</li>
        </ul>
      </section>

      <section className="grid gap-4 rounded-xl border bg-card p-4 shadow-xs sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="company">Firma</Label>
          <NativeSelect id="company" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setReport(null); }}>
            <option value="">Firma seçin</option>
            {(companies.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="file">CSV veya Excel dosyası</Label>
          <input
            id="file"
            type="file"
            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => void pick(e.target.files?.[0])}
            className="block h-10 w-full rounded-md border px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium"
          />
        </div>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" className="min-h-10" disabled={run.isPending} onClick={() => check(true)}>
          <FileUp className="size-4" aria-hidden />
          Kontrol et
        </Button>
        <Button variant="brand" className="min-h-10" disabled={run.isPending || !clean || report?.dryRun === false} onClick={() => check(false)}>
          İçe aktar
        </Button>
      </div>

      {report && (
        <section className="rounded-xl border bg-card shadow-xs">
          <div className="border-b px-4 py-3 text-sm">
            {report.dryRun ? (
              clean ? (
                <span className="font-medium text-emerald-700">
                  Hata yok: {report.products} ürün, {report.variants} varyant içe aktarılmaya hazır.
                </span>
              ) : (
                <span className="font-medium text-destructive">
                  {report.errors.length} hata bulundu; hiçbir şey kaydedilmedi. Düzeltip tekrar kontrol edin.
                </span>
              )
            ) : (
              <span className="font-medium text-emerald-700">{report.created} ürün oluşturuldu.</span>
            )}
          </div>
          {report.errors.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20 pl-4">Satır</TableHead>
                  <TableHead className="w-36">Kolon</TableHead>
                  <TableHead className="pr-4">Hata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.errors.map((e, i) => (
                  <TableRow key={`${e.row}-${e.column}-${i}`}>
                    <TableCell className="pl-4 tabular-nums">{e.row}</TableCell>
                    <TableCell className="font-mono text-xs">{e.column ?? '—'}</TableCell>
                    <TableCell className="pr-4 whitespace-normal">{e.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}
    </div>
  );
}
