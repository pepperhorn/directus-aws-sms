import { SETTINGS_COLLECTION } from "./constants.js";

export type AwsConfig = {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  senderId?: string;
  twoWayNumber?: string;
  sprayNumber?: string;
  orgSignature?: string;
};

type ResolveContext = {
  env: Record<string, string | undefined>;
  services: { ItemsService: new (collection: string, opts: unknown) => { readSingleton: (query?: unknown) => Promise<Record<string, unknown>> } };
  getSchema: () => Promise<unknown>;
  accountability: unknown;
};

const trimOrUndefined = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
};

export const resolveAwsConfig = async (
  ctx: ResolveContext
): Promise<AwsConfig> => {
  const fromEnv = {
    region: trimOrUndefined(ctx.env.SMS_AWS_REGION),
    accessKeyId: trimOrUndefined(ctx.env.SMS_AWS_ACCESS_KEY_ID),
    secretAccessKey: trimOrUndefined(ctx.env.SMS_AWS_SECRET_ACCESS_KEY),
    senderId: trimOrUndefined(ctx.env.SMS_AWS_SNS_SENDER_ID),
    twoWayNumber: trimOrUndefined(ctx.env.SMS_AWS_TWO_WAY_NUMBER),
    sprayNumber: trimOrUndefined(ctx.env.SMS_AWS_SPRAY_NUMBER),
    orgSignature: trimOrUndefined(ctx.env.SMS_AWS_ORG_SIGNATURE),
  };

  const allEnvSet =
    fromEnv.region &&
    fromEnv.accessKeyId &&
    fromEnv.secretAccessKey &&
    fromEnv.senderId;

  let fromSettings: {
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    senderId?: string;
    twoWayNumber?: string;
    sprayNumber?: string;
    orgSignature?: string;
  } = {};

  if (!allEnvSet) {
    try {
      const schema = await ctx.getSchema();
      const items = new ctx.services.ItemsService(SETTINGS_COLLECTION, {
        schema,
        accountability: ctx.accountability,
      });
      const row = (await items.readSingleton({})) ?? {};
      fromSettings = {
        region: trimOrUndefined((row as any).aws_region),
        accessKeyId: trimOrUndefined((row as any).aws_access_key_id),
        secretAccessKey: trimOrUndefined((row as any).aws_secret_access_key),
        senderId: trimOrUndefined((row as any).aws_sns_sender_id),
        twoWayNumber: trimOrUndefined((row as any).aws_two_way_number),
        sprayNumber: trimOrUndefined((row as any).aws_spray_number),
        orgSignature: trimOrUndefined((row as any).aws_org_signature),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read sms_settings: ${msg}`);
    }
  }

  const region = fromEnv.region ?? fromSettings.region;
  if (!region) {
    throw new Error(
      "AWS region not configured. Set SMS_AWS_REGION env var or configure SMS Settings."
    );
  }

  return {
    region,
    accessKeyId: fromEnv.accessKeyId ?? fromSettings.accessKeyId,
    secretAccessKey: fromEnv.secretAccessKey ?? fromSettings.secretAccessKey,
    senderId: fromEnv.senderId ?? fromSettings.senderId,
    twoWayNumber: fromEnv.twoWayNumber ?? fromSettings.twoWayNumber,
    sprayNumber: fromEnv.sprayNumber ?? fromSettings.sprayNumber,
    orgSignature: fromEnv.orgSignature ?? fromSettings.orgSignature,
  };
};
