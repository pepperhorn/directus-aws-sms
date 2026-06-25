# Two-Way SMS — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the channel-agnostic ticketing collections, an AU phone-number normalization utility, and a number backfill operation — the data foundation the outbound (Plan 2) and inbound (Plan 3) work depends on.

**Architecture:** Extend the existing `directus-extension-operation-sms-aws-sns` **bundle** extension. Collections are bootstrapped idempotently by the existing hook (same pattern as `sms_settings`). Normalization is a pure, unit-tested utility. Backfill is a pure planner plus a thin Directus operation that dry-runs or applies it.

**Tech Stack:** TypeScript, Directus Extensions SDK v12 (bundle: operation + hook + later endpoint), Vitest, `aws-sdk-client-mock` (already present).

**Spec:** `docs/superpowers/specs/2026-06-23-two-way-sms-ticketing-design.md`

## Global Constraints

- Extension `host` compatibility: `^10.0.0 || ^11.0.0 || ^12.0.0` (do not narrow).
- Module type is ESM (`"type": "module"`); intra-package imports use the `.js` extension in source (e.g. `import { X } from "../constants.js"`), matching existing files.
- Tests live beside source as `*.test.ts` and run via `npm test` (Vitest, `include: ["src/**/*.test.ts"]`).
- Collection names: `client_ticket`, `client_message` (channel-agnostic; SMS is the first adapter).
- Phone numbers are stored and compared in **E.164**, normalized on the `+614` prefix. Only **mobile** numbers yield an E.164 value; `03`/landline and un-normalizable numbers are flagged, never silently kept.
- Bootstrapping must be **idempotent** — skip creation if the collection already exists (match the `sms_settings` hook).
- Build + deploy is the existing cycle: `npm run build` → copy `dist/` to the host volume → restart Directus. No restart happens from the SSH sidecar.
- Square null-backfill is **out of scope for this plan** (mechanics undetermined in the spec); the backfill operation only normalizes/flags existing values.

---

## File Structure

- `src/constants.ts` (modify) — add `TICKET_COLLECTION`, `MESSAGE_COLLECTION` constants.
- `src/phone.ts` (create) — `normalizeAuMobile()` pure utility + types.
- `src/phone.test.ts` (create) — normalization unit tests.
- `src/hook/ticketing-schema.ts` (create) — exported collection + relation definitions for the two collections (keeps the hook file focused; makes the schema shape unit-testable).
- `src/hook/ticketing-schema.test.ts` (create) — asserts the schema definitions' shape.
- `src/hook/index.ts` (modify) — bootstrap `client_ticket` + `client_message` (and their relations) after `sms_settings`, idempotently.
- `src/backfill/plan.ts` (create) — `planNumberBackfill()` pure planner + types.
- `src/backfill/plan.test.ts` (create) — planner unit tests.
- `src/backfill/api.ts` (create) — `sms-number-backfill` operation handler (dry-run / apply).
- `src/backfill/app.ts` (create) — operation UI (mode dropdown).
- `package.json` (modify) — register the `sms-number-backfill` operation entry in the bundle.

---

## Task 1: Phone normalization utility

**Files:**
- Create: `src/phone.ts`
- Test: `src/phone.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PhoneKind = "mobile" | "landline" | "unknown" | "empty"`
  - `type NormalizedPhone = { e164: string | null; kind: PhoneKind }`
  - `function normalizeAuMobile(input: unknown): NormalizedPhone` — returns `e164` (non-null **only** for mobiles), and a `kind` classification. Used by the backfill planner (Task 4) and, later, by the inbound adapter (Plan 3) for matching.

- [ ] **Step 1: Write the failing test**

