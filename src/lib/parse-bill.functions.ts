import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AssessmentReport, Finding } from "./assessment-types";
import { MIN_SUMMARY_CHARS, SERVER_BILL_TEXT_LIMIT } from "./bill-input";
import { normalizeReport } from "./normalize-assessment";

type AiChatPayload = {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{
        function?: { arguments?: unknown };
      }>;
    };
  }>;
};

const MAX_AI_CONTEXT_CHARS = 14_000;
const AI_PROVIDER_TIMEOUT_MS = 12_000;

type LocalServiceSpend = {
  service: string;
  amount: number;
  evidence: string[];
};

type LocalBillSection = {
  label: string;
  dateRange: string;
  amount: number;
  content: string;
  services: LocalServiceSpend[];
};

const SERVICE_PATTERNS: Array<{ service: string; pattern: RegExp }> = [
  { service: "Elastic Compute Cloud", pattern: /\b(EC2|Elastic Compute|Compute Cloud|Compute Engine|Virtual Machines)\b/i },
  { service: "Simple Storage Service", pattern: /\b(S3|Simple Storage|Object Storage|Cloud Storage|Blob Storage)\b/i },
  { service: "Elastic Block Store", pattern: /\b(EBS|Elastic Block|Persistent Disk|Managed Disks)\b/i },
  { service: "Relational Database Service", pattern: /\b(RDS|Relational Database|Cloud SQL|Azure SQL|Database)\b/i },
  { service: "Lambda", pattern: /\b(Lambda|Functions|Cloud Functions)\b/i },
  { service: "NAT Gateway", pattern: /\b(NAT Gateway|NAT)\b/i },
  { service: "Data Transfer", pattern: /\b(Data Transfer|Bandwidth|Inter-AZ|Egress)\b/i },
  { service: "CloudFront", pattern: /\b(CloudFront|CDN)\b/i },
  { service: "Route 53", pattern: /\b(Route 53|DNS)\b/i },
  { service: "KMS", pattern: /\b(KMS|Key Management|Key Vault)\b/i },
  { service: "CloudTrail", pattern: /\b(CloudTrail|Audit Logs|Activity Log)\b/i },
  { service: "Config", pattern: /\b(Config|Policy|Asset Inventory)\b/i },
  { service: "GuardDuty", pattern: /\b(GuardDuty|Defender|Threat Detection)\b/i },
  { service: "Security Hub", pattern: /\b(Security Hub|Security Command Center)\b/i },
  { service: "Support", pattern: /\b(Support|Business Support|Enterprise Support)\b/i },
];

function formatUsd(amount: number) {
  return `$${Math.round(amount).toLocaleString()}`;
}

function getLineAmounts(line: string) {
  const amounts: number[] = [];
  const currencyMatches = line.matchAll(/\$\s*([0-9][\d,]*(?:\.\d{1,2})?)/g);
  for (const match of currencyMatches) amounts.push(Number(match[1].replace(/,/g, "")));

  const usdMatches = line.matchAll(/\bUSD\s*([0-9][\d,]*(?:\.\d{1,2})?)/gi);
  for (const match of usdMatches) amounts.push(Number(match[1].replace(/,/g, "")));

  if (!amounts.length && /total|charges|EC2|S3|Storage|Compute|Database|Transfer|Support/i.test(line)) {
    const trailing = line.match(/(?:^|\s)([0-9][\d,]*\.\d{2})\s*$/);
    if (trailing) amounts.push(Number(trailing[1].replace(/,/g, "")));
  }

  return amounts.filter((amount) => Number.isFinite(amount) && amount >= 0);
}

function detectService(line: string) {
  if (/\b(tax|credit|refund|payment|invoice total|grand total|amount due|subtotal)\b/i.test(line)) {
    return undefined;
  }
  const known = SERVICE_PATTERNS.find(({ pattern }) => pattern.test(line));
  if (known) return known.service;

  if (!getLineAmounts(line).length) return undefined;
  const inferred = line
    .replace(/\$\s*[0-9][\d,]*(?:\.\d{1,2})?/g, "")
    .replace(/\bUSD\s*[0-9][\d,]*(?:\.\d{1,2})?/gi, "")
    .replace(/[._·-]{2,}/g, " ")
    .trim()
    .slice(0, 56);
  return inferred.length >= 4 ? inferred : undefined;
}

