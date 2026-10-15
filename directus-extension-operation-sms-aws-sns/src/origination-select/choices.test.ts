import { describe, it, expect } from "vitest";
import { originationChoices, isConfiguredNumber } from "./choices.js";

describe("originationChoices", () => {
  it("always offers Sender ID as enabled", () => {
    for (const configured of [true, false]) {
      const senderId = originationChoices(configured).find((c) => c.value === "senderId");
      expect(senderId).toBeDefined();
      expect(senderId!.disabled).toBe(false);
    }
  });

  it("enables the two-way option when a two-way number is configured", () => {
    const number = originationChoices(true).find((c) => c.value === "number")!;
    expect(number.disabled).toBe(false);
    expect(number.text).not.toMatch(/not configured/i);
  });

  it("disables the two-way option and explains why when not configured", () => {
    const number = originationChoices(false).find((c) => c.value === "number")!;
    expect(number.disabled).toBe(true);
    expect(number.text).toMatch(/not configured/i);
  });
});

describe("isConfiguredNumber", () => {
  it("is true for a non-empty string", () => {
    expect(isConfiguredNumber("+61481076512")).toBe(true);
  });

  it("is false for empty, whitespace, null, undefined, and non-strings", () => {
    expect(isConfiguredNumber("")).toBe(false);
    expect(isConfiguredNumber("   ")).toBe(false);
    expect(isConfiguredNumber(null)).toBe(false);
    expect(isConfiguredNumber(undefined)).toBe(false);
    expect(isConfiguredNumber(12345)).toBe(false);
  });
});
