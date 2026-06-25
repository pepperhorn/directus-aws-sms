export type PhoneKind = "mobile" | "landline" | "unknown" | "empty";
export type NormalizedPhone = { e164: string | null; kind: PhoneKind };

const AU_LANDLINE_AREA = new Set(["2", "3", "7", "8"]);

/**
 * Normalize an Australian phone number to E.164 (+614…) for SMS.
 * Only mobiles get an `e164`; landlines and un-normalizable values are flagged.
 */
export function normalizeAuMobile(input: unknown): NormalizedPhone {
  if (typeof input !== "string") return { e164: null, kind: "empty" };
  const trimmed = input.trim();
  if (trimmed === "") return { e164: null, kind: "empty" };

  let digits = trimmed.replace(/[\s\-().]/g, "");

  if (digits.startsWith("+61")) {
    digits = "+61" + digits.slice(3);
  } else if (digits.startsWith("0061")) {
    digits = "+61" + digits.slice(4);
  } else if (digits.startsWith("61") && digits.length >= 10) {
    digits = "+61" + digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = "+61" + digits.slice(1);
  } else if (digits.startsWith("+")) {
    // Another country code: out of AU scope. Keep the value if it looks E.164, flag unknown.
    return { e164: /^\+\d{8,15}$/.test(digits) ? digits : null, kind: "unknown" };
  } else {
    return { e164: null, kind: "unknown" };
  }

  const m = /^\+61(\d+)$/.exec(digits);
  if (!m) return { e164: null, kind: "unknown" };
  const national = m[1]; // national portion, leading 0 already removed

  if (/^4\d{8}$/.test(national)) {
    return { e164: "+61" + national, kind: "mobile" };
  }
  if (national.length === 9 && AU_LANDLINE_AREA.has(national[0]!)) {
    return { e164: null, kind: "landline" };
  }
  return { e164: null, kind: "unknown" };
}
