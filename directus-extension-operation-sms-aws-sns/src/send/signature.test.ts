import { describe, it, expect } from "vitest";
import { applyOrgSignature } from "./signature.js";

describe("applyOrgSignature", () => {
  it("prepends the signature with a colon separator", () => {
    expect(applyOrgSignature("This is a test", "CRF Schools")).toBe(
      "CRF Schools: This is a test",
    );
  });

  it("returns the message unchanged when signature is undefined", () => {
    expect(applyOrgSignature("hi", undefined)).toBe("hi");
  });

  it("returns the message unchanged when signature is empty or whitespace", () => {
    expect(applyOrgSignature("hi", "")).toBe("hi");
    expect(applyOrgSignature("hi", "   ")).toBe("hi");
  });

  it("trims surrounding whitespace on the signature", () => {
    expect(applyOrgSignature("hi", "  CRF Schools  ")).toBe("CRF Schools: hi");
  });

  it("is idempotent: does not double-prepend an already-signed message", () => {
    const once = applyOrgSignature("hi", "CRF Schools");
    expect(applyOrgSignature(once, "CRF Schools")).toBe("CRF Schools: hi");
  });

  it("does not treat a different leading text as an existing signature", () => {
    expect(applyOrgSignature("Schools: hi", "CRF Schools")).toBe(
      "CRF Schools: Schools: hi",
    );
  });
});
