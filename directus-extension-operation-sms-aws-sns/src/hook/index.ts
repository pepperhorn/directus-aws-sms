import { defineHook } from "@directus/extensions-sdk";
import { SETTINGS_COLLECTION, TICKET_COLLECTION, MESSAGE_COLLECTION } from "../constants.js";
import { ticketCollectionPayload, messageCollectionPayload, ticketingRelations } from "./ticketing-schema.js";

export default defineHook(({ init }, { services, getSchema, logger, database }) => {
  init("app.before", async () => {
    const { CollectionsService, ItemsService, RelationsService } = services as any;

    const ensureSettings = async (schema: any) => {
      const collections = schema?.collections ?? {};
      if (collections[SETTINGS_COLLECTION]) return;
      const collectionsService = new CollectionsService({ schema, knex: database });
      await collectionsService.createOne({
        collection: SETTINGS_COLLECTION,
        meta: { singleton: true, icon: "sms", note: "AWS SNS credentials used by the Send SMS operation. Env vars override these values." },
        schema: { name: SETTINGS_COLLECTION },
        fields: [
          { field: "id", type: "integer", meta: { hidden: true, interface: "input", readonly: true }, schema: { is_primary_key: true, has_auto_increment: true } },
          { field: "aws_region", type: "string", meta: { interface: "input", width: "half", note: "AWS region, e.g. us-east-1" }, schema: { default_value: "us-east-1" } },
          { field: "aws_access_key_id", type: "string", meta: { interface: "input", width: "half", note: "Stored plaintext. Prefer SMS_AWS_ACCESS_KEY_ID env var in production." } },
          { field: "aws_secret_access_key", type: "string", meta: { interface: "input", width: "full", special: ["conceal"], note: "Stored plaintext. Prefer SMS_AWS_SECRET_ACCESS_KEY env var in production." } },
          { field: "aws_sns_sender_id", type: "string", meta: { interface: "input", width: "half", note: "Optional alphanumeric Sender ID (where supported by destination country)." } },
          { field: "aws_two_way_number", type: "string", meta: { interface: "input", width: "half", note: "E.164 two-way number for conversational sends (AWS End User Messaging origination identity). Prefer SMS_AWS_TWO_WAY_NUMBER env var in production." } },
        ],
      });
      const freshSchema = await getSchema();
      const items = new ItemsService(SETTINGS_COLLECTION, { schema: freshSchema, accountability: null });
      await items.upsertSingleton({});
      logger.info(`Created singleton collection "${SETTINGS_COLLECTION}".`);
    };

    const ensureTicketing = async (schema: any) => {
      const collections = schema?.collections ?? {};
      const collectionsService = new CollectionsService({ schema, knex: database });
      let didWork = false;

      if (!collections[TICKET_COLLECTION]) { await collectionsService.createOne(ticketCollectionPayload); didWork = true; }
      if (!collections[MESSAGE_COLLECTION]) { await collectionsService.createOne(messageCollectionPayload); didWork = true; }

      // Relations require both collections to exist; create any that are missing.
      // Always run this loop (cheap, guarded by hasRelation) so a boot that aborted
      // partway through relation creation can still complete on a later boot.
      const freshSchema = await getSchema();
      const relationsService = new RelationsService({ schema: freshSchema, knex: database });
      const existingRelations: any[] = (freshSchema as any)?.relations ?? [];
      const hasRelation = (collection: string, field: string) =>
        existingRelations.some((r) => r.collection === collection && r.field === field);
      for (const rel of ticketingRelations) {
        if (!hasRelation(rel.collection, rel.field)) { await relationsService.createOne(rel); didWork = true; }
      }
      if (didWork) logger.info(`Created ticketing collections "${TICKET_COLLECTION}" / "${MESSAGE_COLLECTION}".`);

      // Ensure a partial unique index that prevents two open tickets for the same conversation.
      // Postgres and SQLite support partial unique indexes; MySQL does NOT — skip with a warn.
      try {
        const dbClient: string = (database as any)?.client?.config?.client ?? "";
        if (/pg|postgres|sqlite/i.test(dbClient)) {
          const indexName = "client_ticket_open_conversation_uq";
          await (database as any).raw(
            `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${TICKET_COLLECTION} (external_identity, our_identity) WHERE status = 'open'`,
          );
          logger.info(`Ensured partial unique index "${indexName}" on "${TICKET_COLLECTION}".`);
        } else {
          logger.warn(
            `SMS extension: skipping partial unique index on "${TICKET_COLLECTION}" — engine "${dbClient}" does not support partial indexes. ` +
            `Without this index, concurrent new-conversation events could create duplicate open tickets.`,
          );
        }
      } catch (idxErr) {
        const idxMsg = idxErr instanceof Error ? idxErr.message : String(idxErr);
        logger.warn(
          `SMS extension: could not create partial unique index on "${TICKET_COLLECTION}" (${idxMsg}). ` +
          `Without this index, concurrent new-conversation events could create duplicate open tickets.`,
        );
      }
    };

    try {
      await ensureSettings(await getSchema());
      await ensureTicketing(await getSchema());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`SMS extension bootstrap failed: ${msg}`);
    }
  });
});
