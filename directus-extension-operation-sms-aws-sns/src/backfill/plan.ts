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
  summary: { normalized: number; alreadyNormalized: number; landline: number; unknown: number; empty: number };
};

const asStr = (v: unknown): string | null => (typeof v === "string" ? v : v == null ? null : String(v));

export function planNumberBackfill(families: FamilyRow[]): BackfillResult {
  const changes: BackfillChange[] = [];
  const summary = { normalized: 0, alreadyNormalized: 0, landline: 0, unknown: 0, empty: 0 };

  const consider = (id: string, field: BackfillChange["field"], raw: unknown, index?: number) => {
    const norm = normalizeAuMobile(raw);
    const from = asStr(raw);
    if (norm.kind === "empty") { summary.empty++; return; }
    if (norm.kind === "mobile") {
      if (norm.e164 !== from) {
        summary.normalized++;
        changes.push({ id, field, ...(index !== undefined ? { index } : {}), from, to: norm.e164, kind: "mobile", action: "normalize" });
      } else {
        summary.alreadyNormalized++;
      }
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

export function buildFamilyPatch(
  current: FamilyRow,
  changes: BackfillChange[],
): { patch: Record<string, unknown>; skipped: BackfillChange[] } {
  const patch: Record<string, unknown> = {};
  const skipped: BackfillChange[] = [];

  // Only process normalize changes; flag entries are never written.
  const normalizeChanges = changes.filter((c) => c.action === "normalize");

  // Handle family_admin_mobile changes
  for (const c of normalizeChanges) {
    if (c.field === "family_admin_mobile") {
      const currentVal = asStr(current.family_admin_mobile);
      if (currentVal === c.from) {
        patch.family_admin_mobile = c.to;
      } else {
        skipped.push(c);
      }
    }
  }

  // Handle family_sms_cc changes as a group
  const ccChanges = normalizeChanges.filter((c) => c.field === "family_sms_cc");
  if (ccChanges.length > 0) {
    if (Array.isArray(current.family_sms_cc)) {
      const ccCopy = [...current.family_sms_cc];
      let anyWritten = false;
      for (const c of ccChanges) {
        if (c.index === undefined) { skipped.push(c); continue; }
        const entry = ccCopy[c.index];
        const currentMobile = asStr(entry?.to_mobile ?? null);
        if (currentMobile === c.from) {
          ccCopy[c.index] = { ...entry, to_mobile: c.to };
          anyWritten = true;
        } else {
          skipped.push(c);
        }
      }
      if (anyWritten) patch.family_sms_cc = ccCopy;
    } else {
      // current.family_sms_cc is not an array — skip all cc changes
      skipped.push(...ccChanges);
    }
  }

  return { patch, skipped };
}
