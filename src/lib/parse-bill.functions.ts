import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AssessmentReport, Finding } from "./assessment-types";
import { MIN_SUMMARY_CHARS, SERVER_BILL_TEXT_LIMIT } from "./bill-input";
import { normalizeReport } from "./normalize-assessment";

type OllamaChatPayload = {
  message?: { content?: unknown };
  response?: unknown;
  error?: string | { message?: string };
  choices?: Array<{ message?: { content?: unknown } }>;
};

const MAX_AI_CONTEXT_CHARS = 14_000;
const OLLAMA_PROVIDER_TIMEOUT_MS = 45_000;

function buildOllamaChatEndpoints(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  const candidates: string[] = [];

  try {
    const url = new URL(normalized);
    if (url.hostname === "ollama.com") candidates.push(`${url.origin}/api/chat`);
  } catch {
    // Fall through to string-based endpoint handling below.
  }

  if (/\/api\/chat$/i.test(normalized)) candidates.push(normalized);
  else if (/\/api$/i.test(normalized)) candidates.push(`${normalized}/chat`);
  else candidates.push(`${normalized}/api/chat`);

  try {
    const url = new URL(normalized);
    candidates.push(`${url.origin}/api/chat`);
  } catch {
    // Ignore invalid URL fallbacks; the fetch path will surface the error.
  }

  return [...new Set(candidates)];
}

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
  {
    service: "Elastic Compute Cloud",
    pattern: /\b(EC2|Elastic Compute|Compute Cloud|Compute Engine|Virtual Machines)\b/i,
  },
  {
    service: "Simple Storage Service",
    pattern: /\b(S3|Simple Storage|Object Storage|Cloud Storage|Blob Storage)\b/i,
  },
  {
    service: "Elastic Block Store",
    pattern: /\b(EBS|Elastic Block|Persistent Disk|Managed Disks)\b/i,
  },
  {
    service: "Relational Database Service",
    pattern: /\b(RDS|Relational Database|Cloud SQL|Azure SQL|Database)\b/i,
  },
  { service: "Lambda", pattern: /\b(Lambda|Functions|Cloud Functions)\b/i },
  { service: "NAT Gateway", pattern: /\b(NAT Gateway|NAT)\b/i },
  { service: "Data Transfer", pattern: /\b(Data Transfer|Bandwidth|Inter-AZ|Egress)\b/i },
  { service: "CloudFront", pattern: /\b(CloudFront|CDN)\b/i },
  {
    service: "Elastic Load Balancing",
    pattern: /\b(ELB|Elastic Load Balanc|Load Balancer|ALB|NLB)\b/i,
  },
  { service: "CloudWatch", pattern: /\b(CloudWatch|Monitoring|Log Group|Logs|Metrics)\b/i },
  { service: "DynamoDB", pattern: /\b(DynamoDB|NoSQL|Table Storage)\b/i },
  { service: "ElastiCache", pattern: /\b(ElastiCache|Redis|Memcached)\b/i },
  { service: "OpenSearch", pattern: /\b(OpenSearch|Elasticsearch)\b/i },
  { service: "Elastic Container Service", pattern: /\b(ECS|Fargate|Container Service)\b/i },
  { service: "Elastic Kubernetes Service", pattern: /\b(EKS|Kubernetes)\b/i },
  { service: "Elastic Container Registry", pattern: /\b(ECR|Container Registry)\b/i },
  { service: "Web Application Firewall", pattern: /\b(WAF|Firewall Manager)\b/i },
  { service: "AWS Backup", pattern: /\b(AWS Backup|Backup)\b/i },
  { service: "Secrets Manager", pattern: /\b(Secrets Manager|Secret Manager)\b/i },
  { service: "Athena", pattern: /\b(Athena|Query Service)\b/i },
  { service: "Glue", pattern: /\b(Glue|Data Catalog|ETL)\b/i },
  { service: "Redshift", pattern: /\b(Redshift|Data Warehouse)\b/i },
  { service: "SageMaker", pattern: /\b(SageMaker|Machine Learning)\b/i },
  { service: "Bedrock", pattern: /\b(Bedrock|Foundation Model|Generative AI)\b/i },
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

  if (
    !amounts.length &&
    /total|charges|EC2|S3|Storage|Compute|Database|Transfer|Support/i.test(line)
  ) {
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
  const preferredTotalCandidates: number[] = [];
  const totalCandidates: number[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (/\b(tax|credit|refund|payment|discount|subtotal)\b/i.test(line)) continue;
    if (
      /\b(grand total|invoice total|amount due|total charges|total billed|bill total)\b/i.test(line)
    ) {
      preferredTotalCandidates.push(...getLineAmounts(line));
    } else if (/^\s*total\b|\btotal\s*$/i.test(line)) {
      totalCandidates.push(...getLineAmounts(line));
    }
  }
  if (preferredTotalCandidates.length) return Math.max(...preferredTotalCandidates);
  if (totalCandidates.length) return Math.max(...totalCandidates);
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
      const existing = grouped.get(service.service) ?? {
        service: service.service,
        amount: 0,
        evidence: [],
      };
      existing.amount += service.amount;
      existing.evidence.push(
        ...service.evidence.slice(0, Math.max(0, 3 - existing.evidence.length)),
      );
      grouped.set(service.service, existing);
    }
  }
  return [...grouped.values()].sort((a, b) => b.amount - a.amount);
}

