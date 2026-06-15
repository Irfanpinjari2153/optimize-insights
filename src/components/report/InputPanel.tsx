import { useEffect, useState } from "react";
import { Upload, Loader2, Sparkles, Plus, Trash2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { parseBillSummary } from "@/lib/parse-bill.functions";
import type { AssessmentReport } from "@/lib/assessment-types";
import {
  MAX_BILLS,
  MIN_BILLS,
  MIN_SUMMARY_CHARS,
  combineBillSummaries,
  getBillTextIssue,
  normalizeBillText,
} from "@/lib/bill-input";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import { toast } from "sonner";

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
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const parse = useServerFn(parseBillSummary);

  const readyBills = bills.filter((b) => b.text.trim().length >= MIN_SUMMARY_CHARS);
  const filledCount = readyBills.length;
  const combined = combineBillSummaries(readyBills);

  useEffect(() => {
    if (retryAfterSeconds <= 0) return;

    const timer = window.setTimeout(() => {
      setRetryAfterSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [retryAfterSeconds]);

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
    let normalized: string;
    try {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const pdfText = await extractTextFromPdf(file);
        normalized = normalizeBillText(pdfText);
      } else {
        const content = await file.text();
        normalized = normalizeBillText(content);
      }
    } catch (e) {
      toast.error("Could not read file. Please try a text export or paste the content manually.");
      return;
    }

    const issue = getBillTextIssue(normalized);
    if (issue) {
      toast.error(issue);
      return;
    }
    updateBill(id, { text: normalized, label: file.name.replace(/\.[^.]+$/, "") });
    toast.success(`Loaded ${file.name}`);
  }

  async function analyze() {
    if (filledCount < MIN_BILLS) {
      toast.error(
        `Please provide at least ${MIN_BILLS} bill summaries (each with ${MIN_SUMMARY_CHARS}+ characters). You have ${filledCount}.`,
      );
      return;
    }
    if (bills.length > MAX_BILLS) {
      toast.error(`Maximum ${MAX_BILLS} bill summaries allowed.`);
      return;
    }

    const invalidBill = bills.find((bill) => bill.text.trim() && getBillTextIssue(bill.text));
    if (invalidBill) {
      toast.error(getBillTextIssue(invalidBill.text) || "One billing period contains unreadable input.");
      return;
    }


    setLoading(true);
    try {
      const result = await parse({
        data: { billText: combined, accountName: accountName || undefined },
      });

      if (!result || typeof result !== "object") {
        toast.error("Analysis timed out. I reduced the AI payload size; please try again.");
        return;
      }

      if (!result.ok) {
        if (result.code === "rate_limited") {
          setRetryAfterSeconds(result.retryAfterSeconds ?? 60);
        }
        toast.error(result.message);
        return;
      }

      setRetryAfterSeconds(0);
      onAnalyzed(result.report);
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
          <Button onClick={analyze} disabled={loading || retryAfterSeconds > 0} className="gap-2">
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {retryAfterSeconds > 0 ? `Retry in ${retryAfterSeconds}s` : "Analyze"}
          </Button>
        </div>
      </div>

      {retryAfterSeconds > 0 ? (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-foreground">
          Free-model quota is temporarily exhausted. Please wait {retryAfterSeconds}s, then try again.
        </div>
      ) : null}

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
                    accept=".txt,.csv,.json,.md,.log,.pdf"
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
                onChange={(e) => updateBill(b.id, { text: normalizeBillText(e.target.value) })}
                placeholder={`Paste bill summary for period ${i + 1}…\n\nExample:\nSep 2025 — total $384.68\n  Elastic Compute Cloud ........ $215.40\n  Simple Storage Service ....... $38.92`}
                rows={5}
                className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground outline-none ring-ring/40 placeholder:text-muted-foreground focus:ring-2"
              />
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>Use a concise bill summary for this period.</span>
                <span>{b.text.length.toLocaleString()} chars</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {bills.length} of {MAX_BILLS} periods · {combined.length.toLocaleString()} combined chars
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
