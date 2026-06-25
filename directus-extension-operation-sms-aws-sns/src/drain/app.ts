// src/drain/app.ts
import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "sms-dlq-drain",
  name: "Drain SMS Inbound DLQ",
  icon: "replay",
  description: "Long-poll the SQS DLQ and reprocess any inbound SMS that outlived SNS retries, through the same idempotent upsert. Safe to run repeatedly.",
  overview: ({ queueUrl }) => [{ label: "Queue", text: (queueUrl as string) ?? "SMS_AWS_DLQ_URL env" }],
  options: [
    {
      field: "queueUrl",
      name: "Queue URL",
      type: "string",
      meta: { width: "full", interface: "input", note: "SQS DLQ URL. Leave blank to use the SMS_AWS_DLQ_URL env var." },
    },
    {
      field: "maxMessages",
      name: "Max messages per receive",
      type: "integer",
      schema: { default_value: 10 },
      meta: { width: "half", interface: "input", note: "SQS caps at 10 per ReceiveMessage call." },
    },
    {
      field: "waitTimeSeconds",
      name: "Long-poll wait (seconds)",
      type: "integer",
      schema: { default_value: 20 },
      meta: { width: "half", interface: "input", note: "0–20. 20 = full long-poll." },
    },
  ],
});