```ts
// src/phone.test.ts
import { describe, it, expect } from "vitest";
import { normalizeAuMobile } from "./phone.js";

describe("normalizeAuMobile", () => {
  it("normalizes local 04xx mobile to +614 E.164", () => {
    expect(normalizeAuMobile("0449 922 425")).toEqual({ e164: "+61449922425", kind: "mobile" });
  });

  it("accepts already-international +61 mobile", () => {
    expect(normalizeAuMobile("+61449922425")).toEqual({ e164: "+61449922425", kind: "mobile" });
  });

  it("accepts 61... and 0061... mobile prefixes", () => {
    expect(normalizeAuMobile("61449922425")).toEqual({ e164: "+61449922425", kind: "mobile" });
    expect(normalizeAuMobile("0061449922425")).toEqual({ e164: "+61449922425", kind: "mobile" });
  });

  it("strips spaces, hyphens, parens, dots", () => {
    expect(normalizeAuMobile("(04) 4992-2425")).toEqual({ e164: "+61449922425", kind: "mobile" });
  });

  it("flags 03 landline numbers as landline with no e164", () => {
    expect(normalizeAuMobile("03 9123 4567")).toEqual({ e164: null, kind: "landline" });
  });

  it("flags 02/07/08 landlines as landline", () => {
    expect(normalizeAuMobile("0291234567").kind).toBe("landline");
    expect(normalizeAuMobile("0712345678").kind).toBe("landline");
    expect(normalizeAuMobile("0812345678").kind).toBe("landline");
  });

  it("treats null/empty/whitespace as empty", () => {
    expect(normalizeAuMobile(null)).toEqual({ e164: null, kind: "empty" });
    expect(normalizeAuMobile("")).toEqual({ e164: null, kind: "empty" });
    expect(normalizeAuMobile("   ")).toEqual({ e164: null, kind: "empty" });
  });

  it("treats garbage and wrong-length input as unknown", () => {
    expect(normalizeAuMobile("not a phone")).toEqual({ e164: null, kind: "unknown" });
    expect(normalizeAuMobile("041234")).toEqual({ e164: null, kind: "unknown" });
  });

  it("treats a non-AU +country number as unknown (out of AU scope)", () => {
    expect(normalizeAuMobile("+15551234567")).toEqual({ e164: "+15551234567", kind: "unknown" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/phone.test.ts`
Expected: FAIL — `Cannot find module './phone.js'` / `normalizeAuMobile is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/phone.ts
export type PhoneKind = "mobile" | "landline" | "unknown" | "empty";
export type NormalizedPhone = { e164: string | null; kind: PhoneKind };

const AU_LANDLINE_AREA = new Set(["2", "3", "7", "8"]);

/**
 * Normalize an Australian phone number to E.164 (+614…) for SMS.
 * Only mobiles get an `e164`; landlines and un-normalizable values are flagged.
 */
export function normalizeAuMobile(input: unknown): NormalizedPhone {
  if (typeof input !== "string") return { e164: null, kind: "empty" };
  const trimmed = input.trim();
  if (trimmed === "") return { e164: null, kind: "empty" };

  let digits = trimmed.replace(/[\s\-().]/g, "");

  if (digits.startsWith("+61")) {
    digits = "+61" + digits.slice(3);
  } else if (digits.startsWith("0061")) {
    digits = "+61" + digits.slice(4);
  } else if (digits.startsWith("61") && digits.length >= 10) {
    digits = "+61" + digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = "+61" + digits.slice(1);
  } else if (digits.startsWith("+")) {
    // Another country code: out of AU scope. Keep the value if it looks E.164, flag unknown.
    return { e164: /^\+\d{8,15}$/.test(digits) ? digits : null, kind: "unknown" };
  } else {
    return { e164: null, kind: "unknown" };
  }

  const m = /^\+61(\d+)$/.exec(digits);
  if (!m) return { e164: null, kind: "unknown" };
  const national = m[1]; // national portion, leading 0 already removed

  if (/^4\d{8}$/.test(national)) {
    return { e164: "+61" + national, kind: "mobile" };
  }
  if (national.length === 9 && AU_LANDLINE_AREA.has(national[0]!)) {
    return { e164: null, kind: "landline" };
  }
  return { e164: null, kind: "unknown" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/phone.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/phone.ts src/phone.test.ts
git commit -m "feat(sms): add AU phone normalization utility"
```

---

## Task 2: Ticketing collection + relation definitions