function extractDateRange(label: string, content: string) {
  const source = `${label}\n${content.slice(0, 500)}`;
  const dateLike = source.match(
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}(?:\s*[-–—]\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4})?/i,
  );
  return dateLike?.[0] || label;
}

function extractServices(content: string) {
  const grouped = new Map<string, LocalServiceSpend>();
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    const amounts = getLineAmounts(line);
    const service = detectService(line);
    if (!service || !amounts.length) continue;
    const amount = amounts.at(-1) ?? 0;
    const existing = grouped.get(service) ?? { service, amount: 0, evidence: [] };
    existing.amount += amount;
    if (existing.evidence.length < 3) existing.evidence.push(line.slice(0, 180));
    grouped.set(service, existing);
  }
  return [...grouped.values()].sort((a, b) => b.amount - a.amount);
}

function extractSectionTotal(content: string, services: LocalServiceSpend[]) {
  const totalCandidates: number[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (/\b(grand total|invoice total|amount due|total charges|total)\b/i.test(line)) {
      totalCandidates.push(...getLineAmounts(line));
    }
  }
  if (totalCandidates.length) return totalCandidates.at(-1) ?? 0;
  const serviceTotal = services.reduce((sum, service) => sum + service.amount, 0);
  if (serviceTotal > 0) return serviceTotal;
  const allAmounts = content.split("\n").flatMap(getLineAmounts);
  return allAmounts.length ? Math.max(...allAmounts) : 0;
}

function parseLocalBillSections(text: string) {
  const markers = [...text.matchAll(/^===== (.*?) =====$/gm)];
  const sections: LocalBillSection[] = [];

  if (!markers.length) {
    const services = extractServices(text);
    sections.push({
      label: "Billing period 1",
      dateRange: extractDateRange("Billing period 1", text),
      amount: extractSectionTotal(text, services),
      content: text,
      services,
    });
    return sections;
  }

  markers.forEach((marker, index) => {
    const next = markers[index + 1];
    const content = text.slice((marker.index ?? 0) + marker[0].length, next?.index).trim();
    const label = marker[1].trim() || `Billing period ${index + 1}`;
    const services = extractServices(content);
    sections.push({
      label,
      dateRange: extractDateRange(label, content),
      amount: extractSectionTotal(content, services),
      content,
      services,
    });
  });

  return sections;
}

function aggregateServices(sections: LocalBillSection[]) {
  const grouped = new Map<string, LocalServiceSpend>();
  for (const section of sections) {
    for (const service of section.services) {
      const existing = grouped.get(service.service) ?? { service: service.service, amount: 0, evidence: [] };
      existing.amount += service.amount;
      existing.evidence.push(...service.evidence.slice(0, Math.max(0, 3 - existing.evidence.length)));
      grouped.set(service.service, existing);
    }
  }
  return [...grouped.values()].sort((a, b) => b.amount - a.amount);
}

function findService(services: LocalServiceSpend[], names: string[]) {
  return services.find((service) => names.some((name) => service.service.toLowerCase().includes(name)));
}

