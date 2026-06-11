import { cn } from "@/lib/utils";

interface ScoreRingProps {
  value: number;
  max?: number;
  label: string;
  sublabel?: string;
  tone?: "primary" | "success" | "warning";
  size?: number;
}

export function ScoreRing({
  value,
  max = 100,
  label,
  sublabel,
  tone = "primary",
  size = 132,
}: ScoreRingProps) {
  const pct = Math.max(0, Math.min(1, value / max));
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * pct;

  const toneCls: Record<string, string> = {
    primary: "stroke-primary",
    success: "stroke-success",
    warning: "stroke-warning",
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            className="fill-none stroke-border"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            strokeLinecap="round"
            className={cn("fill-none transition-all", toneCls[tone])}
            strokeDasharray={`${dash} ${c}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tabular-nums text-foreground">
            {Math.round(value)}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            / {max}
          </span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {sublabel ? (
          <div className="text-xs text-muted-foreground">{sublabel}</div>
        ) : null}
      </div>
    </div>
  );
}
