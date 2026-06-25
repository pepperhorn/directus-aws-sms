# Two-Way SMS — Plan 3: Inbound & Two-way Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receive inbound SMS replies from the AU two-way number, capture them as channel-agnostic tickets without ever losing or duplicating a message, and close the loop with a staff Reply action — plus the SQS DLQ drain that recovers anything dropped during a Directus outage.

**Architecture:** Add a `defineEndpoint` adapter to the existing `directus-extension-operation-sms-aws-sns` **bundle**. The endpoint is a thin transport shell over four pure, unit-tested cores: an SNS signature **verifier** (Node `crypto`, no new dep, injectable cert fetch), an SNS-envelope **parser**, a family **resolver** (reuses `normalizeAuMobile`), and the idempotent **upsert adapter** (find-open-ticket-or-create + insert message keyed on unique `external_message_id`). The DLQ **drain** (`@aws-sdk/client-sqs`, mocked with `aws-sdk-client-mock`) replays through the *same* upsert adapter. The Reply action sends via Plan 2's origination-aware `sendSms` and appends an outbound message via Plan 2's `appendOutboundMessage`. The two-way UI is documented Directus Studio config, not a custom module.

**Tech Stack:** TypeScript, Directus Extensions SDK v12 (bundle: operation + hook + endpoint), Vitest, Node `crypto` (signature verify — no runtime dep), `@aws-sdk/client-sqs` (DLQ drain), `aws-sdk-client-mock` (already present).

**Spec:** `docs/superpowers/specs/2026-06-23-two-way-sms-ticketing-design.md` (§2 inbound adapter, §4 resilience & idempotency, §6 two-way UI, Decisions 4 & 5, Testing).

**Depends on:**
- **Plan 1 (landed):** `client_ticket` / `client_message` collections (incl. unique `external_message_id`, `our_identity`, `external_identity`, `status` open/pending/closed), `normalizeAuMobile()`, `TICKET_COLLECTION` / `MESSAGE_COLLECTION` / `E164_REGEX`.
- **Plan 2 (lands first):** exports an origination-aware send `sendSms(opts)` and an `appendOutboundMessage(...)` helper. This plan references them by name and treats them as a hard dependency for Task 7 only — Tasks 1–6 do not need Plan 2 and can proceed in parallel.

## Global Constraints

- Extension `host` compatibility: `^10.0.0 || ^11.0.0 || ^12.0.0` (do not narrow).
- Module type is ESM (`"type": "module"`); intra-package imports use the `.js` extension in source (e.g. `import { X } from "../constants.js"`), matching existing files.
- Tests live beside source as `*.test.ts` and run via `npm test` (Vitest, `include: ["src/**/*.test.ts"]`).
- Phone numbers are stored and compared in **E.164**, normalized on the `+614` prefix via `normalizeAuMobile` (Plan 1). Inbound `originationNumber` matching uses the same utility; only **mobiles** ever match.
- **Idempotency is mandatory:** the inbound path upserts on the unique `client_message.external_message_id` (= AWS `inboundMessageId`). A duplicate id is a no-op/update — **never** a second row. SNS retries and DLQ replays both flow through the same upsert adapter.
- **SNS signature verification is the security boundary** and runs FIRST, before any parsing or side effect. A forged/missing signature, or a `SigningCertURL` whose host is not an `sns.<region>.amazonaws.com` / `*.amazonaws.com` cert host, is rejected with `403`.
- Signature verification uses Node's built-in `crypto` only — **no new runtime dependency**. The cert fetch is an **injected** dependency so unit tests run fully offline (tests generate a throwaway RSA keypair, sign a canonical message, and verify).
- SQS DLQ drain adds `@aws-sdk/client-sqs` to `package.json` `dependencies`; it is mocked in tests with `aws-sdk-client-mock` (already a devDependency) and exercised against live AWS only at the manual deploy gate. The drain loop is unit-testable by injecting the SQS client and the upsert function.
- Build + deploy is the existing cycle: `npm run build` → copy `dist/` to the host volume → restart Directus. **No restart happens from the SSH sidecar.** New deps are inlined by the bundle build.
- **AWS provisioning is EXTERNAL/manual** — registering the two-way number, creating the SNS topic, subscribing the HTTPS endpoint, creating the SQS DLQ, and wiring the scheduled drain flow (interval / long-poll / visibility timeout) are documented manual gates. Code is unit-tested with mocks and verified against live AWS only at the deploy gate.
- The endpoint adds a new bundle entry `{ "type": "endpoint", ... }`; the drain adds a new `{ "type": "operation", ... }` entry. Both shown verbatim.

---

## File Structure

- `src/inbound/sns-verify.ts` (create) — `verifySnsSignature()` pure verifier + canonical string builder; injectable cert fetch.
- `src/inbound/sns-verify.test.ts` (create) — valid / forged / missing-signature / bad-host tests (offline, throwaway keypair).
- `src/inbound/parse.ts` (create) — `parseSnsEnvelope()` + `parseInboundSms()` (SNS envelope → AWS End User Messaging payload).
- `src/inbound/parse.test.ts` (create) — envelope + inner-payload parsing tests.
- `src/inbound/resolve-family.ts` (create) — `resolveFamily()` pure 0/1/many matcher over `family_admin_mobile` + `family_sms_cc[].to_mobile`.
- `src/inbound/resolve-family.test.ts` (create) — 0 / 1 / many resolution tests.
- `src/inbound/upsert.ts` (create) — `upsertInbound()` idempotent adapter (find-open-ticket-or-create + insert message on unique id + bump `last_message_at`). The shared core reused by the drain.
- `src/inbound/upsert.test.ts` (create) — create-vs-append, closed-ticket-→-new, duplicate-id no-op, last_message_at bump (fake ItemsService).
- `src/inbound/index.ts` (create) — `defineEndpoint` wiring: verify → handshake → parse → resolve → upsert.
- `src/inbound/types.ts` (create) — shared inbound types (`SnsEnvelope`, `InboundSms`, `FamilyMatchRow`, `UpsertDeps`, `UpsertResult`).
- `src/drain/drain.ts` (create) — `drainDlq()` loop logic (injected SQS client + upsert fn).
- `src/drain/drain.test.ts` (create) — drain happy-path, delete-on-success, leave-on-failure, empty-queue (aws-sdk-client-mock).
- `src/drain/api.ts` (create) — `sms-dlq-drain` operation handler (manual "drain now" + scheduled).
- `src/drain/app.ts` (create) — drain operation UI (max-messages / wait-time options).
- `src/reply/api.ts` (create) — `sms-ticket-reply` operation handler (Reply action; consumes Plan 2 `sendSms` + `appendOutboundMessage`).
- `src/reply/app.ts` (create) — reply operation UI (ticket id + body).
- `package.json` (modify) — add `@aws-sdk/client-sqs` dep; register the `endpoint`, the `sms-dlq-drain` operation, and the `sms-ticket-reply` operation bundle entries.

---

## Task 1: SNS signature verifier (pure, offline-testable)

**Files:**
- Create: `src/inbound/sns-verify.ts`
- Test: `src/inbound/sns-verify.test.ts`

**Interfaces:**
- Consumes: Node `crypto` (`createVerify`, builtin), an injected `fetchCert: (url: string) => Promise<string>`.
- Produces:
  - `type SnsMessage = Record<string, unknown>` (the parsed SNS JSON body).
  - `type VerifyDeps = { fetchCert: (url: string) => Promise<string> }`
  - `function snsCertUrlIsValid(url: string, region?: string): boolean` — host allow-list check.
  - `function buildStringToSign(msg: SnsMessage): string` — canonical, key-ordered string-to-sign for `Notification` / `SubscriptionConfirmation`.
  - `async function verifySnsSignature(msg: SnsMessage, deps: VerifyDeps): Promise<boolean>` — false on bad host, missing fields, SignatureVersion ≠ "1", or a signature that does not verify against the fetched cert.
- Consumed by: the endpoint (Task 5).

- [ ] **Step 1: Write the failing test**