function findService(services: LocalServiceSpend[], names: string[]) {
  return services.find((service) =>
    names.some((name) => service.service.toLowerCase().includes(name)),
  );
}

function serviceOptimization(serviceName: string) {
  const lower = serviceName.toLowerCase();
  if (/compute|ec2|virtual machine|container|kubernetes|fargate/.test(lower)) {
    return {
      rate: 0.25,
      title: `${serviceName} commitment and right-sizing opportunity`,
      mechanism:
        "right-size always-on capacity first, then cover the stable baseline with one-year commitments",
      action:
        "Export instance or workload utilization for this service, remove idle capacity, and size commitments only to the verified p70 baseline.",
    };
  }
  if (/storage|s3|block store|backup|snapshot/.test(lower)) {
    return {
      rate: 0.3,
      title: `${serviceName} lifecycle and retention cleanup opportunity`,
      mechanism:
        "move cold data to lower-cost tiers, delete stale snapshots, and reduce non-production retention after owner approval",
      action:
        "Pull age, last-access, and retention data for this storage line, then apply lifecycle rules to confirmed cold or stale data.",
    };
  }
  if (/database|rds|sql|dynamodb|redshift|opensearch|elasticache/.test(lower)) {
    return {
      rate: 0.2,
      title: `${serviceName} capacity and purchase-model review`,
      mechanism:
        "validate steady usage, remove over-provisioned capacity, and reserve only the confirmed baseline",
      action:
        "Compare database CPU, storage, IOPS, and connection metrics with current class or capacity settings, then right-size before reserving.",
    };
  }
  if (/transfer|nat|bandwidth|cloudfront|load balanc|egress/.test(lower)) {
    return {
      rate: 0.35,
      title: `${serviceName} network path optimization opportunity`,
      mechanism:
        "reduce avoidable NAT processing, inter-zone traffic, public egress, and uncached outbound transfer",
      action:
        "Use flow logs and cost usage detail to identify top traffic paths, then add private endpoints, caching, or same-zone routing where applicable.",
    };
  }
  if (/cloudwatch|logs|monitoring|config|cloudtrail|security|guardduty|waf|kms/.test(lower)) {
    return {
      rate: 0.15,
      title: `${serviceName} telemetry volume and retention review`,
      mechanism:
        "separate required security telemetry from noisy debug data and tune retention without weakening audit coverage",
      action:
        "Review ingestion volume, metric cardinality, and retention settings for this telemetry service, then reduce noisy non-audit data.",
    };
  }
  return {
    rate: 0.12,
    title: `${serviceName} owner-level cost validation`,
    mechanism:
      "confirm the business owner, usage driver, and SKU-level detail before applying conservative optimization targets",
    action:
      "Open the service cost detail for this line item, assign an owner, and validate the specific usage driver causing the charge.",
  };
}

