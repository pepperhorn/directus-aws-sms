// src/inbound/upsert.ts
import type { InboundSms, FamilyResolution, UpsertDeps, UpsertResult } from "./types.js";

export async function upsertInbound(
  sms: InboundSms,
  resolution: FamilyResolution,
  deps: UpsertDeps,
): Promise<UpsertResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const timestamp = now();

  // 1. Idempotency: if this provider message id already exists, do nothing.
  const existing = await deps.messages.readByQuery({
    filter: { external_message_id: { _eq: sms.inboundMessageId } },
    fields: ["id", "ticket"],
    limit: 1,
  });
  if (existing.length > 0) {
    return { ticketId: existing[0].ticket, messageCreated: false, ticketCreated: false };
  }

  // 2. Find the OPEN ticket for this conversation (counterpart + our number), else create.
  const open = await deps.tickets.readByQuery({
    filter: {
      external_identity: { _eq: sms.originationNumber },
      our_identity: { _eq: sms.destinationNumber },
      status: { _eq: "open" },
    },
    fields: ["id"],
    limit: 1,
  });

  let ticketId: string;
  let ticketCreated = false;
  if (open.length > 0) {
    ticketId = open[0].id;
  } else {
    ticketId = await deps.tickets.createOne({
      status: "open",
      channel: "sms",
      client: resolution.familyId, // null for 0/many matches (triage)
      external_identity: sms.originationNumber,
      our_identity: sms.destinationNumber,
      last_message_at: timestamp,
    });
    ticketCreated = true;
  }

  // 3. Insert the inbound message keyed on the unique external_message_id.
  //    Guard against a race-condition unique-violation: if two DLQ retries arrive
  //    concurrently, the pre-check (step 1) may both see no existing row, then one
  //    createOne wins and the other throws a unique-constraint error. In that case,
  //    re-read to confirm the duplicate exists and return a non-error result.
  try {
    await deps.messages.createOne({
      ticket: ticketId,
      direction: "inbound",
      channel: "sms",
      body: sms.messageBody,
      from_identity: sms.originationNumber,
      to_identity: sms.destinationNumber,
      external_message_id: sms.inboundMessageId,
      delivery_status: null,
      raw: sms,
      timestamp,
    });
  } catch (err) {
    const dup = await deps.messages.readByQuery({
      filter: { external_message_id: { _eq: sms.inboundMessageId } },
      fields: ["id", "ticket"],
      limit: 1,
    });
    if (dup.length > 0) {
      return { ticketId: dup[0].ticket, messageCreated: false, ticketCreated };
    }
    throw err;
  }

  // 4. Bump last_message_at (skip the redundant write on a just-created ticket).
  if (!ticketCreated) {
    await deps.tickets.updateOne(ticketId, { last_message_at: timestamp });
  }

  return { ticketId, messageCreated: true, ticketCreated };
}