```ts
// src/inbound/sns-verify.test.ts
import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { snsCertUrlIsValid, buildStringToSign, verifySnsSignature } from "./sns-verify.js";

// One throwaway RSA keypair for the whole suite — keeps tests fully offline.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const certPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const CERT_URL = "https://sns.ap-southeast-2.amazonaws.com/SimpleNotificationService-abc123.pem";

const signWith = (stringToSign: string): string => {
  const signer = createSign("RSA-SHA1");
  signer.update(stringToSign, "utf8");
  return signer.sign(privateKey, "base64");
};

const baseNotification = () => ({
  Type: "Notification",
  MessageId: "msg-1",
  TopicArn: "arn:aws:sns:ap-southeast-2:111:two-way",
  Message: "hello",
  Timestamp: "2026-06-25T00:00:00.000Z",
  SignatureVersion: "1",
  SigningCertURL: CERT_URL,
});

const fetchCert = async () => certPem;

describe("snsCertUrlIsValid", () => {
  it("accepts a regional sns amazonaws.com cert host", () => {
    expect(snsCertUrlIsValid(CERT_URL)).toBe(true);
  });
  it("rejects a non-amazonaws host", () => {
    expect(snsCertUrlIsValid("https://evil.example.com/x.pem")).toBe(false);
  });
  it("rejects an amazonaws look-alike host (suffix spoof)", () => {
    expect(snsCertUrlIsValid("https://sns.ap-southeast-2.amazonaws.com.evil.com/x.pem")).toBe(false);
  });
  it("rejects a non-https url", () => {
    expect(snsCertUrlIsValid("http://sns.ap-southeast-2.amazonaws.com/x.pem")).toBe(false);
  });
});

describe("buildStringToSign", () => {
  it("orders Notification keys canonically (Message, MessageId, Subject?, Timestamp, TopicArn, Type)", () => {
    const s = buildStringToSign({ ...baseNotification(), Subject: "subj" });
    expect(s).toBe(
      ["Message", "hello", "MessageId", "msg-1", "Subject", "subj",
       "Timestamp", "2026-06-25T00:00:00.000Z", "TopicArn",
       "arn:aws:sns:ap-southeast-2:111:two-way", "Type", "Notification"].join("\n") + "\n"
    );
  });
  it("omits Subject when absent", () => {
    const s = buildStringToSign(baseNotification());
    expect(s.includes("Subject")).toBe(false);
  });
  it("uses SubscribeURL/Token keys for SubscriptionConfirmation", () => {
    const s = buildStringToSign({
      Type: "SubscriptionConfirmation", MessageId: "m", Message: "m-body",
      SubscribeURL: "https://sns/confirm", Timestamp: "t",
      Token: "tok", TopicArn: "arn",
    });
    expect(s).toBe(
      ["Message", "m-body", "MessageId", "m", "SubscribeURL", "https://sns/confirm",
       "Timestamp", "t", "Token", "tok", "TopicArn", "arn", "Type",
       "SubscriptionConfirmation"].join("\n") + "\n"
    );
  });
});

describe("verifySnsSignature", () => {
  it("accepts a correctly signed Notification", async () => {
    const msg = baseNotification();
    const signed = { ...msg, Signature: signWith(buildStringToSign(msg)) };
    expect(await verifySnsSignature(signed, { fetchCert })).toBe(true);
  });
  it("rejects a forged/altered message (signature no longer matches)", async () => {
    const msg = baseNotification();
    const signed = { ...msg, Signature: signWith(buildStringToSign(msg)), Message: "tampered" };
    expect(await verifySnsSignature(signed, { fetchCert })).toBe(false);
  });
  it("rejects a missing Signature", async () => {
    expect(await verifySnsSignature(baseNotification(), { fetchCert })).toBe(false);
  });
  it("rejects a bad SigningCertURL host without fetching the cert", async () => {
    const msg = { ...baseNotification(), SigningCertURL: "https://evil.example.com/x.pem" };
    const signed = { ...msg, Signature: signWith(buildStringToSign(msg)) };
    let fetched = false;
    const spyFetch = async () => { fetched = true; return certPem; };
    expect(await verifySnsSignature(signed, { fetchCert: spyFetch })).toBe(false);
    expect(fetched).toBe(false);
  });
  it("rejects an unsupported SignatureVersion", async () => {
    const msg = { ...baseNotification(), SignatureVersion: "2" };
    const signed = { ...msg, Signature: signWith(buildStringToSign(msg)) };
    expect(await verifySnsSignature(signed, { fetchCert })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/inbound/sns-verify.test.ts`
Expected: FAIL — `Cannot find module './sns-verify.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/inbound/sns-verify.ts
import { createVerify } from "node:crypto";

export type SnsMessage = Record<string, unknown>;
export type VerifyDeps = { fetchCert: (url: string) => Promise<string> };

// Keys included in the string-to-sign, in canonical (alphabetical) order, per message type.
const SIGN_KEYS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
  UnsubscribeConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
};

/**
 * The SigningCertURL must be https and its host must be an AWS SNS cert host:
 * `sns.<region>.amazonaws.com`. We require the host to END WITH `.amazonaws.com`
 * AND START WITH `sns.` to defeat suffix-spoof hosts like `...amazonaws.com.evil.com`.
 */
export function snsCertUrlIsValid(url: string, _region?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return host.startsWith("sns.") && host.endsWith(".amazonaws.com");
}

/** Build the newline-joined `key\nvalue\n…` string AWS signs for this message type. */
export function buildStringToSign(msg: SnsMessage): string {
  const type = String(msg.Type ?? "");
  const keys = SIGN_KEYS[type];
  if (!keys) return "";
  let out = "";
  for (const key of keys) {
    const val = msg[key];
    if (val === undefined || val === null) continue; // e.g. optional Subject
    out += `${key}\n${String(val)}\n`;
  }
  return out;
}

export async function verifySnsSignature(msg: SnsMessage, deps: VerifyDeps): Promise<boolean> {
  if (String(msg.SignatureVersion ?? "") !== "1") return false;

  const signature = msg.Signature;
  if (typeof signature !== "string" || signature.length === 0) return false;

  const certUrl = msg.SigningCertURL;
  if (typeof certUrl !== "string" || !snsCertUrlIsValid(certUrl)) return false;

  const stringToSign = buildStringToSign(msg);
  if (stringToSign === "") return false;

  let certPem: string;
  try {
    certPem = await deps.fetchCert(certUrl);
  } catch {
    return false;
  }

  try {
    const verifier = createVerify("RSA-SHA1");
    verifier.update(stringToSign, "utf8");
    return verifier.verify(certPem, signature, "base64");
  } catch {
    return false;
  }
}
```

