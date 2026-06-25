# Two-Way SMS — Plan 2: Outbound & Spray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the send operation **origination-aware** (Sender ID via Amazon SNS for sprays / a two-way number via AWS End User Messaging for conversational sends), write an `outbound` `client_message` for every successful conversational send, and add a **Spray** operation that blasts selected families via the Sender ID and writes a per-recipient audit row. This is the outbound half of the two-way loop; Plan 3 (inbound) consumes the send + message-writer helpers built here.

**Architecture:** Extend the existing `directus-extension-operation-sms-aws-sns` **bundle** extension. The provider call is factored into a small mockable unit (`sendSms`) that routes by `origination`. The outbound message-writer (`appendOutboundMessage`) is a pure-ish helper over a fake `ItemsService`. The spray recipient selection + per-recipient result mapping is a pure, unit-tested planner mirroring `src/backfill/plan.ts`. Config (`AwsConfig` / `resolveAwsConfig`) and the `sms_settings` bootstrap field list gain the two-way number, with env-overrides-settings precedence preserved.

**Tech Stack:** TypeScript, Directus Extensions SDK v12 (bundle: operations + hook), Vitest, `aws-sdk-client-mock` (mocks both SNS and pinpoint-sms-voice-v2 clients), `@aws-sdk/client-sns` (present), `@aws-sdk/client-pinpoint-sms-voice-v2` (new dependency).

**Spec:** `docs/superpowers/specs/2026-06-23-two-way-sms-ticketing-design.md` — Components §3 (origination-aware send), §5 (Spray); Decisions 1, 2, 5.

**Builds on:** Plan 1 (`docs/superpowers/plans/2026-06-23-two-way-sms-foundation.md`) — `client_ticket` / `client_message` collections, `normalizeAuMobile`, `TICKET_COLLECTION` / `MESSAGE_COLLECTION` constants, the `sms_settings` bootstrap, and the backfill planner pattern.

## Global Constraints

- Extension `host` compatibility: `^10.0.0 || ^11.0.0 || ^12.0.0` (do not narrow).
- Module type is ESM (`"type": "module"`); intra-package imports use the `.js` extension in source (e.g. `import { X } from "../constants.js"`), matching existing files.
- Tests live beside source as `*.test.ts` and run via `npm test` (Vitest, `include: ["src/**/*.test.ts"]`).
- Phone numbers are stored and compared in **E.164** (`E164_REGEX` from `constants.ts`), normalized on the `+614` prefix. The conversational `to` is already E.164 by the time it reaches the send.
- The `(do not reply)` `FOOTER` is appended **only** on the `senderId` (spray) path. The `number` (conversational) path must **not** append it — parents can reply.
- **Two providers, kept side by side** (Decision 1): `senderId` → Amazon SNS `PublishCommand`; `number` → AWS End User Messaging `SendTextMessageCommand`. The operation routes by `origination`.
- Env overrides settings (existing precedence): every field reads `fromEnv.X ?? fromSettings.X`. The new two-way number follows the same rule (`SMS_AWS_TWO_WAY_NUMBER` env overrides the `sms_settings.aws_two_way_number` field).
- **One active two-way number for v1** (Decision 5, pool model). The model is N-number capable via `client_ticket.our_identity`; replies (Plan 3) originate from the ticket's `our_identity`. This plan only needs the single configured number.
- A new dependency (`@aws-sdk/client-pinpoint-sms-voice-v2`) must be added to `package.json` `dependencies` and will be inlined by the bundle build.
- Build + deploy is the existing cycle: `npm run build` → copy `dist/` to the host volume → restart Directus. No restart happens from the SSH sidecar.
- Spray writes **per-recipient `outbound` rows** (Decision 2, preferred). The single-item-with-JSON-recipients fallback is **out of scope** for this plan (build one path, not both) — see Out of scope.

---

## File Structure

- `package.json` (modify) — add `@aws-sdk/client-pinpoint-sms-voice-v2` dependency; register the `sms-spray` operation entry in the bundle.
- `src/config.ts` (modify) — add `twoWayNumber` to `AwsConfig`; resolve it from `SMS_AWS_TWO_WAY_NUMBER` env / `aws_two_way_number` setting with env-overrides-settings precedence.
- `src/config.test.ts` (modify) — assert the two-way number resolves and env overrides settings.
- `src/hook/index.ts` (modify) — add an `aws_two_way_number` field to the `sms_settings` bootstrap field list.
- `src/send/provider.ts` (create) — `sendSms()`: origination-aware provider call (SNS vs pinpoint-sms-voice-v2), the only place that talks to AWS. Mockable unit.
- `src/send/provider.test.ts` (create) — provider routing + conditional-footer unit tests (both AWS clients mocked).
- `src/send/outbound.ts` (create) — `appendOutboundMessage()`: find-or-create the open ticket and insert an `outbound` `client_message`, bump `last_message_at`. Operates over an injected `ItemsService`.
- `src/send/outbound.test.ts` (create) — ticket find-vs-create + row-shape unit tests (fake `ItemsService`).
- `src/operation/api.ts` (modify) — add the `origination` option; route through `sendSms`; on `origination: number` append an outbound message via `appendOutboundMessage`.
- `src/operation/app.ts` (modify) — add the `origination` dropdown to the send operation UI.
- `src/operation/api.test.ts` (modify) — extend existing tests for the two origination paths + footer behaviour.
- `src/spray/plan.ts` (create) — `planSpray()` pure planner: select eligible recipients + map per-recipient send results to audit rows.
- `src/spray/plan.test.ts` (create) — planner unit tests.
- `src/spray/api.ts` (create) — `sms-spray` operation handler (read families → `sendSms` per recipient → `appendOutboundMessage` per recipient).
- `src/spray/app.ts` (create) — spray operation UI (message + sms type).