function buildServiceCostFinding(
  service: LocalServiceSpend,
  index: number,
  latestAmount: number,
  averageSpend: number,
): Finding {
  const optimization = serviceOptimization(service.service);
  const savings = Math.min(service.amount, Math.round(service.amount * optimization.rate));
  const share = latestAmount > 0 ? Math.round((service.amount / latestAmount) * 1000) / 10 : 0;
  const evidence = service.evidence[0]
    ? `The bill line evidence includes "${service.evidence[0]}".`
    : `The parsed latest-period service amount is ${formatUsd(service.amount)}.`;

  return {
    id: `f-${index + 1}`,
    title: optimization.title,
    category: "cost",
    severity: share >= 35 || service.amount > averageSpend * 0.35 ? "high" : "medium",
    monthlySavings: savings,
    annualSavings: savings * 12,
    confidence: service.evidence.length ? "medium" : "low",
    evidenceType: service.evidence.length ? "direct" : "inference",
    points: [
      `${service.service} is ${formatUsd(service.amount)} in the latest visible period, representing ${share}% of that period's ${formatUsd(latestAmount)} total.`,
      `${evidence} A conservative ${Math.round(optimization.rate * 100)}% improvement gives ${formatUsd(service.amount)} × ${Math.round(optimization.rate * 100)}% = about ${formatUsd(savings)} per month, capped below the service spend.`,
      `The recommended mechanism is to ${optimization.mechanism}, because the bill proves spend but not utilization or owner intent.`,
      `Annualized impact is ${formatUsd(savings)} × 12 = ${formatUsd(savings * 12)}, subject to validating SKU, region, and production-safety constraints before changes.`,
    ],
    assumptions: [
      "The billing summary does not include utilization, SKU-level commitment coverage, or workload owner approval.",
    ],
    nextAction: optimization.action,
  };
}

