import type { AssessmentReport } from "./assessment-types";

export const mockReport: AssessmentReport = {
  accountName: "Acme Cloud Environment",
  generatedAt: new Date().toISOString(),
  billingPeriods: [
    {
      label: "Nov 2025",
      dateRange: "Nov 01, 2025 — Nov 30, 2025",
      amount: 412.91,
      invoiceFile: "Bills_Billing_and_Cost_Management_Global_nov.pdf",
    },
    {
      label: "Oct 2025",
      dateRange: "Oct 01, 2025 — Oct 31, 2025",
      amount: 356.42,
      invoiceFile: "Bills_Billing_and_Cost_Management_Global_oct.pdf",
    },
    {
      label: "Sep 2025",
      dateRange: "Sep 01, 2025 — Sep 30, 2025",
      amount: 384.68,
      invoiceFile: "Bills_Billing_and_Cost_Management_Global_sept.pdf",
    },
  ],
  scores: {
    health: "Good",
    costEfficiency: 71,
    securityGrade: 64,
  },
  summaryMetrics: {
    averageSpend: 384.67,
    monthlySavings: 188.25,
    annualSavings: 2259.0,
    savingsPercent: 48.9,
    criticalCount: 1,
  },
  executiveBullets: [
    "Elastic Compute Cloud accounts for 56% of monthly spend, indicating a single-service concentration risk that warrants modernization review.",
    "No Compute Savings Plan or Reserved Instance commitments are evidenced in the billing summary; conservative coverage could yield ~20% compute savings.",
    "Security tooling spend (GuardDuty, Security Hub, Config) is below industry baseline for the workload size — security posture cannot be confirmed from billing evidence alone.",
    "Monthly spend volatility is moderate (±13%), consistent with non-steady-state workloads or untagged environment sprawl.",
  ],
  serviceBreakdown: [
    { service: "EC2", amount: 230.85 },
    { service: "S3", amount: 41.20 },
    { service: "Data Transfer", amount: 38.74 },
    { service: "RDS", amount: 32.10 },
    { service: "CloudWatch", amount: 22.80 },
    { service: "Other", amount: 47.22 },
  ],
  findings: [
    {
      id: "f-1",
      title: "Review EC2 x86 workloads for Graviton migration eligibility",
      category: "modernization",
      severity: "medium",
      monthlySavings: 46.17,
      annualSavings: 554.04,
      confidence: "medium",
      evidenceType: "inference",
      points: [
        "Elastic Compute Cloud incurred USD 230.85 in the most recent billing period.",
        "No Graviton (Arm) instance line items appear in the summary, indicating workloads likely run on x86 instance families.",
        "Industry benchmarks show 20–40% price-performance gain on Graviton for compatible workloads (web tier, JVM, Python, Go).",
        "Applying a conservative 20% modernization assumption on billed EC2 spend yields USD 46.17 monthly savings.",
      ],
      assumptions: [
        "Workload compatibility with Arm64 must be validated per service before migration.",
      ],
      nextAction:
        "Inventory EC2 instance families and shortlist stateless x86 workloads compatible with Graviton (t4g, m7g, c7g).",
    },
    {
      id: "f-2",
      title: "Compute Savings Plan eligibility on baseline EC2 spend",
      category: "cost",
      severity: "high",
      monthlySavings: 69.26,
      annualSavings: 831.10,
      confidence: "high",
      evidenceType: "inference",
      points: [
        "On-demand EC2 spend of USD 230.85/mo is steady across the trailing three periods (σ ≈ 8%).",
        "No Savings Plan or Reserved Instance discount lines are present in the bill, indicating zero commitment coverage.",
        "A 1-year, no-upfront Compute Savings Plan typically yields ~30% on the committed baseline.",
        "Committing to ~70% of observed baseline (USD 162/mo) produces USD 69.26 in monthly savings.",
      ],
      nextAction:
        "Purchase a 1-year no-upfront Compute Savings Plan sized to the rolling 30-day p70 of EC2 + Fargate + Lambda spend.",
    },
    {
      id: "f-3",
      title: "RDS Reserved Instance opportunity for steady-state database",
      category: "cost",
      severity: "medium",
      monthlySavings: 12.84,
      annualSavings: 154.08,
      confidence: "medium",
      evidenceType: "inference",
      points: [
        "RDS spend is flat at USD 32.10/mo across three periods — consistent with a steady-state database.",
        "No RI discount lines are observed in the billing summary.",
        "A 1-year no-upfront RI provides ~40% off equivalent on-demand instance pricing.",
        "Applying 40% to RDS spend yields USD 12.84/mo in conservative savings.",
      ],
      nextAction:
        "Confirm DB instance class and engine, then purchase a matching 1-year no-upfront RI.",
    },
    {
      id: "f-4",
      title: "Data transfer cost concentration suggests egress hotspot",
      category: "cost",
      severity: "medium",
      monthlySavings: 11.62,
      annualSavings: 139.44,
      confidence: "low",
      evidenceType: "inference",
      points: [
        "Data Transfer charges of USD 38.74 represent 9.4% of monthly spend — above the 4–6% benchmark for similarly sized accounts.",
        "Billing summary does not expose source/destination pairs; root cause requires Cost & Usage Report (CUR) analysis.",
        "CloudFront in front of egress-heavy endpoints typically reduces outbound DTO by 30–60%.",
        "A 30% reduction on observed egress yields USD 11.62 monthly savings.",
      ],
      assumptions: [
        "Application architecture is compatible with edge caching for public endpoints.",
      ],
      nextAction:
        "Enable Cost & Usage Reports, identify top egress paths, and front public endpoints with CloudFront.",
    },
    {
      id: "f-5",
      title: "Logging and monitoring concentration in CloudWatch",
      category: "cost",
      severity: "info",
      monthlySavings: 6.84,
      annualSavings: 82.08,
      confidence: "medium",
      evidenceType: "inference",
      points: [
        "CloudWatch spend of USD 22.80 represents 5.5% of bill — within band but trending up from prior periods.",
        "Common drivers: verbose application logs, high-cardinality custom metrics, retained log groups without lifecycle.",
        "Applying log-group retention policies and dropping DEBUG-level ingestion can reduce ingest cost by ~30%.",
      ],
      nextAction:
        "Audit log groups, set retention to 30 days where appropriate, and filter DEBUG ingestion at the agent.",
    },
    {
      id: "f-6",
      title: "Security services coverage cannot be confirmed from billing",
      category: "security",
      severity: "high",
      confidence: "medium",
      evidenceType: "inference",
      points: [
        "GuardDuty, Security Hub, AWS Config, and Inspector charges are either absent or below USD 5/mo combined.",
        "For workloads of this size, baseline security tooling typically contributes USD 15–40/mo.",
        "Low spend implies one of: services disabled, partial-account enablement, or a sibling payer account not visible here.",
        "Billing alone cannot confirm exposure of resources, IAM posture, or network openness — direct telemetry is required.",
      ],
      assumptions: [
        "This bill represents the full account scope and is not a member of a consolidated billing family.",
      ],
      nextAction:
        "Enable GuardDuty, Security Hub, and Config org-wide; review findings within 14 days of activation.",
    },
    {
      id: "f-7",
      title: "Single-service concentration risk on Elastic Compute Cloud",
      category: "governance",
      severity: "medium",
      confidence: "high",
      evidenceType: "direct",
      points: [
        "EC2 is 56% of monthly spend — above the 40% threshold for healthy service diversification.",
        "Concentration amplifies blast radius of pricing changes, instance shortages, or regional incidents.",
        "Modernization to managed services (Fargate, Lambda, App Runner) reduces operational risk and ties spend to usage.",
      ],
      nextAction:
        "Classify EC2 workloads by statefulness and shortlist candidates for Fargate / Lambda migration.",
    },
    {
      id: "f-8",
      title: "Monthly spend volatility consistent with untagged environment sprawl",
      category: "governance",
      severity: "info",
      confidence: "medium",
      evidenceType: "inference",
      points: [
        "Trailing three-month spend: USD 384.68 → 356.42 → 412.91 — a swing of ±13% with no clear seasonal pattern.",
        "Volatility at this scale typically indicates ad-hoc workloads, untagged environments, or developer sandboxes left running.",
        "Allocation visibility requires consistent cost-allocation tags (Environment, Owner, Project).",
      ],
      nextAction:
        "Enforce a mandatory tag policy (Environment, Owner, Project) and enable cost allocation tags in Billing.",
    },
    {
      id: "f-9",
      title: "Potential idle EBS or unattached storage pattern",
      category: "cost",
      severity: "info",
      monthlySavings: 4.10,
      annualSavings: 49.20,
      confidence: "low",
      evidenceType: "assumption",
      points: [
        "S3 + EBS combined charges total USD 41.20 with no growth signal across the trailing period.",
        "Static storage spend at this scale commonly contains 10–20% unused volumes, orphaned snapshots, or low-access objects.",
        "Billing summary does not expose volume/snapshot detail — confirmation requires Trusted Advisor or a CUR query.",
      ],
      assumptions: [
        "Account does not already run a storage lifecycle policy or snapshot cleanup automation.",
      ],
      nextAction:
        "Run Trusted Advisor 'Underutilized EBS' and 'Idle Snapshots' checks; apply S3 lifecycle rules.",
    },
    {
      id: "f-10",
      title: "Backup and disaster-recovery spend appears under-invested",
      category: "security",
      severity: "critical",
      confidence: "medium",
      evidenceType: "inference",
      points: [
        "No AWS Backup, Snapshot, or cross-region replication charges appear in the summary.",
        "RDS spend is present but the corresponding automated backup storage line is absent or zero — indicating either default retention or backups disabled.",
        "Without confirmed cross-region or cross-account backups, the account does not meet a baseline DR posture for production workloads.",
      ],
      assumptions: [
        "This account hosts production data; for non-production accounts this finding can be downgraded.",
      ],
      nextAction:
        "Define an AWS Backup policy with daily snapshots, 35-day retention, and cross-region copy for production resources.",
    },
  ],
};
