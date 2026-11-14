'use client';

import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useRetrySyncJob, useSyncJobs } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { statsSummary, SYNC_STATUS_LABELS, type SyncStatus } from '@/lib/integrations';

const dateFormat = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const BADGE: Record<SyncStatus, 'muted' | 'secondary' | 'success' | 'destructive'> = {
  queued: 'muted',
  running: 'secondary',
  succeeded: 'success',
  failed: 'destructive',
};

/** Latest sync jobs of one account; failed jobs can be retried. */
export function SyncLog({ companyId, accountId }: { companyId: string; accountId: string }) {
  const [status, setStatus] = useState<SyncStatus | 'all'>('all');
  const jobs = useSyncJobs(companyId, accountId, status);
  const retry = useRetrySyncJob(companyId, accountId);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-brand-navy">Senkron logu</h3>
        <Select value={status} onValueChange={(v) => setStatus(v as SyncStatus | 'all')}>
          <SelectTrigger className="w-40" aria-label="Durum filtresi">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tümü</SelectItem>
            {(Object.keys(SYNC_STATUS_LABELS) as SyncStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {SYNC_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {jobs.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(jobs.error)}</AlertDescription>
        </Alert>
      ) : !jobs.data ? (
        <Skeleton className="h-24 w-full" />
      ) : jobs.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Henüz senkron işi yok. Ürün, stok ve sipariş senkronları Trendyol entegrasyonu açıldığında
          burada görünecek.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>İş</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead>Sonuç</TableHead>
              <TableHead>Zaman</TableHead>
              <TableHead className="sr-only">İşlem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.data.data.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-mono text-xs">{job.kind}</TableCell>
                <TableCell>
                  <Badge variant={BADGE[job.status]}>{SYNC_STATUS_LABELS[job.status]}</Badge>
                </TableCell>
                <TableCell className="max-w-sm text-sm whitespace-normal">
                  {job.errorMessage ?? (statsSummary(job.stats) || '—')}
                  <span className="block text-xs text-muted-foreground">
                    Toplam deneme: {job.attempts}
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  {dateFormat.format(new Date(job.finishedAt ?? job.startedAt ?? job.queuedAt))}
                </TableCell>
                <TableCell className="text-right">
                  {job.status === 'failed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retry.isPending}
                      onClick={() =>
                        retry.mutate(job.id, {
                          onSuccess: () => toast.success('İş yeniden kuyruğa alındı'),
                          onError: (e) => toast.error(errorMessage(e)),
                        })
                      }
                    >
                      <RotateCcw aria-hidden />
                      Yeniden dene
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
