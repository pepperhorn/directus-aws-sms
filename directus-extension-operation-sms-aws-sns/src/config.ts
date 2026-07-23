import { SETTINGS_COLLECTION } from "./constants.js";

export type AwsConfig = {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  senderId?: string;
  twoWayNumber?: string;
  sprayNumber?: string;
  orgSignature?: string;
  orgSignatureFirstOnly?: boolean;
  orgFooter?: string;
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

// Parse a boolean from an env string ("true"/"1"/"yes"/"on") or a settings
// value (native boolean, or 1/0). Returns undefined when unset/unrecognized so
// the env→settings fallback can chain.
const boolOrUndefined = (v: unknown): boolean | undefined => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "") return undefined;
    if (["true", "1", "yes", "on"].includes(t)) return true;
    if (["false", "0", "no", "off"].includes(t)) return false;
  }
  return undefined;
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
    orgSignatureFirstOnly: boolOrUndefined(ctx.env.SMS_AWS_ORG_SIGNATURE_FIRST_ONLY),
    orgFooter: trimOrUndefined(ctx.env.SMS_AWS_ORG_FOOTER),
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
    orgSignatureFirstOnly?: boolean;
    orgFooter?: string;
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
        orgSignatureFirstOnly: boolOrUndefined((row as any).aws_org_signature_first_only),
        orgFooter: trimOrUndefined((row as any).aws_org_footer),
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
    orgSignatureFirstOnly: fromEnv.orgSignatureFirstOnly ?? fromSettings.orgSignatureFirstOnly,
    orgFooter: fromEnv.orgFooter ?? fromSettings.orgFooter,
  };
};
