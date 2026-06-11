import { FileText } from "lucide-react";
import type { BillingPeriod } from "@/lib/assessment-types";

function currency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function InvoiceCard({ period }: { period: BillingPeriod }) {
  return (
    <div className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-soft transition hover:shadow-elevated">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {period.label}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">{period.dateRange}</div>
        </div>
        <div className="rounded-lg bg-primary-soft p-2 text-primary">
          <FileText className="size-4" />
        </div>
      </div>
      <div>
        <div className="text-2xl font-semibold tabular-nums text-foreground">
          {currency(period.amount)}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">Billed amount</div>
      </div>
      <div className="truncate border-t border-border pt-3 text-[11px] text-muted-foreground">
        {period.invoiceFile}
      </div>
    </div>
  );
}
