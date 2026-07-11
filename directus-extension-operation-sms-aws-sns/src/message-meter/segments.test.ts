import { describe, it, expect } from "vitest";
import {
  smsMetrics,
  composeEffectiveMessage,
  hasTemplateVars,
} from "./segments.js";
import { FOOTER } from "../constants.js";

describe("smsMetrics — GSM-7", () => {
  it("counts plain text as GSM-7, one segment", () => {
    const m = smsMetrics("Hello there");
    expect(m.encoding).toBe("GSM-7");
    expect(m.length).toBe(11);
    expect(m.segments).toBe(1);
    expect(m.singleLimit).toBe(160);
  });

  it("empty string is zero segments", () => {
    expect(smsMetrics("").segments).toBe(0);
  });

  it("160 GSM-7 chars = 1 segment, 161 = 2", () => {
    expect(smsMetrics("a".repeat(160)).segments).toBe(1);
    const two = smsMetrics("a".repeat(161));
    expect(two.segments).toBe(2);
    expect(two.perSegment).toBe(153);
  });

  it("counts GSM-7 extended chars (€, {, }) as two", () => {
    const m = smsMetrics("€"); // one extended char
    expect(m.encoding).toBe("GSM-7");
    expect(m.length).toBe(2);
  });
});

describe("smsMetrics — UCS-2", () => {
  it("a single emoji forces UCS-2 with a 70-char limit", () => {
    const m = smsMetrics("hi 😀");
    expect(m.encoding).toBe("UCS-2");
    expect(m.singleLimit).toBe(70);
    expect(m.forcedUnicodeBy).toBe("😀");
  });

  it("a curly quote forces UCS-2", () => {
    expect(smsMetrics("it’s").encoding).toBe("UCS-2");
  });

  it("70 UCS-2 chars = 1 segment, 71 = 2 (67/seg)", () => {
    // Use a non-GSM char to force UCS-2, then pad.
    const base = "’"; // 1 code unit, non-GSM
    expect(smsMetrics(base + "a".repeat(69)).segments).toBe(1); // 70
    const two = smsMetrics(base + "a".repeat(70)); // 71
    expect(two.segments).toBe(2);
    expect(two.perSegment).toBe(67);
  });
});

describe("composeEffectiveMessage", () => {
  it("two-way path: prefixes signature and suffixes footer (worst case)", () => {
    expect(
      composeEffectiveMessage("See you at 3pm", {
        origination: "number",
        signature: "CRF Schools",
        footer: "Reply STOP",
      }),
    ).toBe("CRF Schools: See you at 3pm -- Reply STOP");
  });

  it("two-way path with no signature/footer is just the body", () => {
    expect(composeEffectiveMessage("hi", { origination: "number" })).toBe("hi");
  });

  it("senderId path appends the automatic do-not-reply footer", () => {
    expect(composeEffectiveMessage("hi", { origination: "senderId" })).toBe("hi" + FOOTER);
  });

  it("the composed length is what the meter should measure", () => {
    const composed = composeEffectiveMessage("a".repeat(150), {
      origination: "senderId",
    });
    // 150 body + FOOTER pushes past 160 → 2 segments
    expect(smsMetrics(composed).segments).toBe(2);
  });
});

describe("hasTemplateVars", () => {
  it("detects {{ }} variables", () => {
    expect(hasTemplateVars("code {{ trigger.payload.code }}")).toBe(true);
  });
  it("is false for plain text", () => {
    expect(hasTemplateVars("no vars here")).toBe(false);
  });
});
