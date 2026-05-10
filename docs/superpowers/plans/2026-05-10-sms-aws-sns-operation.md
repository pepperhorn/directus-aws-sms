# SMS via AWS SNS — Directus Operation Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Directus operation extension `directus-extension-operation-sms-aws-sns` that publishes a single SMS via AWS SNS, modeled on the built-in email send operation.

**Architecture:** Two-file Directus operation extension (`app.ts` for the panel UI, `api.ts` for the handler). Handler validates E.164 phone format, appends a `\n\n(do not reply)` footer, calls `SNSClient.send(PublishCommand)`, and returns `{ messageId, to }` to the data chain. Credentials come from environment via the AWS SDK's default credential chain.

**Tech Stack:** TypeScript, `@directus/extensions-sdk` (build + typings), `@aws-sdk/client-sns` v3, `vitest`, `aws-sdk-client-mock`.

**Spec:** `docs/superpowers/specs/2026-05-10-sms-aws-sns-operation-design.md`

---

## File Structure

All paths relative to project root `/home/shaun/sms-interface/`.

```
directus-extension-operation-sms-aws-sns/
├── package.json                # Extension metadata, deps, build scripts
├── tsconfig.json               # TS config (extends extension-sdk default)
├── vitest.config.ts            # Test runner config
├── .gitignore                  # node_modules, dist
├── README.md                   # Install + env vars + usage
└── src/
    ├── index.ts                # Default export combining app + api
    ├── app.ts                  # Panel UI: id, name, icon, options, overview
    ├── api.ts                  # Handler: validate, append footer, call SNS
    ├── api.test.ts             # Unit tests for handler (mocked SNS)
    └── constants.ts            # FOOTER constant + E.164 regex
```

Responsibility split:
- `constants.ts` — pure values, imported by `api.ts` and tests. Keeps the regex and footer string in one place.
- `app.ts` — declarative UI definition only, no logic.
- `api.ts` — runtime logic only (validation, SNS call, error handling).
- `index.ts` — assembly; minimal.

---

## Task 1: Initialize the extension package

**Files:**
- Create: `directus-extension-operation-sms-aws-sns/package.json`
- Create: `directus-extension-operation-sms-aws-sns/tsconfig.json`
- Create: `directus-extension-operation-sms-aws-sns/.gitignore`

- [ ] **Step 1: Create the package directory**

Run:
```bash
mkdir -p /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns/src
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
```

- [ ] **Step 2: Write `package.json`**

Create `directus-extension-operation-sms-aws-sns/package.json`:

```json
{
  "name": "directus-extension-operation-sms-aws-sns",
  "version": "0.1.0",
  "description": "Directus flow operation that sends SMS via AWS SNS.",
  "type": "module",
  "directus:extension": {
    "type": "operation",
    "path": {
      "app": "dist/app.js",
      "api": "dist/api.js"
    },
    "source": {
      "app": "src/app.ts",
      "api": "src/api.ts"
    },
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
git init -q 2>/dev/null || true
git add directus-extension-operation-sms-aws-sns/package.json directus-extension-operation-sms-aws-sns/tsconfig.json directus-extension-operation-sms-aws-sns/.gitignore directus-extension-operation-sms-aws-sns/package-lock.json
git commit -m "chore: scaffold directus-extension-operation-sms-aws-sns package"
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
import { FOOTER, E164_REGEX } from "./constants.js";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npx vitest run src/constants.test.ts
```

