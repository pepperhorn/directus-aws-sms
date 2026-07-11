import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
} from "@aws-sdk/client-pinpoint-sms-voice-v2";
import operation from "./api.js";

const snsMock = mockClient(SNSClient);
const pinpointMock = mockClient(PinpointSMSVoiceV2Client);

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
    const c = ctx({ env: { SMS_AWS_REGION: "us-east-1" } });
    await expect(
      operation.handler(
        { to: "5551234567", message: "hi", smsType: "Transactional" },
        c
      )
    ).rejects.toThrow(/E\.164/);
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it("rejects when message is empty", async () => {
    const c = ctx({ env: { SMS_AWS_REGION: "us-east-1" } });
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
        SMS_AWS_REGION: "us-east-1",
        SMS_AWS_ACCESS_KEY_ID: "AKIA",
        SMS_AWS_SECRET_ACCESS_KEY: "shh",
      },
    });

    const result = await operation.handler(
      { to: "+15551234567", message: "Your code is 4815", smsType: "Transactional" },
      c
    );

    expect((result as any).messageId).toBe("msg-abc-123");
    expect((result as any).to).toBe("+15551234567");
    expect((result as any).origination).toBe("senderId");

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

    const result = (await operation.handler(
      { to: "+447700900123", message: "hi", smsType: "Transactional" },
      c
    )) as { messageId: string; to: string };

    expect(result.messageId).toBe("id-db");
    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.MessageAttributes!["AWS.SNS.SMS.SenderID"]).toEqual({
      DataType: "String",
      StringValue: "BRAND_DB",
    });
  });

  it("propagates Promotional smsType", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "id-2" });
    const c = ctx({ env: { SMS_AWS_REGION: "us-east-1" } });

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
    const c = ctx({ env: { SMS_AWS_REGION: "us-east-1" } });

    await operation.handler(
      { to: "+15551234567", message: "hi", smsType: "Transactional" },
      c
    );

    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.MessageAttributes!["AWS.SNS.SMS.SenderID"]).toBeUndefined();
  });

  it("returns empty messageId when SNS response omits MessageId", async () => {
    snsMock.on(PublishCommand).resolves({});
    const c = ctx({ env: { SMS_AWS_REGION: "us-east-1" } });

    const result = (await operation.handler(
      { to: "+15551234567", message: "hi", smsType: "Transactional" },
      c
    )) as { messageId: string; to: string };

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
    const c = ctx({ env: { SMS_AWS_REGION: "us-east-1" } });
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

// Fake ItemsService that serves BOTH the settings singleton and the ticket/message writes.
const makeServicesWithTicketing = (settingsRow: Record<string, unknown> = {}) => {
  const created: { collection: string; item: any }[] = [];
  class FakeItemsService {
    constructor(public collection: string, public _opts: unknown) {}
    async readSingleton() {
      return settingsRow;
    }
    async readByQuery() {
      return []; // no open ticket → create path
    }
    async createOne(item: any) {
      created.push({ collection: this.collection, item });
      return this.collection === "client_ticket" ? "t-new" : "m-new";
    }
    async updateOne(id: any) {
      return id;
    }
  }
  return { services: { ItemsService: FakeItemsService } as any, created };
};

describe("operation.handler — origination=number (conversational)", () => {
  beforeEach(() => {
    snsMock.reset();
    pinpointMock.reset();
  });

  it("sends via End User Messaging, omits footer, and writes an outbound client_message", async () => {
    pinpointMock.on(SendTextMessageCommand).resolves({ MessageId: "eum-9" });
    const { services, created } = makeServicesWithTicketing({
      aws_region: "ap-southeast-2",
      aws_two_way_number: "+61480000001",
    });

    const c = {
      env: {},
      services,
      getSchema: async () => ({}) as any,
      accountability: null,
      data: {},
      database: {} as any,
      logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as any,
    };

    const result = (await operation.handler(
      { to: "+61400000001", message: "See you at 3pm", smsType: "Transactional", origination: "number" } as any,
      c as any,
    )) as any;

    expect(result.messageId).toBe("eum-9");
    expect(result.origination).toBe("number");
    expect(result.from).toBe("+61480000001");

    const input = pinpointMock.commandCalls(SendTextMessageCommand)[0]!.args[0].input;
    expect(input.MessageBody).toBe("See you at 3pm");
    expect(input.MessageBody).not.toContain("(do not reply)");

    const msg = created.find((x) => x.collection === "client_message");
    expect(msg!.item).toMatchObject({
      direction: "outbound",
      external_message_id: "eum-9",
      delivery_status: "sent",
      to_identity: "+61400000001",
      from_identity: "+61480000001",
    });
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it("prepends the org signature to the two-way body (send + stored message) when configured", async () => {
    pinpointMock.on(SendTextMessageCommand).resolves({ MessageId: "eum-sig" });
    const { services, created } = makeServicesWithTicketing({
      aws_region: "ap-southeast-2",
      aws_two_way_number: "+61480000001",
      aws_org_signature: "CRF Schools",
    });
    const c = {
      env: {},
      services,
      getSchema: async () => ({}) as any,
      accountability: null,
      data: {},
      database: {} as any,
      logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as any,
    };

    await operation.handler(
      { to: "+61400000001", message: "See you at 3pm", smsType: "Transactional", origination: "number" } as any,
      c as any,
    );

    const input = pinpointMock.commandCalls(SendTextMessageCommand)[0]!.args[0].input;
    expect(input.MessageBody).toBe("CRF Schools: See you at 3pm");

    const msg = created.find((x) => x.collection === "client_message");
    expect(msg!.item.body).toBe("CRF Schools: See you at 3pm");
  });

  it("does NOT apply the org signature on the senderId path", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "sns-sig" });
    const { services } = makeServicesWithTicketing({
      aws_region: "ap-southeast-2",
      aws_org_signature: "CRF Schools",
    });
    const c = {
      env: {},
      services,
      getSchema: async () => ({}) as any,
      accountability: null,
      data: {},
      database: {} as any,
      logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as any,
    };

    await operation.handler(
      { to: "+61400000001", message: "Blast", smsType: "Promotional" } as any,
      c as any,
    );

    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.Message).toBe("Blast\n\n(do not reply)");
    expect(input.Message).not.toContain("CRF Schools");
  });

  it("defaults to senderId (footer appended, no client_message) when origination is omitted", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "sns-default" });
    const { services, created } = makeServicesWithTicketing({ aws_region: "ap-southeast-2" });
    const c = {
      env: {},
      services,
      getSchema: async () => ({}) as any,
      accountability: null,
      data: {},
      database: {} as any,
      logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as any,
    };

    const result = (await operation.handler(
      { to: "+61400000001", message: "Blast", smsType: "Promotional" } as any,
      c as any,
    )) as any;

    expect(result.origination).toBe("senderId");
    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.Message).toBe("Blast\n\n(do not reply)");
    expect(created.find((x) => x.collection === "client_message")).toBeUndefined();
  });
});
