# SMS via AWS SNS — Directus Operation Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Directus bundle extension `directus-extension-operation-sms-aws-sns` that publishes a single SMS via AWS SNS. Ships an operation (panel UI + handler) and a hook that auto-creates an `sms_settings` singleton collection so admins can configure AWS credentials in the UI as an alternative to env vars.

**Architecture:** Directus bundle with two entries — an operation (`operation/app.ts` + `operation/api.ts`) and a hook (`hook/index.ts`). Shared modules: `constants.ts` for `FOOTER` / `E164_REGEX` / `SETTINGS_COLLECTION`, and `config.ts` for `resolveAwsConfig` (env → settings collection fallback). Handler validates, resolves config, appends `\n\n(do not reply)` footer, calls `SNSClient.send(PublishCommand)`, returns `{ messageId, to }`.

**Tech Stack:** TypeScript, `@directus/extensions-sdk`, `@aws-sdk/client-sns` v3, `vitest`, `aws-sdk-client-mock`.

**Spec:** `docs/superpowers/specs/2026-05-10-sms-aws-sns-operation-design.md`

---

## File Structure

All paths relative to project root `/home/shaun/sms-interface/`.

```
directus-extension-operation-sms-aws-sns/
├── package.json                  # Bundle extension metadata
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── README.md
└── src/
    ├── index.ts                  # Bundle entry — combines operation + hook
    ├── constants.ts              # FOOTER, E164_REGEX, SETTINGS_COLLECTION
    ├── constants.test.ts
    ├── config.ts                 # resolveAwsConfig({ env, services, getSchema, accountability })
    ├── config.test.ts
    ├── operation/
    │   ├── app.ts                # Panel UI (To, Message, SMS Type)
    │   ├── api.ts                # Handler
    │   └── api.test.ts
    └── hook/
        └── index.ts              # init.before hook: ensure sms_settings exists
```

Responsibility split:
- `constants.ts` — pure values shared everywhere.
- `config.ts` — pure resolver, no AWS or SNS knowledge.
- `operation/api.ts` — validation, config resolution, SNS call.
- `operation/app.ts` — declarative UI only.
- `hook/index.ts` — collection bootstrap on startup, idempotent.
- `index.ts` — bundle assembly.

---

## Task 1: Initialize the bundle package

**Files:**
- Create: `directus-extension-operation-sms-aws-sns/package.json`
- Create: `directus-extension-operation-sms-aws-sns/tsconfig.json`
- Create: `directus-extension-operation-sms-aws-sns/.gitignore`

- [ ] **Step 1: Create the package directory**

Run:
```bash
mkdir -p /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns/src/operation
mkdir -p /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns/src/hook
```

- [ ] **Step 2: Write `package.json`**

Create `directus-extension-operation-sms-aws-sns/package.json`:

```json
{
  "name": "directus-extension-operation-sms-aws-sns",
  "version": "0.1.0",
  "description": "Directus bundle: flow operation that sends SMS via AWS SNS, with an auto-created settings collection.",
  "type": "module",
  "directus:extension": {
    "type": "bundle",
    "path": "dist/index.js",
    "entries": [
      { "type": "operation", "name": "sms-aws-sns", "source": "src/operation/index.ts" },
      { "type": "hook", "name": "sms-aws-sns-bootstrap", "source": "src/hook/index.ts" }
    ],
    "host": "^10.0.0 || ^11.0.0"
  },
  "scripts": {
    "build": "directus-extension build",
    "dev": "directus-extension build -w",
    "link": "directus-extension link",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@aws-sdk/client-sns": "^3.700.0"
  },
  "devDependencies": {
    "@directus/extensions-sdk": "^12.0.0",
    "@types/node": "^20.11.0",
    "aws-sdk-client-mock": "^4.1.0",
    "typescript": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

Note: the operation entry's `source` is `src/operation/index.ts`. We'll create that as a thin re-export combining `app.ts` + `api.ts`.

- [ ] **Step 3: Write `tsconfig.json`**

Create `directus-extension-operation-sms-aws-sns/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Write `.gitignore`**

Create `directus-extension-operation-sms-aws-sns/.gitignore`:

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 5: Install dependencies**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npm install
```

Expected: `node_modules/` populated, `package-lock.json` created, no errors.

- [ ] **Step 6: Commit**

```bash
cd /home/shaun/sms-interface
git add directus-extension-operation-sms-aws-sns/package.json directus-extension-operation-sms-aws-sns/tsconfig.json directus-extension-operation-sms-aws-sns/.gitignore directus-extension-operation-sms-aws-sns/package-lock.json
git commit -m "chore(sms): scaffold bundle extension package"
```

---

## Task 2: Add constants module

**Files:**
- Create: `directus-extension-operation-sms-aws-sns/src/constants.ts`
- Create: `directus-extension-operation-sms-aws-sns/src/constants.test.ts`
- Create: `directus-extension-operation-sms-aws-sns/vitest.config.ts`

- [ ] **Step 1: Write the failing test**

Create `directus-extension-operation-sms-aws-sns/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