function buildDeterministicReport(billText: string, accountName?: string): AssessmentReport {
  const sections = parseLocalBillSections(billText).filter((section) => section.content.trim());
  const safeSections = sections.length
    ? sections
    : parseLocalBillSections("Total cloud spend $0.00");
  const latest = safeSections.at(-1) ?? safeSections[0];
  const aggregate = aggregateServices(safeSections);
  const latestServices = latest.services.length ? latest.services : aggregate;
  const topService = latestServices[0] ?? {
    service: "Total cloud spend",
    amount: latest.amount,
    evidence: [],
  };
  const averageSpend =
    safeSections.reduce((sum, section) => sum + section.amount, 0) /
    Math.max(1, safeSections.length);

  const compute = findService(aggregate, ["compute", "elastic compute", "virtual machines"]);
  const securityVisible = aggregate.filter((service) =>
    ["guardduty", "security hub", "config", "cloudtrail", "kms"].some((name) =>
      service.service.toLowerCase().includes(name),
    ),
  );

  const computeBase = compute?.amount || topService.amount || averageSpend;

  const trend = safeSections.length >= 2 ? latest.amount - safeSections[0].amount : 0;
  const trendDirection = trend > 0 ? "increased" : trend < 0 ? "decreased" : "remained flat";
  const visibleSecurityText = securityVisible.length
    ? securityVisible.map((service) => `${service.service} ${formatUsd(service.amount)}`).join(", ")
    : "no visible GuardDuty, Security Hub, Config, CloudTrail, or KMS line items";
  const costFindingServices = (latestServices.length ? latestServices : aggregate)
    .filter((service) => service.amount > 0)
    .slice(0, 3);
  const costFindings = (costFindingServices.length ? costFindingServices : [topService]).map(
    (service, index) => buildServiceCostFinding(service, index, latest.amount, averageSpend),
  );

  const findings: AssessmentReport["findings"] = [
    ...costFindings,
    {
      id: `f-${costFindings.length + 1}`,
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
      nextAction:
        "Create monthly budget alerts at service-owner level using latest-period service totals and the three-month average as the baseline.",
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
      assumptions: securityVisible.length
        ? []
        : [
            "Security services may be free-tier, centrally billed elsewhere, or omitted from the summary.",
          ],
      nextAction:
        "Verify GuardDuty, Security Hub, Config, CloudTrail, and KMS coverage across every production account and active region this sprint.",
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
      nextAction:
        "Run a configuration inventory for encryption, public access, and audit logging on the highest-spend storage, database, and compute services.",
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
      assumptions: [
        "Instance families, runtime architectures, and workload compatibility are not visible in billing text.",
      ],
      nextAction:
        "Identify the top three steady compute workloads and test right-sizing, autoscaling, or modern instance families in a non-production environment.",
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
      nextAction:
        "Enforce required cost tags for application, owner, environment, and data classification on the services driving the latest bill.",
    },
  ];

  const billingPeriods = safeSections.map((section, index) => ({
    label: section.label,
    dateRange: section.dateRange,
    amount: Math.round(section.amount),
    invoiceFile: `period-${index + 1}`,
  }));

  const serviceBreakdownSource = latestServices.length
    ? latestServices
    : [{ service: "Total cloud spend", amount: latest.amount, evidence: [] }];
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
      savingsPercent:
        averageSpend > 0 ? Math.round((monthlySavings / averageSpend) * 1000) / 10 : 0,
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
      /EC2|Elastic|Compute|S3|Storage|EBS|RDS|Database|DynamoDB|Lambda|NAT|VPC|CloudFront|CloudWatch|Route 53|KMS|GuardDuty|Security Hub|Config|CloudTrail|Support|Data Transfer|Bandwidth|ECS|EKS|Fargate|Load Balanc|WAF|Backup|Secrets|Athena|Glue|Redshift|SageMaker|Bedrock/i.test(
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

function parseJsonObjectFromText(value: unknown): AssessmentReport | undefined {
  if (!value) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) return value as AssessmentReport;

  const text = Array.isArray(value)
    ? value
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part) {
            const textValue = (part as { text?: unknown }).text;
            return typeof textValue === "string" ? textValue : "";
          }
          return "";
        })
        .join("\n")
    : typeof value === "string"
      ? value
      : "";

  const cleaned = text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;

  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as AssessmentReport;
  } catch {
    return undefined;
  }
}

function extractAssessmentFromOllamaPayload(payload: OllamaChatPayload) {
  return (
    parseJsonObjectFromText(payload?.choices?.[0]?.message?.content) ??
    parseJsonObjectFromText(payload?.message?.content) ??
    parseJsonObjectFromText(payload?.response)
  );
}

