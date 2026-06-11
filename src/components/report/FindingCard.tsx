import { useState } from "react";
import { ChevronDown, ArrowRight } from "lucide-react";
import type { Finding } from "@/lib/assessment-types";
import { SeverityBadge, CategoryChip, ConfidenceChip } from "./SeverityBadge";
import { cn } from "@/lib/utils";

function currency(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function FindingCard({
  finding,
  defaultOpen = false,
}: {
  finding: Finding;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-shadow hover:shadow-elevated print-break-inside-avoid">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-4 p-5 text-left"
      >
        <SeverityBadge severity={finding.severity} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryChip category={finding.category} />
            <ConfidenceChip confidence={finding.confidence} />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {finding.evidenceType}
            </span>
          </div>
          <h3 className="mt-2 text-base font-semibold leading-snug text-foreground">
            {finding.title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {finding.monthlySavings ? (
            <div className="text-right">
              <div className="text-base font-semibold tabular-nums text-success">
                {currency(finding.monthlySavings)}
                <span className="text-xs font-normal text-muted-foreground">/mo</span>
              </div>
              {finding.annualSavings ? (
                <div className="text-[11px] text-muted-foreground">
                  {currency(finding.annualSavings)} / yr
                </div>
              ) : null}
            </div>
          ) : null}
          <ChevronDown
            className={cn(
              "size-5 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
      </button>

      {open ? (
        <div className="border-t border-border bg-surface px-5 py-5">
          <div className="grid gap-5 md:grid-cols-[1fr_auto]">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Reasoning
              </div>
              <ol className="mt-3 space-y-2.5">
                {finding.points.map((p, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed text-foreground">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-primary-soft text-[11px] font-semibold text-primary">
                      {i + 1}
                    </span>
                    <span>{p}</span>
                  </li>
                ))}
              </ol>

              {finding.assumptions && finding.assumptions.length > 0 ? (
                <div className="mt-5">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Assumptions requiring validation
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {finding.assumptions.map((a, i) => (
                      <li
                        key={i}
                        className="rounded-md border border-dashed border-border bg-card px-3 py-2 text-xs text-muted-foreground"
                      >
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-primary/15 bg-primary-soft/50 p-4">
            <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-primary">
                Recommended next action
              </div>
              <p className="mt-1 text-sm leading-relaxed text-foreground">
                {finding.nextAction}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