Expected: PASS — 9 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/shaun/sms-interface
git add directus-extension-operation-sms-aws-sns/src/constants.ts directus-extension-operation-sms-aws-sns/src/constants.test.ts directus-extension-operation-sms-aws-sns/vitest.config.ts
git commit -m "feat(sms): add FOOTER constant and E164_REGEX with tests"
```

---

## Task 3: Implement the handler — validation + missing-region error

**Files:**
- Create: `directus-extension-operation-sms-aws-sns/src/api.ts`
- Create: `directus-extension-operation-sms-aws-sns/src/api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `directus-extension-operation-sms-aws-sns/src/api.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import operation from "./api.js";

const snsMock = mockClient(SNSClient);

const ctx = () => ({
  env: {} as Record<string, string | undefined>,
  logger: {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
  } as any,
  data: {} as Record<string, unknown>,
  database: {} as any,
  accountability: null,
  getSchema: async () => ({} as any),
  services: {} as any,
});

describe("operation.handler validation", () => {
  beforeEach(() => {
    snsMock.reset();
  });

  it("rejects when AWS_REGION is missing", async () => {
    const c = ctx();
    c.env = {};
    await expect(
      operation.handler(
        { to: "+15551234567", message: "hi", smsType: "Transactional" },
        c
      )
    ).rejects.toThrow(/AWS_REGION/);
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it("rejects when phone is not E.164", async () => {
    const c = ctx();
    c.env = { AWS_REGION: "us-east-1" };
    await expect(
      operation.handler(
        { to: "5551234567", message: "hi", smsType: "Transactional" },
        c
      )
    ).rejects.toThrow(/E\.164/);
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it("rejects when message is empty", async () => {
    const c = ctx();
    c.env = { AWS_REGION: "us-east-1" };
    await expect(
      operation.handler(
        { to: "+15551234567", message: "   ", smsType: "Transactional" },
        c
      )
    ).rejects.toThrow(/Message body is required/);
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npx vitest run src/api.test.ts
```

Expected: FAIL — module `./api.js` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

Create `directus-extension-operation-sms-aws-sns/src/api.ts`:

```ts
import { defineOperationApi } from "@directus/extensions-sdk";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { FOOTER, E164_REGEX } from "./constants.js";

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
  handler: async ({ to, message, smsType }, { env, logger }) => {
    if (!env.AWS_REGION) {
      throw new Error(
        "AWS_REGION is not set. Configure it in the Directus environment."
      );
    }

    if (typeof to !== "string" || !E164_REGEX.test(to)) {
      throw new Error(
        "Invalid phone number: must be E.164 (e.g. +15551234567)"
      );
    }

    if (typeof message !== "string" || message.trim().length === 0) {
      throw new Error("Message body is required");
    }

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

    if (env.AWS_SNS_SENDER_ID) {
      messageAttributes["AWS.SNS.SMS.SenderID"] = {
        DataType: "String",
        StringValue: String(env.AWS_SNS_SENDER_ID),
      };
    }

    const client = new SNSClient({ region: String(env.AWS_REGION) });

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
      logger.error(`SNS Publish failed: ${e.name ?? "Error"}: ${e.message ?? String(err)}`);
      throw err;
    }
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npx vitest run src/api.test.ts
```