function buildDeterministicReport(billText: string, accountName?: string): AssessmentReport {
  const sections = parseLocalBillSections(billText).filter((section) => section.content.trim());
  const safeSections = sections.length ? sections : parseLocalBillSections("Total cloud spend $0.00");
  const latest = safeSections.at(-1) ?? safeSections[0];
  const aggregate = aggregateServices(safeSections);
  const latestServices = latest.services.length ? latest.services : aggregate;
  const topService = latestServices[0] ?? { service: "Total cloud spend", amount: latest.amount, evidence: [] };
  const averageSpend =
    safeSections.reduce((sum, section) => sum + section.amount, 0) / Math.max(1, safeSections.length);

  const compute = findService(aggregate, ["compute", "elastic compute", "virtual machines"]);
  const storage = findService(aggregate, ["storage", "block store"]);
  const network = findService(aggregate, ["nat", "transfer", "cloudfront"]);
  const securityVisible = aggregate.filter((service) =>
    ["guardduty", "security hub", "config", "cloudtrail", "kms"].some((name) =>
      service.service.toLowerCase().includes(name),
    ),
  );

  const computeBase = compute?.amount || topService.amount || averageSpend;
  const storageBase = storage?.amount || Math.max(topService.amount * 0.35, averageSpend * 0.15);
  const networkBase = network?.amount || Math.max(averageSpend * 0.08, 0);
  const computeSavings = Math.round(computeBase * 0.25);
  const storageSavings = Math.round(storageBase * 0.3);
  const networkSavings = Math.round(networkBase * 0.35);

  const trend = safeSections.length >= 2 ? latest.amount - safeSections[0].amount : 0;
  const trendDirection = trend > 0 ? "increased" : trend < 0 ? "decreased" : "remained flat";
  const visibleSecurityText = securityVisible.length
    ? securityVisible.map((service) => `${service.service} ${formatUsd(service.amount)}`).join(", ")
    : "no visible GuardDuty, Security Hub, Config, CloudTrail, or KMS line items";

  const findings: AssessmentReport["findings"] = [
    {
      id: "f-1",
      title: "Compute commitment coverage is likely underused",
      category: "cost",
      severity: computeBase > averageSpend * 0.35 ? "high" : "medium",
      monthlySavings: computeSavings,
      annualSavings: computeSavings * 12,
      confidence: compute ? "medium" : "low",
      evidenceType: compute ? "inference" : "assumption",
      points: [
        `The visible compute baseline is ${formatUsd(computeBase)}, using ${compute?.service || topService.service} as the spend evidence from the provided bill text.`,
        `A conservative 25% commitment or rightsizing target gives ${formatUsd(computeBase)} × 25% = about ${formatUsd(computeSavings)} monthly savings.`,
        "The bill proves recurring spend but does not include utilization, so CPU, memory, and reservation coverage must be validated before purchase.",
        "Start with always-on production instances and stable database nodes, then apply Savings Plans or reservations only after seven-day utilization review.",
      ],
      assumptions: compute ? ["Compute utilization and commitment coverage are not visible in billing text."] : ["The largest visible service is being used as the compute optimization proxy."],
      nextAction: "Export compute utilization and commitment coverage for the latest month, then right-size idle resources before buying one-year commitments.",
    },
    {
      id: "f-2",
      title: "Storage lifecycle tiering has measurable savings potential",
      category: "cost",
      severity: storageBase > averageSpend * 0.2 ? "high" : "medium",
      monthlySavings: storageSavings,
      annualSavings: storageSavings * 12,
      confidence: storage ? "medium" : "low",
      evidenceType: storage ? "inference" : "assumption",
      points: [
        `The storage optimization baseline is ${formatUsd(storageBase)}, taken from ${storage?.service || "estimated storage share of the latest bill"}.`,
        `A conservative 30% lifecycle target gives ${formatUsd(storageBase)} × 30% = about ${formatUsd(storageSavings)} monthly savings.`,
        "The invoice text proves storage spend but not object age, access frequency, snapshot age, or backup retention policy.",
        "Apply lifecycle rules only to cold objects, stale snapshots, and non-production backups after confirming restore requirements with application owners.",
      ],
      assumptions: ["Detailed object access patterns and snapshot ages are not included in the billing summary."],
      nextAction: "Pull S3/EBS/storage inventory with last-access and snapshot-age fields, then move confirmed cold data to lower-cost tiers.",
    },
    {
      id: "f-3",
      title: "Network transfer charges need architecture review",
      category: "cost",
      severity: networkBase > averageSpend * 0.12 ? "high" : "medium",
      monthlySavings: networkSavings,
      annualSavings: networkSavings * 12,
      confidence: network ? "medium" : "low",
      evidenceType: network ? "inference" : "assumption",
      points: [
        `The network baseline is ${formatUsd(networkBase)}, using ${network?.service || "a conservative share of monthly spend"} as the review target.`,
        `Reducing avoidable routing, NAT, or egress by 35% gives ${formatUsd(networkBase)} × 35% = about ${formatUsd(networkSavings)} monthly savings.`,
        "Billing confirms the spend pattern but not the traffic paths, so flow logs and endpoint usage must validate the actual source.",
        "Highest-priority checks are NAT Gateway processing, inter-zone transfer, public egress, and missing private endpoints for managed services.",
      ],
      assumptions: ["Traffic path details are not available in the pasted billing text."],
      nextAction: "Review VPC flow logs, NAT metrics, and endpoint coverage for the latest period, then remove avoidable cross-zone and public egress paths.",
    },
    {
      id: "f-4",
      title: "Monthly spend trend needs active forecasting",
      category: "governance",
      severity: Math.abs(trend) > averageSpend * 0.15 ? "high" : "medium",
      confidence: safeSections.length >= 3 ? "high" : "medium",
      evidenceType: "direct",
      points: [
        `The uploaded periods show spend ${trendDirection} from ${formatUsd(safeSections[0].amount)} to ${formatUsd(latest.amount)} across ${safeSections.length} billing periods.`,
        `Average monthly spend is approximately ${formatUsd(averageSpend)}, which should become the baseline for budget alerts and owner accountability.`,
        "The bill text includes period totals but does not prove whether changes came from usage growth, new services, pricing, or one-time credits.",
        "Create service-owner budgets using the top spend drivers so finance can distinguish planned growth from unmanaged cloud waste.",
      ],
      assumptions: [],
      nextAction: "Create monthly budget alerts at service-owner level using latest-period service totals and the three-month average as the baseline.",
    },
    {
      id: "f-5",
      title: "Security telemetry charges are missing from billing",
      category: "security",
      severity: securityVisible.length ? "medium" : "high",
      confidence: "medium",
      evidenceType: securityVisible.length ? "direct" : "inference",
      points: [
        `The billing evidence shows ${visibleSecurityText}, which is the available signal for cloud-native detection and audit coverage.`,
        "Missing or very small security line items do not prove tools are disabled, but they are a strong prompt to validate account-wide coverage.",
        "The operational risk is that workloads may scale spend while threat detection, configuration drift checks, and audit retention remain incomplete.",
        "Validate coverage in the security consoles by checking enabled regions, protected accounts, finding volume, and log retention configuration.",
      ],
      assumptions: securityVisible.length ? [] : ["Security services may be free-tier, centrally billed elsewhere, or omitted from the summary."],
      nextAction: "Verify GuardDuty, Security Hub, Config, CloudTrail, and KMS coverage across every production account and active region this sprint.",
    },
    {
      id: "f-6",
      title: "Encryption and audit evidence needs validation",
      category: "security",
      severity: "medium",
      confidence: "low",
      evidenceType: "assumption",
      points: [
        "The pasted billing text is financial evidence, so it cannot directly prove encryption status, public exposure, or privileged access controls.",
        `KMS or audit-related services in the bill are ${securityVisible.length ? "present but need scope validation" : "not clearly visible in the provided lines"}.`,
        "The risk is unmanaged data stores or logs growing alongside spend without the controls needed for incident investigation and compliance evidence.",
        "Validation should compare storage, database, and compute inventories against encryption defaults, key ownership, and centralized audit logging.",
      ],
      assumptions: ["Control-plane configuration is not included in the billing summary."],
      nextAction: "Run a configuration inventory for encryption, public access, and audit logging on the highest-spend storage, database, and compute services.",
    },
    {
      id: "f-7",
      title: "Modernization path can reduce compute baseline",
      category: "modernization",
      severity: "medium",
      monthlySavings: Math.round(computeBase * 0.15),
      annualSavings: Math.round(computeBase * 0.15) * 12,
      confidence: compute ? "medium" : "low",
      evidenceType: "inference",
      points: [
        `The modernization baseline is ${formatUsd(computeBase)}, tied to recurring compute or the largest recurring service shown in the bill.`,
        `A conservative 15% Graviton, autoscaling, or managed-platform improvement equals ${formatUsd(computeBase)} × 15% = about ${formatUsd(computeBase * 0.15)} monthly impact.`,
        "Billing does not reveal architecture, so migration candidates must be selected from workloads with stable demand and low platform coupling.",
        "Prioritize non-critical stateless services first, then expand to databases or stateful systems after compatibility and performance tests pass.",
      ],
      assumptions: ["Instance families, runtime architectures, and workload compatibility are not visible in billing text."],
      nextAction: "Identify the top three steady compute workloads and test right-sizing, autoscaling, or modern instance families in a non-production environment.",
    },
    {
      id: "f-8",
      title: "Cost allocation controls need stronger ownership",
      category: "governance",
      severity: "medium",
      confidence: "medium",
      evidenceType: "inference",
      points: [
        `The latest bill is concentrated around ${topService.service} at ${formatUsd(topService.amount)}, which needs a named owner and budget threshold.`,
        `Total latest-period spend is ${formatUsd(latest.amount)}, so even a 10% unmanaged variance represents about ${formatUsd(latest.amount * 0.1)} per month.`,
        "The bill text does not show tags, cost categories, business units, or environment labels, so accountability cannot be confirmed from finance data alone.",
        "Ownership controls should map every large service line to application, environment, team, and lifecycle so waste is routed to the right owner.",
      ],
      assumptions: ["Tagging and cost-category coverage are not included in the pasted summary."],
      nextAction: "Enforce required cost tags for application, owner, environment, and data classification on the services driving the latest bill.",
    },
  ];

  const billingPeriods = safeSections.map((section, index) => ({
    label: section.label,
    dateRange: section.dateRange,
    amount: Math.round(section.amount),
    invoiceFile: `period-${index + 1}`,
  }));

  const serviceBreakdownSource = latestServices.length ? latestServices : [{ service: "Total cloud spend", amount: latest.amount, evidence: [] }];
  const monthlySavings = findings.reduce((sum, finding) => sum + (finding.monthlySavings || 0), 0);

  return normalizeReport({
    accountName: accountName || "Cloud Environment",
    generatedAt: new Date().toISOString(),
    billingPeriods,
    scores: { health: "Fair", costEfficiency: 70, securityGrade: 65 },
    summaryMetrics: {
      averageSpend: Math.round(averageSpend),
      monthlySavings,
      annualSavings: monthlySavings * 12,
      savingsPercent: averageSpend > 0 ? Math.round((monthlySavings / averageSpend) * 1000) / 10 : 0,
      criticalCount: findings.filter((finding) => finding.severity === "critical").length,
    },
    executiveBullets: [
      `Estimated monthly savings are ${formatUsd(monthlySavings)}, or ${formatUsd(monthlySavings * 12)} annualized, based on conservative optimization assumptions.`,
      `Average visible monthly spend is ${formatUsd(averageSpend)}, with the latest period at ${formatUsd(latest.amount)} across the uploaded billing data.`,
      `The biggest visible spend driver is ${topService.service} at ${formatUsd(topService.amount)}, making it the first owner-level review target.`,
      `The biggest risk is incomplete proof of security telemetry, encryption, and audit coverage from the billing evidence alone.`,
      "The next 30 days should focus on commitment coverage, storage lifecycle cleanup, network path review, and mandatory cost ownership tags.",
    ],
    findings,
    serviceBreakdown: serviceBreakdownSource.slice(0, 12).map((service) => ({
      service: service.service,
      amount: Math.round(service.amount),
    })),
  });
}

