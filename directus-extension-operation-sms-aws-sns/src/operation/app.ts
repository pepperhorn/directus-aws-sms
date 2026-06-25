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
        note: "SMS body. Supports {{ }} template variables. A (do not reply) footer is appended automatically on the Sender ID (spray) path only — not on the two-way number path.",
      },
    },
    {
      field: "origination",
      name: "Origination",
      type: "string",
      schema: { default_value: "senderId" },
      meta: {
        width: "half",
        interface: "select-dropdown",
        options: {
          choices: [
            { text: "Sender ID (one-way, footer appended)", value: "senderId" },
            { text: "Two-way number (replyable, no footer, logs a ticket message)", value: "number" },
          ],
        },
        note: "Sender ID sends via Amazon SNS. Two-way number sends via AWS End User Messaging and appends an outbound message to the client ticket.",
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
