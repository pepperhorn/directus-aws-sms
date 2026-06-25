// src/inbound/resolve-family.test.ts
import { describe, it, expect } from "vitest";
import { resolveFamily, familyMatchesNumber } from "./resolve-family.js";
import type { FamilyMatchRow } from "./types.js";

const fam = (id: string, admin?: string, cc: string[] = []): FamilyMatchRow => ({
  id,
  family_admin_mobile: admin,
  family_sms_cc: cc.map((to_mobile, i) => ({ to_name: `cc${i}`, to_mobile })),
});

describe("familyMatchesNumber", () => {
  it("matches on the admin mobile after normalization (local vs E.164)", () => {
    expect(familyMatchesNumber(fam("f1", "0412 345 678"), "+61412345678")).toBe(true);
  });
  it("matches on a cc entry", () => {
    expect(familyMatchesNumber(fam("f1", "0400000000", ["0412345678"]), "+61412345678")).toBe(true);
  });
  it("does not match a different number", () => {
    expect(familyMatchesNumber(fam("f1", "0400000000"), "+61412345678")).toBe(false);
  });
  it("ignores landline/un-normalizable entries (they never produce an e164)", () => {
    expect(familyMatchesNumber(fam("f1", "03 9123 4567"), "+61412345678")).toBe(false);
  });
});

describe("resolveFamily", () => {
  it("returns exactly one match → familyId set", () => {
    const out = resolveFamily("+61412345678", [fam("a", "0400000000"), fam("b", "0412345678")]);
    expect(out).toEqual({ matchCount: 1, familyId: "b", matchedFamilyIds: ["b"] });
  });
  it("returns zero matches → familyId null (triage)", () => {
    const out = resolveFamily("+61412345678", [fam("a", "0400000000")]);
    expect(out).toEqual({ matchCount: 0, familyId: null, matchedFamilyIds: [] });
  });
  it("returns many matches → familyId null, all ids surfaced", () => {
    const out = resolveFamily("+61412345678", [fam("a", "0412345678"), fam("b", "0412 345 678")]);
    expect(out.matchCount).toBe(2);
    expect(out.familyId).toBeNull();
    expect(out.matchedFamilyIds).toEqual(["a", "b"]);
  });
  it("returns zero matches when the inbound number is not a normalizable mobile", () => {
    const out = resolveFamily("garbage", [fam("a", "0412345678")]);
    expect(out).toEqual({ matchCount: 0, familyId: null, matchedFamilyIds: [] });
  });
  it("counts a family at most once even if both admin + cc match", () => {
    const out = resolveFamily("+61412345678", [fam("a", "0412345678", ["0412345678"])]);
    expect(out.matchCount).toBe(1);
    expect(out.matchedFamilyIds).toEqual(["a"]);
  });
});
