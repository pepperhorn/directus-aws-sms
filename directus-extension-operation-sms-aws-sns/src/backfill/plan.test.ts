// src/backfill/plan.test.ts
import { describe, it, expect } from "vitest";
import { planNumberBackfill } from "./plan.js";

describe("planNumberBackfill", () => {
  it("normalizes a local admin mobile and reports it", () => {
    const out = planNumberBackfill([{ id: "f1", family_admin_mobile: "0449 922 425" }]);
    expect(out.changes).toContainEqual({
      id: "f1", field: "family_admin_mobile", from: "0449 922 425",
      to: "+61449922425", kind: "mobile", action: "normalize",
    });
    expect(out.summary.normalized).toBe(1);
  });

  it("flags a landline admin mobile without producing an e164", () => {
    const out = planNumberBackfill([{ id: "f2", family_admin_mobile: "03 9123 4567" }]);
    const change = out.changes.find((c) => c.id === "f2");
    expect(change).toMatchObject({ action: "flag", kind: "landline", to: null });
    expect(out.summary.landline).toBe(1);
  });

  it("walks the family_sms_cc array by index", () => {
    const out = planNumberBackfill([
      { id: "f3", family_sms_cc: [{ to_name: "Mum", to_mobile: "0412345678" }, { to_name: "Dad", to_mobile: "0299999999" }] },
    ]);
    expect(out.changes).toContainEqual({
      id: "f3", field: "family_sms_cc", index: 0, from: "0412345678",
      to: "+61412345678", kind: "mobile", action: "normalize",
    });
    expect(out.changes.find((c) => c.index === 1)).toMatchObject({ action: "flag", kind: "landline" });
  });

  it("ignores already-normalized mobiles (no change emitted)", () => {
    const out = planNumberBackfill([{ id: "f4", family_admin_mobile: "+61449922425" }]);
    expect(out.changes).toHaveLength(0);
  });

  it("counts empty values without emitting changes", () => {
    const out = planNumberBackfill([{ id: "f5", family_admin_mobile: null }]);
    expect(out.changes).toHaveLength(0);
    expect(out.summary.empty).toBe(1);
  });
});
