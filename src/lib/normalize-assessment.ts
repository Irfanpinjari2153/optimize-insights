import type {
  AssessmentReport,
  Category,
  Finding,
  Severity,
} from "./assessment-types";

// Severity weight used for scoring
const SEVERITY_WEIGHT: Record<Severity, number> = {
  info: 1,
  medium: 3,
  high: 6,
  critical: 10,
};

// Confidence multiplier applied to AI-reported savings to stay conservative
const CONFIDENCE_MULTIPLIER = {
  low: 0.5,
  medium: 0.8,
  high: 1.0,
} as const;

// Scoring weights stated in the UI
export const CATEGORY_WEIGHTS = {
  cost: 0.4,
  security: 0.25,
  governance: 0.2,
  modernization: 0.15,
} as const;

/**
 * Recompute summary metrics and scores from the per-finding data so the report
 * is internally consistent regardless of what the LLM returned.
 */
export function normalizeReport(input: AssessmentReport): AssessmentReport {
  const findings: Finding[] = (input.findings || []).map((f) => {
    const mult = CONFIDENCE_MULTIPLIER[f.confidence] ?? 0.8;
    const monthly =
      typeof f.monthlySavings === "number" && f.monthlySavings > 0
        ? Math.round(f.monthlySavings * mult)
        : f.monthlySavings;
    const annual =
      typeof monthly === "number" && monthly > 0
        ? Math.round(monthly * 12)
        : f.annualSavings;
    return { ...f, monthlySavings: monthly, annualSavings: annual };
  });

  const averageSpend =
    input.billingPeriods && input.billingPeriods.length
      ? input.billingPeriods.reduce((s, p) => s + (p.amount || 0), 0) /
        input.billingPeriods.length
      : input.summaryMetrics?.averageSpend || 0;

  const monthlySavings = findings.reduce(
    (s, f) => s + (f.monthlySavings || 0),
    0,
  );
  const annualSavings = Math.round(monthlySavings * 12);
  const savingsPercent =
    averageSpend > 0 ? (monthlySavings / averageSpend) * 100 : 0;
  const criticalCount = findings.filter((f) => f.severity === "critical").length;

  // Per-category severity load (0-100 where 100 = saturated with criticals)
  const categoryPenalty: Record<Category, number> = {
    cost: 0,
    security: 0,
    modernization: 0,
    governance: 0,
  };
  for (const f of findings) {
    categoryPenalty[f.category] += SEVERITY_WEIGHT[f.severity];
  }
  const cap = 30; // saturate at ~3 critical findings per category
  const scoreFor = (cat: Category) =>
    Math.max(0, Math.round(100 - (Math.min(categoryPenalty[cat], cap) / cap) * 100));

  const costEfficiency = scoreFor("cost");
  const securityGrade = scoreFor("security");
  const governanceScore = scoreFor("governance");
  const modernizationScore = scoreFor("modernization");

  const composite =
    costEfficiency * CATEGORY_WEIGHTS.cost +
    securityGrade * CATEGORY_WEIGHTS.security +
    governanceScore * CATEGORY_WEIGHTS.governance +
    modernizationScore * CATEGORY_WEIGHTS.modernization;

  let health: AssessmentReport["scores"]["health"];
  if (criticalCount >= 2 || composite < 55) health = "At Risk";
  else if (composite < 70) health = "Fair";
  else if (composite < 85) health = "Good";
  else health = "Excellent";

  return {
    ...input,
    findings,
    scores: {
      health,
      costEfficiency,
      securityGrade,
    },
    summaryMetrics: {
      averageSpend: Math.round(averageSpend),
      monthlySavings: Math.round(monthlySavings),
      annualSavings,
      savingsPercent: Math.round(savingsPercent * 10) / 10,
      criticalCount,
    },
  };
}
