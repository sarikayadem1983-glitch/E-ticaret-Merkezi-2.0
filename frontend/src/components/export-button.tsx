"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { bff, errorMessage } from "@/lib/api";

/** IMP-04: asks the backend for a CSV (as JSON text) and saves it in the browser. */
export function ExportButton({
  kind,
  companyId,
}: {
  kind: "products" | "stock";
  companyId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const q = companyId ? `?company_id=${companyId}` : "";
      const res = await bff<{
        data: { filename: string; rows: number; csv: string };
      }>(`exports/${kind}${q}`);
      const url = URL.createObjectURL(
        new Blob([res.data.csv], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = res.data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${res.data.rows} satır dışa aktarıldı`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" disabled={busy} onClick={() => void run()}>
      <Download className="size-4" aria-hidden />
      Dışa aktar
    </Button>
  );
}
