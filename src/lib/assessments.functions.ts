import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AssessmentReport } from "./assessment-types";

const SaveInput = z.object({
  id: z.string().uuid().optional(),
  accountName: z.string().min(1).max(200),
  report: z.unknown(),
});

export const saveAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.id) {
      const { data: row, error } = await supabase
        .from("assessments")
        .update({
          account_name: data.accountName,
          report: data.report as never,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id)
        .eq("user_id", userId)
        .select("id, account_name, created_at, updated_at")
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await supabase
      .from("assessments")
      .insert({
        user_id: userId,
        account_name: data.accountName,
        report: data.report as never,
      })
      .select("id, account_name, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listAssessments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("assessments")
      .select("id, account_name, created_at, updated_at, report")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data || []).map((r) => {
      const rep = r.report as unknown as AssessmentReport;
      return {
        id: r.id,
        accountName: r.account_name,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        averageSpend: rep?.summaryMetrics?.averageSpend ?? 0,
        annualSavings: rep?.summaryMetrics?.annualSavings ?? 0,
        criticalCount: rep?.summaryMetrics?.criticalCount ?? 0,
        health: rep?.scores?.health ?? "Fair",
      };
    });
  });

export const getAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("assessments")
      .select("id, account_name, report, created_at, updated_at")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return {
      id: row.id,
      accountName: row.account_name,
      report: row.report as unknown as AssessmentReport,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

export const deleteAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("assessments")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
