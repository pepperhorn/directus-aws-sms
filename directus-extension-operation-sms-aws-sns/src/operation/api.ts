import { defineOperationApi } from "@directus/extensions-sdk";
import { resolveAwsConfig } from "../config.js";
import { sendSms, type Origination } from "../send/provider.js";
import {
  appendOutboundMessage,
  hasOpenTicket,
  type ItemsServiceLike,
} from "../send/outbound.js";
import { applyOrgSignature, applyFooter } from "../send/signature.js";

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
    // already brands via the Sender ID, so it is neither signed nor footed here.
    let outgoing = message;
    // Built once for the two-way path — reused by the "first message only" check
    // and by the outbound ticket write below.
    let items: ((collection: string) => ItemsServiceLike) | undefined;

    if (route === "number") {
      const { ItemsService } = services as any;
      const schema = await getSchema();
      items = (collection: string): ItemsServiceLike =>
        new ItemsService(collection, { schema, accountability });

      // Footer applies to every outreach message when configured.
      outgoing = applyFooter(outgoing, config.orgFooter);

      // Signature: every outreach message, or only the first of a conversation
      // (no open ticket yet) when the first-only toggle is on.
      if (config.orgSignature) {
        let sign = true;
        if (config.orgSignatureFirstOnly && config.twoWayNumber) {
          sign = !(await hasOpenTicket(items, to, config.twoWayNumber));
        }
        if (sign) outgoing = applyOrgSignature(outgoing, config.orgSignature);
      }
    }

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

    if (route === "number" && items) {
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
