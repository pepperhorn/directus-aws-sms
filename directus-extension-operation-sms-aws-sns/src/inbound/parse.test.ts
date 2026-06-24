// src/inbound/parse.test.ts
import { describe, it, expect } from "vitest";
import { parseSnsEnvelope, parseInboundSms } from "./parse.js";

const innerPayload = JSON.stringify({
  originationNumber: "+61412345678",
  destinationNumber: "+61480000000",
  messageBody: "Yes please",
  inboundMessageId: "inbound-abc-123",
  previousPublishedMessageId: "outbound-xyz-789",
});

describe("parseSnsEnvelope", () => {
  it("accepts a Notification with Type + Message", () => {
    const env = parseSnsEnvelope({ Type: "Notification", Message: innerPayload, MessageId: "m" });
    expect(env?.Type).toBe("Notification");
    expect(env?.Message).toBe(innerPayload);
  });
  it("accepts a SubscriptionConfirmation and exposes SubscribeURL", () => {
    const env = parseSnsEnvelope({ Type: "SubscriptionConfirmation", Message: "x", SubscribeURL: "https://sns/confirm" });
    expect(env?.SubscribeURL).toBe("https://sns/confirm");
  });
  it("returns null for a non-object or missing fields", () => {
    expect(parseSnsEnvelope("not json")).toBeNull();
    expect(parseSnsEnvelope({ Type: "Notification" })).toBeNull();
    expect(parseSnsEnvelope(null)).toBeNull();
  });
});

describe("parseInboundSms", () => {
  it("extracts the AWS End User Messaging fields", () => {
    expect(parseInboundSms(innerPayload)).toEqual({
      originationNumber: "+61412345678",
      destinationNumber: "+61480000000",
      messageBody: "Yes please",
      inboundMessageId: "inbound-abc-123",
      previousPublishedMessageId: "outbound-xyz-789",
    });
  });
  it("defaults previousPublishedMessageId to null when absent", () => {
    const body = JSON.stringify({
      originationNumber: "+61412345678", destinationNumber: "+61480000000",
      messageBody: "Hi", inboundMessageId: "id-1",
    });
    expect(parseInboundSms(body)?.previousPublishedMessageId).toBeNull();
  });
  it("returns null when a required field is missing", () => {
    const body = JSON.stringify({ originationNumber: "+61412345678", messageBody: "Hi" });
    expect(parseInboundSms(body)).toBeNull();
  });
  it("returns null on unparseable inner JSON", () => {
    expect(parseInboundSms("{not json")).toBeNull();
  });
  it("treats an empty messageBody as valid (empty replies happen)", () => {
    const body = JSON.stringify({
      originationNumber: "+61412345678", destinationNumber: "+61480000000",
      messageBody: "", inboundMessageId: "id-2",
    });
    expect(parseInboundSms(body)?.messageBody).toBe("");
  });
});
