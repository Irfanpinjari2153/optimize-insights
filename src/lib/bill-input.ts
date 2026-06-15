export const MIN_BILLS = 3;
export const MAX_BILLS = 6;
export const MIN_SUMMARY_CHARS = 20;
export const MAX_BILL_CHARS = 30_000;
export const MAX_COMBINED_BILL_CHARS = 120_000;
export const SERVER_BILL_TEXT_LIMIT = MAX_COMBINED_BILL_CHARS;

const RAW_PDF_MARKERS = ["%PDF-", "endobj", "stream", "xref", "trailer", "/Type /XObject"];
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

type BillSummaryInput = {
  label?: string;
  text: string;
};

export function normalizeBillText(text: string) {
  return text.replace(/\r\n?/g, "\n");
}

export function getBillTextIssue(text: string) {
  const normalized = normalizeBillText(text);
  const sample = normalized.slice(0, 5000);

  if (!sample.trim()) {
    return null;
  }

  const pdfMarkerCount = RAW_PDF_MARKERS.reduce(
    (count, marker) => count + (sample.includes(marker) ? 1 : 0),
    0,
  );
  const controlCount = (sample.match(CONTROL_CHARS) || []).length;

  if (sample.startsWith("%PDF-") || pdfMarkerCount >= 2) {
    return "This looks like a raw PDF upload, not readable billing text. Upload a text export or paste the bill text instead.";
  }

  if (controlCount > Math.max(24, sample.length * 0.02)) {
    return "This input contains binary characters instead of readable billing text. Upload a text export or paste the bill text instead.";
  }

  return null;
}

export function clampBillText(text: string) {
  return normalizeBillText(text);
}

export function combineBillSummaries(bills: BillSummaryInput[]) {
  return bills
    .filter((bill) => bill.text.trim().length >= MIN_SUMMARY_CHARS)
    .map(
      (bill, index) =>
        `===== ${bill.label?.trim() || `Billing period ${index + 1}`} =====\n${bill.text.trim()}`,
    )
    .join("\n\n");
}