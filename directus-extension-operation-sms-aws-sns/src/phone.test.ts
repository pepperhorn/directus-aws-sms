import { describe, it, expect } from "vitest";
import { normalizeAuMobile } from "./phone.js";

describe("normalizeAuMobile", () => {
  it("normalizes local 04xx mobile to +614 E.164", () => {
    expect(normalizeAuMobile("0449 922 425")).toEqual({ e164: "+61449922425", kind: "mobile" });
  });

  it("accepts already-international +61 mobile", () => {
    expect(normalizeAuMobile("+61449922425")).toEqual({ e164: "+61449922425", kind: "mobile" });
  });

  it("accepts 61... and 0061... mobile prefixes", () => {
    expect(normalizeAuMobile("61449922425")).toEqual({ e164: "+61449922425", kind: "mobile" });
    expect(normalizeAuMobile("0061449922425")).toEqual({ e164: "+61449922425", kind: "mobile" });
  });

  it("strips spaces, hyphens, parens, dots", () => {
    expect(normalizeAuMobile("(04) 4992-2425")).toEqual({ e164: "+61449922425", kind: "mobile" });
  });

  it("flags 03 landline numbers as landline with no e164", () => {
    expect(normalizeAuMobile("03 9123 4567")).toEqual({ e164: null, kind: "landline" });
  });

  it("flags 02/07/08 landlines as landline", () => {
    expect(normalizeAuMobile("0291234567").kind).toBe("landline");
    expect(normalizeAuMobile("0712345678").kind).toBe("landline");
    expect(normalizeAuMobile("0812345678").kind).toBe("landline");
  });

  it("treats null/empty/whitespace as empty", () => {
    expect(normalizeAuMobile(null)).toEqual({ e164: null, kind: "empty" });
    expect(normalizeAuMobile("")).toEqual({ e164: null, kind: "empty" });
    expect(normalizeAuMobile("   ")).toEqual({ e164: null, kind: "empty" });
  });

  it("treats garbage and wrong-length input as unknown", () => {
    expect(normalizeAuMobile("not a phone")).toEqual({ e164: null, kind: "unknown" });
    expect(normalizeAuMobile("041234")).toEqual({ e164: null, kind: "unknown" });
  });

  it("treats a non-AU +country number as unknown (out of AU scope)", () => {
    expect(normalizeAuMobile("+15551234567")).toEqual({ e164: "+15551234567", kind: "unknown" });
  });
});
