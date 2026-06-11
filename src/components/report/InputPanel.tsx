import { useState } from "react";
import { Upload, Loader2, Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { parseBillSummary } from "@/lib/parse-bill.functions";
import type { AssessmentReport } from "@/lib/assessment-types";
import { toast } from "sonner";

export function InputPanel({
  onAnalyzed,
}: {
  onAnalyzed: (report: AssessmentReport) => void;
}) {
  const [text, setText] = useState("");
  const [accountName, setAccountName] = useState("");
  const [loading, setLoading] = useState(false);
  const parse = useServerFn(parseBillSummary);

  async function handleFile(file: File) {
    const content = await file.text();
    setText(content);
    toast.success(`Loaded ${file.name}`);
  }

  async function analyze() {
    if (text.trim().length < 20) {
      toast.error("Paste at least a few lines of billing summary text.");
      return;
    }
    setLoading(true);
    try {
      const report = await parse({
        data: { billText: text, accountName: accountName || undefined },
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
          <h3 className="text-base font-semibold text-foreground">Analyze a bill summary</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste raw AWS bill text or upload a text export. We parse it into a
            consultant-grade assessment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted">
            <Upload className="size-4" />
            Upload file
            <input
              type="file"
              accept=".txt,.csv,.json,.md,.log"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>
          <Button onClick={analyze} disabled={loading} className="gap-2">
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Analyze Bill Summary
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <input
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder="Account name (optional, e.g. Acme Production)"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-ring/40 placeholder:text-muted-foreground focus:ring-2"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Paste billing summary, for example:

Sep 2025 — total $384.68
  Elastic Compute Cloud ........ $215.40
  Simple Storage Service ....... $38.92
  Data Transfer ................ $36.10
  CloudWatch ................... $20.55
  ...`}
          rows={8}
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[12px] leading-relaxed text-foreground outline-none ring-ring/40 placeholder:text-muted-foreground focus:ring-2"
        />
      </div>
    </div>
  );
}
