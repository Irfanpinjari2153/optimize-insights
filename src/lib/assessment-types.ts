export type Severity = "info" | "medium" | "high" | "critical";
export type Category = "cost" | "security" | "modernization" | "governance";
export type EvidenceType = "direct" | "inference" | "assumption";
export type Confidence = "low" | "medium" | "high";

export interface BillingPeriod {
  label: string;
  dateRange: string;
  amount: number;
  invoiceFile: string;
}

export interface AssessmentScores {
  health: "Excellent" | "Good" | "Fair" | "At Risk";
  costEfficiency: number;
  securityGrade: number;
}

export interface SummaryMetrics {
  averageSpend: number;
  monthlySavings: number;
  annualSavings: number;
  savingsPercent: number;
  criticalCount: number;
}

export interface Finding {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  monthlySavings?: number;
  annualSavings?: number;
  confidence: Confidence;
  evidenceType: EvidenceType;
  points: string[];
  assumptions?: string[];
  nextAction: string;
}

export interface AssessmentReport {
  accountName: string;
  generatedAt: string;
  billingPeriods: BillingPeriod[];
  scores: AssessmentScores;
  summaryMetrics: SummaryMetrics;
  executiveBullets: string[];
  findings: Finding[];
  serviceBreakdown: { service: string; amount: number }[];
}
