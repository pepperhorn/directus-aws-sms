// src/spray/plan.ts
import { normalizeAuMobile } from "../phone.js";

export type SprayFamilyRow = {
  id: string;
  family_sms_option?: unknown;
  family_admin_mobile?: unknown;
};

export type SprayRecipient = { familyId: string; to: string };

export type SpraySkip = {
  familyId: string;
  reason: "opted-out" | "no-mobile" | "bad-number";
};

export type SprayPlan = { recipients: SprayRecipient[]; skipped: SpraySkip[] };

export type SpraySendResult = {
  familyId: string;
  to: string;
  status: "sent" | "failed";
  messageId?: string;
  error?: string;
};

/**
 * Pure recipient selection for a spray: opted-in families with a valid mobile.
 * Everyone else is recorded with a reason (audit + UI summary).
 */
export function planSpray(families: SprayFamilyRow[]): SprayPlan {
  const recipients: SprayRecipient[] = [];
  const skipped: SpraySkip[] = [];

  for (const fam of families) {
    if (!fam.family_sms_option) {
      skipped.push({ familyId: fam.id, reason: "opted-out" });
      continue;
    }
    const norm = normalizeAuMobile(fam.family_admin_mobile);
    if (norm.kind === "empty") {
      skipped.push({ familyId: fam.id, reason: "no-mobile" });
      continue;
    }
    if (norm.kind !== "mobile" || !norm.e164) {
      skipped.push({ familyId: fam.id, reason: "bad-number" });
      continue;
    }
    recipients.push({ familyId: fam.id, to: norm.e164 });
  }

  return { recipients, skipped };
}

export function summarizeSpray(results: SpraySendResult[]): {
  sent: number;
  failed: number;
  total: number;
} {
  let sent = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "sent") sent++;
    else failed++;
  }
  return { sent, failed, total: results.length };
}
