import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import operation from "./api.js";

const snsMock = mockClient(SNSClient);

const makeServices = (settingsRow: Record<string, unknown> = {}) => {
  const readSingleton = vi.fn(async () => settingsRow);
  class FakeItemsService {
    constructor(public collection: string, public _opts: unknown) {}
    readSingleton = readSingleton;
  }
  return { ItemsService: FakeItemsService } as any;
};

const ctx = (overrides: Partial<{ env: Record<string, string | undefined>; settings: Record<string, unknown> }> = {}) => ({
  env: overrides.env ?? {},
  services: makeServices(overrides.settings ?? {}),
  getSchema: async () => ({}) as any,
  accountability: null,
  data: {} as Record<string, unknown>,
  database: {} as any,
  logger: {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
  } as any,
});

describe("operation.handler validation", () => {
  beforeEach(() => {
    snsMock.reset();
  });

  it("rejects when phone is not E.164 (no AWS call, no config read)", async () => {
    const c = ctx({ env: { AWS_REGION: "us-east-1" } });
    await expect(
      operation.handler(
        { to: "5551234567", message: "hi", smsType: "Transactional" },
        c
      )
    ).rejects.toThrow(/E\.164/);
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it("rejects when message is empty", async () => {
    const c = ctx({ env: { AWS_REGION: "us-east-1" } });
    await expect(
      operation.handler(
        { to: "+15551234567", message: "   ", smsType: "Transactional" },
        c
      )
    ).rejects.toThrow(/Message body is required/);
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it("rejects when region is missing from env and settings", async () => {
    const c = ctx({ env: {}, settings: {} });
    await expect(
      operation.handler(
        { to: "+15551234567", message: "hi", smsType: "Transactional" },
        c
      )
    ).rejects.toThrow(/AWS region not configured/);
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });
});

describe("operation.handler success path", () => {
  beforeEach(() => {
    snsMock.reset();
  });

  it("publishes with footer and returns messageId + to", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "msg-abc-123" });

    const c = ctx({
      env: {
        AWS_REGION: "us-east-1",
        AWS_ACCESS_KEY_ID: "AKIA",
        AWS_SECRET_ACCESS_KEY: "shh",
      },
    });

    const result = await operation.handler(
      { to: "+15551234567", message: "Your code is 4815", smsType: "Transactional" },
      c
    );

    expect(result).toEqual({ messageId: "msg-abc-123", to: "+15551234567" });

    const calls = snsMock.commandCalls(PublishCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input;
    expect(input.PhoneNumber).toBe("+15551234567");
    expect(input.Message).toBe("Your code is 4815\n\n(do not reply)");
    expect(input.MessageAttributes!["AWS.SNS.SMS.SMSType"]).toEqual({
      DataType: "String",
      StringValue: "Transactional",
    });
  });

  it("uses settings collection when env is empty", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "id-db" });
    const c = ctx({
      env: {},
      settings: {
        aws_region: "eu-west-1",
        aws_access_key_id: "AKIA_DB",
        aws_secret_access_key: "secret_db",
        aws_sns_sender_id: "BRAND_DB",
      },
    });

    const result = await operation.handler(
      { to: "+447700900123", message: "hi", smsType: "Transactional" },
      c
    );

    expect(result.messageId).toBe("id-db");
    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.MessageAttributes!["AWS.SNS.SMS.SenderID"]).toEqual({
      DataType: "String",
      StringValue: "BRAND_DB",
    });
  });

  it("propagates Promotional smsType", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "id-2" });
    const c = ctx({ env: { AWS_REGION: "us-east-1" } });

    await operation.handler(
      { to: "+15551234567", message: "hi", smsType: "Promotional" },
      c
    );

    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.MessageAttributes!["AWS.SNS.SMS.SMSType"]).toEqual({
      DataType: "String",
      StringValue: "Promotional",
    });
  });

  it("omits SenderID when not configured anywhere", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "id-3" });
    const c = ctx({ env: { AWS_REGION: "us-east-1" } });

    await operation.handler(
      { to: "+15551234567", message: "hi", smsType: "Transactional" },
      c
    );

    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.MessageAttributes!["AWS.SNS.SMS.SenderID"]).toBeUndefined();
  });

  it("returns empty messageId when SNS response omits MessageId", async () => {
    snsMock.on(PublishCommand).resolves({});
    const c = ctx({ env: { AWS_REGION: "us-east-1" } });

    const result = await operation.handler(
      { to: "+15551234567", message: "hi", smsType: "Transactional" },
      c
    );

    expect(result.messageId).toBe("");
  });
});

describe("operation.handler error path", () => {
  beforeEach(() => {
    snsMock.reset();
  });

  it("logs and rethrows when SNS rejects", async () => {
    const snsErr = Object.assign(new Error("Invalid parameter: PhoneNumber"), {
      name: "InvalidParameterException",
    });
    snsMock.on(PublishCommand).rejects(snsErr);

    let logged = "";
    const c = ctx({ env: { AWS_REGION: "us-east-1" } });
    c.logger = {
      error: (msg: string) => {
        logged = msg;
      },
      warn: () => {},
      info: () => {},
      debug: () => {},
    } as any;

    await expect(
      operation.handler(
        { to: "+15551234567", message: "hi", smsType: "Transactional" },
        c
      )
    ).rejects.toThrow(/Invalid parameter/);

    expect(logged).toContain("InvalidParameterException");
    expect(logged).toContain("Invalid parameter: PhoneNumber");
  });
});