Create `directus-extension-operation-sms-aws-sns/src/constants.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FOOTER, E164_REGEX, SETTINGS_COLLECTION } from "./constants.js";

describe("FOOTER", () => {
  it("is exactly the no-reply footer with two leading newlines", () => {
    expect(FOOTER).toBe("\n\n(do not reply)");
  });

  it("is 16 characters", () => {
    expect(FOOTER.length).toBe(16);
  });
});

describe("E164_REGEX", () => {
  it("accepts a US-style E.164 number", () => {
    expect(E164_REGEX.test("+15551234567")).toBe(true);
  });

  it("accepts a UK E.164 number", () => {
    expect(E164_REGEX.test("+447700900123")).toBe(true);
  });

  it("rejects a number without leading +", () => {
    expect(E164_REGEX.test("15551234567")).toBe(false);
  });

  it("rejects a number starting with +0", () => {
    expect(E164_REGEX.test("+05551234567")).toBe(false);
  });

  it("rejects a number with hyphens", () => {
    expect(E164_REGEX.test("+1-555-123-4567")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(E164_REGEX.test("")).toBe(false);
  });

  it("rejects a 17-digit number (over E.164 max of 15)", () => {
    expect(E164_REGEX.test("+12345678901234567")).toBe(false);
  });
});

describe("SETTINGS_COLLECTION", () => {
  it("is the singleton collection name", () => {
    expect(SETTINGS_COLLECTION).toBe("sms_settings");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npx vitest run src/constants.test.ts
```

Expected: FAIL — module `./constants.js` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

Create `directus-extension-operation-sms-aws-sns/src/constants.ts`:

```ts
export const FOOTER = "\n\n(do not reply)";

export const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export const SETTINGS_COLLECTION = "sms_settings";
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npx vitest run src/constants.test.ts
```

Expected: PASS — 10 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/shaun/sms-interface
git add directus-extension-operation-sms-aws-sns/src/constants.ts directus-extension-operation-sms-aws-sns/src/constants.test.ts directus-extension-operation-sms-aws-sns/vitest.config.ts
git commit -m "feat(sms): add FOOTER, E164_REGEX, SETTINGS_COLLECTION constants"
```

---

## Task 3: Implement `resolveAwsConfig` (hybrid env + settings)

**Files:**
- Create: `directus-extension-operation-sms-aws-sns/src/config.ts`
- Create: `directus-extension-operation-sms-aws-sns/src/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `directus-extension-operation-sms-aws-sns/src/config.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npx vitest run src/config.test.ts
```

Expected: FAIL — module `./config.js` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

Create `directus-extension-operation-sms-aws-sns/src/config.ts`:

