// src/inbound/index.ts
import { defineEndpoint } from "@directus/extensions-sdk";
import { TICKET_COLLECTION, MESSAGE_COLLECTION } from "../constants.js";
import { verifySnsSignature, type SnsMessage } from "./sns-verify.js";
import { parseSnsEnvelope, parseInboundSms } from "./parse.js";
import { resolveFamily } from "./resolve-family.js";
import { upsertInbound } from "./upsert.js";
import type { FamilyMatchRow, UpsertDeps } from "./types.js";

// Fetch helper kept here (not in the verifier) so the verifier stays offline-testable.
const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
};

export default defineEndpoint((router, { services, getSchema, logger, database }) => {
  const { ItemsService } = services as any;

  // express.json() may already have parsed the body; SNS posts text/plain, so accept both.
  router.post("/", async (req: any, res: any) => {
    let msg: SnsMessage;
    try {
      msg = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (msg === null || typeof msg !== "object") throw new Error("non-object body");
    } catch {
      logger.warn("SMS inbound: unparseable SNS body, rejecting.");
      return res.status(400).send("bad request");
    }

    // 1. SECURITY BOUNDARY: verify the SNS signature before any side effect.
    const verified = await verifySnsSignature(msg, { fetchCert: fetchText });
    if (!verified) {
      logger.warn("SMS inbound: SNS signature verification FAILED, rejecting.");
      return res.status(403).send("forbidden");
    }

    const envelope = parseSnsEnvelope(msg);
    if (!envelope) return res.status(200).send("ok"); // verified but shapeless — ack, log nothing actionable

    // 2. Subscription handshake.
    if (envelope.Type === "SubscriptionConfirmation") {
      if (typeof envelope.SubscribeURL === "string") {
        try {
          await fetchText(envelope.SubscribeURL);
          logger.info("SMS inbound: confirmed SNS subscription.");
        } catch (err) {
          logger.error(`SMS inbound: SubscribeURL confirm failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return res.status(200).send("ok");
    }

    if (envelope.Type !== "Notification") {
      logger.info(`SMS inbound: ignoring SNS message type "${envelope.Type}".`);
      return res.status(200).send("ok");
    }

    // 3. Parse the inner AWS End User Messaging payload.
    const sms = parseInboundSms(envelope.Message);
    if (!sms) {
      // Malformed inner payload we can never process: ack so SNS stops retrying.
      logger.warn("SMS inbound: unparseable inbound payload, acking to stop retries.");
      return res.status(200).send("ok");
    }

    try {
      const schema = await getSchema();
      // 4. Resolve family.
      const families: FamilyMatchRow[] = await new ItemsService("family", { schema, accountability: null })
        .readByQuery({ fields: ["id", "family_admin_mobile", "family_sms_cc"], limit: -1 });
      const resolution = resolveFamily(sms.originationNumber, families);
      if (resolution.matchCount > 1) {
        logger.warn(`SMS inbound: ${sms.originationNumber} matched ${resolution.matchCount} families ${JSON.stringify(resolution.matchedFamilyIds)} — leaving client=null for staff disambiguation.`);
      }

      // 5. Idempotent upsert through the shared adapter.
      const deps: UpsertDeps = {
        tickets: new ItemsService(TICKET_COLLECTION, { schema, accountability: null, knex: database }),
        messages: new ItemsService(MESSAGE_COLLECTION, { schema, accountability: null, knex: database }),
      };
      const result = await upsertInbound(sms, resolution, deps);
      logger.info(`SMS inbound: ${sms.inboundMessageId} → ticket ${result.ticketId} (ticketCreated=${result.ticketCreated}, messageCreated=${result.messageCreated}).`);
      return res.status(200).send("ok");
    } catch (err) {
      // A unique-violation on external_message_id (racing retry) is a benign duplicate → ack.
      const msgText = err instanceof Error ? err.message : String(err);
      if (/unique|duplicate/i.test(msgText)) {
        logger.info(`SMS inbound: duplicate ${sms.inboundMessageId} (unique violation) — acking.`);
        return res.status(200).send("ok");
      }
      // Genuine failure (DB down mid-deploy): 5xx so SNS retries / DLQ captures it.
      logger.error(`SMS inbound: processing failed, returning 503 for SNS retry: ${msgText}`);
      return res.status(503).send("unavailable");
    }
  });
});
