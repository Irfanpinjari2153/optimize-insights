import { cn } from "@/lib/utils";

interface KpiStatProps {
  label: string;
  value: string;
  delta?: string;
  tone?: "default" | "success" | "warning" | "critical";
  hint?: string;
}

export function KpiStat({ label, value, delta, tone = "default", hint }: KpiStatProps) {
  const toneCls = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning-foreground",
    critical: "text-critical",
  } as const;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("text-2xl font-semibold tabular-nums", toneCls[tone])}>
        {value}
      </div>
      {delta ? (
        <div className="text-xs font-medium text-success">{delta}</div>
      ) : null}
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