```ts
import { SETTINGS_COLLECTION } from "./constants.js";

export type AwsConfig = {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  senderId?: string;
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
    region: trimOrUndefined(ctx.env.AWS_REGION),
    accessKeyId: trimOrUndefined(ctx.env.AWS_ACCESS_KEY_ID),
    secretAccessKey: trimOrUndefined(ctx.env.AWS_SECRET_ACCESS_KEY),
    senderId: trimOrUndefined(ctx.env.AWS_SNS_SENDER_ID),
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
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read sms_settings: ${msg}`);
    }
  }

  const region = fromEnv.region ?? fromSettings.region;
  if (!region) {
    throw new Error(
      "AWS region not configured. Set AWS_REGION env var or configure SMS Settings."
    );
  }

  return {
    region,
    accessKeyId: fromEnv.accessKeyId ?? fromSettings.accessKeyId,
    secretAccessKey: fromEnv.secretAccessKey ?? fromSettings.secretAccessKey,
    senderId: fromEnv.senderId ?? fromSettings.senderId,
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npx vitest run src/config.test.ts
```

Expected: PASS — 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/shaun/sms-interface
git add directus-extension-operation-sms-aws-sns/src/config.ts directus-extension-operation-sms-aws-sns/src/config.test.ts
git commit -m "feat(sms): add resolveAwsConfig with env + settings hybrid resolution"
```

---

## Task 4: Operation handler — validation + missing region

**Files:**
- Create: `directus-extension-operation-sms-aws-sns/src/operation/api.ts`
- Create: `directus-extension-operation-sms-aws-sns/src/operation/api.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `directus-extension-operation-sms-aws-sns/src/operation/api.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npx vitest run src/operation/api.test.ts
```

Expected: FAIL — module `./api.js` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

Create `directus-extension-operation-sms-aws-sns/src/operation/api.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npx vitest run src/operation/api.test.ts
```

Expected: PASS — 3 validation tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/shaun/sms-interface
git add directus-extension-operation-sms-aws-sns/src/operation/api.ts directus-extension-operation-sms-aws-sns/src/operation/api.test.ts
git commit -m "feat(sms): add operation handler with validation and config resolution"
```

---

## Task 5: Operation handler — success path, footer, attributes, errors

**Files:**
- Modify: `directus-extension-operation-sms-aws-sns/src/operation/api.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `directus-extension-operation-sms-aws-sns/src/operation/api.test.ts` (after the existing `describe("operation.handler validation", ...)` block):

```ts
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
```

- [ ] **Step 2: Run all tests**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npx vitest run
```

Expected: PASS — 10 constants + 8 config + 9 api = 27 tests.

- [ ] **Step 3: Commit**

```bash
cd /home/shaun/sms-interface
git add directus-extension-operation-sms-aws-sns/src/operation/api.test.ts
git commit -m "test(sms): cover footer, settings fallback, sender ID, error path"
```

---

## Task 6: Operation panel UI

**Files:**
- Create: `directus-extension-operation-sms-aws-sns/src/operation/app.ts`
- Create: `directus-extension-operation-sms-aws-sns/src/operation/index.ts`

- [ ] **Step 1: Write the panel UI**

Create `directus-extension-operation-sms-aws-sns/src/operation/app.ts`:

```ts
import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "sms-aws-sns",
  name: "Send SMS (AWS SNS)",
  icon: "sms",
  description: "Send a single SMS via AWS SNS. Appends a (do not reply) footer.",
  overview: ({ to, message }) => [
    { label: "To", text: (to as string) ?? "" },
    {
      label: "Message",
      text:
        typeof message === "string" && message.length > 60
          ? message.slice(0, 60) + "…"
          : ((message as string) ?? ""),
    },
  ],
  options: [
    {
      field: "to",
      name: "To",
      type: "string",
      meta: {
        width: "full",
        interface: "input",
        options: { placeholder: "+15551234567" },
        required: true,
        note: "Recipient phone number in E.164 format. Supports {{ }} template variables.",
      },
    },
    {
      field: "message",
      name: "Message",
      type: "text",
      meta: {
        width: "full",
        interface: "input-multiline",
        options: {
          placeholder: "Your verification code is {{ trigger.payload.code }}",
        },
        required: true,
        note: "SMS body. Supports {{ }} template variables. A (do not reply) footer is appended automatically.",
      },
    },
    {
      field: "smsType",
      name: "SMS Type",
      type: "string",
      schema: { default_value: "Transactional" },
      meta: {
        width: "half",
        interface: "select-dropdown",
        options: {
          choices: [
            { text: "Transactional", value: "Transactional" },
            { text: "Promotional", value: "Promotional" },
          ],
        },
      },
    },
  ],
});
```

- [ ] **Step 2: Write the operation entry**

Create `directus-extension-operation-sms-aws-sns/src/operation/index.ts`:

```ts
export { default as app } from "./app.js";
export { default as api } from "./api.js";
```

- [ ] **Step 3: Type-check**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/shaun/sms-interface
git add directus-extension-operation-sms-aws-sns/src/operation/app.ts directus-extension-operation-sms-aws-sns/src/operation/index.ts
git commit -m "feat(sms): add operation panel UI and bundle entry"
```

---

## Task 7: Bootstrap hook — auto-create `sms_settings`

**Files:**
- Create: `directus-extension-operation-sms-aws-sns/src/hook/index.ts`

- [ ] **Step 1: Write the hook**

Create `directus-extension-operation-sms-aws-sns/src/hook/index.ts`:

```ts
import { defineHook } from "@directus/extensions-sdk";
import { SETTINGS_COLLECTION } from "../constants.js";

export default defineHook(({ init }, { services, getSchema, logger, database }) => {
  init("app.before", async () => {
    try {
      const schema = await getSchema();
      const collections = (schema as any)?.collections ?? {};
      if (collections[SETTINGS_COLLECTION]) {
        return;
      }

      const { CollectionsService, ItemsService } = services as any;
      const collectionsService = new CollectionsService({
        schema,
        knex: database,
      });

      await collectionsService.createOne({
        collection: SETTINGS_COLLECTION,
        meta: {
          singleton: true,
          icon: "sms",
          note: "AWS SNS credentials used by the Send SMS operation. Env vars override these values.",
        },
        schema: { name: SETTINGS_COLLECTION },
        fields: [
          {
            field: "id",
            type: "integer",
            meta: { hidden: true, interface: "input", readonly: true },
            schema: { is_primary_key: true, has_auto_increment: true },
          },
          {
            field: "aws_region",
            type: "string",
            meta: {
              interface: "input",
              width: "half",
              note: "AWS region, e.g. us-east-1",
            },
            schema: { default_value: "us-east-1" },
          },
          {
            field: "aws_access_key_id",
            type: "string",
            meta: {
              interface: "input",
              width: "half",
              note: "Stored plaintext. Prefer AWS_ACCESS_KEY_ID env var in production.",
            },
          },
          {
            field: "aws_secret_access_key",
            type: "string",
            meta: {
              interface: "input",
              width: "full",
              special: ["conceal"],
              note: "Stored plaintext. Prefer AWS_SECRET_ACCESS_KEY env var in production.",
            },
          },
          {
            field: "aws_sns_sender_id",
            type: "string",
            meta: {
              interface: "input",
              width: "half",
              note: "Optional alphanumeric Sender ID (where supported by destination country).",
            },
          },
        ],
      });

      const freshSchema = await getSchema();
      const items = new ItemsService(SETTINGS_COLLECTION, {
        schema: freshSchema,
        accountability: null,
      });
      await items.upsertSingleton({});

      logger.info(`Created singleton collection "${SETTINGS_COLLECTION}".`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to bootstrap ${SETTINGS_COLLECTION}: ${msg}`);
    }
  });
});
```

- [ ] **Step 2: Type-check**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/shaun/sms-interface
git add directus-extension-operation-sms-aws-sns/src/hook/index.ts
git commit -m "feat(sms): add bootstrap hook that auto-creates sms_settings"
```

Note: the hook is intentionally not unit-tested. It depends on Directus's CollectionsService whose full surface is awkward to mock and whose behavior is verified by the manual E2E test (Task 9). This is documented as a deliberate trade-off, not an oversight.

---

## Task 8: Build the bundle

**Files:**
- Verify: `directus-extension-operation-sms-aws-sns/dist/index.js` exists

- [ ] **Step 1: Run the build**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npm run build
```

Expected: build succeeds, `dist/index.js` exists, no warnings about missing exports.

- [ ] **Step 2: Sanity-check build output**

Run:
```bash
ls -1 /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns/dist
```

Expected: at minimum `index.js` listed.

- [ ] **Step 3: Run the full test suite**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npm test
```

Expected: all tests pass (27 tests).

- [ ] **Step 4: Commit if needed**

```bash
cd /home/shaun/sms-interface
git status
git diff --cached --quiet || git commit -m "chore(sms): verify bundle build"
```

(No-op if `dist/` is gitignored and no other changes — that's fine.)

---

## Task 9: Write the README

**Files:**
- Create: `directus-extension-operation-sms-aws-sns/README.md`

- [ ] **Step 1: Write the README**

Create `directus-extension-operation-sms-aws-sns/README.md`:

```markdown
# directus-extension-operation-sms-aws-sns

Directus bundle: a flow operation that sends a single SMS via AWS SNS, plus a bootstrap hook that auto-creates an `sms_settings` singleton collection so admins can configure AWS credentials in the UI.

## Install

1. Build the extension:
   ```bash
   npm install
   npm run build
   ```
2. Copy the package directory into your Directus instance's `extensions/` folder, **or** publish to npm and install it from your Directus project.
3. Restart Directus. On first start the hook creates the `sms_settings` collection (look for `Created singleton collection "sms_settings".` in the log).

## Configure (two options, can be combined)

### Option A — Settings page (in-UI)

In crf-admin: **Settings → Data Model → SMS Settings** (or navigate to the singleton through the standard Directus collection UI). Fill in:

- **AWS Region** (e.g. `us-east-1`) — required
- **AWS Access Key ID**
- **AWS Secret Access Key** (masked input)
- **AWS SNS Sender ID** (optional)

> ⚠️ **Security:** values are stored plaintext in your Directus database. Anyone with admin DB or API access can read them, and they appear in DB backups. Prefer Option B for production.

### Option B — Environment variables

Set on the Directus host:

| Variable | Required | Notes |
|---|---|---|
| `AWS_REGION` | yes | e.g. `us-east-1`. |
| `AWS_ACCESS_KEY_ID` | conditional | Required unless using SDK default credential chain (IAM role, profile). |
| `AWS_SECRET_ACCESS_KEY` | conditional | Same as above. |
| `AWS_SNS_SENDER_ID` | no | Honored only in countries that support alphanumeric Sender IDs. |

Env vars take precedence over the settings collection per-key. You can mix: e.g. set `AWS_REGION` in env and store credentials in the settings page.

IAM permission required: `sns:Publish`.

## Operation options

- **To** — recipient phone number, E.164 (e.g. `+15551234567`). Supports `{{ }}` template variables.
- **Message** — SMS body. Supports `{{ }}` template variables.
- **SMS Type** — `Transactional` (default) or `Promotional`.

A `\n\n(do not reply)` footer is appended to every message automatically.

## Output

Resolves with `{ messageId, to }` into the data chain. Reference downstream as `{{ <operation_key>.messageId }}`.

## AWS prerequisites

- New SNS SMS accounts start in **sandbox mode**: you can only send to verified phone numbers. Verify your test number in the SNS console (Mobile → Sandbox destination phone numbers) or request production access.
- Default monthly SMS spend cap is `$1`. Adjust in SNS → Mobile → Text messaging (SMS) preferences.

## Development

```bash
npm install
npm test          # run unit tests
npm run dev       # watch-mode build
npm run build     # one-shot build
```
```

- [ ] **Step 2: Commit**

```bash
cd /home/shaun/sms-interface
git add directus-extension-operation-sms-aws-sns/README.md
git commit -m "docs(sms): README covering hybrid config and AWS prerequisites"
```

---

## Task 10: Manual end-to-end verification

Performed by a human operator with AWS access. No automated check.

- [ ] **Step 1: Build, install, restart**

Build the extension, copy the package into Directus's `extensions/`, restart.

- [ ] **Step 2: Verify auto-bootstrap**

In the Directus log, find `Created singleton collection "sms_settings".`
Navigate to the new collection in crf-admin — confirm:
- Singleton form (no list view)
- Four fields visible (region, access key, secret, sender ID)
- Secret field renders as concealed (dots) on save

- [ ] **Step 3: Path A — Settings page only**

Leave AWS env vars unset. Fill in region + credentials in the SMS Settings page. Verify a destination phone in the SNS sandbox; confirm spend cap > 0. Build a manual-trigger flow with one Send SMS operation (`to` = your verified number, `message` = `Test from settings page.`, `smsType` = Transactional). Run the flow.

Confirm:
- SMS received with body `Test from settings page.\n\n(do not reply)`
- Flow log shows `{ messageId, to }`

- [ ] **Step 4: Path B — Env override**

Set `AWS_REGION=us-west-2` (or any region different from your settings) on the Directus host. Restart. Edit the same flow (no changes) and run it. Confirm via the SNS console that the publish hit `us-west-2` (proves env wins over settings).

- [ ] **Step 5: Negative test**

Edit the flow, change `to` to `5551234567` (no `+`). Run. Confirm flow takes the reject path, no SMS sent, log shows `Invalid phone number: must be E.164`.

- [ ] **Step 6: Missing-region test**

Clear both env vars and the `aws_region` field in SMS Settings. Restart. Run the flow. Confirm reject with `AWS region not configured. Set AWS_REGION env var or configure SMS Settings.`

---

## Self-Review Notes

- **Spec coverage:**
  - Bundle structure (operation + hook) → Task 1 (`package.json` declares bundle), Tasks 6/7 (entries).
  - `FOOTER`, `E164_REGEX`, `SETTINGS_COLLECTION` → Task 2.
  - Hybrid config resolver (env → settings collection, region required, optional creds, optional sender) → Task 3.
  - Handler validation (E.164, message, region) → Task 4.
  - Handler success path (footer append, SMSType, SenderID present/absent, settings fallback, error logging) → Task 5.
  - Panel UI (To/Message/SMS Type) + overview → Task 6.
  - Auto-bootstrap of `sms_settings` singleton with masked secret field → Task 7.
  - Build green, all tests pass → Task 8.
  - README covering both config paths, security caveat, AWS prereqs → Task 9.
  - Manual E2E covering both config paths, env precedence, negatives → Task 10.

- **Type consistency:** `Options.smsType` literal matches dropdown choices; `Result` shape `{ messageId, to }` matches tests, README, and data flow example. `AwsConfig` from `config.ts` is the only shape consumed by `api.ts`. `SETTINGS_COLLECTION` constant used everywhere the collection name appears.

- **No placeholders:** Every code block is complete. Every command has expected output. The hook's lack of unit tests is explicitly justified, not glossed.