**Files:**
- Modify: `src/constants.ts`
- Create: `src/hook/ticketing-schema.ts`
- Create: `src/hook/ticketing-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TICKET_COLLECTION = "client_ticket"`, `MESSAGE_COLLECTION = "client_message"` (from `constants.ts`).
  - `ticketCollectionPayload`, `messageCollectionPayload` — objects passed to `CollectionsService.createOne()`.
  - `ticketingRelations` — array of relation payloads passed to `RelationsService.createOne()`.
  - Consumed by the hook (Task 3).

- [ ] **Step 1: Add collection-name constants**

Add to `src/constants.ts` (below the existing `SETTINGS_COLLECTION` line):

```ts
export const TICKET_COLLECTION = "client_ticket";
export const MESSAGE_COLLECTION = "client_message";
```

- [ ] **Step 2: Write the failing schema-shape test**

```ts
// src/hook/ticketing-schema.test.ts
import { describe, it, expect } from "vitest";
import {
  ticketCollectionPayload,
  messageCollectionPayload,
  ticketingRelations,
} from "./ticketing-schema.js";
import { TICKET_COLLECTION, MESSAGE_COLLECTION } from "../constants.js";

const fieldNames = (payload: { fields: { field: string }[] }) =>
  payload.fields.map((f) => f.field);

describe("ticketing schema", () => {
  it("client_ticket has the expected fields", () => {
    expect(ticketCollectionPayload.collection).toBe(TICKET_COLLECTION);
    expect(fieldNames(ticketCollectionPayload)).toEqual(
      expect.arrayContaining([
        "id", "status", "channel", "client", "external_identity",
        "our_identity", "assignee", "last_message_at",
      ]),
    );
  });

  it("client_message has the expected fields including a unique external_message_id", () => {
    expect(messageCollectionPayload.collection).toBe(MESSAGE_COLLECTION);
    const ext = messageCollectionPayload.fields.find((f) => f.field === "external_message_id");
    expect(ext).toBeDefined();
    expect(ext!.schema?.is_unique).toBe(true);
    expect(fieldNames(messageCollectionPayload)).toEqual(
      expect.arrayContaining([
        "id", "ticket", "direction", "channel", "body",
        "from_identity", "to_identity", "external_message_id",
        "delivery_status", "raw", "timestamp",
      ]),
    );
  });

  it("defines client→family, ticket→client_ticket (with messages o2m), assignee→users relations", () => {
    const byField = Object.fromEntries(ticketingRelations.map((r) => [`${r.collection}.${r.field}`, r]));
    expect(byField["client_ticket.client"].related_collection).toBe("family");
    expect(byField["client_ticket.assignee"].related_collection).toBe("directus_users");
    expect(byField["client_message.ticket"].related_collection).toBe(TICKET_COLLECTION);
    expect(byField["client_message.ticket"].meta.one_field).toBe("messages");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/hook/ticketing-schema.test.ts`
Expected: FAIL — `Cannot find module './ticketing-schema.js'`.

- [ ] **Step 4: Write the schema definitions**