Expected: PASS — 3 validation tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/shaun/sms-interface
git add directus-extension-operation-sms-aws-sns/src/api.ts directus-extension-operation-sms-aws-sns/src/api.test.ts
git commit -m "feat(sms): add operation handler with input validation"
```

---

## Task 4: Handler success path + footer + SNS attributes

**Files:**
- Modify: `directus-extension-operation-sms-aws-sns/src/api.test.ts` (add tests, no new logic in api.ts)

- [ ] **Step 1: Append the failing tests**

Append to `directus-extension-operation-sms-aws-sns/src/api.test.ts` (inside the file, before the final closing — i.e. add these `describe` blocks after the existing `describe("operation.handler validation", ...)`):

```ts
describe("operation.handler success path", () => {
  beforeEach(() => {
    snsMock.reset();
  });

  it("publishes with footer appended and returns messageId + to", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "msg-abc-123" });

    const c = ctx();
    c.env = { AWS_REGION: "us-east-1" };

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
  });

  it("sets SMSType=Transactional in MessageAttributes", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "id-1" });
    const c = ctx();
    c.env = { AWS_REGION: "us-east-1" };

    await operation.handler(
      { to: "+15551234567", message: "hi", smsType: "Transactional" },
      c
    );

    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.MessageAttributes!["AWS.SNS.SMS.SMSType"]).toEqual({
      DataType: "String",
      StringValue: "Transactional",
    });
  });

  it("sets SMSType=Promotional when chosen", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "id-2" });
    const c = ctx();
    c.env = { AWS_REGION: "us-east-1" };

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

  it("includes SenderID when AWS_SNS_SENDER_ID is set", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "id-3" });
    const c = ctx();
    c.env = { AWS_REGION: "us-east-1", AWS_SNS_SENDER_ID: "MYBRAND" };

    await operation.handler(
      { to: "+15551234567", message: "hi", smsType: "Transactional" },
      c
    );

    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.MessageAttributes!["AWS.SNS.SMS.SenderID"]).toEqual({
      DataType: "String",
      StringValue: "MYBRAND",
    });
  });

  it("omits SenderID when AWS_SNS_SENDER_ID is not set", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "id-4" });
    const c = ctx();
    c.env = { AWS_REGION: "us-east-1" };

    await operation.handler(
      { to: "+15551234567", message: "hi", smsType: "Transactional" },
      c
    );

    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.MessageAttributes!["AWS.SNS.SMS.SenderID"]).toBeUndefined();
  });

  it("returns empty messageId when SNS response omits MessageId", async () => {
    snsMock.on(PublishCommand).resolves({});
    const c = ctx();
    c.env = { AWS_REGION: "us-east-1" };

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
    const c = ctx();
    c.env = { AWS_REGION: "us-east-1" };
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

- [ ] **Step 2: Run tests to verify success-path tests pass and footer assertion holds**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npx vitest run src/api.test.ts
```

Expected: PASS — all tests pass (3 validation + 6 success + 1 error = 10 tests). The footer assertion (`Your code is 4815\n\n(do not reply)`) confirms `FOOTER` is appended correctly. No changes to `api.ts` needed; the tests verify behavior already implemented in Task 3.

- [ ] **Step 3: Commit**

```bash
cd /home/shaun/sms-interface
git add directus-extension-operation-sms-aws-sns/src/api.test.ts
git commit -m "test(sms): cover footer, SMSType, sender ID, and SNS error path"
```

---

## Task 5: Add the panel UI definition

**Files:**
- Create: `directus-extension-operation-sms-aws-sns/src/app.ts`

- [ ] **Step 1: Write the UI definition**

Create `directus-extension-operation-sms-aws-sns/src/app.ts`:

```ts
import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "sms-aws-sns",
  name: "Send SMS (AWS SNS)",
  icon: "sms",
  description: "Send a single SMS via AWS SNS. Appends a (do not reply) footer.",
  overview: ({ to, message }) => [
    { label: "To", text: to ?? "" },
    {
      label: "Message",
      text:
        typeof message === "string" && message.length > 60
          ? message.slice(0, 60) + "…"
          : (message as string) ?? "",
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
        options: {
          placeholder: "+15551234567",
        },
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
        note: "SMS body. Supports {{ }} template variables. A `\\n\\n(do not reply)` footer is appended automatically.",
      },
    },
    {
      field: "smsType",
      name: "SMS Type",
      type: "string",
      schema: {
        default_value: "Transactional",
      },
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
git add directus-extension-operation-sms-aws-sns/src/app.ts
git commit -m "feat(sms): add operation panel UI with To, Message, SMS Type"
```

---

## Task 6: Build the extension

**Files:**
- Verify: `directus-extension-operation-sms-aws-sns/dist/app.js`
- Verify: `directus-extension-operation-sms-aws-sns/dist/api.js`

- [ ] **Step 1: Run the build**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npm run build
```

Expected: build succeeds, `dist/app.js` and `dist/api.js` exist, no warnings about missing exports.

- [ ] **Step 2: Sanity-check build output exists**

Run:
```bash
ls -1 /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns/dist
```

Expected: at minimum `app.js` and `api.js` listed.

- [ ] **Step 3: Run the full test suite**

Run:
```bash
cd /home/shaun/sms-interface/directus-extension-operation-sms-aws-sns
npm test
```

Expected: all tests pass (9 constants + 10 api = 19 tests).

- [ ] **Step 4: Commit (no source changes; this task only verifies build)**

If `npm run build` produced a `package-lock.json` change or any source-tracked artifact, commit it. Otherwise skip:

```bash
cd /home/shaun/sms-interface
git status
# If anything is uncommitted from build:
git add -A directus-extension-operation-sms-aws-sns
git diff --cached --quiet || git commit -m "chore(sms): verify build output"
```

---

## Task 7: Write the README

**Files:**
- Create: `directus-extension-operation-sms-aws-sns/README.md`

- [ ] **Step 1: Write the README**

Create `directus-extension-operation-sms-aws-sns/README.md`:

```markdown
# directus-extension-operation-sms-aws-sns

Directus flow operation that sends a single SMS via AWS SNS.

## Install

1. Build the extension:
   ```bash
   npm install
   npm run build
   ```
2. Copy the package directory into your Directus instance's `extensions/` folder, **or** publish to npm and `npm install` it from your Directus project.
3. Restart Directus.

## Required environment variables

| Variable | Required | Notes |
|---|---|---|
| `AWS_REGION` | yes | e.g. `us-east-1`. Must be a region where SNS SMS is supported. |
| `AWS_ACCESS_KEY_ID` | conditional | Required unless using the SDK's default credential chain (IAM role, profile). |
| `AWS_SECRET_ACCESS_KEY` | conditional | Same as above. |
| `AWS_SNS_SENDER_ID` | no | Alphanumeric sender ID. Honored only in countries that support it; ignored in US/Canada. |

IAM permission required: `sns:Publish`.

## Operation options

- **To** — recipient phone number, E.164 format (e.g. `+15551234567`). Supports `{{ }}` template variables.
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
git commit -m "docs(sms): add README with install, env vars, and usage"
```

---

## Task 8: Manual end-to-end verification

This task is performed by a human operator with AWS access. There is no automated check.

- [ ] **Step 1: Set environment variables on the Directus host**

In the Directus instance's `.env` (or container env):

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# Optional:
# AWS_SNS_SENDER_ID=MYBRAND
```

- [ ] **Step 2: Verify a destination phone number in SNS sandbox**

In AWS Console → SNS → Mobile → Sandbox destination phone numbers, add and verify your test number. Skip if account is already in production.

- [ ] **Step 3: Confirm SMS spending limit > $0**

AWS Console → SNS → Mobile → Text messaging (SMS) preferences. Default `$1` is fine for a single test.

- [ ] **Step 4: Install the built extension into Directus**

Copy `directus-extension-operation-sms-aws-sns/` (with `dist/`, `package.json`) into Directus's `extensions/` directory. Restart Directus.

- [ ] **Step 5: Build a test flow**

In crf-admin: Settings → Flows → Create.
- Trigger: `Manual`.
- Add operation: pick **Send SMS (AWS SNS)**.
- `To`: your verified phone number (E.164).
- `Message`: `Test from Directus.`
- `SMS Type`: `Transactional`.
- Save flow.

- [ ] **Step 6: Run the flow and verify**

Trigger the flow manually. Confirm:
- SMS received on the test phone, body reads exactly `Test from Directus.\n\n(do not reply)`.
- Flow execution log shows the operation resolved with `{ messageId, to }`.

- [ ] **Step 7: Negative test**

Edit the flow, change `To` to `5551234567` (no `+`). Run again.
Confirm: flow takes the reject path, no SMS sent, log shows `Invalid phone number: must be E.164`.

---

## Self-Review Notes

- **Spec coverage:** Every spec section has a task. Constants + regex → Task 2. Validation → Task 3. Footer + SMSType + SenderID + success + error logging → Task 4. Panel UI (3 fields, overview) → Task 5. Build → Task 6. README (env vars, prerequisites, install) → Task 7. Manual E2E (incl. sandbox + spending cap) → Task 8.
- **Type consistency:** `Options.smsType` literal `"Transactional" | "Promotional"` matches the dropdown choices in `app.ts`. `Result` shape `{ messageId, to }` is what tests assert and what the README documents. `FOOTER` and `E164_REGEX` names match across `constants.ts`, `api.ts`, and tests.
- **No placeholders:** Every code block is complete. Every command has expected output. No "TBD" or "implement later".
