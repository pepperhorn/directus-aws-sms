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
