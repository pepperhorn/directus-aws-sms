// src/inbound/resolve-family.ts
import { normalizeAuMobile } from "../phone.js";
import type { FamilyMatchRow, FamilyResolution } from "./types.js";

const numbersOf = (fam: FamilyMatchRow): unknown[] => {
  const out: unknown[] = [fam.family_admin_mobile];
  const cc = fam.family_sms_cc;
  if (Array.isArray(cc)) for (const entry of cc) out.push(entry?.to_mobile);
  return out;
};

export function familyMatchesNumber(fam: FamilyMatchRow, e164: string): boolean {
  for (const raw of numbersOf(fam)) {
    const norm = normalizeAuMobile(raw);
    if (norm.kind === "mobile" && norm.e164 === e164) return true;
  }
  return false;
}

export function resolveFamily(originationNumber: string, families: FamilyMatchRow[]): FamilyResolution {
  const inbound = normalizeAuMobile(originationNumber);
  if (inbound.kind !== "mobile" || inbound.e164 === null) {
    return { matchCount: 0, familyId: null, matchedFamilyIds: [] };
  }
  const matchedFamilyIds: string[] = [];
  for (const fam of families) {
    if (familyMatchesNumber(fam, inbound.e164)) matchedFamilyIds.push(fam.id);
  }
  return {
    matchCount: matchedFamilyIds.length,
    familyId: matchedFamilyIds.length === 1 ? matchedFamilyIds[0]! : null,
    matchedFamilyIds,
  };
}
