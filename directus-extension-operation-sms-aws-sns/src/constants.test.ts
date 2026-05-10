import { describe, it, expect } from "vitest";
import { FOOTER, E164_REGEX, SETTINGS_COLLECTION } from "./constants.js";

describe("FOOTER", () => {
  it("is exactly the no-reply footer with two leading newlines", () => {
    expect(FOOTER).toBe("\n\n(do not reply)");
  });

  it("is 16 characters", () => {
    expect(FOOTER.length).toBe(16);
  });
});

describe("E164_REGEX", () => {
  it("accepts a US-style E.164 number", () => {
    expect(E164_REGEX.test("+15551234567")).toBe(true);
  });

  it("accepts a UK E.164 number", () => {
    expect(E164_REGEX.test("+447700900123")).toBe(true);
  });

  it("rejects a number without leading +", () => {
    expect(E164_REGEX.test("15551234567")).toBe(false);
  });

  it("rejects a number starting with +0", () => {
    expect(E164_REGEX.test("+05551234567")).toBe(false);
  });

  it("rejects a number with hyphens", () => {
    expect(E164_REGEX.test("+1-555-123-4567")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(E164_REGEX.test("")).toBe(false);
  });

  it("rejects a 17-digit number (over E.164 max of 15)", () => {
    expect(E164_REGEX.test("+12345678901234567")).toBe(false);
  });
});

describe("SETTINGS_COLLECTION", () => {
  it("is the singleton collection name", () => {
    expect(SETTINGS_COLLECTION).toBe("sms_settings");
  });
});
