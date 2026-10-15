// src/send/outbound.ts
import { TICKET_COLLECTION, MESSAGE_COLLECTION } from "../constants.js";

export type ItemsServiceLike = {
  readByQuery(q: unknown): Promise<any[]>;
  createOne(item: Record<string, unknown>): Promise<string | number>;
  updateOne(key: string | number, item: Record<string, unknown>): Promise<string | number>;
};

export type AppendOutboundDeps = {
  items: (collection: string) => ItemsServiceLike;
  now?: () => string;
};

export type AppendOutboundInput = {
  externalIdentity: string;
  ourIdentity: string;
  body: string;
  externalMessageId: string;
  client?: string | null;
  raw?: unknown;
};

export type AppendOutboundResult = {
  ticketId: string | number;
  messageId: string | number;
  createdTicket: boolean;
};

/**
 * Find the OPEN client_ticket for (external_identity, our_identity) or create one,
 * insert an `outbound` client_message keyed on the provider message id, and bump last_message_at.
 * Used by the send operation (origination=number) and by Plan 3's reply action.
 */
/**
 * True when an OPEN client_ticket already exists for (external_identity,
 * our_identity) — i.e. this send is continuing a conversation rather than
 * starting one. Used by the outreach path to decide whether an org signature
 * should be prepended when "first message only" mode is on.
 */
export async function hasOpenTicket(
  items: (collection: string) => ItemsServiceLike,
  externalIdentity: string,
  ourIdentity: string,
): Promise<boolean> {
  const open = await items(TICKET_COLLECTION).readByQuery({
    filter: {
      external_identity: { _eq: externalIdentity },
      our_identity: { _eq: ourIdentity },
      status: { _eq: "open" },
    },
    limit: 1,
  });
  return Array.isArray(open) && open.length > 0;
}

export async function appendOutboundMessage(
  input: AppendOutboundInput,
  deps: AppendOutboundDeps,
): Promise<AppendOutboundResult> {
  const now = deps.now ? deps.now() : new Date().toISOString();
  const tickets = deps.items(TICKET_COLLECTION);
  const messages = deps.items(MESSAGE_COLLECTION);

  const open = await tickets.readByQuery({
    filter: {
      external_identity: { _eq: input.externalIdentity },
      our_identity: { _eq: input.ourIdentity },
      status: { _eq: "open" },
    },
    limit: 1,
  });

  let ticketId: string | number;
  let createdTicket = false;

  if (Array.isArray(open) && open.length > 0) {
    ticketId = open[0].id;
    await tickets.updateOne(ticketId, { last_message_at: now });
  } else {
    // Guard against a race where two concurrent outbound sends for the same NEW conversation
    // both find no open ticket, then both attempt createOne. The DB partial unique index
    // (client_ticket_open_conversation_uq) causes the loser to throw a unique-constraint
    // error. Re-read the winner's ticket; if found, adopt it and continue without error.
    try {
      ticketId = await tickets.createOne({
        status: "open",
        channel: "sms",
        external_identity: input.externalIdentity,
        our_identity: input.ourIdentity,
        client: input.client ?? null,
        last_message_at: now,
      });
      createdTicket = true;
    } catch (ticketErr) {
      const raced = await tickets.readByQuery({
        filter: {
          external_identity: { _eq: input.externalIdentity },
          our_identity: { _eq: input.ourIdentity },
          status: { _eq: "open" },
        },
        limit: 1,
      });
      if (Array.isArray(raced) && raced.length > 0) {
        ticketId = raced[0].id;
        createdTicket = false;
        // Adopted the race winner's existing ticket: bump last_message_at for this send.
        await tickets.updateOne(ticketId, { last_message_at: now });
      } else {
        throw ticketErr;
      }
    }
  }

  const messageId = await messages.createOne({
    ticket: ticketId,
    direction: "outbound",
    channel: "sms",
    body: input.body,
    from_identity: input.ourIdentity,
    to_identity: input.externalIdentity,
    external_message_id: input.externalMessageId,
    delivery_status: "sent",
    raw: input.raw ?? null,
    timestamp: now,
  });

  return { ticketId, messageId, createdTicket };
}