```ts
// src/hook/ticketing-schema.ts
import { TICKET_COLLECTION, MESSAGE_COLLECTION } from "../constants.js";

export const ticketCollectionPayload = {
  collection: TICKET_COLLECTION,
  meta: {
    icon: "support_agent",
    note: "Channel-agnostic client tickets. SMS is the first adapter.",
    sort_field: "sort",
    archive_field: "status",
    archive_value: "closed",
    unarchive_value: "open",
  },
  schema: { name: TICKET_COLLECTION },
  fields: [
    { field: "id", type: "uuid", meta: { hidden: true, readonly: true, interface: "input", special: ["uuid"] }, schema: { is_primary_key: true } },
    { field: "status", type: "string", schema: { default_value: "open" },
      meta: { interface: "select-dropdown", width: "half", display: "labels",
        options: { choices: [
          { text: "Open", value: "open", color: "var(--theme--primary)" },
          { text: "Pending", value: "pending", color: "var(--theme--warning)" },
          { text: "Closed", value: "closed", color: "var(--theme--foreground-subdued)" },
        ] } } },
    { field: "channel", type: "string", schema: { default_value: "sms" },
      meta: { interface: "select-dropdown", width: "half",
        options: { choices: [{ text: "SMS", value: "sms" }, { text: "Email", value: "email" }, { text: "Social", value: "social" }] } } },
    { field: "external_identity", type: "string",
      meta: { interface: "input", width: "half", note: "Counterpart address (E.164 phone for SMS)." },
      schema: { is_indexed: true } },
    { field: "our_identity", type: "string",
      meta: { interface: "input", width: "half", note: "Our address the conversation is on (the two-way number the parent texted)." } },
    { field: "client", type: "uuid",
      meta: { interface: "select-dropdown-m2o", width: "half", special: ["m2o"], note: "Linked family (null = unmatched/triage)." } },
    { field: "assignee", type: "uuid",
      meta: { interface: "select-dropdown-m2o", width: "half", special: ["m2o"] } },
    { field: "last_message_at", type: "timestamp",
      meta: { interface: "datetime", width: "half", display: "datetime", display_options: { relative: true } } },
    { field: "sort", type: "integer", meta: { hidden: true, interface: "input" } },
    { field: "date_created", type: "timestamp", meta: { special: ["date-created"], interface: "datetime", readonly: true, hidden: true } },
    { field: "date_updated", type: "timestamp", meta: { special: ["date-updated"], interface: "datetime", readonly: true, hidden: true } },
  ],
};

export const messageCollectionPayload = {
  collection: MESSAGE_COLLECTION,
  meta: {
    icon: "chat",
    note: "Individual inbound/outbound messages within a client ticket.",
    sort_field: "sort",
  },
  schema: { name: MESSAGE_COLLECTION },
  fields: [
    { field: "id", type: "uuid", meta: { hidden: true, readonly: true, interface: "input", special: ["uuid"] }, schema: { is_primary_key: true } },
    { field: "ticket", type: "uuid", meta: { interface: "select-dropdown-m2o", width: "half", special: ["m2o"] } },
    { field: "direction", type: "string",
      meta: { interface: "select-dropdown", width: "half",
        options: { choices: [{ text: "Inbound", value: "inbound" }, { text: "Outbound", value: "outbound" }] } } },
    { field: "channel", type: "string", schema: { default_value: "sms" }, meta: { interface: "input", width: "half" } },
    { field: "body", type: "text", meta: { interface: "input-multiline", width: "full" } },
    { field: "from_identity", type: "string", meta: { interface: "input", width: "half" } },
    { field: "to_identity", type: "string", meta: { interface: "input", width: "half" } },
    { field: "external_message_id", type: "string",
      meta: { interface: "input", width: "half", note: "Provider message id; idempotency key." },
      schema: { is_unique: true } },
    { field: "delivery_status", type: "string", meta: { interface: "input", width: "half", note: "sent | delivered | failed (null for inbound)." } },
    { field: "raw", type: "json", meta: { interface: "input-code", width: "full", options: { language: "json" }, special: ["cast-json"] } },
    { field: "timestamp", type: "timestamp", meta: { interface: "datetime", width: "half", display: "datetime" } },
    { field: "sort", type: "integer", meta: { hidden: true, interface: "input" } },
  ],
};

export const ticketingRelations = [
  {
    collection: TICKET_COLLECTION, field: "client", related_collection: "family",
    meta: { sort_field: null }, schema: { on_delete: "SET NULL" },
  },
  {
    collection: TICKET_COLLECTION, field: "assignee", related_collection: "directus_users",
    meta: { sort_field: null }, schema: { on_delete: "SET NULL" },
  },
  {
    collection: MESSAGE_COLLECTION, field: "ticket", related_collection: TICKET_COLLECTION,
    meta: { one_field: "messages", sort_field: "sort", one_deselect_action: "delete" },
    schema: { on_delete: "CASCADE" },
  },
];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/hook/ticketing-schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/constants.ts src/hook/ticketing-schema.ts src/hook/ticketing-schema.test.ts
git commit -m "feat(sms): define client_ticket/client_message schema + relations"
```

---

## Task 3: Bootstrap the ticketing collections in the hook

**Files:**
- Modify: `src/hook/index.ts`

