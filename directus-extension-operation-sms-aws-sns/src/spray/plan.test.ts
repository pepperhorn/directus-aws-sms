// src/spray/plan.test.ts
import { describe, it, expect } from "vitest";
import { planSpray, summarizeSpray } from "./plan.js";

describe("planSpray", () => {
  it("includes opted-in families with a valid mobile (normalized to E.164)", () => {
    const out = planSpray([{ id: "f1", family_sms_option: true, family_admin_mobile: "0400 000 001" }]);
    expect(out.recipients).toEqual([{ familyId: "f1", to: "+61400000001" }]);
    expect(out.skipped).toHaveLength(0);
  });

  it("skips families with a falsy family_sms_option as opted-out", () => {
    const out = planSpray([{ id: "f2", family_sms_option: false, family_admin_mobile: "0400000002" }]);
    expect(out.recipients).toHaveLength(0);
    expect(out.skipped).toContainEqual({ familyId: "f2", reason: "opted-out" });
  });

  it("skips an opted-in family with no mobile", () => {
    const out = planSpray([{ id: "f3", family_sms_option: true, family_admin_mobile: null }]);
    expect(out.skipped).toContainEqual({ familyId: "f3", reason: "no-mobile" });
  });

  it("skips an opted-in family whose number is a landline/unknown", () => {
    const out = planSpray([{ id: "f4", family_sms_option: true, family_admin_mobile: "03 9123 4567" }]);
    expect(out.skipped).toContainEqual({ familyId: "f4", reason: "bad-number" });
  });

  it("partitions a mixed batch", () => {
    const out = planSpray([
      { id: "a", family_sms_option: true, family_admin_mobile: "+61400000001" },
      { id: "b", family_sms_option: 1, family_admin_mobile: "0400000002" },
      { id: "c", family_sms_option: 0, family_admin_mobile: "0400000003" },
      { id: "d", family_sms_option: true, family_admin_mobile: "" },
    ]);
    expect(out.recipients.map((r) => r.familyId)).toEqual(["a", "b"]);
    expect(out.skipped.map((s) => s.familyId).sort()).toEqual(["c", "d"]);
  });
});

describe("summarizeSpray", () => {
  it("counts sent vs failed", () => {
    const summary = summarizeSpray([
      { familyId: "a", to: "+61400000001", status: "sent", messageId: "1" },
      { familyId: "b", to: "+61400000002", status: "failed", error: "throttled" },
      { familyId: "c", to: "+61400000003", status: "sent", messageId: "3" },
    ]);
    expect(summary).toEqual({ sent: 2, failed: 1, total: 3 });
  });
});
