import { defineOperationApi } from "@directus/extensions-sdk";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { FOOTER, E164_REGEX } from "../constants.js";
import { resolveAwsConfig } from "../config.js";

export type Options = {
  to: string;
  message: string;
  smsType: "Transactional" | "Promotional";
};

export type Result = {
  messageId: string;
  to: string;
};

export default defineOperationApi<Options>({
  id: "sms-aws-sns",
  handler: async (
    { to, message, smsType },
    { env, services, getSchema, accountability, logger }
  ) => {
    if (typeof to !== "string" || !E164_REGEX.test(to)) {
      throw new Error(
        "Invalid phone number: must be E.164 (e.g. +15551234567)"
      );
    }

    if (typeof message !== "string" || message.trim().length === 0) {
      throw new Error("Message body is required");
    }

    const config = await resolveAwsConfig({
      env: env as Record<string, string | undefined>,
      services,
      getSchema,
      accountability,
    });

    const finalMessage = message + FOOTER;

    const messageAttributes: Record<
      string,
      { DataType: string; StringValue: string }
    > = {
      "AWS.SNS.SMS.SMSType": {
        DataType: "String",
        StringValue: smsType ?? "Transactional",
      },
    };

    if (config.senderId) {
      messageAttributes["AWS.SNS.SMS.SenderID"] = {
        DataType: "String",
        StringValue: config.senderId,
      };
    }

    const clientConfig: { region: string; credentials?: { accessKeyId: string; secretAccessKey: string } } = {
      region: config.region,
    };
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    const client = new SNSClient(clientConfig);

    try {
      const result = await client.send(
        new PublishCommand({
          PhoneNumber: to,
          Message: finalMessage,
          MessageAttributes: messageAttributes,
        })
      );
      return { messageId: result.MessageId ?? "", to } satisfies Result;
    } catch (err) {
      const e = err as { name?: string; message?: string };
      logger.error(
        `SNS Publish failed: ${e.name ?? "Error"}: ${e.message ?? String(err)}`
      );
      throw err;
    }
  },
});
