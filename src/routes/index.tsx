import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ArrowLeft,
  CloudCog,
  FileDown,
  FileText,
  Filter,
  History,
  LogIn,
  Save,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  CircleAlert,
  CheckCircle2,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/report/ScoreRing";
import { KpiStat } from "@/components/report/KpiStat";
import { InvoiceCard } from "@/components/report/InvoiceCard";
import { FindingCard } from "@/components/report/FindingCard";
import { InsightsCharts } from "@/components/report/InsightsCharts";
import { CalloutBanner } from "@/components/report/CalloutBanner";
import { InputPanel } from "@/components/report/InputPanel";
import { SeverityBadge, CategoryChip } from "@/components/report/SeverityBadge";
import { mockReport } from "@/lib/mock-assessment";
import type { AssessmentReport, Category } from "@/lib/assessment-types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { saveAssessment, getAssessment } from "@/lib/assessments.functions";
import { toast } from "sonner";

const SearchSchema = z.object({
  assessment: z.string().uuid().optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: (s) => SearchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Cloud Assessment Report — Generate consultant-grade AWS bill reviews" },
      {
        name: "description",
        content:
          "Turn AWS bill summaries into board-ready cloud assessment reports: cost savings, security signals, modernization roadmap, and governance findings.",
      },
    ],
  }),
  component: AssessmentPage,
});

type FilterKey = "all" | Category;

const filters: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "cost", label: "Cost" },
  { key: "security", label: "Security" },
  { key: "modernization", label: "Modernization" },
  { key: "governance", label: "Governance" },
];

function currency(n: number, max = 2) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: max,
  });
}