function compactBillTextForAi(text: string) {
  const lines = text.split("\n");
  const important = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("=====")) return true;
    if (/\$\s?\d|\bUSD\b|total|subtotal|tax|credit/i.test(trimmed)) return true;
    if (
      /EC2|Elastic|Compute|S3|Storage|EBS|RDS|Database|Lambda|NAT|VPC|CloudFront|Route 53|KMS|GuardDuty|Security Hub|Config|CloudTrail|Support|Data Transfer|Bandwidth/i.test(
        trimmed,
      )
    ) {
      return trimmed.length <= 220;
    }
    return false;
  });

  const compacted = important.join("\n");
  const source = compacted.trim().length >= MIN_SUMMARY_CHARS ? compacted : text;
  return source.length <= MAX_AI_CONTEXT_CHARS
    ? source
    : `${source.slice(0, MAX_AI_CONTEXT_CHARS)}\n…[additional bill lines omitted to keep analysis within request time]`;
}

export type ParseBillSummaryResult =
  | {
      ok: true;
      report: AssessmentReport;
    }
  | {
      ok: false;
      code:
        | "not_configured"
        | "rate_limited"
        | "credits_exhausted"
        | "invalid_key"
        | "request_failed"
        | "invalid_response";
      message: string;
      retryAfterSeconds?: number;
    };

