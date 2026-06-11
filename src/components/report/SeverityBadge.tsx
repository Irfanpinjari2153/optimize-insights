import type { Category, Severity, Confidence } from "@/lib/assessment-types";
import { cn } from "@/lib/utils";

const severityStyles: Record<
  Severity,
  { label: string; cls: string; dot: string }
> = {
  info: {
    label: "Info",
    cls: "bg-success-soft text-success border-success/20",
    dot: "bg-success",
  },
  medium: {
    label: "Medium",
    cls: "bg-info-soft text-info border-info/20",
    dot: "bg-info",
  },
  high: {
    label: "High",
    cls: "bg-warning-soft text-warning-foreground border-warning/30",
    dot: "bg-warning",
  },
  critical: {
    label: "Critical",
    cls: "bg-critical-soft text-critical border-critical/25",
    dot: "bg-critical",
  },
};

export function SeverityBadge({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}) {
  const s = severityStyles[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-wide",
        s.cls,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

const categoryLabel: Record<Category, string> = {
  cost: "Cost",
  security: "Security",
  modernization: "Modernization",
  governance: "Governance",
};

export function CategoryChip({ category }: { category: Category }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {categoryLabel[category]}
    </span>
  );
}

export function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  const map = {
    low: "text-muted-foreground border-border",
    medium: "text-info border-info/20 bg-info-soft",
    high: "text-success border-success/20 bg-success-soft",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        map[confidence],
      )}
    >
      {confidence} confidence
    </span>
  );
}
