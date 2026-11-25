'use client';

import { Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useChannelAccounts, usePushTrendyolStockPrice } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';

/**
 * INT-TY-02b: sends this product's local stock and Trendyol price to Trendyol
 * (manual, after confirmation). Hidden when the company has no active Trendyol
 * account. The backend decides permissions and which variants are linked.
 */
export function TrendyolPushButton({
  companyId,
  variantIds,
}: {
  companyId: string;
  variantIds: string[];
}) {
  const accounts = useChannelAccounts(companyId);
  const account = accounts.data?.find((a) => a.channel === 'trendyol' && a.isActive);
  const [open, setOpen] = useState(false);
  const push = usePushTrendyolStockPrice(companyId, account?.id ?? '');

  if (!account || variantIds.length === 0) return null;
  const ids = variantIds.slice(0, 50);

  return (
    <>
      <Button variant="outline" className="h-10" onClick={() => setOpen(true)}>
        <Send className="size-4" aria-hidden />
        {"Trendyol'a gönder"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{"Stok ve fiyat Trendyol'a gönderilsin mi?"}</DialogTitle>
            <DialogDescription>
              {`${ids.length} varyantın satılabilir stoğu (tüm depolar, rezerve hariç) ve Trendyol fiyatı "${account.name}" hesabına yazılır. Trendyol'da eşleşmemiş, stok kaydı olmayan veya fiyatı Trendyol'dakinden 2 kattan fazla farklı varyantlar gönderilmez. Sonuç Entegrasyonlar > Senkron logu'nda görünür.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button
              disabled={push.isPending}
              onClick={() =>
                push.mutate(ids, {
                  onSuccess: (r) => {
                    setOpen(false);
                    toast.success(
                      r.data.duplicate
                        ? 'Bu seçim için bu dakika içinde başlatılmış iş zaten var.'
                        : "Gönderme işi kuyruğa alındı.",
                    );
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              Gönder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
