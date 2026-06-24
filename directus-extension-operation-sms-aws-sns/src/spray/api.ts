// src/spray/api.ts
import { defineOperationApi } from "@directus/extensions-sdk";
import { resolveAwsConfig } from "../config.js";
import { sendSms } from "../send/provider.js";
import { appendOutboundMessage, type ItemsServiceLike } from "../send/outbound.js";
import {
  planSpray,
  summarizeSpray,
  type SprayFamilyRow,
  type SpraySendResult,
} from "./plan.js";

export type Options = {
  message: string;
  smsType: "Transactional" | "Promotional";
};

export default defineOperationApi<Options>({
  id: "sms-spray",
  handler: async (
    { message, smsType },
    { env, services, getSchema, accountability, logger }
  ) => {
    if (typeof message !== "string" || message.trim().length === 0) {
      throw new Error("Message body is required");
    }

    const config = await resolveAwsConfig({
      env: env as Record<string, string | undefined>,
      services,
      getSchema,
      accountability,
    });

    const { ItemsService } = services as any;
    const schema = await getSchema();
    const families = new ItemsService("family", { schema, accountability });

    const rows: SprayFamilyRow[] = await families.readByQuery({
      fields: ["id", "family_sms_option", "family_admin_mobile"],
      limit: -1,
    });

    const { recipients, skipped } = planSpray(rows);

    const items = (collection: string): ItemsServiceLike =>
      new ItemsService(collection, { schema, accountability });

    const results: SpraySendResult[] = [];
    for (const r of recipients) {
      try {
        const sent = await sendSms(
          { to: r.to, message, origination: "senderId", smsType },
          config
        );
        // Per-recipient audit row (Decision 2). our_identity = the Sender ID we sent from.
        await appendOutboundMessage(
          {
            externalIdentity: r.to,
            ourIdentity: sent.from || (config.senderId ?? ""),
            body: message,
            externalMessageId: sent.messageId,
            client: r.familyId,
          },
          { items }
        );
        results.push({ familyId: r.familyId, to: r.to, status: "sent", messageId: sent.messageId });
      } catch (err) {
        const e = err as { name?: string; message?: string };
        const msg = `${e.name ?? "Error"}: ${e.message ?? String(err)}`;
        logger.error(`Spray send failed for family ${r.familyId} (${r.to}): ${msg}`);
        results.push({ familyId: r.familyId, to: r.to, status: "failed", error: msg });
      }
    }

    const summary = summarizeSpray(results);
    logger.info(
      `Spray complete: ${summary.sent} sent, ${summary.failed} failed, ${skipped.length} skipped.`
    );
    return { summary, skipped, results };
  },
});