function AssessmentPage() {
  const [report, setReport] = useState<AssessmentReport>(mockReport);
  const [view, setView] = useState<"dashboard" | "report">("dashboard");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showInput, setShowInput] = useState(false);

  const filtered = useMemo(
    () =>
      filter === "all"
        ? report.findings
        : report.findings.filter((f) => f.category === filter),
    [report.findings, filter],
  );

  const counts = useMemo(() => {
    const all = report.findings.length;
    const byCat: Record<Category, number> = {
      cost: 0,
      security: 0,
      modernization: 0,
      governance: 0,
    };
    for (const f of report.findings) byCat[f.category]++;
    return { all, ...byCat };
  }, [report.findings]);

  if (view === "report") {
    return <ReportView report={report} onBack={() => setView("dashboard")} />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <div className="hidden h-6 w-px bg-border md:block" />
            <div className="hidden items-center gap-2 md:flex">
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <CloudCog className="size-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Cloud Assessment Report
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {report.accountName}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInput((s) => !s)}
              className="gap-2"
            >
              <Sparkles className="size-4" />
              New analysis
            </Button>
            <Button size="sm" onClick={() => setView("report")} className="gap-2">
              <FileText className="size-4" />
              Generate Report
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        {showInput ? (
          <InputPanel
            onAnalyzed={(r) => {
              setReport(r);
              setShowInput(false);
            }}
          />
        ) : null}

        {/* Hero / Executive summary */}
        <section className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-elevated">
          <div className="absolute inset-0 bg-grid-faint opacity-50" />
          <div className="absolute right-0 top-0 hidden h-full w-1/2 bg-gradient-to-l from-primary-soft/60 to-transparent lg:block" />

          <div className="relative grid gap-8 p-8 lg:grid-cols-[1.4fr_1fr] lg:p-10">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
                  <CheckCircle2 className="size-3.5" />
                  Health: {report.scores.health}
                </span>
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Generated {new Date(report.generatedAt).toLocaleDateString()}
                </span>
              </div>

              <h1 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-foreground lg:text-5xl">
                Executive cloud assessment
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Evidence-first review of <strong className="text-foreground">{report.accountName}</strong>{" "}
                across cost, security, modernization, and governance — derived
                conservatively from the available billing summary.
              </p>

              <div className="mt-7 grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
                <KpiStat
                  label="Avg. monthly spend"
                  value={currency(report.summaryMetrics.averageSpend)}
                />
                <KpiStat
                  label="Monthly savings"
                  value={currency(report.summaryMetrics.monthlySavings)}
                  tone="success"
                  delta={`-${report.summaryMetrics.savingsPercent.toFixed(1)}%`}
                />
                <KpiStat
                  label="Annual impact"
                  value={currency(report.summaryMetrics.annualSavings, 0)}
                  tone="success"
                />
                <KpiStat
                  label="Critical findings"
                  value={String(report.summaryMetrics.criticalCount)}
                  tone={report.summaryMetrics.criticalCount > 0 ? "critical" : "default"}
                />
              </div>

              <ul className="mt-7 space-y-2.5">
                {report.executiveBullets.slice(0, 4).map((b, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed text-foreground">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="text-balance">{b}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative flex flex-col items-center justify-center gap-6 rounded-2xl border border-border bg-card/70 p-6 backdrop-blur">
              <div className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-background">
                <Sparkles className="size-3" />
                Premium
              </div>
              <div className="grid grid-cols-2 gap-6">
                <ScoreRing
                  value={report.scores.costEfficiency}
                  label="Cost efficiency"
                  sublabel="weighted 40%"
                  tone="primary"
                />
                <ScoreRing
                  value={report.scores.securityGrade}
                  label="Security grade"
                  sublabel="weighted 25%"
                  tone="success"
                />
              </div>
              <div className="grid w-full grid-cols-3 gap-2 border-t border-border pt-4 text-center">
                <Mini icon={<TrendingUp className="size-3.5" />} label="Modernization" value="Strong" />
                <Mini icon={<ShieldCheck className="size-3.5" />} label="Governance" value="Fair" />
                <Mini icon={<CircleAlert className="size-3.5" />} label="Risk" value="Low" />
              </div>
            </div>
          </div>
        </section>

        {/* Invoice cards */}
        <section>
          <SectionHeader
            title="Bill overview"
            subtitle="Latest three billing periods used as evidence"
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {report.billingPeriods.slice(0, 3).map((p) => (
              <InvoiceCard key={p.label} period={p} />
            ))}
          </div>
        </section>

        {/* Charts */}
        <section>
          <InsightsCharts findings={report.findings} />
        </section>

        {/* Callouts */}
        <section className="grid gap-4 lg:grid-cols-2">
          <CalloutBanner
            tone="warning"
            title="Migration prerequisite: validate Graviton compatibility"
          >
            Workload portability to Arm64 requires re-testing native dependencies,
            binary distributions, and managed runtime versions before rollout.
          </CalloutBanner>
          <CalloutBanner
            tone="consult"
            title="Expert consultation recommended for security posture"
            action={
              <Button size="sm" variant="outline" className="gap-2">
                Book review
              </Button>
            }
          >
            Billing evidence cannot confirm IAM, network, or data-exposure
            posture. Direct telemetry review is required to validate findings.
          </CalloutBanner>
        </section>

        {/* Findings */}
        <section>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHeader
              title={`Specific findings (${counts.all})`}
              subtitle="Evidence-first observations with assumptions, math, and next actions"
              compact
            />
            <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Filter className="size-3.5" />
              Filter
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5 rounded-xl border border-border bg-muted p-1">
            {filters.map((f) => {
              const count = f.key === "all" ? counts.all : counts[f.key];
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                    active
                      ? "bg-card text-foreground shadow-soft"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                      active ? "bg-primary-soft text-primary" : "bg-card text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-3">
            {filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
                No findings in this category.
              </div>
            ) : (
              filtered.map((f) => <FindingCard key={f.id} finding={f} />)
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function Mini({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  compact,
}: {
  title: string;
  subtitle?: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mb-0" : "mb-5"}>
      <h2 className="font-display text-2xl tracking-tight text-foreground lg:text-3xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  );
}

/* ---------------------------- Final report view ---------------------------- */

function ReportView({
  report,
  onBack,
}: {
  report: AssessmentReport;
  onBack: () => void;
}) {
  const sorted = [...report.findings].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, info: 3 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur no-print">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
            <ArrowLeft className="size-4" />
            Back to assessment
          </Button>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Report ready — board-quality output
            </span>
            <Button size="sm" onClick={() => window.print()} className="gap-2">
              <FileDown className="size-4" />
              Save as PDF
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-6 py-12">
        {/* Cover */}
        <section className="rounded-3xl border border-border bg-card p-10 shadow-elevated print-break-inside-avoid">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <CloudCog className="size-4 text-primary" />
              Cloud Assessment Report
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(report.generatedAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </div>
          </div>
          <h1 className="mt-6 font-display text-5xl leading-tight text-foreground lg:text-6xl">
            {report.accountName}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            A consultant-grade review of cost, security, modernization, and
            governance signals derived from the trailing-three billing periods.
          </p>

          <div className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-border pt-8 md:grid-cols-4">
            <KpiStat label="Account health" value={report.scores.health} />
            <KpiStat
              label="Avg. monthly spend"
              value={currency(report.summaryMetrics.averageSpend)}
            />
            <KpiStat
              label="Annual savings opportunity"
              value={currency(report.summaryMetrics.annualSavings, 0)}
              tone="success"
            />
            <KpiStat
              label="Critical findings"
              value={String(report.summaryMetrics.criticalCount)}
              tone={report.summaryMetrics.criticalCount > 0 ? "critical" : "default"}
            />
          </div>

          <div className="mt-10 flex items-center justify-around border-t border-border pt-10">
            <ScoreRing
              value={report.scores.costEfficiency}
              label="Cost efficiency"
              sublabel="weighted 40%"
              tone="primary"
              size={150}
            />
            <ScoreRing
              value={report.scores.securityGrade}
              label="Security grade"
              sublabel="weighted 25%"
              tone="success"
              size={150}
            />
          </div>
        </section>

        {/* Executive summary */}
        <section className="rounded-3xl border border-border bg-card p-10 shadow-soft print-break-inside-avoid">
          <h2 className="font-display text-3xl tracking-tight text-foreground">
            Executive summary
          </h2>
          <ol className="mt-6 space-y-4">
            {report.executiveBullets.map((b, i) => (
              <li
                key={i}
                className="flex gap-4 border-b border-border pb-4 text-base leading-relaxed text-foreground last:border-0 last:pb-0"
              >
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Findings (printable) */}
        <section className="print-break-before">
          <div className="mb-6">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Section II
            </div>
            <h2 className="mt-1 font-display text-3xl tracking-tight text-foreground">
              Findings & recommendations
            </h2>
          </div>

          <div className="space-y-4">
            {sorted.map((f, idx) => (
              <article
                key={f.id}
                className="rounded-2xl border border-border bg-card p-7 shadow-soft print-break-inside-avoid"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <SeverityBadge severity={f.severity} />
                    <CategoryChip category={f.category} />
                  </div>
                  {f.monthlySavings ? (
                    <div className="text-right">
                      <div className="text-lg font-semibold tabular-nums text-success">
                        {currency(f.monthlySavings, 0)}/mo
                      </div>
                      {f.annualSavings ? (
                        <div className="text-[11px] text-muted-foreground">
                          {currency(f.annualSavings, 0)} annualized
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <h3 className="mt-3 text-lg font-semibold leading-snug text-foreground">
                  {f.title}
                </h3>
                <ol className="mt-4 space-y-2">
                  {f.points.map((p, i) => (
                    <li key={i} className="flex gap-3 text-sm leading-relaxed text-foreground">
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-5 rounded-xl border border-primary/15 bg-primary-soft/40 p-4 text-sm leading-relaxed text-foreground">
                  <span className="font-semibold text-primary">Next action — </span>
                  {f.nextAction}
                </div>
              </article>
            ))}
          </div>
        </section>

        <footer className="border-t border-border pt-6 text-center text-xs text-muted-foreground">
          Prepared from billing evidence. Conclusions about exposed resources,
          IAM posture, or network openness require direct telemetry to confirm.
        </footer>
      </main>
    </div>
  );
}
