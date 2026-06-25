// src/send/provider.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
} from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { sendSms } from "./provider.js";
import type { AwsConfig } from "../config.js";

const snsMock = mockClient(SNSClient);
const pinpointMock = mockClient(PinpointSMSVoiceV2Client);

const baseConfig: AwsConfig = {
  region: "ap-southeast-2",
  accessKeyId: "AKIA",
  secretAccessKey: "shh",
  senderId: "CRF-Schools",
  twoWayNumber: "+61480000001",
};

describe("sendSms — senderId (spray) path", () => {
  beforeEach(() => {
    snsMock.reset();
    pinpointMock.reset();
  });

  it("publishes via SNS with the Sender ID and APPENDS the footer", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "sns-1" });

    const result = await sendSms(
      { to: "+61400000001", message: "School closed today", origination: "senderId", smsType: "Promotional" },
      baseConfig,
    );

    expect(result).toEqual({ messageId: "sns-1", to: "+61400000001", from: "CRF-Schools", origination: "senderId" });
    expect(pinpointMock.commandCalls(SendTextMessageCommand)).toHaveLength(0);

    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.PhoneNumber).toBe("+61400000001");
    expect(input.Message).toBe("School closed today\n\n(do not reply)");
    expect(input.MessageAttributes!["AWS.SNS.SMS.SenderID"]).toEqual({ DataType: "String", StringValue: "CRF-Schools" });
    expect(input.MessageAttributes!["AWS.SNS.SMS.SMSType"]).toEqual({ DataType: "String", StringValue: "Promotional" });
  });

  it("defaults smsType to Transactional on the senderId path", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "sns-2" });
    await sendSms({ to: "+61400000001", message: "hi", origination: "senderId" }, baseConfig);
    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.MessageAttributes!["AWS.SNS.SMS.SMSType"]).toEqual({ DataType: "String", StringValue: "Transactional" });
  });
});

describe("sendSms — number (conversational) path", () => {
  beforeEach(() => {
    snsMock.reset();
    pinpointMock.reset();
  });

  it("sends via End User Messaging from the two-way number and does NOT append the footer", async () => {
    pinpointMock.on(SendTextMessageCommand).resolves({ MessageId: "eum-1" });

    const result = await sendSms(
      { to: "+61400000001", message: "Sure, see you at 3pm", origination: "number" },
      baseConfig,
    );

    expect(result).toEqual({ messageId: "eum-1", to: "+61400000001", from: "+61480000001", origination: "number" });
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);

    const input = pinpointMock.commandCalls(SendTextMessageCommand)[0]!.args[0].input;
    expect(input.DestinationPhoneNumber).toBe("+61400000001");
    expect(input.OriginationIdentity).toBe("+61480000001");
    expect(input.MessageBody).toBe("Sure, see you at 3pm");
    expect(input.MessageBody).not.toContain("(do not reply)");
  });

  it("throws when origination=number but no two-way number is configured", async () => {
    await expect(
      sendSms({ to: "+61400000001", message: "hi", origination: "number" }, { ...baseConfig, twoWayNumber: undefined }),
    ).rejects.toThrow(/two-way number not configured/i);
    expect(pinpointMock.commandCalls(SendTextMessageCommand)).toHaveLength(0);
  });

  it("rejects a non-E.164 destination before any AWS call", async () => {
    await expect(
      sendSms({ to: "0400000001", message: "hi", origination: "number" }, baseConfig),
    ).rejects.toThrow(/E\.164/);
    expect(pinpointMock.commandCalls(SendTextMessageCommand)).toHaveLength(0);
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it("returns empty messageId when the provider omits MessageId", async () => {
    pinpointMock.on(SendTextMessageCommand).resolves({});
    const result = await sendSms({ to: "+61400000001", message: "hi", origination: "number" }, baseConfig);
    expect(result.messageId).toBe("");
  });
});
