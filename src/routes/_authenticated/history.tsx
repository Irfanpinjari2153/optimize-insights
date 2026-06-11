import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CloudCog, Trash2, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listAssessments, deleteAssessment } from "@/lib/assessments.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [{ title: "Assessment history — Cloud Assessment Report" }],
  }),
  component: HistoryPage,
});

function currency(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function HistoryPage() {
  const navigate = useNavigate();
  const list = useServerFn(listAssessments);
  const del = useServerFn(deleteAssessment);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["assessments"],
    queryFn: () => list(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Assessment deleted");
      qc.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                <ArrowLeft className="size-4" />
                Back
              </Button>
            </Link>
            <div className="hidden h-6 w-px bg-border md:block" />
            <div className="hidden items-center gap-2 md:flex">
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <CloudCog className="size-4" />
              </div>
              <div className="text-sm font-semibold text-foreground">
                Saved assessments
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8">
          <h1 className="font-display text-4xl tracking-tight text-foreground">
            Assessment history
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every saved cloud assessment for your workspace.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
          </div>
        ) : !data || data.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
            <FileText className="mx-auto size-8 text-muted-foreground" />
            <h3 className="mt-3 font-display text-xl text-foreground">
              No saved assessments yet
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Generate one from the dashboard, then save it here.
            </p>
            <Link to="/" className="mt-5 inline-block">
              <Button>Go to dashboard</Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-3">
            {data.map((a) => (
              <Link
                key={a.id}
                to="/"
                search={{ assessment: a.id }}
                className="group flex items-center justify-between rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40 hover:shadow-soft"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg text-foreground">
                      {a.accountName}
                    </span>
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {a.health}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Saved {new Date(a.createdAt).toLocaleDateString()} ·{" "}
                    {currency(a.averageSpend)} avg spend ·{" "}
                    <span className="text-success">
                      {currency(a.annualSavings)} annual opportunity
                    </span>
                    {a.criticalCount > 0 ? (
                      <span className="ml-1 text-critical">
                        · {a.criticalCount} critical
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (confirm(`Delete "${a.accountName}"?`)) remove.mutate(a.id);
                  }}
                  className="rounded-lg p-2 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-critical"
                  aria-label="Delete"
                >
                  <Trash2 className="size-4" />
                </button>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
