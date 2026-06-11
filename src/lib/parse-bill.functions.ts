import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AssessmentReport } from "./assessment-types";
import { MIN_SUMMARY_CHARS, SERVER_BILL_TEXT_LIMIT } from "./bill-input";
import { normalizeReport } from "./normalize-assessment";


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
  .handler(async ({ data }): Promise<AssessmentReport> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Error("AI service is not configured. Please contact support.");
    }

    const systemPrompt = `You are a senior AWS cloud cost and security consultant.
You receive a pasted cloud bill summary (raw text, may be partial). You produce a CONSERVATIVE consultant-grade assessment as JSON.

Rules:
- Distinguish direct evidence from inference and assumption.
- Never claim certainty about exposed resources, open security groups, IAM abuse, or exact instance families unless the source text supports it.
- Findings must be evidence-first: cite USD amounts and percentages from the bill where possible.
- Every finding has 3–5 numbered reasoning points and a concrete next action.
- Savings math: be conservative. Apply at most these uplift factors against the relevant service line item: Compute Savings Plan ~25-30%, Reserved Instances ~35-40%, Graviton migration ~15-20%, S3 storage class transition ~30-50% of the storage line, idle/right-size ~30-50% of the over-provisioned line. NEVER claim savings larger than the underlying service spend.
- monthlySavings must be a realistic dollar number (not a percent). Set 0 or omit when the finding is not directly cost-saving (security, governance).
- billingPeriods must include the periods present in the bill text with real amounts. Use trailing 3 months when available.
- summaryMetrics: averageSpend = mean of billingPeriods.amount. monthlySavings = sum of finding monthlySavings. annualSavings = monthlySavings * 12. savingsPercent = monthlySavings / averageSpend * 100. criticalCount = number of findings with severity 'critical'.
- Scoring: costEfficiency and securityGrade are 0–100 integers. Lower the score when more high/critical findings exist in that category.
- Categories: cost, security, modernization, governance. Severity: info, medium, high, critical. Confidence: low, medium, high. EvidenceType: direct, inference, assumption.
- Provide 6–10 findings spread across the four categories. Include at least 1 security and 1 governance finding even if low severity.
- Output STRICT JSON matching the provided schema. No prose, no markdown fences.`;

    const userPrompt = `Account name: ${data.accountName || "Cloud Environment"}

BILL SUMMARY TEXT:
"""
${data.billText}
"""

Generate the assessment JSON now. Include 6–10 findings across the four categories.`;

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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
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

    if (response.status === 429) {
      throw new Error("Rate limit reached. Please wait a moment and try again.");
    }
    if (response.status === 402) {
      throw new Error("AI credits exhausted. Please add credits in workspace settings.");
    }
    if (!response.ok) {
      const txt = await response.text();
      console.error("AI gateway error", response.status, txt);
      throw new Error("Failed to generate assessment. Please try again.");
    }

    const payload = await response.json();
    const toolCall = payload?.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall?.function?.arguments;
    if (!args) throw new Error("Assessment generation returned no structured output.");

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
    return normalizeReport(raw);
  });