**Interfaces:**
- Consumes: `ticketCollectionPayload`, `messageCollectionPayload`, `ticketingRelations` (Task 2); `TICKET_COLLECTION`, `MESSAGE_COLLECTION` (Task 2).
- Produces: idempotent creation of both collections + relations on `app.before`. No new exports.

> This task follows the existing `sms_settings` bootstrap pattern in the same file. There is no unit test for the hook (consistent with the codebase — `sms_settings` bootstrap is untested); verification is by build + a manual smoke check against a running Directus. The schema *shape* is already covered by Task 2's unit test.

- [ ] **Step 1: Add a helper and the bootstrap calls**

Replace the body of `src/hook/index.ts` with the following (keeps the existing `sms_settings` logic, adds the two collections after it):

```ts
import { defineHook } from "@directus/extensions-sdk";
import { SETTINGS_COLLECTION, TICKET_COLLECTION, MESSAGE_COLLECTION } from "../constants.js";
import { ticketCollectionPayload, messageCollectionPayload, ticketingRelations } from "./ticketing-schema.js";

export default defineHook(({ init }, { services, getSchema, logger, database }) => {
  init("app.before", async () => {
    const { CollectionsService, ItemsService, RelationsService } = services as any;

    const ensureSettings = async (schema: any) => {
      const collections = schema?.collections ?? {};
      if (collections[SETTINGS_COLLECTION]) return;
      const collectionsService = new CollectionsService({ schema, knex: database });
      await collectionsService.createOne({
        collection: SETTINGS_COLLECTION,
        meta: { singleton: true, icon: "sms", note: "AWS SNS credentials used by the Send SMS operation. Env vars override these values." },
        schema: { name: SETTINGS_COLLECTION },
        fields: [
          { field: "id", type: "integer", meta: { hidden: true, interface: "input", readonly: true }, schema: { is_primary_key: true, has_auto_increment: true } },
          { field: "aws_region", type: "string", meta: { interface: "input", width: "half", note: "AWS region, e.g. us-east-1" }, schema: { default_value: "us-east-1" } },
          { field: "aws_access_key_id", type: "string", meta: { interface: "input", width: "half", note: "Stored plaintext. Prefer SMS_AWS_ACCESS_KEY_ID env var in production." } },
          { field: "aws_secret_access_key", type: "string", meta: { interface: "input", width: "full", special: ["conceal"], note: "Stored plaintext. Prefer SMS_AWS_SECRET_ACCESS_KEY env var in production." } },
          { field: "aws_sns_sender_id", type: "string", meta: { interface: "input", width: "half", note: "Optional alphanumeric Sender ID (where supported by destination country)." } },
        ],
      });
      const freshSchema = await getSchema();
      const items = new ItemsService(SETTINGS_COLLECTION, { schema: freshSchema, accountability: null });
      await items.upsertSingleton({});
      logger.info(`Created singleton collection "${SETTINGS_COLLECTION}".`);
    };

    const ensureTicketing = async (schema: any) => {
      const collections = schema?.collections ?? {};
      if (collections[TICKET_COLLECTION] && collections[MESSAGE_COLLECTION]) return;
      const collectionsService = new CollectionsService({ schema, knex: database });
      const relationsService = new RelationsService({ schema, knex: database });

      if (!collections[TICKET_COLLECTION]) await collectionsService.createOne(ticketCollectionPayload);
      if (!collections[MESSAGE_COLLECTION]) await collectionsService.createOne(messageCollectionPayload);

      // Relations require both collections to exist; create any that are missing.
      const freshSchema = await getSchema();
      const existingRelations: any[] = (freshSchema as any)?.relations ?? [];
      const hasRelation = (collection: string, field: string) =>
        existingRelations.some((r) => r.collection === collection && r.field === field);
      for (const rel of ticketingRelations) {
        if (!hasRelation(rel.collection, rel.field)) await relationsService.createOne(rel);
      }
      logger.info(`Created ticketing collections "${TICKET_COLLECTION}" / "${MESSAGE_COLLECTION}".`);
    };

    try {
      await ensureSettings(await getSchema());
      await ensureTicketing(await getSchema());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`SMS extension bootstrap failed: ${msg}`);
    }
  });
});
```