---

## Task 1: Add `@aws-sdk/client-pinpoint-sms-voice-v2` dependency

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the `SendTextMessageCommand` provider client available to `src/send/provider.ts` (Task 4) and inlined into the bundle on build.

- [ ] **Step 1: Add the dependency**

In `package.json`, add the new package to `dependencies` (keep `@aws-sdk/client-sns`):

```json
"dependencies": {
  "@aws-sdk/client-sns": "^3.700.0",
  "@aws-sdk/client-pinpoint-sms-voice-v2": "^3.700.0"
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: `@aws-sdk/client-pinpoint-sms-voice-v2` resolves and appears in `node_modules`; no peer-dep errors.

- [ ] **Step 3: Run the existing suite (no regressions)**

Run: `npm test`
Expected: PASS — adding a dependency must not change existing behaviour.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(sms): add @aws-sdk/client-pinpoint-sms-voice-v2 for End User Messaging"
```

---

## Task 2: Config — resolve the two-way number

**Files:**
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`

**Interfaces:**
- Consumes: `SMS_AWS_TWO_WAY_NUMBER` env / `sms_settings.aws_two_way_number` (added in Task 3).
- Produces:
  - `AwsConfig` gains `twoWayNumber?: string` — the E.164 origination identity for the `number` path.
  - `resolveAwsConfig` resolves it with env-overrides-settings precedence, identical to the other fields.
- Consumed by: the send operation (Task 5) and the spray operation (Task 7).

- [ ] **Step 1: Write the failing config test**

Add these cases to `src/config.test.ts` (a new `describe` block; keep existing tests as-is):

```ts
import { describe, it, expect } from "vitest";
import { resolveAwsConfig } from "./config.js";

const makeCtx = (env: Record<string, string | undefined>, settingsRow: Record<string, unknown> = {}) => ({
  env,
  services: {
    ItemsService: class {
      constructor(public collection: string, public _opts: unknown) {}
      async readSingleton() {
        return settingsRow;
      }
    },
  } as any,
  getSchema: async () => ({}) as any,
  accountability: null,
});

