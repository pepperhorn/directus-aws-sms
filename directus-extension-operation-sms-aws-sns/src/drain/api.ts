// src/drain/api.ts
import { defineOperationApi } from "@directus/extensions-sdk";
import { SQSClient } from "@aws-sdk/client-sqs";
import { resolveAwsConfig } from "../config.js";
import { TICKET_COLLECTION, MESSAGE_COLLECTION, FAMILY_COLLECTION } from "../constants.js";
import { parseSnsEnvelope, parseInboundSms } from "../inbound/parse.js";
import { resolveFamily } from "../inbound/resolve-family.js";
import { upsertInbound } from "../inbound/upsert.js";
import { drainDlq } from "./drain.js";
import type { FamilyMatchRow, UpsertDeps } from "../inbound/types.js";

export type Options = { queueUrl?: string; maxMessages?: number; waitTimeSeconds?: number };

export default defineOperationApi<Options>({
  id: "sms-dlq-drain",
  handler: async ({ queueUrl, maxMessages, waitTimeSeconds }, ctx) => {
    const { services, getSchema, env, accountability, logger, database } = ctx as any;
    const { ItemsService } = services;

    const url = queueUrl ?? env.SMS_AWS_DLQ_URL;
    if (!url) throw new Error("DLQ queue URL not set. Provide queueUrl option or SMS_AWS_DLQ_URL env var.");

    const cfg = await resolveAwsConfig({ env, services, getSchema, accountability });
    const sqs = new SQSClient({
      region: cfg.region,
      credentials: cfg.accessKeyId && cfg.secretAccessKey
        ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
        : undefined, // fall back to the host's default credential chain
    });

    // processOne mirrors the endpoint's Notification path, reusing the same upsert adapter.
    const processOne = async (snsBody: unknown): Promise<void> => {
      const envelope = parseSnsEnvelope(snsBody);
      if (!envelope || envelope.Type !== "Notification") {
        logger.warn(
          `[sms-dlq-drain] Discarding DLQ message with non-Notification envelope (Type=${envelope?.Type ?? "unknown"}); message will be deleted.`
        );
        return; // non-notifications: nothing to do, delete
      }
      const sms = parseInboundSms(envelope.Message);
      if (!sms) {
        logger.warn(
          "[sms-dlq-drain] Discarding DLQ message: inbound SMS payload could not be parsed; message will be deleted."
        );
        return; // unprocessable payload: delete rather than loop forever
      }
      const schema = await getSchema();
      const families: FamilyMatchRow[] = await new ItemsService(FAMILY_COLLECTION, { schema, accountability: null })
        .readByQuery({ fields: ["id", "family_admin_mobile", "family_sms_cc"], limit: -1 });
      const resolution = resolveFamily(sms.originationNumber, families);
      const deps: UpsertDeps = {
        tickets: new ItemsService(TICKET_COLLECTION, { schema, accountability: null, knex: database }),
        messages: new ItemsService(MESSAGE_COLLECTION, { schema, accountability: null, knex: database }),
      };
      await upsertInbound(sms, resolution, deps);
    };

    const result = await drainDlq({
      sqs, queueUrl: url, processOne,
      maxMessages, waitTimeSeconds, logger,
    });
    return result;
  },
});