- [ ] **Step 2: Build the extension**

Run: `npm run build`
Expected: `✔ Done`, no TypeScript errors.

- [ ] **Step 3: Run the full test suite (no regressions)**

Run: `npm test`
Expected: PASS — existing config/constants/operation tests plus the new `phone` and `ticketing-schema` tests.

- [ ] **Step 4: Commit**

```bash
git add src/hook/index.ts
git commit -m "feat(sms): bootstrap client_ticket/client_message collections in hook"
```

- [ ] **Step 5: Deploy + smoke-check (manual, against a running Directus)**

Deploy `dist/` via the usual cycle and restart Directus. In Studio, confirm `Client Ticket` and `Client Message` collections exist, the `client` field links to `family`, and a ticket shows a `messages` o2m. (This is a manual verification gate — not automated.)

---

## Task 4: Number backfill — planner + operation

**Files:**
- Create: `src/backfill/plan.ts`
- Create: `src/backfill/plan.test.ts`
- Create: `src/backfill/api.ts`
- Create: `src/backfill/app.ts`
- Modify: `package.json` (register the operation entry)

**Interfaces:**
- Consumes: `normalizeAuMobile` (Task 1).
- Produces:
  - `type FamilyRow = { id: string; family_admin_mobile?: unknown; family_sms_cc?: { to_name?: string; to_mobile?: unknown }[] | null }`
  - `type BackfillChange = { id: string; field: "family_admin_mobile" | "family_sms_cc"; index?: number; from: string | null; to: string | null; kind: import("../phone.js").PhoneKind; action: "normalize" | "flag" }`
  - `function planNumberBackfill(families: FamilyRow[]): { changes: BackfillChange[]; summary: { normalized: number; landline: number; unknown: number; empty: number } }`
  - A Directus operation `sms-number-backfill` with options `{ mode: "dry-run" | "apply" }`.

- [ ] **Step 1: Write the failing planner test**

```ts
// src/backfill/plan.test.ts
import { describe, it, expect } from "vitest";
import { planNumberBackfill } from "./plan.js";

describe("planNumberBackfill", () => {
  it("normalizes a local admin mobile and reports it", () => {
    const out = planNumberBackfill([{ id: "f1", family_admin_mobile: "0449 922 425" }]);
    expect(out.changes).toContainEqual({
      id: "f1", field: "family_admin_mobile", from: "0449 922 425",
      to: "+61449922425", kind: "mobile", action: "normalize",
    });
    expect(out.summary.normalized).toBe(1);
  });

  it("flags a landline admin mobile without producing an e164", () => {
    const out = planNumberBackfill([{ id: "f2", family_admin_mobile: "03 9123 4567" }]);
    const change = out.changes.find((c) => c.id === "f2");
    expect(change).toMatchObject({ action: "flag", kind: "landline", to: null });
    expect(out.summary.landline).toBe(1);
  });

  it("walks the family_sms_cc array by index", () => {
    const out = planNumberBackfill([
      { id: "f3", family_sms_cc: [{ to_name: "Mum", to_mobile: "0412345678" }, { to_name: "Dad", to_mobile: "0299999999" }] },
    ]);
    expect(out.changes).toContainEqual({
      id: "f3", field: "family_sms_cc", index: 0, from: "0412345678",
      to: "+61412345678", kind: "mobile", action: "normalize",
    });
    expect(out.changes.find((c) => c.index === 1)).toMatchObject({ action: "flag", kind: "landline" });
  });

  it("ignores already-normalized mobiles (no change emitted)", () => {
    const out = planNumberBackfill([{ id: "f4", family_admin_mobile: "+61449922425" }]);
    expect(out.changes).toHaveLength(0);
  });

  it("counts empty values without emitting changes", () => {
    const out = planNumberBackfill([{ id: "f5", family_admin_mobile: null }]);
    expect(out.changes).toHaveLength(0);
    expect(out.summary.empty).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/backfill/plan.test.ts`
Expected: FAIL — `Cannot find module './plan.js'`.

- [ ] **Step 3: Write the planner**