> Note: SignatureVersion 1 is SHA1-RSA (AWS's default for HTTPS SNS subscriptions). The verifier accepts the raw cert/public-key PEM that `fetchCert` returns; in tests this is an SPKI public-key PEM, in production it is the X.509 cert AWS serves at `SigningCertURL` — Node's `crypto.verify` accepts both.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/inbound/sns-verify.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/inbound/sns-verify.ts src/inbound/sns-verify.test.ts
git commit -m "feat(sms): add offline-testable SNS signature verifier"
```

---

## Task 2: SNS envelope + inbound payload parser

**Files:**
- Create: `src/inbound/types.ts`
- Create: `src/inbound/parse.ts`
- Test: `src/inbound/parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (in `types.ts`):
  - `type SnsEnvelope = { Type: string; Message: string; SubscribeURL?: string; [k: string]: unknown }`
  - `type InboundSms = { originationNumber: string; destinationNumber: string; messageBody: string; inboundMessageId: string; previousPublishedMessageId: string | null }`
- Produces (in `parse.ts`):
  - `function parseSnsEnvelope(body: unknown): SnsEnvelope | null` — validates a parsed SNS body has `Type` + `Message`.
  - `function parseInboundSms(envelopeMessage: string): InboundSms | null` — parses the inner AWS End User Messaging JSON; returns null if required fields are missing.
- Consumed by: the endpoint (Task 5) and the drain (Task 6 — it parses the same inner payload off SQS bodies).

- [ ] **Step 1: Write the failing test**

```ts
// src/inbound/parse.test.ts
import { describe, it, expect } from "vitest";
import { parseSnsEnvelope, parseInboundSms } from "./parse.js";

const innerPayload = JSON.stringify({
  originationNumber: "+61412345678",
  destinationNumber: "+61480000000",
  messageBody: "Yes please",
  inboundMessageId: "inbound-abc-123",
  previousPublishedMessageId: "outbound-xyz-789",
});

describe("parseSnsEnvelope", () => {
  it("accepts a Notification with Type + Message", () => {
    const env = parseSnsEnvelope({ Type: "Notification", Message: innerPayload, MessageId: "m" });
    expect(env?.Type).toBe("Notification");
    expect(env?.Message).toBe(innerPayload);
  });
  it("accepts a SubscriptionConfirmation and exposes SubscribeURL", () => {
    const env = parseSnsEnvelope({ Type: "SubscriptionConfirmation", Message: "x", SubscribeURL: "https://sns/confirm" });
    expect(env?.SubscribeURL).toBe("https://sns/confirm");
  });
  it("returns null for a non-object or missing fields", () => {
    expect(parseSnsEnvelope("not json")).toBeNull();
    expect(parseSnsEnvelope({ Type: "Notification" })).toBeNull();
    expect(parseSnsEnvelope(null)).toBeNull();
  });
});

describe("parseInboundSms", () => {
  it("extracts the AWS End User Messaging fields", () => {
    expect(parseInboundSms(innerPayload)).toEqual({
      originationNumber: "+61412345678",
      destinationNumber: "+61480000000",
      messageBody: "Yes please",
      inboundMessageId: "inbound-abc-123",
      previousPublishedMessageId: "outbound-xyz-789",
    });
  });
  it("defaults previousPublishedMessageId to null when absent", () => {
    const body = JSON.stringify({
      originationNumber: "+61412345678", destinationNumber: "+61480000000",
      messageBody: "Hi", inboundMessageId: "id-1",
    });
    expect(parseInboundSms(body)?.previousPublishedMessageId).toBeNull();
  });
  it("returns null when a required field is missing", () => {
    const body = JSON.stringify({ originationNumber: "+61412345678", messageBody: "Hi" });
    expect(parseInboundSms(body)).toBeNull();
  });
  it("returns null on unparseable inner JSON", () => {
    expect(parseInboundSms("{not json")).toBeNull();
  });
  it("treats an empty messageBody as valid (empty replies happen)", () => {
    const body = JSON.stringify({
      originationNumber: "+61412345678", destinationNumber: "+61480000000",
      messageBody: "", inboundMessageId: "id-2",
    });
    expect(parseInboundSms(body)?.messageBody).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/inbound/parse.test.ts`
Expected: FAIL — `Cannot find module './parse.js'`.

- [ ] **Step 3: Write the types**

```ts
// src/inbound/types.ts
export type SnsEnvelope = {
  Type: string;
  Message: string;
  SubscribeURL?: string;
  [k: string]: unknown;
};

export type InboundSms = {
  originationNumber: string;
  destinationNumber: string;
  messageBody: string;
  inboundMessageId: string;
  previousPublishedMessageId: string | null;
};

/** A family row as read for inbound matching. */
export type FamilyMatchRow = {
  id: string;
  family_admin_mobile?: unknown;
  family_sms_cc?: { to_name?: string; to_mobile?: unknown }[] | null;
};

/** A single family-resolution outcome. */
export type FamilyResolution = {
  matchCount: number;
  familyId: string | null; // set only when exactly one match
  matchedFamilyIds: string[]; // all matches (for staff disambiguation when many)
};
```

- [ ] **Step 4: Write the parser**

```ts
// src/inbound/parse.ts
import type { SnsEnvelope, InboundSms } from "./types.js";

export function parseSnsEnvelope(body: unknown): SnsEnvelope | null {
  if (body === null || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.Type !== "string" || typeof b.Message !== "string") return null;
  return b as SnsEnvelope;
}

export function parseInboundSms(envelopeMessage: string): InboundSms | null {
  let inner: Record<string, unknown>;
  try {
    inner = JSON.parse(envelopeMessage) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (inner === null || typeof inner !== "object") return null;

  const originationNumber = inner.originationNumber;
  const destinationNumber = inner.destinationNumber;
  const messageBody = inner.messageBody;
  const inboundMessageId = inner.inboundMessageId;

  if (
    typeof originationNumber !== "string" ||
    typeof destinationNumber !== "string" ||
    typeof messageBody !== "string" ||
    typeof inboundMessageId !== "string"
  ) {
    return null;
  }

  const prev = inner.previousPublishedMessageId;
  return {
    originationNumber,
    destinationNumber,
    messageBody,
    inboundMessageId,
    previousPublishedMessageId: typeof prev === "string" ? prev : null,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/inbound/parse.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/inbound/types.ts src/inbound/parse.ts src/inbound/parse.test.ts
git commit -m "feat(sms): parse SNS envelope + inbound SMS payload"
```

---

## Task 3: Family resolution (0 / 1 / many)

**Files:**
- Create: `src/inbound/resolve-family.ts`
- Test: `src/inbound/resolve-family.test.ts`

**Interfaces:**
- Consumes: `normalizeAuMobile` (Plan 1), `FamilyMatchRow` / `FamilyResolution` (Task 2 `types.ts`).
- Produces:
  - `function familyMatchesNumber(fam: FamilyMatchRow, e164: string): boolean` — true if the family's admin mobile OR any `family_sms_cc[].to_mobile` normalizes to `e164`.
  - `function resolveFamily(originationNumber: string, families: FamilyMatchRow[]): FamilyResolution` — normalizes the inbound number, returns `{ matchCount, familyId, matchedFamilyIds }`. 1 match → `familyId` set; 0 or many → `familyId: null` (triage; many surfaced via `matchedFamilyIds`).
- Consumed by: the endpoint (Task 5).

- [ ] **Step 1: Write the failing test**

```ts
// src/inbound/resolve-family.test.ts
import { describe, it, expect } from "vitest";
import { resolveFamily, familyMatchesNumber } from "./resolve-family.js";
import type { FamilyMatchRow } from "./types.js";

const fam = (id: string, admin?: string, cc: string[] = []): FamilyMatchRow => ({
  id,
  family_admin_mobile: admin,
  family_sms_cc: cc.map((to_mobile, i) => ({ to_name: `cc${i}`, to_mobile })),
});

describe("familyMatchesNumber", () => {
  it("matches on the admin mobile after normalization (local vs E.164)", () => {
    expect(familyMatchesNumber(fam("f1", "0412 345 678"), "+61412345678")).toBe(true);
  });
  it("matches on a cc entry", () => {
    expect(familyMatchesNumber(fam("f1", "0400000000", ["0412345678"]), "+61412345678")).toBe(true);
  });
  it("does not match a different number", () => {
    expect(familyMatchesNumber(fam("f1", "0400000000"), "+61412345678")).toBe(false);
  });
  it("ignores landline/un-normalizable entries (they never produce an e164)", () => {
    expect(familyMatchesNumber(fam("f1", "03 9123 4567"), "+61412345678")).toBe(false);
  });
});

describe("resolveFamily", () => {
  it("returns exactly one match → familyId set", () => {
    const out = resolveFamily("+61412345678", [fam("a", "0400000000"), fam("b", "0412345678")]);
    expect(out).toEqual({ matchCount: 1, familyId: "b", matchedFamilyIds: ["b"] });
  });
  it("returns zero matches → familyId null (triage)", () => {
    const out = resolveFamily("+61412345678", [fam("a", "0400000000")]);
    expect(out).toEqual({ matchCount: 0, familyId: null, matchedFamilyIds: [] });
  });
  it("returns many matches → familyId null, all ids surfaced", () => {
    const out = resolveFamily("+61412345678", [fam("a", "0412345678"), fam("b", "0412 345 678")]);
    expect(out.matchCount).toBe(2);
    expect(out.familyId).toBeNull();
    expect(out.matchedFamilyIds).toEqual(["a", "b"]);
  });
  it("returns zero matches when the inbound number is not a normalizable mobile", () => {
    const out = resolveFamily("garbage", [fam("a", "0412345678")]);
    expect(out).toEqual({ matchCount: 0, familyId: null, matchedFamilyIds: [] });
  });
  it("counts a family at most once even if both admin + cc match", () => {
    const out = resolveFamily("+61412345678", [fam("a", "0412345678", ["0412345678"])]);
    expect(out.matchCount).toBe(1);
    expect(out.matchedFamilyIds).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/inbound/resolve-family.test.ts`
Expected: FAIL — `Cannot find module './resolve-family.js'`.

- [ ] **Step 3: Write the resolver**

```ts
// src/inbound/resolve-family.ts
import { normalizeAuMobile } from "../phone.js";
import type { FamilyMatchRow, FamilyResolution } from "./types.js";

const numbersOf = (fam: FamilyMatchRow): unknown[] => {
  const out: unknown[] = [fam.family_admin_mobile];
  const cc = fam.family_sms_cc;
  if (Array.isArray(cc)) for (const entry of cc) out.push(entry?.to_mobile);
  return out;
};

export function familyMatchesNumber(fam: FamilyMatchRow, e164: string): boolean {
  for (const raw of numbersOf(fam)) {
    const norm = normalizeAuMobile(raw);
    if (norm.kind === "mobile" && norm.e164 === e164) return true;
  }
  return false;
}

export function resolveFamily(originationNumber: string, families: FamilyMatchRow[]): FamilyResolution {
  const inbound = normalizeAuMobile(originationNumber);
  if (inbound.kind !== "mobile" || inbound.e164 === null) {
    return { matchCount: 0, familyId: null, matchedFamilyIds: [] };
  }
  const matchedFamilyIds: string[] = [];
  for (const fam of families) {
    if (familyMatchesNumber(fam, inbound.e164)) matchedFamilyIds.push(fam.id);
  }
  return {
    matchCount: matchedFamilyIds.length,
    familyId: matchedFamilyIds.length === 1 ? matchedFamilyIds[0]! : null,
    matchedFamilyIds,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/inbound/resolve-family.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/inbound/resolve-family.ts src/inbound/resolve-family.test.ts
git commit -m "feat(sms): resolve inbound number to 0/1/many families"
```

---

## Task 4: Idempotent upsert adapter (shared by endpoint + drain)

**Files:**
- Create: `src/inbound/upsert.ts`
- Test: `src/inbound/upsert.test.ts`
- Modify: `src/inbound/types.ts` (add `UpsertDeps` / `UpsertResult`)

**Interfaces:**
- Consumes: `InboundSms` (Task 2), `FamilyResolution` (Task 2), an injected pair of ItemsService-like objects (so it is unit-testable with fakes).
- Produces:
  - `type ItemsLike = { readByQuery(q: any): Promise<any[]>; createOne(item: any): Promise<string>; updateOne(id: string, patch: any): Promise<string>; }`
  - `type UpsertDeps = { tickets: ItemsLike; messages: ItemsLike; now?: () => string; }`
  - `type UpsertResult = { ticketId: string; messageCreated: boolean; ticketCreated: boolean; }`
  - `async function upsertInbound(sms: InboundSms, resolution: FamilyResolution, deps: UpsertDeps): Promise<UpsertResult>`
- Behaviour (matches spec §2.5 and §4):
  1. **Idempotency first:** look up a `client_message` by unique `external_message_id === sms.inboundMessageId`. If one exists → no-op (`messageCreated: false`), return its ticket id. This makes SNS retries and DLQ replays safe even mid-flight.
  2. Find the **open** ticket for `external_identity === originationNumber` AND `our_identity === destinationNumber`. If none → create one (`status: open`, `channel: sms`, `client: resolution.familyId`, `our_identity`, `external_identity`, `last_message_at`).
  3. Insert the inbound `client_message` keyed on `external_message_id` (`direction: inbound`, `delivery_status: null`, `raw`, `timestamp`, `from_identity`, `to_identity`, `body`).
  4. Bump the ticket's `last_message_at`.
- Consumed by: the endpoint (Task 5) and the drain (Task 6) — the single shared write path, so both produce identical, idempotent results.

- [ ] **Step 1: Extend `types.ts`**

Append to `src/inbound/types.ts`:

```ts
export type ItemsLike = {
  readByQuery(q: any): Promise<any[]>;
  createOne(item: any): Promise<string>;
  updateOne(id: string, patch: any): Promise<string>;
};

export type UpsertDeps = {
  tickets: ItemsLike;
  messages: ItemsLike;
  now?: () => string;
};

export type UpsertResult = {
  ticketId: string;
  messageCreated: boolean;
  ticketCreated: boolean;
};
```

- [ ] **Step 2: Write the failing test**

```ts
// src/inbound/upsert.test.ts
import { describe, it, expect, vi } from "vitest";
import { upsertInbound } from "./upsert.js";
import type { ItemsLike } from "./types.js";
import type { InboundSms, FamilyResolution } from "./types.js";

const sms = (id: string, overrides: Partial<InboundSms> = {}): InboundSms => ({
  originationNumber: "+61412345678",
  destinationNumber: "+61480000000",
  messageBody: "Yes please",
  inboundMessageId: id,
  previousPublishedMessageId: null,
  ...overrides,
});

const oneMatch: FamilyResolution = { matchCount: 1, familyId: "fam-1", matchedFamilyIds: ["fam-1"] };
const noMatch: FamilyResolution = { matchCount: 0, familyId: null, matchedFamilyIds: [] };

// Minimal in-memory fakes that honour the unique external_message_id + open-ticket lookups.
function makeDeps() {
  const ticketRows: any[] = [];
  const messageRows: any[] = [];
  let tId = 0;
  let mId = 0;

  const tickets: ItemsLike = {
    readByQuery: async (q) => {
      const f = q.filter ?? {};
      return ticketRows.filter((r) =>
        (!f.external_identity || r.external_identity === f.external_identity._eq) &&
        (!f.our_identity || r.our_identity === f.our_identity._eq) &&
        (!f.status || r.status === f.status._eq));
    },
    createOne: async (item) => { const id = `t${++tId}`; ticketRows.push({ id, ...item }); return id; },
    updateOne: async (id, patch) => { Object.assign(ticketRows.find((r) => r.id === id), patch); return id; },
  };
  const messages: ItemsLike = {
    readByQuery: async (q) => {
      const f = q.filter ?? {};
      return messageRows.filter((r) =>
        !f.external_message_id || r.external_message_id === f.external_message_id._eq);
    },
    createOne: async (item) => { const id = `m${++mId}`; messageRows.push({ id, ...item }); return id; },
    updateOne: async (id, patch) => { Object.assign(messageRows.find((r) => r.id === id), patch); return id; },
  };
  return { deps: { tickets, messages, now: () => "2026-06-25T00:00:00.000Z" }, ticketRows, messageRows };
}

describe("upsertInbound", () => {
  it("creates a new ticket + message on first inbound (single family match)", async () => {
    const { deps, ticketRows, messageRows } = makeDeps();
    const out = await upsertInbound(sms("in-1"), oneMatch, deps);
    expect(out.ticketCreated).toBe(true);
    expect(out.messageCreated).toBe(true);
    expect(ticketRows).toHaveLength(1);
    expect(ticketRows[0]).toMatchObject({
      status: "open", channel: "sms", client: "fam-1",
      external_identity: "+61412345678", our_identity: "+61480000000",
      last_message_at: "2026-06-25T00:00:00.000Z",
    });
    expect(messageRows[0]).toMatchObject({
      ticket: out.ticketId, direction: "inbound", channel: "sms",
      body: "Yes please", external_message_id: "in-1",
      from_identity: "+61412345678", to_identity: "+61480000000", delivery_status: null,
    });
  });

  it("links client=null when family resolution has no match", async () => {
    const { deps, ticketRows } = makeDeps();
    await upsertInbound(sms("in-1"), noMatch, deps);
    expect(ticketRows[0].client).toBeNull();
  });

  it("appends to the existing OPEN ticket rather than creating a new one", async () => {
    const { deps, ticketRows, messageRows } = makeDeps();
    const first = await upsertInbound(sms("in-1"), oneMatch, deps);
    const second = await upsertInbound(sms("in-2"), oneMatch, deps);
    expect(second.ticketCreated).toBe(false);
    expect(second.ticketId).toBe(first.ticketId);
    expect(ticketRows).toHaveLength(1);
    expect(messageRows).toHaveLength(2);
  });

  it("is idempotent: a duplicate inboundMessageId never creates a second message", async () => {
    const { deps, messageRows, ticketRows } = makeDeps();
    const a = await upsertInbound(sms("dup"), oneMatch, deps);
    const b = await upsertInbound(sms("dup"), oneMatch, deps);
    expect(b.messageCreated).toBe(false);
    expect(b.ticketId).toBe(a.ticketId);
    expect(messageRows).toHaveLength(1);
    expect(ticketRows).toHaveLength(1);
  });

  it("opens a NEW ticket when the only matching ticket is closed", async () => {
    const { deps, ticketRows } = makeDeps();
    await upsertInbound(sms("in-1"), oneMatch, deps);
    ticketRows[0].status = "closed"; // staff closed it
    const out = await upsertInbound(sms("in-2"), oneMatch, deps);
    expect(out.ticketCreated).toBe(true);
    expect(ticketRows).toHaveLength(2);
  });

  it("bumps last_message_at on the existing ticket when appending", async () => {
    const { deps, ticketRows } = makeDeps();
    await upsertInbound(sms("in-1"), oneMatch, deps);
    ticketRows[0].last_message_at = "2000-01-01T00:00:00.000Z";
    await upsertInbound(sms("in-2"), oneMatch, deps);
    expect(ticketRows[0].last_message_at).toBe("2026-06-25T00:00:00.000Z");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/inbound/upsert.test.ts`
Expected: FAIL — `Cannot find module './upsert.js'`.

- [ ] **Step 4: Write the upsert adapter**

```ts
// src/inbound/upsert.ts
import { TICKET_COLLECTION, MESSAGE_COLLECTION } from "../constants.js";
import type { InboundSms, FamilyResolution, UpsertDeps, UpsertResult } from "./types.js";

// TICKET_COLLECTION / MESSAGE_COLLECTION are imported for callers that build the real
// ItemsService instances (Task 5/6); the adapter itself operates on the injected deps.
void TICKET_COLLECTION;
void MESSAGE_COLLECTION;

export async function upsertInbound(
  sms: InboundSms,
  resolution: FamilyResolution,
  deps: UpsertDeps,
): Promise<UpsertResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const timestamp = now();

  // 1. Idempotency: if this provider message id already exists, do nothing.
  const existing = await deps.messages.readByQuery({
    filter: { external_message_id: { _eq: sms.inboundMessageId } },
    fields: ["id", "ticket"],
    limit: 1,
  });
  if (existing.length > 0) {
    return { ticketId: existing[0].ticket, messageCreated: false, ticketCreated: false };
  }

  // 2. Find the OPEN ticket for this conversation (counterpart + our number), else create.
  const open = await deps.tickets.readByQuery({
    filter: {
      external_identity: { _eq: sms.originationNumber },
      our_identity: { _eq: sms.destinationNumber },
      status: { _eq: "open" },
    },
    fields: ["id"],
    limit: 1,
  });

  let ticketId: string;
  let ticketCreated = false;
  if (open.length > 0) {
    ticketId = open[0].id;
  } else {
    ticketId = await deps.tickets.createOne({
      status: "open",
      channel: "sms",
      client: resolution.familyId, // null for 0/many matches (triage)
      external_identity: sms.originationNumber,
      our_identity: sms.destinationNumber,
      last_message_at: timestamp,
    });
    ticketCreated = true;
  }

  // 3. Insert the inbound message keyed on the unique external_message_id.
  await deps.messages.createOne({
    ticket: ticketId,
    direction: "inbound",
    channel: "sms",
    body: sms.messageBody,
    from_identity: sms.originationNumber,
    to_identity: sms.destinationNumber,
    external_message_id: sms.inboundMessageId,
    delivery_status: null,
    raw: sms,
    timestamp,
  });

  // 4. Bump last_message_at (skip the redundant write on a just-created ticket).
  if (!ticketCreated) {
    await deps.tickets.updateOne(ticketId, { last_message_at: timestamp });
  }

  return { ticketId, messageCreated: true, ticketCreated };
}
```

> Note: the `client_message.external_message_id` unique constraint is the *hard* idempotency guarantee. The read-before-create check above prevents a thrown unique-violation in the normal case; if two retries race past the read, the DB unique index still rejects the second `createOne`, which the endpoint/drain treat as a benign duplicate (Task 5/6 catch it and return success so SNS/SQS do not redeliver forever).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/inbound/upsert.test.ts`
Expected: PASS (all six cases, including the duplicate-id no-op and closed-ticket-→-new).

- [ ] **Step 6: Commit**

```bash
git add src/inbound/upsert.ts src/inbound/types.ts src/inbound/upsert.test.ts
git commit -m "feat(sms): idempotent inbound ticket/message upsert adapter"
```

---

## Task 5: Inbound endpoint (verify → handshake → parse → resolve → upsert)

**Files:**
- Create: `src/inbound/index.ts`
- Modify: `package.json` (register the `endpoint` bundle entry)

**Interfaces:**
- Consumes: `verifySnsSignature` (Task 1), `parseSnsEnvelope` / `parseInboundSms` (Task 2), `resolveFamily` (Task 3), `upsertInbound` + `UpsertDeps` (Task 4), `TICKET_COLLECTION` / `MESSAGE_COLLECTION` (Plan 1).
- Produces: a `defineEndpoint` registered at the bundle's endpoint path. One `POST` route handles all SNS message types:
  - Verify signature FIRST — reject `403` on failure (security boundary).
  - `SubscriptionConfirmation` → fetch `SubscribeURL` (confirm), `200`.
  - `Notification` → parse inner payload, resolve family, `upsertInbound`, `200`. Unparseable inner payload → `200` (ack so SNS stops retrying a malformed message we can never process) but logged.
  - Any other type → `200` (ack, log).
- Consumed by: AWS (the SNS HTTPS subscription posts here).

> The endpoint is a thin shell: it wires the verified deps and delegates to the pure cores. There is **no unit test for `index.ts` itself** (consistent with the codebase — `hook/index.ts` is untested; the cores it calls are fully covered by Tasks 1–4). Verification is build + a manual live-AWS smoke check at the deploy gate. The route reads the **raw** body to verify the signature against the exact bytes AWS signed.

- [ ] **Step 1: Write the endpoint**

```ts
// src/inbound/index.ts
import { defineEndpoint } from "@directus/extensions-sdk";
import { TICKET_COLLECTION, MESSAGE_COLLECTION } from "../constants.js";
import { verifySnsSignature, type SnsMessage } from "./sns-verify.js";
import { parseSnsEnvelope, parseInboundSms } from "./parse.js";
import { resolveFamily } from "./resolve-family.js";
import { upsertInbound } from "./upsert.js";
import type { FamilyMatchRow, UpsertDeps } from "./types.js";

// Fetch helper kept here (not in the verifier) so the verifier stays offline-testable.
const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
};

