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

      if (!collections[TICKET_COLLECTION]) await collectionsService.createOne(ticketCollectionPayload);
      if (!collections[MESSAGE_COLLECTION]) await collectionsService.createOne(messageCollectionPayload);

      // Relations require both collections to exist; create any that are missing.
      // Always run this loop (cheap, guarded by hasRelation) so a boot that aborted
      // partway through relation creation can still complete on a later boot.
      const freshSchema = await getSchema();
      const relationsService = new RelationsService({ schema: freshSchema, knex: database });
      const existingRelations: any[] = (freshSchema as any)?.relations ?? [];
      const hasRelation = (collection: string, field: string) =>
        existingRelations.some((r) => r.collection === collection && r.field === field);
      for (const rel of ticketingRelations) {
        if (!hasRelation(rel.collection, rel.field)) await relationsService.createOne(rel);
      }
      logger.info(`Created ticketing collections "${TICKET_COLLECTION}" / "${MESSAGE_COLLECTION}".`);
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
