import { describe, it, expect, vi } from "vitest";
import { resolveAwsConfig } from "./config.js";
import { SETTINGS_COLLECTION } from "./constants.js";

type Env = Record<string, string | undefined>;

const buildContext = (
  env: Env,
  settingsRow: Record<string, string | null> | null,
  readSingletonImpl?: () => Promise<unknown>
) => {
  const readSingleton = vi.fn(
    readSingletonImpl ?? (async () => settingsRow ?? {})
  );

  class FakeItemsService {
    constructor(public collection: string, public _opts: unknown) {}
    readSingleton = readSingleton;
  }

  const services = { ItemsService: FakeItemsService } as any;
  const getSchema = vi.fn(async () => ({}));
  const accountability = null;

  return { env, services, getSchema, accountability, readSingleton };
};

describe("resolveAwsConfig", () => {
  it("returns env values when all set; never reads settings", async () => {
    const { env, services, getSchema, accountability, readSingleton } =
      buildContext(
        {
          AWS_REGION: "us-east-1",
          AWS_ACCESS_KEY_ID: "AKIA",
          AWS_SECRET_ACCESS_KEY: "shh",
          AWS_SNS_SENDER_ID: "BRAND",
        },
        null
      );

    const result = await resolveAwsConfig({
      env,
      services,
      getSchema,
      accountability,
    });

    expect(result).toEqual({
      region: "us-east-1",
      accessKeyId: "AKIA",
      secretAccessKey: "shh",
      senderId: "BRAND",
    });
    expect(readSingleton).not.toHaveBeenCalled();
  });

  it("falls back to settings when env is empty", async () => {
    const { env, services, getSchema, accountability } = buildContext({}, {
      aws_region: "eu-west-1",
      aws_access_key_id: "AKIA_DB",
      aws_secret_access_key: "secret_db",
      aws_sns_sender_id: "BRAND_DB",
    });

    const result = await resolveAwsConfig({
      env,
      services,
      getSchema,
      accountability,
    });

    expect(result).toEqual({
      region: "eu-west-1",
      accessKeyId: "AKIA_DB",
      secretAccessKey: "secret_db",
      senderId: "BRAND_DB",
    });
  });

  it("mixes sources: env wins per-key", async () => {
    const { env, services, getSchema, accountability } = buildContext(
      { AWS_REGION: "ap-south-1" },
      {
        aws_region: "us-east-1",
        aws_access_key_id: "AKIA_DB",
        aws_secret_access_key: "secret_db",
        aws_sns_sender_id: null,
      }
    );

    const result = await resolveAwsConfig({
      env,
      services,
      getSchema,
      accountability,
    });

    expect(result.region).toBe("ap-south-1");
    expect(result.accessKeyId).toBe("AKIA_DB");
    expect(result.secretAccessKey).toBe("secret_db");
    expect(result.senderId).toBeUndefined();
  });

  it("throws when region is missing from both sources", async () => {
    const { env, services, getSchema, accountability } = buildContext({}, {
      aws_region: "",
      aws_access_key_id: "AKIA_DB",
      aws_secret_access_key: "secret_db",
      aws_sns_sender_id: null,
    });

    await expect(
      resolveAwsConfig({ env, services, getSchema, accountability })
    ).rejects.toThrow(
      /AWS region not configured\. Set AWS_REGION env var or configure SMS Settings\./
    );
  });

  it("treats whitespace-only env values as unset", async () => {
    const { env, services, getSchema, accountability } = buildContext(
      { AWS_REGION: "   " },
      { aws_region: "eu-west-1" }
    );

    const result = await resolveAwsConfig({
      env,
      services,
      getSchema,
      accountability,
    });

    expect(result.region).toBe("eu-west-1");
  });

  it("handles empty settings record (no fields populated)", async () => {
    const { env, services, getSchema, accountability } = buildContext(
      { AWS_REGION: "us-east-1" },
      {}
    );

    const result = await resolveAwsConfig({
      env,
      services,
      getSchema,
      accountability,
    });

    expect(result.region).toBe("us-east-1");
    expect(result.accessKeyId).toBeUndefined();
    expect(result.secretAccessKey).toBeUndefined();
    expect(result.senderId).toBeUndefined();
  });

  it("propagates ItemsService errors with context", async () => {
    const { env, services, getSchema, accountability } = buildContext(
      {},
      null,
      async () => {
        throw new Error("DB connection refused");
      }
    );

    await expect(
      resolveAwsConfig({ env, services, getSchema, accountability })
    ).rejects.toThrow(/Failed to read sms_settings.*DB connection refused/);
  });

  it("constructs ItemsService with the right collection name", async () => {
    let capturedCollection = "";
    class CaptureItemsService {
      constructor(public collection: string, public _opts: unknown) {
        capturedCollection = collection;
      }
      readSingleton = async () => ({ aws_region: "us-east-1" });
    }
    const services = { ItemsService: CaptureItemsService } as any;

    await resolveAwsConfig({
      env: {},
      services,
      getSchema: async () => ({}) as any,
      accountability: null,
    });

    expect(capturedCollection).toBe(SETTINGS_COLLECTION);
  });
});