describe("resolveAwsConfig — two-way number", () => {
  it("reads aws_two_way_number from settings when env is unset", async () => {
    const cfg = await resolveAwsConfig(
      makeCtx({}, { aws_region: "ap-southeast-2", aws_two_way_number: "+61480000001" }),
    );
    expect(cfg.twoWayNumber).toBe("+61480000001");
  });

  it("SMS_AWS_TWO_WAY_NUMBER env overrides the settings value", async () => {
    const cfg = await resolveAwsConfig(
      makeCtx(
        { SMS_AWS_REGION: "ap-southeast-2", SMS_AWS_TWO_WAY_NUMBER: "+61480000999" },
        { aws_region: "ap-southeast-2", aws_two_way_number: "+61480000001" },
      ),
    );
    expect(cfg.twoWayNumber).toBe("+61480000999");
  });

  it("leaves twoWayNumber undefined when configured nowhere", async () => {
    const cfg = await resolveAwsConfig(makeCtx({ SMS_AWS_REGION: "ap-southeast-2" }, { aws_region: "ap-southeast-2" }));
    expect(cfg.twoWayNumber).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/config.test.ts`
Expected: FAIL — `cfg.twoWayNumber` is `undefined` in the first two cases (the field is not yet resolved).

- [ ] **Step 3: Implement — extend `AwsConfig` and `resolveAwsConfig`**

In `src/config.ts`, add `twoWayNumber` to the type:

```ts
export type AwsConfig = {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  senderId?: string;
  twoWayNumber?: string;
};
```

Add the env read alongside the existing `fromEnv` fields:

```ts
  const fromEnv = {
    region: trimOrUndefined(ctx.env.SMS_AWS_REGION),
    accessKeyId: trimOrUndefined(ctx.env.SMS_AWS_ACCESS_KEY_ID),
    secretAccessKey: trimOrUndefined(ctx.env.SMS_AWS_SECRET_ACCESS_KEY),
    senderId: trimOrUndefined(ctx.env.SMS_AWS_SNS_SENDER_ID),
    twoWayNumber: trimOrUndefined(ctx.env.SMS_AWS_TWO_WAY_NUMBER),
  };
```

The two-way number is **optional**, so it must NOT be part of `allEnvSet` (that gate decides whether to skip the settings read; requiring an optional field there would force every deployment to set it). Leave `allEnvSet` exactly as it is.

Add it to the `fromSettings` shape and read:

```ts
  let fromSettings: {
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    senderId?: string;
    twoWayNumber?: string;
  } = {};
```

```ts
      fromSettings = {
        region: trimOrUndefined((row as any).aws_region),
        accessKeyId: trimOrUndefined((row as any).aws_access_key_id),
        secretAccessKey: trimOrUndefined((row as any).aws_secret_access_key),
        senderId: trimOrUndefined((row as any).aws_sns_sender_id),
        twoWayNumber: trimOrUndefined((row as any).aws_two_way_number),
      };
```

Add it to the returned object (same env-overrides-settings precedence):

```ts
  return {
    region,
    accessKeyId: fromEnv.accessKeyId ?? fromSettings.accessKeyId,
    secretAccessKey: fromEnv.secretAccessKey ?? fromSettings.secretAccessKey,
    senderId: fromEnv.senderId ?? fromSettings.senderId,
    twoWayNumber: fromEnv.twoWayNumber ?? fromSettings.twoWayNumber,
  };
```

> Note: when only `SMS_AWS_TWO_WAY_NUMBER` is set in env but other fields come from settings, `allEnvSet` is false, so the settings read still runs — `twoWayNumber` then correctly takes the env value via `??`. The third test (configured nowhere) exercises the `undefined` path.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/config.test.ts`
Expected: PASS (new + existing config cases).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat(sms): resolve two-way number in AwsConfig (env overrides settings)"
```

---

## Task 3: Bootstrap the `aws_two_way_number` setting field

**Files:**
- Modify: `src/hook/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: an `aws_two_way_number` field on the `sms_settings` singleton (read by `resolveAwsConfig`, Task 2).

> This extends the existing `sms_settings` bootstrap field list in `ensureSettings`. Consistent with Plan 1, the hook has no unit test; verification is build + a manual Studio smoke-check. The field only appears on **fresh** bootstraps (the `if (collections[SETTINGS_COLLECTION]) return` guard means existing installs already have the collection and won't get the new field automatically — see the deploy note).

- [ ] **Step 1: Add the field to the settings payload**

In `src/hook/index.ts`, inside `ensureSettings`, add the field after `aws_sns_sender_id` in the `fields` array:

```ts
          { field: "aws_sns_sender_id", type: "string", meta: { interface: "input", width: "half", note: "Optional alphanumeric Sender ID (where supported by destination country)." } },
          { field: "aws_two_way_number", type: "string", meta: { interface: "input", width: "half", note: "E.164 two-way number for conversational sends (AWS End User Messaging origination identity). Prefer SMS_AWS_TWO_WAY_NUMBER env var in production." } },
```

- [ ] **Step 2: Build the extension**

Run: `npm run build`
Expected: `✔ Done`, no TypeScript errors.

- [ ] **Step 3: Run the full test suite (no regressions)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hook/index.ts
git commit -m "feat(sms): add aws_two_way_number field to sms_settings bootstrap"
```

- [ ] **Step 5: Deploy + settings note (manual gate)**

Deploy `dist/`, restart Directus. On a **fresh** install the `Sms Settings` singleton now shows a `Two Way Number` field. On an **existing** install (collection already created), add the field manually in Studio (`sms_settings` → new String field `aws_two_way_number`) **or** set `SMS_AWS_TWO_WAY_NUMBER` in env (env always wins). Populate it with the registered AU two-way number in E.164 (`+614…` or `+6148…`).

---

## Task 4: Origination-aware provider call (`sendSms`)

**Files:**
- Create: `src/send/provider.ts`
- Create: `src/send/provider.test.ts`

**Interfaces:**
- Consumes: `AwsConfig` (Task 2); `FOOTER`, `E164_REGEX` (`constants.ts`).
- Produces:
  - `type Origination = "senderId" | "number"`
  - `type SendSmsInput = { to: string; message: string; origination: Origination; smsType?: "Transactional" | "Promotional" }`
  - `type SendSmsResult = { messageId: string; to: string; from: string; origination: Origination }`
  - `async function sendSms(input: SendSmsInput, config: AwsConfig): Promise<SendSmsResult>` — routes by `origination`; SNS `PublishCommand` for `senderId` (footer appended), pinpoint-sms-voice-v2 `SendTextMessageCommand` for `number` (NO footer). The single AWS boundary. **Plan 3's reply action calls this with `origination: "number"`.**

> `sendSms` builds its own AWS clients from `config` (region + optional explicit creds), mirroring the existing operation. Both clients are constructed inside `sendSms` so `aws-sdk-client-mock` (which patches the client class globally) intercepts them in tests.

- [ ] **Step 1: Write the failing provider test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/send/provider.test.ts`
Expected: FAIL — `Cannot find module './provider.js'`.

- [ ] **Step 3: Write `sendSms`**

```ts
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

  const client = new SNSClient({ region: config.region, ...(credentials ? { credentials } : {}) });
  const result = await client.send(
    new PublishCommand({ PhoneNumber: to, Message: finalMessage, MessageAttributes: messageAttributes }),
  );
  return { messageId: result.MessageId ?? "", to, from: config.senderId ?? "", origination };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/send/provider.test.ts`
Expected: PASS (all cases — footer present on `senderId`, absent on `number`).

- [ ] **Step 5: Commit**

```bash
git add src/send/provider.ts src/send/provider.test.ts
git commit -m "feat(sms): origination-aware sendSms (SNS senderId / EUM number), conditional footer"
```

---

## Task 5: Outbound message-writer (`appendOutboundMessage`)

**Files:**
- Create: `src/send/outbound.ts`
- Create: `src/send/outbound.test.ts`

**Interfaces:**
- Consumes: `TICKET_COLLECTION`, `MESSAGE_COLLECTION` (`constants.ts`); a Directus `ItemsService` factory passed in (so it is testable with a fake).
- Produces:
  - `type ItemsServiceLike = { readByQuery(q: unknown): Promise<any[]>; createOne(item: Record<string, unknown>): Promise<string | number>; updateOne(key: string | number, item: Record<string, unknown>): Promise<string | number>; }`
  - `type AppendOutboundDeps = { items: (collection: string) => ItemsServiceLike; now?: () => string }`
  - `type AppendOutboundInput = { externalIdentity: string; ourIdentity: string; body: string; externalMessageId: string; client?: string | null; raw?: unknown }`
  - `type AppendOutboundResult = { ticketId: string | number; messageId: string | number; createdTicket: boolean }`
  - `async function appendOutboundMessage(input: AppendOutboundInput, deps: AppendOutboundDeps): Promise<AppendOutboundResult>` — finds the OPEN `client_ticket` for `(external_identity, our_identity)` or creates one, inserts an `outbound` `client_message` (`external_message_id` = provider id, `delivery_status: "sent"`), bumps `last_message_at`. **Plan 3's reply action calls this after `sendSms`.**

> `external_identity` = the parent's E.164 number (the conversational `to`). `our_identity` = the two-way number we sent from (`SendSmsResult.from`). Matching the OPEN ticket on **both** keeps the model N-number capable (Decision 5): the same parent on two different numbers is two threads.

- [ ] **Step 1: Write the failing outbound-writer test**

```ts
// src/send/outbound.test.ts
import { describe, it, expect, vi } from "vitest";
import { appendOutboundMessage, type ItemsServiceLike } from "./outbound.js";

const makeItems = (existingTickets: any[] = []) => {
  const tickets: any[] = [...existingTickets];
  const messages: any[] = [];
  let ticketSeq = existingTickets.length;
  let messageSeq = 0;

  const ticketService: ItemsServiceLike = {
    readByQuery: vi.fn(async (q: any) => {
      const filter = q.filter ?? {};
      const ext = filter.external_identity?._eq;
      const our = filter.our_identity?._eq;
      const status = filter.status?._eq;
      return tickets.filter(
        (t) =>
          (ext === undefined || t.external_identity === ext) &&
          (our === undefined || t.our_identity === our) &&
          (status === undefined || t.status === status),
      );
    }),
    createOne: vi.fn(async (item: any) => {
      const id = `t${++ticketSeq}`;
      tickets.push({ id, ...item });
      return id;
    }),
    updateOne: vi.fn(async (id: any, patch: any) => {
      const t = tickets.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
      return id;
    }),
  };

  const messageService: ItemsServiceLike = {
    readByQuery: vi.fn(async () => messages),
    createOne: vi.fn(async (item: any) => {
      const id = `m${++messageSeq}`;
      messages.push({ id, ...item });
      return id;
    }),
    updateOne: vi.fn(async (id: any) => id),
  };

  const items = (collection: string): ItemsServiceLike =>
    collection === "client_ticket" ? ticketService : messageService;

  return { items, ticketService, messageService, tickets, messages };
};

const input = {
  externalIdentity: "+61400000001",
  ourIdentity: "+61480000001",
  body: "See you at 3pm",
  externalMessageId: "eum-1",
  client: "fam-1",
};

describe("appendOutboundMessage", () => {
  it("creates a ticket when no open ticket exists, then inserts the outbound message", async () => {
    const h = makeItems([]);
    const res = await appendOutboundMessage(input, { items: h.items, now: () => "2026-06-25T00:00:00.000Z" });

    expect(res.createdTicket).toBe(true);
    expect(h.ticketService.createOne).toHaveBeenCalledTimes(1);
    const ticketArg = (h.ticketService.createOne as any).mock.calls[0][0];
    expect(ticketArg).toMatchObject({
      status: "open",
      channel: "sms",
      external_identity: "+61400000001",
      our_identity: "+61480000001",
      client: "fam-1",
      last_message_at: "2026-06-25T00:00:00.000Z",
    });

    const msgArg = (h.messageService.createOne as any).mock.calls[0][0];
    expect(msgArg).toMatchObject({
      ticket: res.ticketId,
      direction: "outbound",
      channel: "sms",
      body: "See you at 3pm",
      from_identity: "+61480000001",
      to_identity: "+61400000001",
      external_message_id: "eum-1",
      delivery_status: "sent",
      timestamp: "2026-06-25T00:00:00.000Z",
    });
  });

  it("appends to the existing OPEN ticket for the same (external, our) pair and bumps last_message_at", async () => {
    const h = makeItems([
      { id: "t-open", status: "open", external_identity: "+61400000001", our_identity: "+61480000001", client: "fam-1" },
    ]);
    const res = await appendOutboundMessage(input, { items: h.items, now: () => "2026-06-25T01:00:00.000Z" });

    expect(res.createdTicket).toBe(false);
    expect(res.ticketId).toBe("t-open");
    expect(h.ticketService.createOne).not.toHaveBeenCalled();
    expect(h.ticketService.updateOne).toHaveBeenCalledWith("t-open", { last_message_at: "2026-06-25T01:00:00.000Z" });
    expect((h.messageService.createOne as any).mock.calls[0][0].ticket).toBe("t-open");
  });

  it("ignores a CLOSED ticket and creates a new open one (closed → new thread)", async () => {
    const h = makeItems([
      { id: "t-closed", status: "closed", external_identity: "+61400000001", our_identity: "+61480000001" },
    ]);
    const res = await appendOutboundMessage(input, { items: h.items });
    expect(res.createdTicket).toBe(true);
    expect(h.ticketService.createOne).toHaveBeenCalledTimes(1);
  });

  it("does not match a ticket on a different our_identity (N-number isolation)", async () => {
    const h = makeItems([
      { id: "t-other", status: "open", external_identity: "+61400000001", our_identity: "+61480000999" },
    ]);
    const res = await appendOutboundMessage(input, { items: h.items });
    expect(res.createdTicket).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/send/outbound.test.ts`
Expected: FAIL — `Cannot find module './outbound.js'`.

- [ ] **Step 3: Write `appendOutboundMessage`**

```ts
// src/send/outbound.ts
import { TICKET_COLLECTION, MESSAGE_COLLECTION } from "../constants.js";

export type ItemsServiceLike = {
  readByQuery(q: unknown): Promise<any[]>;
  createOne(item: Record<string, unknown>): Promise<string | number>;
  updateOne(key: string | number, item: Record<string, unknown>): Promise<string | number>;
};

export type AppendOutboundDeps = {
  items: (collection: string) => ItemsServiceLike;
  now?: () => string;
};

export type AppendOutboundInput = {
  externalIdentity: string;
  ourIdentity: string;
  body: string;
  externalMessageId: string;
  client?: string | null;
  raw?: unknown;
};

export type AppendOutboundResult = {
  ticketId: string | number;
  messageId: string | number;
  createdTicket: boolean;
};

/**
 * Find the OPEN client_ticket for (external_identity, our_identity) or create one,
 * insert an `outbound` client_message keyed on the provider message id, and bump last_message_at.
 * Used by the send operation (origination=number) and by Plan 3's reply action.
 */
export async function appendOutboundMessage(
  input: AppendOutboundInput,
  deps: AppendOutboundDeps,
): Promise<AppendOutboundResult> {
  const now = deps.now ? deps.now() : new Date().toISOString();
  const tickets = deps.items(TICKET_COLLECTION);
  const messages = deps.items(MESSAGE_COLLECTION);

  const open = await tickets.readByQuery({
    filter: {
      external_identity: { _eq: input.externalIdentity },
      our_identity: { _eq: input.ourIdentity },
      status: { _eq: "open" },
    },
    limit: 1,
  });

  let ticketId: string | number;
  let createdTicket = false;

  if (Array.isArray(open) && open.length > 0) {
    ticketId = open[0].id;
    await tickets.updateOne(ticketId, { last_message_at: now });
  } else {
    ticketId = await tickets.createOne({
      status: "open",
      channel: "sms",
      external_identity: input.externalIdentity,
      our_identity: input.ourIdentity,
      client: input.client ?? null,
      last_message_at: now,
    });
    createdTicket = true;
  }

  const messageId = await messages.createOne({
    ticket: ticketId,
    direction: "outbound",
    channel: "sms",
    body: input.body,
    from_identity: input.ourIdentity,
    to_identity: input.externalIdentity,
    external_message_id: input.externalMessageId,
    delivery_status: "sent",
    raw: input.raw ?? null,
    timestamp: now,
  });

  return { ticketId, messageId, createdTicket };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/send/outbound.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/send/outbound.ts src/send/outbound.test.ts
git commit -m "feat(sms): appendOutboundMessage — find/create open ticket + outbound row"
```

---

## Task 6: Wire `origination` into the send operation

**Files:**
- Modify: `src/operation/api.ts`
- Modify: `src/operation/app.ts`
- Modify: `src/operation/api.test.ts`

**Interfaces:**
- Consumes: `sendSms` (Task 4), `appendOutboundMessage` (Task 5), `resolveAwsConfig` (Task 2).
- Produces:
  - `Options` gains `origination: "senderId" | "number"` (default `senderId`, preserving current behaviour for existing flows).
  - `Result` gains `from`, `origination`, and (for the `number` path) `ticketId` / `messageId`.
  - On `origination: number`, the operation appends an `outbound` `client_message` via `appendOutboundMessage`.

- [ ] **Step 1: Extend the existing operation tests**

Add these cases to `src/operation/api.test.ts`. The existing tests already mock `SNSClient`; import and reset the pinpoint mock too, and extend the fake `services` with `ItemsService` create/read so the `number` path can write a message.

```ts
import { mockClient } from "aws-sdk-client-mock";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
} from "@aws-sdk/client-pinpoint-sms-voice-v2";

const pinpointMock = mockClient(PinpointSMSVoiceV2Client);

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/operation/api.test.ts`
Expected: FAIL — the `number` path is not yet implemented (no `origination` handling, no message write, `result.from` undefined).

- [ ] **Step 3: Rewrite the operation handler**

Replace `src/operation/api.ts` with the following (routes through `sendSms`; appends an outbound message on the `number` path; preserves the SNS-error logging behaviour the existing error-path test asserts):

```ts
import { defineOperationApi } from "@directus/extensions-sdk";
import { resolveAwsConfig } from "../config.js";
import { sendSms, type Origination } from "../send/provider.js";
import { appendOutboundMessage, type ItemsServiceLike } from "../send/outbound.js";

export type Options = {
  to: string;
  message: string;
  smsType: "Transactional" | "Promotional";
  origination?: Origination;
};

export type Result = {
  messageId: string;
  to: string;
  from: string;
  origination: Origination;
  ticketId?: string | number;
  clientMessageId?: string | number;
};

export default defineOperationApi<Options>({
  id: "sms-aws-sns",
  handler: async (
    { to, message, smsType, origination },
    { env, services, getSchema, accountability, logger }
  ) => {
    const route: Origination = origination === "number" ? "number" : "senderId";

    const config = await resolveAwsConfig({
      env: env as Record<string, string | undefined>,
      services,
      getSchema,
      accountability,
    });

    let sent;
    try {
      sent = await sendSms({ to, message, origination: route, smsType }, config);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      logger.error(
        `SMS send failed (${route}): ${e.name ?? "Error"}: ${e.message ?? String(err)}`
      );
      throw err;
    }

    const result: Result = {
      messageId: sent.messageId,
      to: sent.to,
      from: sent.from,
      origination: route,
    };

    if (route === "number") {
      const { ItemsService } = services as any;
      const schema = await getSchema();
      const items = (collection: string): ItemsServiceLike =>
        new ItemsService(collection, { schema, accountability });
      const written = await appendOutboundMessage(
        {
          externalIdentity: sent.to,
          ourIdentity: sent.from,
          body: message,
          externalMessageId: sent.messageId,
        },
        { items }
      );
      result.ticketId = written.ticketId;
      result.clientMessageId = written.messageId;
    }

    return result;
  },
});
```

- [ ] **Step 4: Add the `origination` option to the operation UI**

In `src/operation/app.ts`, update the footer note on the `message` option (footer is now conditional) and add the `origination` dropdown. Replace the `message` option's `note` and add the new option before `smsType`:

Change the `message` note to:

```ts
        note: "SMS body. Supports {{ }} template variables. A (do not reply) footer is appended automatically on the Sender ID (spray) path only — not on the two-way number path.",
```

Add this option to the `options` array (before the `smsType` option):

```ts
    {
      field: "origination",
      name: "Origination",
      type: "string",
      schema: { default_value: "senderId" },
      meta: {
        width: "half",
        interface: "select-dropdown",
        options: {
          choices: [
            { text: "Sender ID (one-way, footer appended)", value: "senderId" },
            { text: "Two-way number (replyable, no footer, logs a ticket message)", value: "number" },
          ],
        },
        note: "Sender ID sends via Amazon SNS. Two-way number sends via AWS End User Messaging and appends an outbound message to the client ticket.",
      },
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/operation/api.test.ts`
Expected: PASS — including the existing validation/success/error-path tests (still covered: E.164 rejection and empty-message rejection now happen inside `sendSms`, which throws the same messages; the error-path test's logged string now contains `SMS send failed (senderId)` plus the SNS error name/message, so its `toContain("InvalidParameterException")` / `toContain("Invalid parameter: PhoneNumber")` assertions still hold).

> If the existing error-path test asserted the literal prefix `SNS Publish failed`, update that assertion to the new prefix `SMS send failed`. The name + message substrings it checks are unchanged.

- [ ] **Step 6: Build + full suite**

Run: `npm run build && npm test`
Expected: build `✔ Done`; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/operation/api.ts src/operation/app.ts src/operation/api.test.ts
git commit -m "feat(sms): origination option on send op (number path writes outbound message)"
```

---

## Task 7: Spray — planner + operation

**Files:**
- Create: `src/spray/plan.ts`
- Create: `src/spray/plan.test.ts`
- Create: `src/spray/api.ts`
- Create: `src/spray/app.ts`
- Modify: `package.json` (register the `sms-spray` operation entry)

**Interfaces:**
- Consumes: `normalizeAuMobile` (Plan 1), `sendSms` (Task 4), `appendOutboundMessage` (Task 5), `resolveAwsConfig` (Task 2).
- Produces:
  - `type SprayFamilyRow = { id: string; family_sms_option?: unknown; family_admin_mobile?: unknown }`
  - `type SprayRecipient = { familyId: string; to: string }`
  - `type SprayPlan = { recipients: SprayRecipient[]; skipped: { familyId: string; reason: "opted-out" | "no-mobile" | "bad-number" }[] }`
  - `function planSpray(families: SprayFamilyRow[]): SprayPlan` — pure selection: keep families whose `family_sms_option` is truthy AND whose `family_admin_mobile` normalizes to a mobile E.164; record the rest with a reason.
  - `type SpraySendResult = { familyId: string; to: string; status: "sent" | "failed"; messageId?: string; error?: string }`
  - `function summarizeSpray(results: SpraySendResult[]): { sent: number; failed: number; total: number }` — pure result mapping.
  - A Directus operation `sms-spray` with options `{ message: string; smsType: "Transactional" | "Promotional" }`.

> Recipient eligibility is keyed on `family_sms_option` (spec §5) and a valid mobile. The planner is pure (mirrors `src/backfill/plan.ts`): the operation reads families, plans, then for each recipient calls `sendSms({ origination: "senderId" })` and writes a per-recipient `outbound` `client_message` (Decision 2). `summarizeSpray` keeps result-counting testable without AWS.

- [ ] **Step 1: Write the failing planner test**

```ts
// src/spray/plan.test.ts
import { describe, it, expect } from "vitest";
import { planSpray, summarizeSpray } from "./plan.js";

describe("planSpray", () => {
  it("includes opted-in families with a valid mobile (normalized to E.164)", () => {
    const out = planSpray([{ id: "f1", family_sms_option: true, family_admin_mobile: "0400 000 001" }]);
    expect(out.recipients).toEqual([{ familyId: "f1", to: "+61400000001" }]);
    expect(out.skipped).toHaveLength(0);
  });

  it("skips families with a falsy family_sms_option as opted-out", () => {
    const out = planSpray([{ id: "f2", family_sms_option: false, family_admin_mobile: "0400000002" }]);
    expect(out.recipients).toHaveLength(0);
    expect(out.skipped).toContainEqual({ familyId: "f2", reason: "opted-out" });
  });

  it("skips an opted-in family with no mobile", () => {
    const out = planSpray([{ id: "f3", family_sms_option: true, family_admin_mobile: null }]);
    expect(out.skipped).toContainEqual({ familyId: "f3", reason: "no-mobile" });
  });

  it("skips an opted-in family whose number is a landline/unknown", () => {
    const out = planSpray([{ id: "f4", family_sms_option: true, family_admin_mobile: "03 9123 4567" }]);
    expect(out.skipped).toContainEqual({ familyId: "f4", reason: "bad-number" });
  });

  it("partitions a mixed batch", () => {
    const out = planSpray([
      { id: "a", family_sms_option: true, family_admin_mobile: "+61400000001" },
      { id: "b", family_sms_option: 1, family_admin_mobile: "0400000002" },
      { id: "c", family_sms_option: 0, family_admin_mobile: "0400000003" },
      { id: "d", family_sms_option: true, family_admin_mobile: "" },
    ]);
    expect(out.recipients.map((r) => r.familyId)).toEqual(["a", "b"]);
    expect(out.skipped.map((s) => s.familyId).sort()).toEqual(["c", "d"]);
  });
});

describe("summarizeSpray", () => {
  it("counts sent vs failed", () => {
    const summary = summarizeSpray([
      { familyId: "a", to: "+61400000001", status: "sent", messageId: "1" },
      { familyId: "b", to: "+61400000002", status: "failed", error: "throttled" },
      { familyId: "c", to: "+61400000003", status: "sent", messageId: "3" },
    ]);
    expect(summary).toEqual({ sent: 2, failed: 1, total: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/spray/plan.test.ts`
Expected: FAIL — `Cannot find module './plan.js'`.

- [ ] **Step 3: Write the planner**

```ts
// src/spray/plan.ts
import { normalizeAuMobile } from "../phone.js";

export type SprayFamilyRow = {
  id: string;
  family_sms_option?: unknown;
  family_admin_mobile?: unknown;
};

export type SprayRecipient = { familyId: string; to: string };

export type SpraySkip = {
  familyId: string;
  reason: "opted-out" | "no-mobile" | "bad-number";
};

export type SprayPlan = { recipients: SprayRecipient[]; skipped: SpraySkip[] };

export type SpraySendResult = {
  familyId: string;
  to: string;
  status: "sent" | "failed";
  messageId?: string;
  error?: string;
};

/**
 * Pure recipient selection for a spray: opted-in families with a valid mobile.
 * Everyone else is recorded with a reason (audit + UI summary).
 */
export function planSpray(families: SprayFamilyRow[]): SprayPlan {
  const recipients: SprayRecipient[] = [];
  const skipped: SpraySkip[] = [];

  for (const fam of families) {
    if (!fam.family_sms_option) {
      skipped.push({ familyId: fam.id, reason: "opted-out" });
      continue;
    }
    const norm = normalizeAuMobile(fam.family_admin_mobile);
    if (norm.kind === "empty") {
      skipped.push({ familyId: fam.id, reason: "no-mobile" });
      continue;
    }
    if (norm.kind !== "mobile" || !norm.e164) {
      skipped.push({ familyId: fam.id, reason: "bad-number" });
      continue;
    }
    recipients.push({ familyId: fam.id, to: norm.e164 });
  }

  return { recipients, skipped };
}

export function summarizeSpray(results: SpraySendResult[]): {
  sent: number;
  failed: number;
  total: number;
} {
  let sent = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "sent") sent++;
    else failed++;
  }
  return { sent, failed, total: results.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/spray/plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the spray operation handler**

```ts
// src/spray/api.ts
import { defineOperationApi } from "@directus/extensions-sdk";
import { resolveAwsConfig } from "../config.js";
import { sendSms } from "../send/provider.js";
import { appendOutboundMessage, type ItemsServiceLike } from "../send/outbound.js";
import {
  planSpray,
  summarizeSpray,
  type SprayFamilyRow,
  type SpraySendResult,
} from "./plan.js";

export type Options = {
  message: string;
  smsType: "Transactional" | "Promotional";
};

export default defineOperationApi<Options>({
  id: "sms-spray",
  handler: async (
    { message, smsType },
    { env, services, getSchema, accountability, logger }
  ) => {
    if (typeof message !== "string" || message.trim().length === 0) {
      throw new Error("Message body is required");
    }

    const config = await resolveAwsConfig({
      env: env as Record<string, string | undefined>,
      services,
      getSchema,
      accountability,
    });

    const { ItemsService } = services as any;
    const schema = await getSchema();
    const families = new ItemsService("family", { schema, accountability });

    const rows: SprayFamilyRow[] = await families.readByQuery({
      fields: ["id", "family_sms_option", "family_admin_mobile"],
      limit: -1,
    });

    const { recipients, skipped } = planSpray(rows);

    const items = (collection: string): ItemsServiceLike =>
      new ItemsService(collection, { schema, accountability });

    const results: SpraySendResult[] = [];
    for (const r of recipients) {
      try {
        const sent = await sendSms(
          { to: r.to, message, origination: "senderId", smsType },
          config
        );
        // Per-recipient audit row (Decision 2). our_identity = the Sender ID we sent from.
        await appendOutboundMessage(
          {
            externalIdentity: r.to,
            ourIdentity: sent.from || (config.senderId ?? ""),
            body: message,
            externalMessageId: sent.messageId,
            client: r.familyId,
          },
          { items }
        );
        results.push({ familyId: r.familyId, to: r.to, status: "sent", messageId: sent.messageId });
      } catch (err) {
        const e = err as { name?: string; message?: string };
        const msg = `${e.name ?? "Error"}: ${e.message ?? String(err)}`;
        logger.error(`Spray send failed for family ${r.familyId} (${r.to}): ${msg}`);
        results.push({ familyId: r.familyId, to: r.to, status: "failed", error: msg });
      }
    }

    const summary = summarizeSpray(results);
    logger.info(
      `Spray complete: ${summary.sent} sent, ${summary.failed} failed, ${skipped.length} skipped.`
    );
    return { summary, skipped, results };
  },
});
```

- [ ] **Step 6: Write the spray operation UI**

```ts
// src/spray/app.ts
import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "sms-spray",
  name: "Spray SMS (AWS SNS, one-way)",
  icon: "campaign",
  description:
    "Blast a one-way SMS to all opted-in families (family_sms_option) via the Sender ID. Appends a (do not reply) footer and logs a per-recipient outbound message.",
  overview: ({ message }) => [
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
      field: "message",
      name: "Message",
      type: "text",
      meta: {
        width: "full",
        interface: "input-multiline",
        options: { placeholder: "School is closed today due to weather." },
        required: true,
        note: "SMS body sent to every opted-in family. A (do not reply) footer is appended automatically. Supports {{ }} template variables.",
      },
    },
    {
      field: "smsType",
      name: "SMS Type",
      type: "string",
      schema: { default_value: "Promotional" },
      meta: {
        width: "half",
        interface: "select-dropdown",
        options: {
          choices: [
            { text: "Promotional", value: "Promotional" },
            { text: "Transactional", value: "Transactional" },
          ],
        },
      },
    },
  ],
});
```

- [ ] **Step 7: Register the operation in the bundle**

In `package.json`, add a fourth entry to `directus:extension.entries` (after the `sms-number-backfill` operation):

```json
{
  "type": "operation",
  "name": "sms-spray",
  "source": { "app": "src/spray/app.ts", "api": "src/spray/api.ts" }
}
```

- [ ] **Step 8: Build + full suite**

Run: `npm run build && npm test`
Expected: build `✔ Done`; all tests PASS (phone, config, constants, operation, ticketing-schema, backfill, provider, outbound, spray).

- [ ] **Step 9: Commit**

```bash
git add src/spray package.json
git commit -m "feat(sms): add sms-spray operation (opted-in families, per-recipient audit)"
```

- [ ] **Step 10: Deploy + smoke-check (manual gate)**

Deploy `dist/`, restart Directus. Build a throwaway manual flow with the **Spray SMS** operation, message it to a tiny test cohort (or one opted-in test family), run it, and confirm: (a) the recipient receives the text with the `(do not reply)` footer, (b) a per-recipient `outbound` `client_message` exists with `delivery_status: sent` and the provider `external_message_id`, (c) the operation result `summary`/`skipped` looks right. Separately, run the **Send SMS** operation with `origination: number` to a number you control and confirm the reply-capable text has **no** footer and an `outbound` message was logged.

---

## Self-Review

**Spec coverage (Plan 2 portion):**
- §3 / Decision 1 — origination-aware send, two providers side by side (SNS Sender ID / EUM number), routed by `origination` → Tasks 4, 6. ✔
- Conditional footer — appended on `senderId` only, never on `number` (tested both ways) → Task 4 (`sendSms`), Task 6 (operation), Task 7 (spray uses `senderId` → footer). ✔
- Config extension — `SMS_AWS_TWO_WAY_NUMBER` env + `aws_two_way_number` setting, env-overrides-settings, `AwsConfig.twoWayNumber`, bootstrap field → Tasks 2, 3. ✔
- Outbound `client_message` writer — find-or-create OPEN ticket on `(external_identity, our_identity)`, insert `outbound` row (`external_message_id`, `delivery_status: "sent"`), bump `last_message_at`; closed→new, N-number isolation tested → Task 5. ✔
- §5 / Decision 2 — spray over `family_sms_option`-filtered families via `origination: senderId`, per-recipient `outbound` audit row → Task 7. ✔
- Decision 5 — single two-way number in v1; N-number capability preserved via `our_identity` matching (not hard-coded) → Tasks 5, 6. ✔
- New dependency `@aws-sdk/client-pinpoint-sms-voice-v2` added to `package.json` dependencies (bundle-inlined) → Task 1. ✔
- Each new operation has a `package.json` bundle entry (exact JSON shown) → Tasks 6 (existing `sms-aws-sns` reused) and 7 (`sms-spray` new). ✔

**Placeholder scan:** No TBD/TODO; every code step shows complete code (no "add error handling" stubs — the spray loop's per-recipient try/catch and the operation's error logging are written out in full). Manual gates (settings field on existing installs, spray/number smoke-checks) are explicitly labelled non-automated verification, not placeholders. ✔

**Type consistency (cross-task and cross-plan):**
- `Origination = "senderId" | "number"` defined once in `src/send/provider.ts`; re-used by the operation `Options.origination` (Task 6) and passed literally by the spray (Task 7). ✔
- `AwsConfig.twoWayNumber` (Task 2) is consumed by `sendSms` (Task 4) and reached via `resolveAwsConfig` by both operations. ✔
- `ItemsServiceLike` defined once in `src/send/outbound.ts`; the operation and spray both build `items: (collection) => new ItemsService(...)` matching that shape; the test fakes implement the same three methods. ✔
- `appendOutboundMessage` row shape (`direction/channel/from_identity/to_identity/external_message_id/delivery_status/timestamp`) matches the Plan 1 `messageCollectionPayload` fields exactly. ✔
- `external_identity` / `our_identity` ticket fields match the Plan 1 `ticketCollectionPayload`. ✔

**Plan 3 interface contract (named exports Plan 3 will call):**
- `sendSms(input: SendSmsInput, config: AwsConfig): Promise<SendSmsResult>` from `src/send/provider.ts` — Plan 3's "Reply to ticket" action calls it with `origination: "number"`, `to = ticket.external_identity`, after resolving `config.twoWayNumber` (or per-ticket `our_identity` when N-number).
- `appendOutboundMessage(input: AppendOutboundInput, deps: AppendOutboundDeps): Promise<AppendOutboundResult>` from `src/send/outbound.ts` — Plan 3 calls it after `sendSms` to thread the reply onto the ticket. (`input.ourIdentity` should be the ticket's `our_identity` so the reply lands on the same thread.)
- `resolveAwsConfig` (extended here with `twoWayNumber`) is the shared config source.

---

## Out of scope (later plans / explicitly not built here)

- **Single-item + JSON-recipients spray fallback** (spec §5 / Decision 2 fallback). Per-recipient rows are built; the JSON fallback is NOT — build one path, not both. If per-recipient rows prove impractical at blast volume, that fallback (one `client_message` with a JSON recipients field, queried via Directus 12 JSON filtering) is a follow-up.
- **Recipient sub-selection / cohorts.** This plan sprays all opted-in families. A composer UI to pick a subset is phase 2 (spec Non-Goals); v1 selection is the `family_sms_option` filter plus valid-mobile gating in `planSpray`.
- **Delivery-status callbacks.** `delivery_status` is set to `sent` at send time. Updating to `delivered`/`failed` from AWS delivery receipts (CloudWatch / EUM event destinations) is not built here.
- **Throughput/rate limiting** for the spray loop (long-code ~1 msg/s). v1 sends sequentially and records per-recipient failures; batching/pacing is a follow-up if volume demands it.
- **Plan 3 — Inbound & Two-way:** the SNS-subscribed endpoint adapter (signature verification, subscription handshake, E.164 matching, idempotent inbound upsert keyed on `external_message_id`, 0/1/many family resolution), the two-way ticket UI + Reply action (which consumes `sendSms` + `appendOutboundMessage` from this plan), and the SQS DLQ scheduled-drain + manual replay.
- **Square null-backfill** mechanics (carried over from Plan 1).