const ParseInput = z.object({
  billText: z
    .string()
    .min(MIN_SUMMARY_CHARS)
    .max(
      SERVER_BILL_TEXT_LIMIT,
      `Bill summaries are too large. Keep the combined input under ${SERVER_BILL_TEXT_LIMIT.toLocaleString()} characters.`,
    ),
  accountName: z.string().optional(),
});

export const parseBillSummary = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ParseInput.parse(input))
  .handler(async ({ data }): Promise<ParseBillSummaryResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey && !process.env.GEMINI_API_KEY && !process.env.NVIDIA_API_KEY) {
      return {
        ok: false,
        code: "not_configured",
        message: "AI service is not configured. Please contact support.",
      };
    }

    const systemPrompt = `You are a Principal Cloud Economist, FinOps lead, and Well-Architected reviewer (AWS / Azure / GCP). Produce a detailed, board-ready cloud assessment from cloud bill text. The user needs a real analysis, not a short summary.

OPERATING PRINCIPLES
- Evidence first. Quote exact line items, USD amounts, units (GB-mo, vCPU-hr, requests), and percentages from the bill text. If something is not in the text, mark it 'inference' or 'assumption' and say so explicitly.
- Be specific. Replace vague phrases ("optimize storage", "review security") with concrete service names, SKUs, regions, instance families, and the exact mechanism (e.g. "Move 4.2 TB of S3 Standard in us-east-1 with <1 access/mo to S3 Glacier Instant Retrieval; cost drops from $0.023 to $0.004 per GB-mo").
- Show the math. Every dollar figure must be derivable from a stated baseline × stated uplift factor. Include the baseline in the reasoning points.
- Be conservative on savings. Cap uplifts: Compute Savings Plans 25–30%, Reserved Instances 35–40%, Graviton 15–20%, S3 IA/Glacier 30–60% of the affected storage line, EBS gp2→gp3 ~20%, idle/right-size 30–50% of the over-provisioned line, NAT Gateway redesign 40–70% of NAT data-processing line, inter-AZ traffic 20–40%. NEVER claim savings larger than the underlying service spend.
- monthlySavings is a realistic USD number (not a percent). Use 0 (or omit) for non-cost findings.

OUTPUT DEPTH REQUIREMENTS
- 8 findings total, distributed across all four categories (cost, security, modernization, governance). Minimum: 3 cost, 2 security, 1 governance, 1 modernization.
- Each finding: title is a concrete claim tied to a service or spend pattern. Provide exactly 4 reasoning points, each a full sentence with evidence, calculation, risk, comparison, or implementation logic. Do not use generic reasoning.
- For cost findings, at least 2 reasoning points must include numeric math from the bill text, such as baseline spend, affected portion, conservative percentage, monthly savings, or annualized impact.
- For security/governance/modernization findings, explain what the bill proves directly, what is inferred from missing/visible line items, the operational risk, and how to validate it in cloud consoles/telemetry.
- assumptions[] lists unverified premises when evidenceType is inference/assumption. If evidenceType is direct, assumptions[] may be empty.
- nextAction is one directive a platform engineer can execute this sprint, including the service, data source, and target change.
- executiveBullets: 5 CFO-readable sentences. Lead with dollar impact, spend trend, biggest waste driver, biggest risk, and next 30-day action. No filler.
- billingPeriods: include EVERY period present in the bill text with the real label, date range, amount, and a short invoiceFile identifier. Order chronologically.
- serviceBreakdown: list the top 8–12 services by spend with real USD amounts from the bill. If only one period is shown, use it; otherwise use the most recent.
- summaryMetrics math: averageSpend = mean of billingPeriods.amount. monthlySavings = sum of per-finding monthlySavings. annualSavings = monthlySavings × 12. savingsPercent = monthlySavings / averageSpend × 100. criticalCount = count of severity='critical'.
- scores: costEfficiency and securityGrade are 0–100 integers; reduce as high/critical findings in that category increase. health ∈ {Excellent, Good, Fair, At Risk}.

ENUMS
- category: cost | security | modernization | governance
- severity: info | medium | high | critical
- confidence: low | medium | high
- evidenceType: direct | inference | assumption

OUTPUT
- Emit ONE call to the emit_assessment tool with STRICT JSON. No prose, no markdown, no code fences.`;

    const aiBillText = compactBillTextForAi(data.billText);

    const userPrompt = `Account name: ${data.accountName || "Cloud Environment"}

The user pasted ${data.billText.length.toLocaleString()} characters of cloud bill / cost-explorer text spanning multiple billing periods. The analysis input below has been compacted to ${aiBillText.length.toLocaleString()} high-signal characters containing period headers, totals, cloud services, units, and USD amounts. Parse every visible period.

BILL SUMMARY TEXT:
"""
${aiBillText}
"""

Produce the assessment now. Return a proper detailed analysis: 8 findings, exactly 4 reasoning sentences per finding, explicit assumptions, service-level evidence, conservative savings math, and one executable nextAction.`;

    const schema = {
      type: "object",
      required: [
        "accountName",
        "billingPeriods",
        "scores",
        "summaryMetrics",
        "executiveBullets",
        "findings",
        "serviceBreakdown",
      ],
      properties: {
        accountName: { type: "string" },
        billingPeriods: {
          type: "array",
          items: {
            type: "object",
            required: ["label", "dateRange", "amount", "invoiceFile"],
            properties: {
              label: { type: "string" },
              dateRange: { type: "string" },
              amount: { type: "number" },
              invoiceFile: { type: "string" },
            },
          },
        },
        scores: {
          type: "object",
          required: ["health", "costEfficiency", "securityGrade"],
          properties: {
            health: { type: "string", enum: ["Excellent", "Good", "Fair", "At Risk"] },
            costEfficiency: { type: "number" },
            securityGrade: { type: "number" },
          },
        },
        summaryMetrics: {
          type: "object",
          required: [
            "averageSpend",
            "monthlySavings",
            "annualSavings",
            "savingsPercent",
            "criticalCount",
          ],
          properties: {
            averageSpend: { type: "number" },
            monthlySavings: { type: "number" },
            annualSavings: { type: "number" },
            savingsPercent: { type: "number" },
            criticalCount: { type: "number" },
          },
        },
        executiveBullets: { type: "array", items: { type: "string" } },
        serviceBreakdown: {
          type: "array",
          items: {
            type: "object",
            required: ["service", "amount"],
            properties: {
              service: { type: "string" },
              amount: { type: "number" },
            },
          },
        },
        findings: {
          type: "array",
          items: {
            type: "object",
            required: [
              "id",
              "title",
              "category",
              "severity",
              "confidence",
              "evidenceType",
              "points",
              "nextAction",
            ],
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              category: {
                type: "string",
                enum: ["cost", "security", "modernization", "governance"],
              },
              severity: {
                type: "string",
                enum: ["info", "medium", "high", "critical"],
              },
              monthlySavings: { type: "number" },
              annualSavings: { type: "number" },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
              evidenceType: {
                type: "string",
                enum: ["direct", "inference", "assumption"],
              },
              points: { type: "array", items: { type: "string" } },
              assumptions: { type: "array", items: { type: "string" } },
              nextAction: { type: "string" },
            },
          },
        },
      },
    };

    const nvidiaKey = process.env.NVIDIA_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const provider: "nvidia" | "gemini" | "lovable" = nvidiaKey
      ? "nvidia"
      : geminiKey
        ? "gemini"
        : "lovable";

    const endpoint =
      provider === "nvidia"
        ? "https://integrate.api.nvidia.com/v1/chat/completions"
        : provider === "gemini"
          ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
          : "https://ai.gateway.lovable.dev/v1/chat/completions";

    const headers: Record<string, string> =
      provider === "nvidia"
        ? {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${nvidiaKey}`,
          }
        : provider === "gemini"
          ? { "Content-Type": "application/json", Authorization: `Bearer ${geminiKey}` }
          : { "Content-Type": "application/json", "Lovable-API-Key": apiKey! };

    const model =
      provider === "nvidia"
        ? "meta/llama-3.3-70b-instruct"
        : provider === "gemini"
          ? "gemini-2.0-flash"
          : "google/gemini-3-flash-preview";

    let response: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_PROVIDER_TIMEOUT_MS);
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 4200,
          tools: [
            {
              type: "function",
              function: {
                name: "emit_assessment",
                description: "Emit the structured cloud assessment report.",
                parameters: schema,
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "emit_assessment" } },
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.warn("AI provider timed out; returning deterministic assessment fallback", {
          provider,
          inputChars: data.billText.length,
          compactedChars: aiBillText.length,
        });
        return {
          ok: true,
          report: buildDeterministicReport(data.billText, data.accountName),
        };
      }
      console.error("AI provider network failure", {
        provider,
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        code: "request_failed",
        message: "The AI provider could not be reached right now. Please try again in a moment.",
      };
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const txt = await response.text();
      console.error("AI provider error", {
        provider,
        status: response.status,
        body: txt,
      });
      if (response.status === 524 || response.status === 504 || response.status === 408) {
        console.warn("AI provider gateway timeout; returning deterministic assessment fallback", {
          provider,
          status: response.status,
        });
        return {
          ok: true,
          report: buildDeterministicReport(data.billText, data.accountName),
        };
      }
      if (response.status === 429) {
        const retryAfterHeader = Number(response.headers.get("retry-after") ?? "60");
        return {
          ok: false,
          code: "rate_limited",
          retryAfterSeconds:
            Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : 60,
          message: `Rate limit hit on ${provider}. Wait about 60s and retry.`,
        };
      }
      if (response.status === 402) {
        return {
          ok: false,
          code: "credits_exhausted",
          message: "AI credits exhausted. Add credits or configure a provider key.",
        };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          code: "invalid_key",
          message: `Invalid ${provider} API key. Check the key and try again.`,
        };
      }
      return {
        ok: false,
        code: "request_failed",
        message: `AI request failed (${response.status}). Please try again in a moment.`,
      };
    }

    let payload: AiChatPayload;
    try {
      payload = await response.json();
    } catch (error) {
      console.error("AI provider returned invalid JSON", {
        provider,
        status: response.status,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: true,
        report: buildDeterministicReport(data.billText, data.accountName),
      };
    }
    const toolCall = payload?.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall?.function?.arguments;
    if (!args) {
      console.warn("AI provider returned no tool call; returning deterministic assessment fallback", {
        provider,
      });
      return {
        ok: true,
        report: buildDeterministicReport(data.billText, data.accountName),
      };
    }

    let parsed: AssessmentReport;
    try {
      parsed = typeof args === "string" ? JSON.parse(args) : (args as AssessmentReport);
    } catch (error) {
      console.error("AI provider returned malformed tool arguments", {
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: true,
        report: buildDeterministicReport(data.billText, data.accountName),
      };
    }

    const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
    const shallowFinding = findings.find(
      (finding: { points?: unknown[]; title?: string }) =>
        !Array.isArray(finding.points) ||
        finding.points.length < 4 ||
        finding.points.some(
          (point) => typeof point !== "string" || point.trim().split(/\s+/).length < 10,
        ) ||
        (typeof finding.title === "string" && finding.title.trim().split(/\s+/).length < 4),
    );

    if (findings.length < 8 || shallowFinding) {
      console.warn("AI response was shallow; returning deterministic assessment fallback", {
        provider,
        findings: findings.length,
      });
      return {
        ok: true,
        report: buildDeterministicReport(data.billText, data.accountName),
      };
    }

    // Best-effort: stamp ids and a timestamp
    const raw: AssessmentReport = {
      ...parsed,
      generatedAt: new Date().toISOString(),
      findings: (parsed.findings || []).map((f: Finding, i: number) => ({
        ...f,
        id: f.id || `f-${i + 1}`,
      })),
    };

    // Enforce internally-consistent math and scoring regardless of LLM output.
    return {
      ok: true,
      report: normalizeReport(raw),
    };
  });