export default defineEndpoint((router, { services, getSchema, logger, database }) => {
  const { ItemsService } = services as any;

  // express.json() may already have parsed the body; SNS posts text/plain, so accept both.
  router.post("/", async (req: any, res: any) => {
    let msg: SnsMessage;
    try {
      msg = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (msg === null || typeof msg !== "object") throw new Error("non-object body");
    } catch {
      logger.warn("SMS inbound: unparseable SNS body, rejecting.");
      return res.status(400).send("bad request");
    }

    // 1. SECURITY BOUNDARY: verify the SNS signature before any side effect.
    const verified = await verifySnsSignature(msg, { fetchCert: fetchText });
    if (!verified) {
      logger.warn("SMS inbound: SNS signature verification FAILED, rejecting.");
      return res.status(403).send("forbidden");
    }

    const envelope = parseSnsEnvelope(msg);
    if (!envelope) return res.status(200).send("ok"); // verified but shapeless — ack, log nothing actionable

    // 2. Subscription handshake.
    if (envelope.Type === "SubscriptionConfirmation") {
      if (typeof envelope.SubscribeURL === "string") {
        try {
          await fetchText(envelope.SubscribeURL);
          logger.info("SMS inbound: confirmed SNS subscription.");
        } catch (err) {
          logger.error(`SMS inbound: SubscribeURL confirm failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return res.status(200).send("ok");
    }

    if (envelope.Type !== "Notification") {
      logger.info(`SMS inbound: ignoring SNS message type "${envelope.Type}".`);
      return res.status(200).send("ok");
    }

    // 3. Parse the inner AWS End User Messaging payload.
    const sms = parseInboundSms(envelope.Message);
    if (!sms) {
      // Malformed inner payload we can never process: ack so SNS stops retrying.
      logger.warn("SMS inbound: unparseable inbound payload, acking to stop retries.");
      return res.status(200).send("ok");
    }

    try {
      const schema = await getSchema();
      // 4. Resolve family.
      const families: FamilyMatchRow[] = await new ItemsService("family", { schema, accountability: null })
        .readByQuery({ fields: ["id", "family_admin_mobile", "family_sms_cc"], limit: -1 });
      const resolution = resolveFamily(sms.originationNumber, families);
      if (resolution.matchCount > 1) {
        logger.warn(`SMS inbound: ${sms.originationNumber} matched ${resolution.matchCount} families ${JSON.stringify(resolution.matchedFamilyIds)} — leaving client=null for staff disambiguation.`);
      }

      // 5. Idempotent upsert through the shared adapter.
      const deps: UpsertDeps = {
        tickets: new ItemsService(TICKET_COLLECTION, { schema, accountability: null, knex: database }),
        messages: new ItemsService(MESSAGE_COLLECTION, { schema, accountability: null, knex: database }),
      };
      const result = await upsertInbound(sms, resolution, deps);
      logger.info(`SMS inbound: ${sms.inboundMessageId} → ticket ${result.ticketId} (ticketCreated=${result.ticketCreated}, messageCreated=${result.messageCreated}).`);
      return res.status(200).send("ok");
    } catch (err) {
      // A unique-violation on external_message_id (racing retry) is a benign duplicate → ack.
      const msgText = err instanceof Error ? err.message : String(err);
      if (/unique|duplicate/i.test(msgText)) {
        logger.info(`SMS inbound: duplicate ${sms.inboundMessageId} (unique violation) — acking.`);
        return res.status(200).send("ok");
      }
      // Genuine failure (DB down mid-deploy): 5xx so SNS retries / DLQ captures it.
      logger.error(`SMS inbound: processing failed, returning 503 for SNS retry: ${msgText}`);
      return res.status(503).send("unavailable");
    }
  });
});
```

- [ ] **Step 2: Register the endpoint in the bundle**

In `package.json`, add an entry to `directus:extension.entries` (after the existing operations + hook):

```json
{
  "type": "endpoint",
  "name": "sms-inbound",
  "source": "src/inbound/index.ts"
}
```

> The endpoint mounts at `/<bundle-extension-name>/sms-inbound` (Directus namespaces bundle endpoints by extension name then entry name). The exact public URL is confirmed at the deploy gate and is what gets subscribed to the SNS topic.

- [ ] **Step 3: Build the extension**

Run: `npm run build`
Expected: `✔ Done`, no TypeScript errors.

- [ ] **Step 4: Run the full test suite (no regressions)**

Run: `npm test`
Expected: PASS — Plan 1 tests plus the new `sns-verify`, `parse`, `resolve-family`, `upsert` tests.

- [ ] **Step 5: Commit**

```bash
git add src/inbound/index.ts package.json
git commit -m "feat(sms): inbound SNS endpoint (verify, handshake, resolve, upsert)"
```

- [ ] **Step 6: Deploy + live-AWS smoke check (manual gate — EXTERNAL provisioning)**

Deploy `dist/`, restart Directus. Then, outside this codebase:
1. Confirm the endpoint URL (`/<bundle>/sms-inbound`) is reachable over HTTPS.
2. Subscribe the URL to the SNS topic; confirm the handshake (the log shows "confirmed SNS subscription").
3. Send a real reply from a test phone to the two-way number; confirm a `client_ticket` + inbound `client_message` appear, `external_identity` = the test phone's E.164, `our_identity` = the two-way number, and the family links when the test number is in a family record.
4. Send the same reply twice (or replay) — confirm NO duplicate message row. (Idempotency is unit-proven; this is the live confirmation.)

---

## Task 6: SQS DLQ drain (Decision 4)

**Files:**
- Create: `src/drain/drain.ts`
- Test: `src/drain/drain.test.ts`
- Create: `src/drain/api.ts`
- Create: `src/drain/app.ts`
- Modify: `package.json` (add `@aws-sdk/client-sqs` dep; register the `sms-dlq-drain` operation)

**Interfaces:**
- Consumes: `parseSnsEnvelope` / `parseInboundSms` (Task 2), `resolveFamily` (Task 3), the SAME `upsertInbound` (Task 4), `@aws-sdk/client-sqs` (`ReceiveMessageCommand`, `DeleteMessageCommand`).
- Produces:
  - `type DrainDeps = { sqs: { send(cmd: any): Promise<any> }; queueUrl: string; processOne: (snsBody: unknown) => Promise<void>; maxMessages?: number; waitTimeSeconds?: number; logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void } }`
  - `type DrainResult = { received: number; processed: number; deleted: number; failed: number }`
  - `async function drainDlq(deps: DrainDeps): Promise<DrainResult>` — long-polls once, processes each message through `processOne`, deletes on success, leaves on failure (so the message stays for the next drain / hits the queue's own redrive). Loops until an empty receive (drains the backlog in one call when invoked manually; the scheduled flow simply calls it on an interval).
  - A Directus operation `sms-dlq-drain` (manual "drain now" + the body the scheduled flow runs).
- Consumed by: the scheduled drain flow + manual action.

- [ ] **Step 1: Add `@aws-sdk/client-sqs` dependency**

In `package.json` `dependencies`, add (alongside `@aws-sdk/client-sns`):

```json
"@aws-sdk/client-sqs": "^3.700.0"
```

Then install: `npm install`.

- [ ] **Step 2: Write the failing drain test**

```ts
// src/drain/drain.test.ts
import { describe, it, expect, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { drainDlq } from "./drain.js";

const sqsMock = mockClient(SQSClient);

const snsBody = (inboundMessageId: string) =>
  JSON.stringify({
    Type: "Notification",
    Message: JSON.stringify({
      originationNumber: "+61412345678", destinationNumber: "+61480000000",
      messageBody: "hi", inboundMessageId,
    }),
  });

beforeEach(() => sqsMock.reset());

describe("drainDlq", () => {
  it("processes each received message and deletes it on success", async () => {
    sqsMock
      .on(ReceiveMessageCommand)
      .resolvesOnce({ Messages: [
        { Body: snsBody("a"), ReceiptHandle: "rh-a" },
        { Body: snsBody("b"), ReceiptHandle: "rh-b" },
      ] })
      .resolves({ Messages: [] }); // second poll: empty → stop
    sqsMock.on(DeleteMessageCommand).resolves({});

    const processOne = vi.fn().mockResolvedValue(undefined);
    const out = await drainDlq({ sqs: new SQSClient({}), queueUrl: "q", processOne });

    expect(out).toEqual({ received: 2, processed: 2, deleted: 2, failed: 0 });
    expect(processOne).toHaveBeenCalledTimes(2);
    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(2);
  });

  it("leaves a message on the queue (no delete) when processing throws", async () => {
    sqsMock
      .on(ReceiveMessageCommand)
      .resolvesOnce({ Messages: [{ Body: snsBody("bad"), ReceiptHandle: "rh-bad" }] })
      .resolves({ Messages: [] });
    sqsMock.on(DeleteMessageCommand).resolves({});

    const processOne = vi.fn().mockRejectedValue(new Error("db down"));
    const out = await drainDlq({ sqs: new SQSClient({}), queueUrl: "q", processOne });

    expect(out).toEqual({ received: 1, processed: 0, deleted: 0, failed: 1 });
    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
  });

  it("returns zeros when the queue is empty", async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [] });
    const out = await drainDlq({ sqs: new SQSClient({}), queueUrl: "q", processOne: vi.fn() });
    expect(out).toEqual({ received: 0, processed: 0, deleted: 0, failed: 0 });
  });

  it("deletes only the successes in a mixed batch", async () => {
    sqsMock
      .on(ReceiveMessageCommand)
      .resolvesOnce({ Messages: [
        { Body: snsBody("ok"), ReceiptHandle: "rh-ok" },
        { Body: snsBody("fail"), ReceiptHandle: "rh-fail" },
      ] })
      .resolves({ Messages: [] });
    sqsMock.on(DeleteMessageCommand).resolves({});

    const processOne = vi.fn()
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => { throw new Error("boom"); });
    const out = await drainDlq({ sqs: new SQSClient({}), queueUrl: "q", processOne });

    expect(out).toMatchObject({ received: 2, processed: 1, deleted: 1, failed: 1 });
    const deletes = sqsMock.commandCalls(DeleteMessageCommand);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].args[0].input.ReceiptHandle).toBe("rh-ok");
  });
});
```

> `beforeEach` is provided by Vitest globals (already enabled in this repo's config). If not, add `import { beforeEach } from "vitest";`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/drain/drain.test.ts`
Expected: FAIL — `Cannot find module './drain.js'` (and/or `@aws-sdk/client-sqs` resolving but no `drainDlq`).

- [ ] **Step 4: Write the drain loop**

```ts
// src/drain/drain.ts
import { ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";

export type DrainLogger = {
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
};

export type DrainDeps = {
  sqs: { send(cmd: any): Promise<any> };
  queueUrl: string;
  /** Reprocess a single SNS body (parsed JSON or raw string) through the upsert adapter. Throws on failure. */
  processOne: (snsBody: unknown) => Promise<void>;
  maxMessages?: number;     // SQS caps at 10 per receive
  waitTimeSeconds?: number; // long-poll window
  logger?: DrainLogger;
};

export type DrainResult = { received: number; processed: number; deleted: number; failed: number };

export async function drainDlq(deps: DrainDeps): Promise<DrainResult> {
  const max = Math.min(deps.maxMessages ?? 10, 10);
  const wait = deps.waitTimeSeconds ?? 20;
  const result: DrainResult = { received: 0, processed: 0, deleted: 0, failed: 0 };

  // Drain the backlog: keep polling until a receive comes back empty.
  for (;;) {
    const recv = await deps.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: deps.queueUrl,
        MaxNumberOfMessages: max,
        WaitTimeSeconds: wait,
      }),
    );
    const messages: any[] = recv?.Messages ?? [];
    if (messages.length === 0) break;

    for (const m of messages) {
      result.received++;
      let body: unknown = m.Body;
      try {
        if (typeof m.Body === "string") body = JSON.parse(m.Body);
      } catch {
        body = m.Body; // let processOne decide; it parses/validates the envelope
      }
      try {
        await deps.processOne(body);
        result.processed++;
        await deps.sqs.send(
          new DeleteMessageCommand({ QueueUrl: deps.queueUrl, ReceiptHandle: m.ReceiptHandle }),
        );
        result.deleted++;
      } catch (err) {
        result.failed++;
        deps.logger?.warn(
          `DLQ drain: leaving message on queue after failure: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Not deleted → becomes visible again after the visibility timeout for a later drain.
      }
    }
  }

  deps.logger?.info(
    `DLQ drain: received=${result.received} processed=${result.processed} deleted=${result.deleted} failed=${result.failed}`,
  );
  return result;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/drain/drain.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the drain operation handler**

```ts
// src/drain/api.ts
import { defineOperationApi } from "@directus/extensions-sdk";
import { SQSClient } from "@aws-sdk/client-sqs";
import { resolveAwsConfig } from "../config.js";
import { TICKET_COLLECTION, MESSAGE_COLLECTION } from "../constants.js";
import { parseSnsEnvelope, parseInboundSms } from "../inbound/parse.js";
import { resolveFamily } from "../inbound/resolve-family.js";
import { upsertInbound } from "../inbound/upsert.js";
import { drainDlq } from "./drain.js";
import type { FamilyMatchRow, UpsertDeps } from "../inbound/types.js";

export type Options = { queueUrl?: string; maxMessages?: number; waitTimeSeconds?: number };

export default defineOperationApi<Options>({
  id: "sms-dlq-drain",
  handler: async ({ queueUrl, maxMessages, waitTimeSeconds }, ctx) => {
    const { services, getSchema, env, accountability, logger, database } = ctx as any;
    const { ItemsService } = services;

    const url = queueUrl ?? env.SMS_AWS_DLQ_URL;
    if (!url) throw new Error("DLQ queue URL not set. Provide queueUrl option or SMS_AWS_DLQ_URL env var.");

    const cfg = await resolveAwsConfig({ env, services, getSchema, accountability });
    const sqs = new SQSClient({
      region: cfg.region,
      credentials: cfg.accessKeyId && cfg.secretAccessKey
        ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
        : undefined, // fall back to the host's default credential chain
    });

    // processOne mirrors the endpoint's Notification path, reusing the same upsert adapter.
    const processOne = async (snsBody: unknown): Promise<void> => {
      const envelope = parseSnsEnvelope(snsBody);
      if (!envelope || envelope.Type !== "Notification") return; // non-notifications: nothing to do, delete
      const sms = parseInboundSms(envelope.Message);
      if (!sms) return; // unprocessable payload: delete rather than loop forever
      const schema = await getSchema();
      const families: FamilyMatchRow[] = await new ItemsService("family", { schema, accountability: null })
        .readByQuery({ fields: ["id", "family_admin_mobile", "family_sms_cc"], limit: -1 });
      const resolution = resolveFamily(sms.originationNumber, families);
      const deps: UpsertDeps = {
        tickets: new ItemsService(TICKET_COLLECTION, { schema, accountability: null, knex: database }),
        messages: new ItemsService(MESSAGE_COLLECTION, { schema, accountability: null, knex: database }),
      };
      await upsertInbound(sms, resolution, deps);
    };

    const result = await drainDlq({
      sqs, queueUrl: url, processOne,
      maxMessages, waitTimeSeconds, logger,
    });
    return result;
  },
});
```

> Note: `SMS_AWS_DLQ_URL` is a new env var for the DLQ's URL (it has no analogue in `sms_settings`, so it is env-only). `resolveAwsConfig` (Plan 1's `config.ts`) supplies region + credentials exactly as the send path does. The handler reuses the endpoint's exact Notification logic via the shared cores — there is no second copy of the upsert.

- [ ] **Step 7: Write the drain operation UI**

```ts
// src/drain/app.ts
import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "sms-dlq-drain",
  name: "Drain SMS Inbound DLQ",
  icon: "replay",
  description: "Long-poll the SQS DLQ and reprocess any inbound SMS that outlived SNS retries, through the same idempotent upsert. Safe to run repeatedly.",
  overview: ({ queueUrl }) => [{ label: "Queue", text: (queueUrl as string) ?? "SMS_AWS_DLQ_URL env" }],
  options: [
    {
      field: "queueUrl",
      name: "Queue URL",
      type: "string",
      meta: { width: "full", interface: "input", note: "SQS DLQ URL. Leave blank to use the SMS_AWS_DLQ_URL env var." },
    },
    {
      field: "maxMessages",
      name: "Max messages per receive",
      type: "integer",
      schema: { default_value: 10 },
      meta: { width: "half", interface: "input", note: "SQS caps at 10 per ReceiveMessage call." },
    },
    {
      field: "waitTimeSeconds",
      name: "Long-poll wait (seconds)",
      type: "integer",
      schema: { default_value: 20 },
      meta: { width: "half", interface: "input", note: "0–20. 20 = full long-poll." },
    },
  ],
});
```

- [ ] **Step 8: Register the drain operation in the bundle**

In `package.json`, add an entry to `directus:extension.entries`:

```json
{
  "type": "operation",
  "name": "sms-dlq-drain",
  "source": { "app": "src/drain/app.ts", "api": "src/drain/api.ts" }
}
```

- [ ] **Step 9: Build + full test suite**

Run: `npm run build && npm test`
Expected: build `✔ Done`; all tests PASS (`@aws-sdk/client-sqs` inlined into the bundle).

- [ ] **Step 10: Commit**

```bash
git add src/drain package.json package-lock.json
git commit -m "feat(sms): SQS DLQ drain operation (scheduled + manual replay)"
```

- [ ] **Step 11: Wire the scheduled drain flow (manual gate — EXTERNAL provisioning)**

Outside this codebase, in Directus Studio:
1. Create the SQS DLQ in AWS and attach it as the redrive target of the SNS→endpoint subscription (so SNS deposits anything that outlives its retries).
2. Set `SMS_AWS_DLQ_URL` in the Directus environment.
3. Create a **Schedule (CRON)**-triggered flow (suggested: every 5 minutes) whose single operation is **Drain SMS Inbound DLQ**. Recommended settings: `maxMessages: 10`, `waitTimeSeconds: 20` (long-poll), and a queue **visibility timeout** comfortably longer than a worst-case drain run (e.g. 60s) so an in-flight message isn't re-received mid-process. Document these in the flow's description.
4. Also expose a **manual-trigger** flow with the same operation as the "drain now" button.
5. Verify recovery: stop Directus briefly so a real inbound SMS lands in the DLQ, restart, run the manual drain, and confirm the ticket/message appears with NO duplicate (the drain shares the idempotent upsert).

---

## Task 7: Two-way UI — Reply action (depends on Plan 2)

**Files:**
- Create: `src/reply/api.ts`
- Create: `src/reply/app.ts`
- Modify: `package.json` (register the `sms-ticket-reply` operation)

**Interfaces:**
- Consumes: **Plan 2's** exports — `sendSms(opts)` (origination-aware send) and `appendOutboundMessage(...)` (writes an `outbound` `client_message` + bumps `last_message_at`). Plan 2 lands first and matches these names. Also `TICKET_COLLECTION` (Plan 1).
  - Assumed Plan 2 signatures (the contract this task codes against):
    - `sendSms(opts: { body: string; to: string; origination: "senderId" | "number"; originationNumber?: string }, ctx): Promise<{ messageId: string }>` — when `origination: "number"`, `originationNumber` is the sending two-way number (the ticket's `our_identity`).
    - `appendOutboundMessage(args: { ticketId: string; body: string; from: string; to: string; externalMessageId: string; ctx: unknown }): Promise<string>` — appends the row, returns the message id.
- Produces: a Directus operation `sms-ticket-reply` taking `{ ticketId, body }`. It loads the ticket, sends from `our_identity` (origination = `number`) to `external_identity`, and appends the outbound message via Plan 2's helper. This is the thin manual-action operation behind the Studio Reply button.
- Consumed by: a manual-trigger flow on `client_ticket` (the Reply button).

> **Gate:** this task is blocked on Plan 2 landing its `sendSms` + `appendOutboundMessage` exports. If implementing before Plan 2 is merged, stub both with the assumed signatures so the suite builds, and replace the stub import with the real path at integration. The send code is **never duplicated here** — this operation only orchestrates.

> The reply send is deliberately origination-aware per **Decision 5**: replies always originate from the ticket's `our_identity` (the two-way number the parent texted), making the model N-number capable with no code change when a second number is added.

- [ ] **Step 1: Write the reply operation handler**

```ts
// src/reply/api.ts
import { defineOperationApi } from "@directus/extensions-sdk";
import { TICKET_COLLECTION } from "../constants.js";
// Plan 2 exports (lands first). Names are the agreed contract.
import { sendSms } from "../operation/send.js";
import { appendOutboundMessage } from "../operation/messages.js";

export type Options = { ticketId?: string; body?: string };

export default defineOperationApi<Options>({
  id: "sms-ticket-reply",
  handler: async ({ ticketId, body }, ctx) => {
    const { services, getSchema, accountability } = ctx as any;
    const { ItemsService } = services;

    if (!ticketId) throw new Error("sms-ticket-reply: ticketId is required.");
    if (typeof body !== "string" || body.trim() === "") throw new Error("sms-ticket-reply: body is required.");

    const schema = await getSchema();
    const tickets = new ItemsService(TICKET_COLLECTION, { schema, accountability });
    const ticket = await tickets.readOne(ticketId, {
      fields: ["id", "external_identity", "our_identity", "channel", "status"],
    });
    if (!ticket?.external_identity) throw new Error(`sms-ticket-reply: ticket ${ticketId} has no external_identity.`);
    if (!ticket?.our_identity) throw new Error(`sms-ticket-reply: ticket ${ticketId} has no our_identity (cannot choose origination number).`);

    // Reply ALWAYS originates from the ticket's our_identity (Decision 5).
    const { messageId } = await sendSms(
      { body, to: ticket.external_identity, origination: "number", originationNumber: ticket.our_identity },
      ctx,
    );

    // Append the outbound message via Plan 2's helper (no duplicate write path here).
    await appendOutboundMessage({
      ticketId,
      body,
      from: ticket.our_identity,
      to: ticket.external_identity,
      externalMessageId: messageId,
      ctx,
    });

    return { ticketId, messageId, to: ticket.external_identity, from: ticket.our_identity };
  },
});
```

- [ ] **Step 2: Write the reply operation UI**

```ts
// src/reply/app.ts
import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "sms-ticket-reply",
  name: "Reply to SMS Ticket",
  icon: "reply",
  description: "Send a reply on a client ticket from the ticket's own two-way number and append it to the thread.",
  overview: ({ ticketId, body }) => [
    { label: "Ticket", text: (ticketId as string) ?? "—" },
    { label: "Message", text: (body as string) ?? "—" },
  ],
  options: [
    {
      field: "ticketId",
      name: "Ticket",
      type: "string",
      meta: { width: "half", interface: "input", note: "client_ticket id (bound to the trigger ticket in the flow)." },
    },
    {
      field: "body",
      name: "Message",
      type: "text",
      meta: { width: "full", interface: "input-multiline", note: "Reply text. Sends from the ticket's our_identity number." },
    },
  ],
});
```

- [ ] **Step 3: Register the reply operation in the bundle**

In `package.json`, add an entry to `directus:extension.entries`:

```json
{
  "type": "operation",
  "name": "sms-ticket-reply",
  "source": { "app": "src/reply/app.ts", "api": "src/reply/api.ts" }
}
```

- [ ] **Step 4: Build + full test suite**

Run: `npm run build && npm test`
Expected: build `✔ Done` (requires Plan 2's `src/operation/send.ts` + `src/operation/messages.ts` to exist); all tests PASS.

> If Plan 2 is not yet merged, the build fails on the two imports. That is the intended gate — do not stub silently in committed code; either land Plan 2 first or land this task in the same integration branch as Plan 2.

- [ ] **Step 5: Commit**

```bash
git add src/reply package.json
git commit -m "feat(sms): ticket Reply action (origination-aware, appends outbound)"
```

- [ ] **Step 6: Configure the two-way Studio UI + Reply button (manual gate — documented config)**

The two-way UI for v1 is **standard Directus Studio config**, not a custom module (module is phase 2). Outside this codebase, in Studio:
1. **Ticket inbox view** on `client_ticket`: a table layout sorted by `last_message_at` (descending), columns `status`, `client`, `external_identity`, `our_identity`, `assignee`, `last_message_at`. Optionally filter the default view to `status = open`.
2. **Thread view**: open a ticket; the `messages` o2m shows the `client_message` rows. Order by `timestamp`; show `direction`, `body`, `from_identity`, `to_identity`, `delivery_status`.
3. **Reply button**: create a **manual-trigger flow** scoped to `client_ticket` whose single operation is **Reply to SMS Ticket**, binding `ticketId` to the triggering item's id and prompting the operator for `body`. This renders as a manual action on the ticket detail page.
4. **Triage**: add a saved filter/view for `client IS NULL` (unmatched + many-match tickets) so staff can disambiguate and link the family by hand.
5. Smoke-test the full loop: reply to a real open ticket, confirm the parent receives the SMS from the two-way number and an `outbound` `client_message` is appended with the returned `external_message_id`.

---

## Self-Review

**Spec coverage (Plan 3 portion):**

§2 Inbound SMS adapter (ordered responsibilities):
- (1) SNS signature verification, security boundary FIRST → Task 1 (pure) + Task 5 (called before any side effect; `403` on fail). ✔
- (2) Subscription handshake (`SubscriptionConfirmation` → fetch `SubscribeURL`) → Task 5. ✔
- (3) Parse + normalize (`originationNumber`, `destinationNumber`, `messageBody`, `inboundMessageId`, `previousPublishedMessageId`; E.164) → Task 2 (parse) + Task 3 (normalize via `normalizeAuMobile`). ✔
- (4) Resolve family across `family_admin_mobile` + `family_sms_cc[].to_mobile`, 0/1/many → Task 3. ✔
- (5) Idempotent upsert: open-ticket-or-create, message keyed on unique `external_message_id`, bump `last_message_at` → Task 4. ✔

§4 Resilience & idempotency:
- SNS retries absorb brief downtime → Task 5 returns `503` on genuine failure so SNS retries. ✔
- SQS DLQ + scheduled drain + manual "drain now" reprocessing through the SAME adapter → Task 6 (`drainDlq` + `sms-dlq-drain` reusing `upsertInbound`). ✔
- Idempotency mandatory on unique `external_message_id` → Task 4 (read-before-create + DB unique index; duplicate = no-op), reasserted in Task 5 (benign-duplicate ack) and Task 6 (shared adapter). ✔

§6 Two-way UI (v1):
- Standard Studio collection views + manual Reply action; reply via origination-aware send from `our_identity`, appends `outbound` message → Task 7. Not a custom module (deferred to phase 2). ✔

Decision 4 (DLQ replay = scheduled SQS-drain + manual drain-now) → Task 6. ✔
Decision 5 (one active number for v1; N-number capable via `our_identity`; replies originate from `our_identity`) → upsert stores `our_identity` = `destinationNumber` (Task 4); reply originates from `our_identity` (Task 7). ✔

Testing section (enumerated cases):
- SNS signature verification: valid / forged / missing / bad `SigningCertURL` host → Task 1 (all four, plus unsupported SignatureVersion and suffix-spoof host). ✔
- Subscription-confirmation handshake → Task 5 (manual gate; the verify cases incl. `SubscriptionConfirmation` string-to-sign are unit-tested in Task 1). ✔
- E.164 normalization across AU formats → covered by Plan 1's `phone.test.ts`; reused here via `normalizeAuMobile`. ✔
- Family resolution 0/1/many across admin + cc array → Task 3. ✔
- Idempotent upsert: duplicate `inboundMessageId` → no duplicate row → Task 4. ✔
- Origination selection (`senderId` vs `number`) → owned by Plan 2; Task 7 consumes it (`origination: "number"` for replies). ✔ (cross-plan)
- Ticket grouping: append to open ticket vs create new; closed ticket → new ticket → Task 4 (explicit tests). ✔

**Placeholder scan:** No TBD/TODO. Every code step shows full code. The Plan 2 dependency in Task 7 is named with concrete assumed signatures and an explicit landing gate, not a placeholder. Manual gates (Tasks 5/6/7 deploy + AWS provisioning + Studio config) are labelled as non-automated verification, matching Plan 1's style — AWS provisioning is EXTERNAL per Global Constraints. ✔

**Type consistency:**
- `SnsMessage` (Task 1) ↔ the raw body in Task 5. ✔
- `SnsEnvelope` / `InboundSms` (Task 2 `types.ts`) used identically in Tasks 5 & 6. ✔
- `FamilyMatchRow` / `FamilyResolution` (Task 2 `types.ts`) flow Task 3 → Tasks 4/5/6 unchanged. ✔
- `UpsertDeps` / `UpsertResult` / `ItemsLike` (Task 4) used identically by the endpoint (Task 5) and drain (Task 6). ✔
- `DrainDeps` / `DrainResult` (Task 6) consistent between `drain.ts` and `api.ts`. ✔
- `upsertInbound` is the single write path — same import in Task 5 and Task 6 (no duplicate logic). ✔
- Task 7 codes against Plan 2's `sendSms` / `appendOutboundMessage` by the agreed names; `origination: "number"` + `originationNumber` = `our_identity`. ✔

---

## Out of scope (this plan / later)

- **Plan 2 — Outbound & Spray:** `sendSms` / `appendOutboundMessage` themselves (origination routing SNS vs End User Messaging, spray recipient selection + per-recipient audit, `(do not reply)` footer). Task 7 consumes these; it does not implement them.
- **Queue-first inbound** (SNS → SQS → long-running polling worker) — phase 2. v1 relies on the endpoint at receipt time with the DLQ drain as the safety net.
- **Custom Directus module** for a polished spray composer + threaded help-desk inbox with read/unread — phase 2. v1 is standard Studio views + manual actions (Task 7 step 6).
- **Additional channel adapters** (email, social) — the collections support them; adapters are future work.
- **Square null-backfill** mechanics — deferred (Plan 1 Global Constraints).
- **Delivery-status ingestion** (CloudWatch `DELIVERED`/`FAILED` per-message) — optional AWS observability noted in the spec's provisioning section; not wired here.