function reportMatchesBillEvidence(report: AssessmentReport, billText: string) {
  const sections = parseLocalBillSections(billText).filter((section) => section.amount > 0);
  if (!sections.length) return true;

  const expectedAmounts = sections.map((section) => Math.round(section.amount));
  const reportedAmounts = (report.billingPeriods || []).map((period) => Math.round(period.amount));
  const amountMatches = expectedAmounts.filter((amount) =>
    reportedAmounts.some((reported) => Math.abs(reported - amount) <= Math.max(2, amount * 0.02)),
  ).length;

  return amountMatches >= Math.min(expectedAmounts.length, 2);
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
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL?.replace(/\/+$/, "");
    const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2";
    const ollamaApiKey = process.env.OLLAMA_API_KEY;
    if (!ollamaBaseUrl) {
      return {
        ok: false,
        code: "not_configured",
        message:
          "Ollama is not configured. Add OLLAMA_BASE_URL as a backend secret pointing to a reachable Ollama server.",
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
- Return one STRICT JSON object matching the requested report schema. No prose, no markdown, no code fences.`;

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

    const endpoints = buildOllamaChatEndpoints(ollamaBaseUrl);
    let endpoint = endpoints[0] ?? ollamaBaseUrl;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ollamaApiKey) headers.Authorization = `Bearer ${ollamaApiKey}`;

    let response: Response | undefined;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_PROVIDER_TIMEOUT_MS);
    try {
      for (const candidateEndpoint of endpoints) {
        endpoint = candidateEndpoint;
        response = await fetch(endpoint, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model: ollamaModel,
            stream: false,
            format: schema,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            options: { temperature: 0.1, num_ctx: 16_384 },
          }),
        });
        if (response.ok || response.status !== 404) break;

        console.warn("Ollama endpoint returned 404; trying fallback endpoint", {
          model: ollamaModel,
          endpoint,
          body: (await response.clone().text()).slice(0, 240),
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.warn("Ollama timed out; returning deterministic assessment fallback", {
          model: ollamaModel,
          inputChars: data.billText.length,
          compactedChars: aiBillText.length,
        });
        return {
          ok: true,
          report: buildDeterministicReport(data.billText, data.accountName),
        };
      }
      console.error("Ollama network failure", {
        model: ollamaModel,
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        code: "request_failed",
        message:
          "Ollama could not be reached from the backend. Use a public HTTPS Ollama endpoint, not localhost.",
      };
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response) {
      return {
        ok: false,
        code: "request_failed",
        message: "Ollama could not be reached from the backend. Check the configured endpoint.",
      };
    }

    if (!response.ok) {
      const txt = await response.text();
      console.error("Ollama provider error", {
        model: ollamaModel,
        status: response.status,
        body: txt,
      });
      if (response.status === 524 || response.status === 504 || response.status === 408) {
        console.warn("Ollama gateway timeout; returning deterministic assessment fallback", {
          model: ollamaModel,
          status: response.status,
        });
        return {
          ok: true,
          report: buildDeterministicReport(data.billText, data.accountName),
        };
      }
      if (response.status === 404) {
        console.warn("Ollama endpoint returned 404 after fallbacks; returning deterministic assessment fallback", {
          model: ollamaModel,
          endpoint,
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
          message: "Rate limit hit on Ollama. Wait about 60s and retry.",
        };
      }
      if (response.status === 402) {
        return {
          ok: false,
          code: "credits_exhausted",
          message: "The Ollama endpoint rejected the request for billing or quota reasons.",
        };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          code: "invalid_key",
          message: "Invalid Ollama API key or endpoint access. Check the configured backend secret.",
        };
      }
      return {
        ok: false,
        code: "request_failed",
        message: `Ollama request failed (${response.status}). Please try again in a moment.`,
      };
    }

    let payload: OllamaChatPayload;
    try {
      payload = await response.json();
    } catch (error) {
      console.error("Ollama returned invalid JSON", {
        model: ollamaModel,
        status: response.status,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: true,
        report: buildDeterministicReport(data.billText, data.accountName),
      };
    }
    if (payload.error) {
      console.error("Ollama returned an error payload", {
        model: ollamaModel,
        error: payload.error,
      });
      return {
        ok: false,
        code: "request_failed",
        message: "Ollama returned an error while analyzing the bill. Check the model name and endpoint.",
      };
    }

    const parsed = extractAssessmentFromOllamaPayload(payload);
    if (!parsed) {
      console.warn(
        "Ollama returned no parseable assessment; returning bill-derived fallback",
        {
          model: ollamaModel,
        },
      );
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
        model: ollamaModel,
        findings: findings.length,
      });
      return {
        ok: true,
        report: buildDeterministicReport(data.billText, data.accountName),
      };
    }

    if (!reportMatchesBillEvidence(parsed, data.billText)) {
      console.warn("AI response did not match bill totals; returning bill-derived fallback", {
        model: ollamaModel,
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
