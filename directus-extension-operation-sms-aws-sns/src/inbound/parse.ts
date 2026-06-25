// src/inbound/parse.ts
import type { SnsEnvelope, InboundSms } from "./types.js";

export function parseSnsEnvelope(body: unknown): SnsEnvelope | null {
  if (body === null || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.Type !== "string" || typeof b.Message !== "string") return null;
  return b as SnsEnvelope;
}

export function parseInboundSms(envelopeMessage: string): InboundSms | null {
  let inner: Record<string, unknown>;
  try {
    inner = JSON.parse(envelopeMessage) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (inner === null || typeof inner !== "object") return null;

  const originationNumber = inner.originationNumber;
  const destinationNumber = inner.destinationNumber;
  const messageBody = inner.messageBody;
  const inboundMessageId = inner.inboundMessageId;

  if (
    typeof originationNumber !== "string" ||
    typeof destinationNumber !== "string" ||
    typeof messageBody !== "string" ||
    typeof inboundMessageId !== "string"
  ) {
    return null;
  }

  const prev = inner.previousPublishedMessageId;
  return {
    originationNumber,
    destinationNumber,
    messageBody,
    inboundMessageId,
    previousPublishedMessageId: typeof prev === "string" ? prev : null,
  };
}
