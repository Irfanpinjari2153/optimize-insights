import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Finding } from "@/lib/assessment-types";
import { cn } from "@/lib/utils";

type Tab = "severity" | "savings";

const severityColors: Record<string, string> = {
  Info: "oklch(0.58 0.13 165)",
  Medium: "oklch(0.62 0.10 200)",
  High: "oklch(0.72 0.16 65)",
  Critical: "oklch(0.58 0.22 25)",
};

export function InsightsCharts({ findings }: { findings: Finding[] }) {
  const [tab, setTab] = useState<Tab>("severity");

  const severityData = useMemo(() => {
    const counts = { Info: 0, Medium: 0, High: 0, Critical: 0 };
    for (const f of findings) {
      const key = (f.severity[0].toUpperCase() + f.severity.slice(1)) as keyof typeof counts;
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [findings]);

  const savingsData = useMemo(() => {
    return findings
      .filter((f) => f.monthlySavings && f.monthlySavings > 0)
      .sort((a, b) => (b.monthlySavings || 0) - (a.monthlySavings || 0))
      .slice(0, 6)
      .map((f) => ({
        name: f.title.length > 36 ? f.title.slice(0, 34) + "…" : f.title,
        value: Math.round(f.monthlySavings || 0),
      }));
  }, [findings]);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center justify-between border-b border-border p-5">
        <div>
          <h3 className="text-base font-semibold text-foreground">Visual Insights</h3>
          <p className="text-xs text-muted-foreground">
            Distribution of findings and largest savings opportunities
          </p>
        </div>
        <div className="flex rounded-lg border border-border bg-muted p-0.5">
          {(["severity", "savings"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition",
                tab === t
                  ? "bg-card text-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "severity" ? "Severity Breakdown" : "Top Savings"}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {tab === "severity" ? (
              <BarChart data={severityData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 260)" vertical={false} />
                <XAxis dataKey="name" stroke="oklch(0.50 0.022 260)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="oklch(0.50 0.022 260)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: "oklch(0.95 0.008 260)" }}
                  contentStyle={{
                    background: "white",
                    border: "1px solid oklch(0.92 0.008 260)",
                    borderRadius: 12,
                    boxShadow: "0 8px 24px -8px oklch(0.2 0.04 265 / 0.15)",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {severityData.map((entry) => (
                    <Cell key={entry.name} fill={severityColors[entry.name]} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <BarChart
                data={savingsData}
                layout="vertical"
                margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 260)" horizontal={false} />
                <XAxis type="number" stroke="oklch(0.50 0.022 260)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke="oklch(0.50 0.022 260)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={220}
                />
                <Tooltip
                  cursor={{ fill: "oklch(0.95 0.008 260)" }}
                  formatter={(v: number) => [`$${v.toLocaleString()}/mo`, "Savings"]}
                  contentStyle={{
                    background: "white",
                    border: "1px solid oklch(0.92 0.008 260)",
                    borderRadius: 12,
                    boxShadow: "0 8px 24px -8px oklch(0.2 0.04 265 / 0.15)",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="value" fill="oklch(0.51 0.22 269)" radius={[0, 8, 8, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
