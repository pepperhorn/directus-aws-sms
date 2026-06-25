// src/spray/app.ts
import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "sms-spray",
  name: "Spray SMS (AWS SNS, one-way)",
  icon: "campaign",
  description:
    "Blast a one-way SMS to all opted-in families (family_sms_option) via the Sender ID. Appends a (do not reply) footer and logs a per-recipient outbound message.",
  overview: ({ message }) => [
    {
      label: "Message",
      text:
        typeof message === "string" && message.length > 60
          ? message.slice(0, 60) + "…"
          : ((message as string) ?? ""),
    },
  ],
  options: [
    {
      field: "message",
      name: "Message",
      type: "text",
      meta: {
        width: "full",
        interface: "input-multiline",
        options: { placeholder: "School is closed today due to weather." },
        required: true,
        note: "SMS body sent to every opted-in family. A (do not reply) footer is appended automatically. Supports {{ }} template variables.",
      },
    },
    {
      field: "smsType",
      name: "SMS Type",
      type: "string",
      schema: { default_value: "Promotional" },
      meta: {
        width: "half",
        interface: "select-dropdown",
        options: {
          choices: [
            { text: "Promotional", value: "Promotional" },
            { text: "Transactional", value: "Transactional" },
          ],
        },
      },
    },
  ],
});
