// src/backfill/plan.test.ts
import { describe, it, expect } from "vitest";
import { planNumberBackfill, buildFamilyPatch, type FamilyRow, type BackfillChange } from "./plan.js";

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

  it("increments alreadyNormalized (not normalized) for already-normalized mobiles", () => {
    const out = planNumberBackfill([{ id: "f6", family_admin_mobile: "+61449922425" }]);
    expect(out.summary.alreadyNormalized).toBe(1);
    expect(out.summary.normalized).toBe(0);
    expect(out.changes).toHaveLength(0);
  });
});

describe("buildFamilyPatch", () => {
  it("patches both admin mobile and cc entry when current values match from", () => {
    const current: FamilyRow = {
      id: "f1",
      family_admin_mobile: "0449 922 425",
      family_sms_cc: [
        { to_name: "Mum", to_mobile: "0412345678" },
        { to_name: "Dad", to_mobile: "+61411111111" },
      ],
    };
    const changes: BackfillChange[] = [
      { id: "f1", field: "family_admin_mobile", from: "0449 922 425", to: "+61449922425", kind: "mobile", action: "normalize" },
      { id: "f1", field: "family_sms_cc", index: 0, from: "0412345678", to: "+61412345678", kind: "mobile", action: "normalize" },
    ];
    const { patch, skipped } = buildFamilyPatch(current, changes);

    expect(patch.family_admin_mobile).toBe("+61449922425");
    const cc = patch.family_sms_cc as { to_name?: string; to_mobile?: unknown }[];
    expect(cc[0].to_mobile).toBe("+61412345678");
    expect(cc[0].to_name).toBe("Mum"); // to_name preserved
    expect(cc[1]).toEqual({ to_name: "Dad", to_mobile: "+61411111111" }); // sibling untouched
    expect(skipped).toHaveLength(0);
  });

  it("never writes flag changes and does not put them in skipped", () => {
    const current: FamilyRow = { id: "f2", family_admin_mobile: "03 9123 4567" };
    const changes: BackfillChange[] = [
      { id: "f2", field: "family_admin_mobile", from: "03 9123 4567", to: null, kind: "landline", action: "flag" },
    ];
    const { patch, skipped } = buildFamilyPatch(current, changes);
    expect(Object.keys(patch)).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });

  it("skips a change whose from no longer matches the current value", () => {
    const current: FamilyRow = {
      id: "f3",
      family_admin_mobile: "+61449922425", // already updated (simulate concurrent edit)
    };
    const changes: BackfillChange[] = [
      { id: "f3", field: "family_admin_mobile", from: "0449 922 425", to: "+61449922425", kind: "mobile", action: "normalize" },
    ];
    const { patch, skipped } = buildFamilyPatch(current, changes);
    expect(Object.keys(patch)).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].field).toBe("family_admin_mobile");
  });

  it("leaves sibling cc entries untouched when only one index is changed", () => {
    const current: FamilyRow = {
      id: "f4",
      family_sms_cc: [
        { to_name: "Alice", to_mobile: "0412000001" },
        { to_name: "Bob",   to_mobile: "0412000002" },
        { to_name: "Carol", to_mobile: "0412000003" },
      ],
    };
    const changes: BackfillChange[] = [
      { id: "f4", field: "family_sms_cc", index: 1, from: "0412000002", to: "+61412000002", kind: "mobile", action: "normalize" },
    ];
    const { patch, skipped } = buildFamilyPatch(current, changes);
    const cc = patch.family_sms_cc as { to_name?: string; to_mobile?: unknown }[];
    expect(cc[0]).toEqual({ to_name: "Alice", to_mobile: "0412000001" }); // untouched
    expect(cc[1].to_mobile).toBe("+61412000002");
    expect(cc[2]).toEqual({ to_name: "Carol", to_mobile: "0412000003" }); // untouched
    expect(skipped).toHaveLength(0);
  });

  it("skips a cc change whose from no longer matches current cc entry", () => {
    const current: FamilyRow = {
      id: "f5",
      family_sms_cc: [
        { to_name: "Mum", to_mobile: "+61412345678" }, // already updated
      ],
    };
    const changes: BackfillChange[] = [
      { id: "f5", field: "family_sms_cc", index: 0, from: "0412345678", to: "+61412345678", kind: "mobile", action: "normalize" },
    ];
    const { patch, skipped } = buildFamilyPatch(current, changes);
    expect(patch.family_sms_cc).toBeUndefined();
    expect(skipped).toHaveLength(1);
    expect(skipped[0].index).toBe(0);
  });
});
