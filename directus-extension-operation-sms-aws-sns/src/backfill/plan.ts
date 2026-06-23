// src/backfill/plan.ts
import { normalizeAuMobile, type PhoneKind } from "../phone.js";

export type FamilyRow = {
  id: string;
  family_admin_mobile?: unknown;
  family_sms_cc?: { to_name?: string; to_mobile?: unknown }[] | null;
};

export type BackfillChange = {
  id: string;
  field: "family_admin_mobile" | "family_sms_cc";
  index?: number;
  from: string | null;
  to: string | null;
  kind: PhoneKind;
  action: "normalize" | "flag";
};

export type BackfillResult = {
  changes: BackfillChange[];
  summary: { normalized: number; landline: number; unknown: number; empty: number };
};

const asStr = (v: unknown): string | null => (typeof v === "string" ? v : v == null ? null : String(v));

export function planNumberBackfill(families: FamilyRow[]): BackfillResult {
  const changes: BackfillChange[] = [];
  const summary = { normalized: 0, landline: 0, unknown: 0, empty: 0 };

  const consider = (id: string, field: BackfillChange["field"], raw: unknown, index?: number) => {
    const norm = normalizeAuMobile(raw);
    const from = asStr(raw);
    if (norm.kind === "empty") { summary.empty++; return; }
    if (norm.kind === "mobile") {
      summary.normalized++;
      if (norm.e164 !== from) changes.push({ id, field, ...(index !== undefined ? { index } : {}), from, to: norm.e164, kind: "mobile", action: "normalize" });
      return;
    }
    // landline | unknown → flag for manual correction
    summary[norm.kind === "landline" ? "landline" : "unknown"]++;
    changes.push({ id, field, ...(index !== undefined ? { index } : {}), from, to: null, kind: norm.kind, action: "flag" });
  };

  for (const fam of families) {
    if ("family_admin_mobile" in fam) consider(fam.id, "family_admin_mobile", fam.family_admin_mobile);
    const cc = fam.family_sms_cc;
    if (Array.isArray(cc)) cc.forEach((entry, i) => consider(fam.id, "family_sms_cc", entry?.to_mobile, i));
  }

  return { changes, summary };
}
