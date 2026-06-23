// src/backfill/app.ts
import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "sms-number-backfill",
  name: "Backfill SMS Numbers (AU)",
  icon: "cleaning_services",
  description: "Normalize family phone numbers to E.164 (+614…) and flag landlines/unknowns. Dry-run by default.",
  overview: ({ mode }) => [{ label: "Mode", text: (mode as string) ?? "dry-run" }],
  options: [
    {
      field: "mode",
      name: "Mode",
      type: "string",
      schema: { default_value: "dry-run" },
      meta: {
        width: "half",
        interface: "select-dropdown",
        options: { choices: [
          { text: "Dry run (report only)", value: "dry-run" },
          { text: "Apply (write normalized mobiles)", value: "apply" },
        ] },
        note: "Apply only writes confirmed mobile normalizations; landline/unknown are reported for manual fixing, never overwritten.",
      },
    },
  ],
});
