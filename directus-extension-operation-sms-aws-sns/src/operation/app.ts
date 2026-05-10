import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "sms-aws-sns",
  name: "Send SMS (AWS SNS)",
  icon: "sms",
  description: "Send a single SMS via AWS SNS. Appends a (do not reply) footer.",
  overview: ({ to, message }) => [
    { label: "To", text: (to as string) ?? "" },
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
      field: "to",
      name: "To",
      type: "string",
      meta: {
        width: "full",
        interface: "input",
        options: { placeholder: "+15551234567" },
        required: true,
        note: "Recipient phone number in E.164 format. Supports {{ }} template variables.",
      },
    },
    {
      field: "message",
      name: "Message",
      type: "text",
      meta: {
        width: "full",
        interface: "input-multiline",
        options: {
          placeholder: "Your verification code is {{ trigger.payload.code }}",
        },
        required: true,
        note: "SMS body. Supports {{ }} template variables. A (do not reply) footer is appended automatically.",
      },
    },
    {
      field: "smsType",
      name: "SMS Type",
      type: "string",
      schema: { default_value: "Transactional" },
      meta: {
        width: "half",
        interface: "select-dropdown",
        options: {
          choices: [
            { text: "Transactional", value: "Transactional" },
            { text: "Promotional", value: "Promotional" },
          ],
        },
      },
    },
  ],
});
