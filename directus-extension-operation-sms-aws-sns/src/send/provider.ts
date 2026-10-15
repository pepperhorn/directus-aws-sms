// src/send/provider.ts
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
} from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { FOOTER, E164_REGEX } from "../constants.js";
import type { AwsConfig } from "../config.js";

export type Origination = "senderId" | "number";

export type SendSmsInput = {
  to: string;
  message: string;
  origination: Origination;
  smsType?: "Transactional" | "Promotional";
};

export type SendSmsResult = {
  messageId: string;
  to: string;
  from: string;
  origination: Origination;
};

const credentialsFrom = (config: AwsConfig) =>
  config.accessKeyId && config.secretAccessKey
    ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
    : undefined;

/**
 * Origination-aware SMS send. The single AWS boundary for outbound.
 * - `senderId`: Amazon SNS PublishCommand with the alphanumeric Sender ID. Footer IS appended.
 * - `number`:   AWS End User Messaging SendTextMessageCommand from the two-way number. Footer is NOT appended (parents can reply).
 */
export async function sendSms(
  input: SendSmsInput,
  config: AwsConfig,
): Promise<SendSmsResult> {
  const { to, message, origination } = input;

  if (typeof to !== "string" || !E164_REGEX.test(to)) {
    throw new Error("Invalid phone number: must be E.164 (e.g. +15551234567)");
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new Error("Message body is required");
  }

  const credentials = credentialsFrom(config);

  if (origination === "number") {
    const from = config.twoWayNumber;
    if (!from) {
      throw new Error(
        "Two-way number not configured. Set SMS_AWS_TWO_WAY_NUMBER env var or configure SMS Settings.",
      );
    }
    const client = new PinpointSMSVoiceV2Client({ region: config.region, ...(credentials ? { credentials } : {}) });
    const result = await client.send(
      new SendTextMessageCommand({
        DestinationPhoneNumber: to,
        OriginationIdentity: from,
        MessageBody: message, // no footer: this thread is replyable
      }),
    );
    return { messageId: result.MessageId ?? "", to, from, origination };
  }

  // origination === "senderId" — spray / one-way blast via SNS, footer appended.
  const finalMessage = message + FOOTER;
  const messageAttributes: Record<string, { DataType: string; StringValue: string }> = {
    "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: input.smsType ?? "Transactional" },
  };
  if (config.senderId) {
    messageAttributes["AWS.SNS.SMS.SenderID"] = { DataType: "String", StringValue: config.senderId };
  }
  if (config.sprayNumber) {
    messageAttributes["AWS.MM.SMS.OriginationNumber"] = { DataType: "String", StringValue: config.sprayNumber };
  }

  const client = new SNSClient({ region: config.region, ...(credentials ? { credentials } : {}) });
  const result = await client.send(
    new PublishCommand({ PhoneNumber: to, Message: finalMessage, MessageAttributes: messageAttributes }),
  );
  return { messageId: result.MessageId ?? "", to, from: config.sprayNumber ?? config.senderId ?? "", origination };
}
