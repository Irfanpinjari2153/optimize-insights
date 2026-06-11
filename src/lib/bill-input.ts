export const MIN_BILLS = 3;
export const MAX_BILLS = 6;
export const MIN_SUMMARY_CHARS = 20;
export const SERVER_BILL_TEXT_LIMIT = 300_000;
export const MAX_BILL_CHARS = 45_000;
export const MAX_COMBINED_BILL_CHARS = 275_000;

type BillSummaryInput = {
  label?: string;
  text: string;
};

export function normalizeBillText(text: string) {
  return text.replace(/\r\n?/g, "\n");
}

export function clampBillText(text: string) {
  return normalizeBillText(text).slice(0, MAX_BILL_CHARS);
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