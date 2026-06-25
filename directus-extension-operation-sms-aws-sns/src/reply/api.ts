import { defineOperationApi } from "@directus/extensions-sdk";
import { TICKET_COLLECTION } from "../constants.js";
import { resolveAwsConfig } from "../config.js";
import { sendSms } from "../send/provider.js";
import { appendOutboundMessage, type ItemsServiceLike } from "../send/outbound.js";

export type Options = { ticketId?: string; body?: string };

export default defineOperationApi<Options>({
  id: "sms-ticket-reply",
  handler: async ({ ticketId, body }, ctx) => {
    const { services, getSchema, accountability, env } = ctx as any;
    const { ItemsService } = services;

    if (!ticketId) throw new Error("sms-ticket-reply: ticketId is required.");
    if (typeof body !== "string" || body.trim() === "") throw new Error("sms-ticket-reply: body is required.");

    const schema = await getSchema();
    const tickets = new ItemsService(TICKET_COLLECTION, { schema, accountability });
    const ticket = await tickets.readOne(ticketId, {
      fields: ["id", "external_identity", "our_identity", "client", "status"],
    });
    if (!ticket?.external_identity) throw new Error(`sms-ticket-reply: ticket ${ticketId} has no external_identity.`);
    if (!ticket?.our_identity) throw new Error(`sms-ticket-reply: ticket ${ticketId} has no our_identity (cannot choose origination number).`);

    // Reply ALWAYS originates from the ticket's our_identity (Decision 5, N-number capable):
    // override twoWayNumber on the resolved config so sendSms's `number` path sends from this ticket's number.
    const baseConfig = await resolveAwsConfig({ env, services, getSchema, accountability });
    const config = { ...baseConfig, twoWayNumber: ticket.our_identity };

    const sent = await sendSms({ to: ticket.external_identity, message: body, origination: "number" }, config);

    const items = (collection: string): ItemsServiceLike =>
      new ItemsService(collection, { schema, accountability });
    const written = await appendOutboundMessage(
      {
        externalIdentity: ticket.external_identity,
        ourIdentity: ticket.our_identity,
        body,
        externalMessageId: sent.messageId,
        client: ticket.client ?? null,
      },
      { items },
    );

    return { ticketId: written.ticketId, messageId: sent.messageId, to: ticket.external_identity, from: ticket.our_identity };
  },
});
