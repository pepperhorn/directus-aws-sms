import { defineHook } from "@directus/extensions-sdk";
import { SETTINGS_COLLECTION } from "../constants.js";

export default defineHook(({ init }, { services, getSchema, logger, database }) => {
  init("app.before", async () => {
    try {
      const schema = await getSchema();
      const collections = (schema as any)?.collections ?? {};
      if (collections[SETTINGS_COLLECTION]) {
        return;
      }

      const { CollectionsService, ItemsService } = services as any;
      const collectionsService = new CollectionsService({
        schema,
        knex: database,
      });

      await collectionsService.createOne({
        collection: SETTINGS_COLLECTION,
        meta: {
          singleton: true,
          icon: "sms",
          note: "AWS SNS credentials used by the Send SMS operation. Env vars override these values.",
        },
        schema: { name: SETTINGS_COLLECTION },
        fields: [
          {
            field: "id",
            type: "integer",
            meta: { hidden: true, interface: "input", readonly: true },
            schema: { is_primary_key: true, has_auto_increment: true },
          },
          {
            field: "aws_region",
            type: "string",
            meta: {
              interface: "input",
              width: "half",
              note: "AWS region, e.g. us-east-1",
            },
            schema: { default_value: "us-east-1" },
          },
          {
            field: "aws_access_key_id",
            type: "string",
            meta: {
              interface: "input",
              width: "half",
              note: "Stored plaintext. Prefer AWS_ACCESS_KEY_ID env var in production.",
            },
          },
          {
            field: "aws_secret_access_key",
            type: "string",
            meta: {
              interface: "input",
              width: "full",
              special: ["conceal"],
              note: "Stored plaintext. Prefer AWS_SECRET_ACCESS_KEY env var in production.",
            },
          },
          {
            field: "aws_sns_sender_id",
            type: "string",
            meta: {
              interface: "input",
              width: "half",
              note: "Optional alphanumeric Sender ID (where supported by destination country).",
            },
          },
        ],
      });

      const freshSchema = await getSchema();
      const items = new ItemsService(SETTINGS_COLLECTION, {
        schema: freshSchema,
        accountability: null,
      });
      await items.upsertSingleton({});

      logger.info(`Created singleton collection "${SETTINGS_COLLECTION}".`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to bootstrap ${SETTINGS_COLLECTION}: ${msg}`);
    }
  });
});