```ts
// src/backfill/plan.ts
import { normalizeAuMobile, type PhoneKind } from "../phone.js";

export type FamilyRow = {
  id: string;
  family_admin_mobile?: unknown;
  family_sms_cc?: { to_name?: string; to_mobile?: unknown }[] | null;
};

export type BackfillChange = {
  id: string;
  field: "family_admin_mobile" | "family_sms_cc";
  index?: number;
  from: string | null;
  to: string | null;
  kind: PhoneKind;
  action: "normalize" | "flag";
};

export type BackfillResult = {
  changes: BackfillChange[];
  summary: { normalized: number; landline: number; unknown: number; empty: number };
};

const asStr = (v: unknown): string | null => (typeof v === "string" ? v : v == null ? null : String(v));

export function planNumberBackfill(families: FamilyRow[]): BackfillResult {
  const changes: BackfillChange[] = [];
  const summary = { normalized: 0, landline: 0, unknown: 0, empty: 0 };

  const consider = (id: string, field: BackfillChange["field"], raw: unknown, index?: number) => {
    const norm = normalizeAuMobile(raw);
    const from = asStr(raw);
    if (norm.kind === "empty") { summary.empty++; return; }
    if (norm.kind === "mobile") {
      summary.normalized++;
      if (norm.e164 !== from) changes.push({ id, field, ...(index !== undefined ? { index } : {}), from, to: norm.e164, kind: "mobile", action: "normalize" });
      return;
    }
    // landline | unknown → flag for manual correction
    summary[norm.kind === "landline" ? "landline" : "unknown"]++;
    changes.push({ id, field, ...(index !== undefined ? { index } : {}), from, to: null, kind: norm.kind, action: "flag" });
  };

  for (const fam of families) {
    if ("family_admin_mobile" in fam) consider(fam.id, "family_admin_mobile", fam.family_admin_mobile);
    const cc = fam.family_sms_cc;
    if (Array.isArray(cc)) cc.forEach((entry, i) => consider(fam.id, "family_sms_cc", entry?.to_mobile, i));
  }

  return { changes, summary };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/backfill/plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the operation handler (dry-run / apply)**

```ts
// src/backfill/api.ts
import { defineOperationApi } from "@directus/extensions-sdk";
import { planNumberBackfill, type FamilyRow, type BackfillChange } from "./plan.js";

export type Options = { mode: "dry-run" | "apply" };

