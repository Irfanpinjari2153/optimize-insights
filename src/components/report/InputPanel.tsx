import { useState } from "react";
import { Upload, Loader2, Sparkles, Plus, Trash2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { parseBillSummary } from "@/lib/parse-bill.functions";
import type { AssessmentReport } from "@/lib/assessment-types";
import { toast } from "sonner";

const MIN_BILLS = 3;
const MAX_BILLS = 6;

type Bill = { id: string; label: string; text: string };

function newBill(i: number): Bill {
  return { id: `bill-${Date.now()}-${i}`, label: `Billing period ${i + 1}`, text: "" };
}

export function InputPanel({
  onAnalyzed,
}: {
  onAnalyzed: (report: AssessmentReport) => void;
}) {
  const [bills, setBills] = useState<Bill[]>(() =>
    Array.from({ length: MIN_BILLS }, (_, i) => newBill(i)),
  );
  const [accountName, setAccountName] = useState("");
  const [loading, setLoading] = useState(false);
  const parse = useServerFn(parseBillSummary);

  const filledCount = bills.filter((b) => b.text.trim().length >= 20).length;

  function updateBill(id: string, patch: Partial<Bill>) {
    setBills((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function addBill() {
    if (bills.length >= MAX_BILLS) {
      toast.error(`You can add at most ${MAX_BILLS} bill summaries.`);
      return;
    }
    setBills((prev) => [...prev, newBill(prev.length)]);
  }

  function removeBill(id: string) {
    if (bills.length <= MIN_BILLS) {
      toast.error(`You must keep at least ${MIN_BILLS} bill summaries.`);
      return;
    }
    setBills((prev) => prev.filter((b) => b.id !== id));
  }

  async function handleFile(id: string, file: File) {
    const content = await file.text();
    updateBill(id, { text: content, label: file.name.replace(/\.[^.]+$/, "") });
    toast.success(`Loaded ${file.name}`);
  }

  async function analyze() {
    if (filledCount < MIN_BILLS) {
      toast.error(
        `Please provide at least ${MIN_BILLS} bill summaries (each with 20+ characters). You have ${filledCount}.`,
      );
      return;
    }
    if (bills.length > MAX_BILLS) {
      toast.error(`Maximum ${MAX_BILLS} bill summaries allowed.`);
      return;
    }

    const combined = bills
      .filter((b) => b.text.trim().length >= 20)
      .map(
        (b, i) =>
          `===== ${b.label || `Billing period ${i + 1}`} =====\n${b.text.trim()}`,
      )
      .join("\n\n");

    setLoading(true);
    try {
      const report = await parse({
        data: { billText: combined, accountName: accountName || undefined },
      });
      onAnalyzed(report);
      toast.success("Assessment generated");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to analyze bill";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">Analyze bill summaries</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Provide between <strong className="text-foreground">{MIN_BILLS}</strong> and{" "}
            <strong className="text-foreground">{MAX_BILLS}</strong> billing periods.
            Trend analysis requires at least {MIN_BILLS} months of data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={
              "rounded-full border px-2.5 py-1 text-xs font-medium " +
              (filledCount >= MIN_BILLS
                ? "border-success/30 bg-success-soft text-success"
                : "border-border bg-muted text-muted-foreground")
            }
          >
            {filledCount} / {MAX_BILLS} ready
          </span>
          <Button onClick={analyze} disabled={loading} className="gap-2">
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Analyze
          </Button>
        </div>
      </div>

      <div className="mt-4">
        <input
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder="Account name (optional, e.g. Acme Production)"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-ring/40 placeholder:text-muted-foreground focus:ring-2"
        />
      </div>

      <div className="mt-4 space-y-3">
        {bills.map((b, i) => {
          const filled = b.text.trim().length >= 20;
          return (
            <div
              key={b.id}
              className="rounded-xl border border-border bg-background/60 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex size-6 items-center justify-center rounded-md bg-primary-soft text-[11px] font-semibold text-primary">
                  {i + 1}
                </span>
                <input
                  value={b.label}
                  onChange={(e) => updateBill(b.id, { label: e.target.value })}
                  placeholder={`Billing period ${i + 1}`}
                  className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-foreground outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring/40"
                />
                {filled ? (
                  <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                    Ready
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Empty
                  </span>
                )}
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition hover:bg-muted">
                  <Upload className="size-3.5" />
                  Upload
                  <input
                    type="file"
                    accept=".txt,.csv,.json,.md,.log"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(b.id, f);
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeBill(b.id)}
                  disabled={bills.length <= MIN_BILLS}
                  className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    bills.length <= MIN_BILLS
                      ? `Minimum ${MIN_BILLS} required`
                      : "Remove"
                  }
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <textarea
                value={b.text}
                onChange={(e) => updateBill(b.id, { text: e.target.value })}
                placeholder={`Paste bill summary for period ${i + 1}…\n\nExample:\nSep 2025 — total $384.68\n  Elastic Compute Cloud ........ $215.40\n  Simple Storage Service ....... $38.92`}
                rows={5}
                className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground outline-none ring-ring/40 placeholder:text-muted-foreground focus:ring-2"
              />
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {bills.length} of {MAX_BILLS} periods · minimum {MIN_BILLS} required
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addBill}
          disabled={bills.length >= MAX_BILLS}
          className="gap-2"
        >
          <Plus className="size-4" />
          Add billing period
        </Button>
      </div>
    </div>
  );
}
