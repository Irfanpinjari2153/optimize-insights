import { useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { CloudCog, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [{ title: "Sign in — Cloud Assessment Report" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || password.length < 6) {
      toast.error("Enter a valid email and a password of 6+ characters.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const redirectTo = `${window.location.origin}/history`;
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) throw error;
        toast.success("Account created. You're signed in.");
        navigate({ to: "/history" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        toast.success("Welcome back");
        navigate({ to: "/history" });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-elevated">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <CloudCog className="size-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              Cloud Assessment Report
            </div>
            <div className="text-[11px] text-muted-foreground">
              Consultant workspace
            </div>
          </div>
        </div>
        <h1 className="mt-6 font-display text-3xl tracking-tight text-foreground">
          {mode === "signin" ? "Sign in" : "Create your workspace"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "signin"
            ? "Access your saved assessments and history."
            : "Save assessments and revisit them later."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none ring-ring/40 focus:ring-2"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (6+ characters)"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none ring-ring/40 focus:ring-2"
          />
          <Button type="submit" disabled={loading} className="w-full gap-2">
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="font-medium text-primary hover:underline"
          >
            {mode === "signin"
              ? "Need an account? Sign up"
              : "Have an account? Sign in"}
          </button>
          <Link to="/" className="hover:text-foreground">
            ← Back to app
          </Link>
        </div>
      </div>
    </div>
  );
}
