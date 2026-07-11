import { defineOperationApi } from "@directus/extensions-sdk";
import { resolveAwsConfig } from "../config.js";
import { sendSms, type Origination } from "../send/provider.js";
import { appendOutboundMessage, type ItemsServiceLike } from "../send/outbound.js";
import { applyOrgSignature } from "../send/signature.js";

export type Options = {
  to: string;
  message: string;
  smsType: "Transactional" | "Promotional";
  origination?: Origination;
};

export type Result = {
  messageId: string;
  to: string;
  from: string;
  origination: Origination;
  ticketId?: string | number;
  clientMessageId?: string | number;
};

export default defineOperationApi<Options>({
  id: "sms-aws-sns",
  handler: async (
    { to, message, smsType, origination },
    { env, services, getSchema, accountability, logger }
  ) => {
    const route: Origination = origination === "number" ? "number" : "senderId";

    const config = await resolveAwsConfig({
      env: env as Record<string, string | undefined>,
      services,
      getSchema,
      accountability,
    });

    // Two-way outreach originates from the bare long code (no alphanumeric Sender
    // ID possible), so the org identity is carried in the message text. Replies
    // (reply/api.ts) are intentionally left unsigned. The senderId/spray path
    // already brands via the Sender ID, so it is never signed here.
    const outgoing =
      route === "number" ? applyOrgSignature(message, config.orgSignature) : message;

    let sent;
    try {
      sent = await sendSms({ to, message: outgoing, origination: route, smsType }, config);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      logger.error(
        `SMS send failed (${route}): ${e.name ?? "Error"}: ${e.message ?? String(err)}`
      );
      throw err;
    }

    const result: Result = {
      messageId: sent.messageId,
      to: sent.to,
      from: sent.from,
      origination: route,
    };

    if (route === "number") {
      const { ItemsService } = services as any;
      const schema = await getSchema();
      const items = (collection: string): ItemsServiceLike =>
        new ItemsService(collection, { schema, accountability });
      const written = await appendOutboundMessage(
        {
          externalIdentity: sent.to,
          ourIdentity: sent.from,
          body: outgoing,
          externalMessageId: sent.messageId,
        },
        { items }
      );
      result.ticketId = written.ticketId;
      result.clientMessageId = written.messageId;
    }

    return result;
  },
});
