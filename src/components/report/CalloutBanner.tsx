import type { ReactNode } from "react";
import { AlertTriangle, Info, ShieldAlert, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "advisory" | "warning" | "critical" | "consult";

interface CalloutBannerProps {
  tone: Tone;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

const toneMap: Record<
  Tone,
  { wrap: string; icon: ReactNode; chip: string; chipLabel: string }
> = {
  advisory: {
    wrap: "border-info/20 bg-info-soft/60",
    icon: <Info className="size-4" />,
    chip: "bg-info text-info-foreground",
    chipLabel: "Advisory",
  },
  warning: {
    wrap: "border-warning/30 bg-warning-soft/60",
    icon: <AlertTriangle className="size-4" />,
    chip: "bg-warning text-warning-foreground",
    chipLabel: "Compatibility",
  },
  critical: {
    wrap: "border-critical/25 bg-critical-soft/60",
    icon: <ShieldAlert className="size-4" />,
    chip: "bg-critical text-critical-foreground",
    chipLabel: "Prerequisite",
  },
  consult: {
    wrap: "border-primary/20 bg-primary-soft/60",
    icon: <MessageSquare className="size-4" />,
    chip: "bg-primary text-primary-foreground",
    chipLabel: "Expert review",
  },
};

export function CalloutBanner({ tone, title, children, action }: CalloutBannerProps) {
  const t = toneMap[tone];
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-5 print-break-inside-avoid md:flex-row md:items-start md:justify-between",
        t.wrap,
      )}
    >
      <div className="flex gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-foreground shadow-soft">
          {t.icon}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                t.chip,
              )}
            >
              {t.chipLabel}
            </span>
          </div>
          <h4 className="mt-1.5 text-sm font-semibold text-foreground">{title}</h4>
          <div className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {children}
          </div>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