export default defineOperationApi<Options>({
  id: "sms-number-backfill",
  handler: async ({ mode }, { services, getSchema, accountability, logger }) => {
    const { ItemsService } = services as any;
    const schema = await getSchema();
    const families = new ItemsService("family", { schema, accountability });

    const rows: FamilyRow[] = await families.readByQuery({
      fields: ["id", "family_admin_mobile", "family_sms_cc"],
      limit: -1,
    });

    const { changes, summary } = planNumberBackfill(rows);

    if (mode !== "apply") {
      return { mode: "dry-run", summary, changeCount: changes.length, changes };
    }

    // Apply: group normalize changes per family; rebuild family_sms_cc arrays where needed.
    const byId = new Map<string, BackfillChange[]>();
    for (const c of changes) {
      if (c.action !== "normalize") continue; // flags are reported, never auto-written
      const list = byId.get(c.id) ?? [];
      list.push(c);
      byId.set(c.id, list);
    }

    let updated = 0;
    for (const [id, famChanges] of byId) {
      const current: FamilyRow = await families.readOne(id, { fields: ["id", "family_admin_mobile", "family_sms_cc"] });
      const patch: Record<string, unknown> = {};
      const ccPatch = Array.isArray(current.family_sms_cc) ? [...current.family_sms_cc] : null;
      for (const c of famChanges) {
        if (c.field === "family_admin_mobile") patch.family_admin_mobile = c.to;
        if (c.field === "family_sms_cc" && ccPatch && c.index !== undefined && ccPatch[c.index]) {
          ccPatch[c.index] = { ...ccPatch[c.index], to_mobile: c.to };
        }
      }
      if (ccPatch && famChanges.some((c) => c.field === "family_sms_cc")) patch.family_sms_cc = ccPatch;
      if (Object.keys(patch).length > 0) { await families.updateOne(id, patch); updated++; }
    }

    logger.info(`sms-number-backfill applied: ${updated} families updated; flagged ${summary.landline} landline / ${summary.unknown} unknown.`);
    return { mode: "apply", summary, updated, flagged: changes.filter((c) => c.action === "flag") };
  },
});
```

- [ ] **Step 6: Write the operation UI**

```ts
// src/backfill/app.ts
import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "sms-number-backfill",
  name: "Backfill SMS Numbers (AU)",
  icon: "cleaning_services",
  description: "Normalize family phone numbers to E.164 (+614…) and flag landlines/unknowns. Dry-run by default.",
  overview: ({ mode }) => [{ label: "Mode", text: (mode as string) ?? "dry-run" }],
  options: [
    {
      field: "mode",
      name: "Mode",
      type: "string",
      schema: { default_value: "dry-run" },
      meta: {
        width: "half",
        interface: "select-dropdown",
        options: { choices: [
          { text: "Dry run (report only)", value: "dry-run" },
          { text: "Apply (write normalized mobiles)", value: "apply" },
        ] },
        note: "Apply only writes confirmed mobile normalizations; landline/unknown are reported for manual fixing, never overwritten.",
      },
    },
  ],
});
```

- [ ] **Step 7: Register the operation in the bundle**

In `package.json`, add a third entry to `directus:extension.entries` (after the existing `sms-aws-sns` operation and `sms-aws-sns-bootstrap` hook):

```json
{
  "type": "operation",
  "name": "sms-number-backfill",
  "source": { "app": "src/backfill/app.ts", "api": "src/backfill/api.ts" }
}
```

- [ ] **Step 8: Build + full test suite**

Run: `npm run build && npm test`
Expected: build `✔ Done`; all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/backfill package.json
git commit -m "feat(sms): add AU number backfill operation (dry-run/apply)"
```

- [ ] **Step 10: Deploy + run a dry-run (manual gate)**

Deploy `dist/`, restart Directus. Build a throwaway manual flow with the **Backfill SMS Numbers** operation in `dry-run` mode; run it; review the reported `summary` + `changes` (especially landline/unknown flags) before ever running `apply`. Apply only after the dry-run looks right and the DB is backed up.

---

## Self-Review

**Spec coverage (Plan 1 portion):**
- `client_ticket` / `client_message` channel-agnostic collections incl. `our_identity`, unique `external_message_id` → Tasks 2–3. ✔
- Relations (client→family nullable, ticket↔message, assignee→users) → Tasks 2–3. ✔
- E.164 normalization on `+614`; landline/unknown flagging → Tasks 1, 4. ✔
- Backfill migration over `family_admin_mobile` + `family_sms_cc[]` → Task 4. ✔
- Square null-backfill → explicitly deferred (Global Constraints) — mechanics undetermined in spec. ✔ (gap is intentional, documented)
- Idempotent bootstrap → Task 3 (`if (collections[...]) return`). ✔

**Placeholder scan:** No TBD/TODO; every code step shows full code; manual gates (hook smoke-check, backfill dry-run) are explicitly labelled as non-automated verification, not placeholders. ✔

**Type consistency:** `normalizeAuMobile`/`NormalizedPhone`/`PhoneKind` used identically in Tasks 1 & 4; `BackfillChange` shape in the planner matches the test and the `api.ts` consumer; collection-name constants identical across Tasks 2–4. ✔

---

## Out of scope (later plans)

- **Plan 2 — Outbound & Spray:** origination-aware send (Sender ID via SNS / number via AWS End User Messaging `SendTextMessage`), writing `client_message` rows, spray recipient selection + per-recipient audit (JSON-fallback), `do not reply` footer handling for the spray path.
- **Plan 3 — Inbound & Two-way:** SNS-subscribed **endpoint** adapter (signature verification, subscription handshake, E.164 matching against `family_admin_mobile` + `family_sms_cc[]`, idempotent upsert keyed on `external_message_id`, 0/1/many family resolution → `our_identity`), the two-way ticket UI + reply action, and the SQS DLQ scheduled-drain + manual replay.
- **Square null-backfill** mechanics.
