import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AssessmentReport } from "./assessment-types";
import { MIN_SUMMARY_CHARS, SERVER_BILL_TEXT_LIMIT } from "./bill-input";
import { normalizeReport } from "./normalize-assessment";

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

    const systemPrompt = `You are a Principal Cloud Economist and Well-Architected reviewer (AWS / Azure / GCP) with 15+ years of FinOps, security, and modernization experience. You are producing a deep, consultant-grade assessment that a CIO will read — NOT a generic checklist.

OPERATING PRINCIPLES
- Evidence first. Quote exact line items, USD amounts, units (GB-mo, vCPU-hr, requests), and percentages from the bill text. If something is not in the text, mark it 'inference' or 'assumption' and say so explicitly.
- Be specific. Replace vague phrases ("optimize storage", "review security") with concrete service names, SKUs, regions, instance families, and the exact mechanism (e.g. "Move 4.2 TB of S3 Standard in us-east-1 with <1 access/mo to S3 Glacier Instant Retrieval; cost drops from $0.023 to $0.004 per GB-mo").
- Show the math. Every dollar figure must be derivable from a stated baseline × stated uplift factor. Include the baseline in the reasoning points.
- Be conservative on savings. Cap uplifts: Compute Savings Plans 25–30%, Reserved Instances 35–40%, Graviton 15–20%, S3 IA/Glacier 30–60% of the affected storage line, EBS gp2→gp3 ~20%, idle/right-size 30–50% of the over-provisioned line, NAT Gateway redesign 40–70% of NAT data-processing line, inter-AZ traffic 20–40%. NEVER claim savings larger than the underlying service spend.
- monthlySavings is a realistic USD number (not a percent). Use 0 (or omit) for non-cost findings.

OUTPUT DEPTH REQUIREMENTS
- 10–14 findings total, distributed across all four categories (cost, security, modernization, governance). Minimum: 4 cost, 2 security, 2 modernization, 2 governance.
- Each finding: title is a concrete claim (not a topic). 5–7 numbered reasoning points, each a full sentence with numbers/units/citations. assumptions[] lists every unverified premise (2–4 items when evidenceType is inference/assumption). nextAction is a 1–2 sentence directive a platform engineer can execute this sprint (name the console path, IaC resource, or CLI command when possible).
- executiveBullets: 5–7 punchy, CFO-readable sentences. Lead with the dollar impact and the single biggest risk. No filler.
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

    const userPrompt = `Account name: ${data.accountName || "Cloud Environment"}

The user has pasted ${data.billText.length.toLocaleString()} characters of cloud bill / cost-explorer text spanning multiple billing periods, separated by lines of '====='. Parse every period.

BILL SUMMARY TEXT:
"""
${data.billText}
"""

Produce the full deep-dive assessment now. Remember: 10–14 findings, 5–7 reasoning sentences each with cited dollar amounts, explicit assumptions, and an executable nextAction.`;

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
        ? { "Content-Type": "application/json", Authorization: `Bearer ${nvidiaKey}` }
        : provider === "gemini"
          ? { "Content-Type": "application/json", Authorization: `Bearer ${geminiKey}` }
          : { "Content-Type": "application/json", "Lovable-API-Key": apiKey! };

    const model =
      provider === "nvidia"
        ? "deepseek-ai/deepseek-v4-flash"
        : provider === "gemini"
          ? "gemini-2.0-flash"
          : "google/gemini-3-flash-preview";

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
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
      console.error("AI provider network failure", {
        provider,
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        code: "request_failed",
        message:
          "The AI provider could not be reached right now. Please try again in a moment.",
      };
    }

    if (!response.ok) {
      const txt = await response.text();
      console.error("AI provider error", { provider, status: response.status, body: txt });
      if (response.status === 429) {
        const retryAfterHeader = Number(response.headers.get("retry-after") ?? "60");
        return {
          ok: false,
          code: "rate_limited",
          retryAfterSeconds: Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : 60,
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

    let payload: any;
    try {
      payload = await response.json();
    } catch (error) {
      console.error("AI provider returned invalid JSON", {
        provider,
        status: response.status,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        code: "invalid_response",
        message: "Assessment generation returned an unreadable response. Please retry.",
      };
    }
    const toolCall = payload?.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall?.function?.arguments;
    if (!args) {
      return {
        ok: false,
        code: "invalid_response",
        message: "Assessment generation returned no structured output. Please retry.",
      };
    }

    const parsed = typeof args === "string" ? JSON.parse(args) : args;

    // Best-effort: stamp ids and a timestamp
    const raw: AssessmentReport = {
      ...parsed,
      generatedAt: new Date().toISOString(),
      findings: (parsed.findings || []).map((f: { id?: string }, i: number) => ({
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
