# Two-Way SMS + Channel-Agnostic Ticketing — Design

**Date:** 2026-06-23
**Status:** Approved (design), pending implementation plan
**Builds on:** `2026-05-10-sms-aws-sns-operation-design.md` (outbound SMS via Amazon SNS)

## Problem

The current extension sends **one-way** SMS via Amazon SNS using an alphanumeric Sender ID
(`CRF-Schools`). Our users are busy parents who reasonably expect to **reply** to a text.
Sender IDs cannot receive replies, and SNS is outbound-only — so two-way requires a dedicated
phone number via **AWS End User Messaging SMS**, an inbound ingestion path, and somewhere for
inbound messages to live and be worked.

We also want the inbound store to be **general** — usable for email and social messages in the
future, not SMS-specific.

## Goals (v1)

- Staff can run a **Spray**: a bulk one-way blast to selected families via the Sender ID.
- Parents can **reply** to messages sent from a dedicated AU number.
- Inbound replies are captured as **tickets** in a channel-agnostic ticketing model, threaded to
  the family where the number resolves.
- Staff can **reply to a ticket** from Directus; the reply sends from the number and appends to
  the thread (full two-way loop in v1).
- **No inbound message is ever lost**, including during Directus restarts/deploys (503s).

## Non-Goals (v1 — documented for later)

- Queue-first inbound delivery with a long-running polling worker (phase 2).
- A polished custom Directus **module** for the spray composer and threaded inbox (phase 2;
  v1 uses standard Directus Studio collection views + flow/manual actions).
- Automated keyword/auto-reply logic beyond AWS's built-in STOP/HELP opt-out handling.
- Email and social adapters (the data model supports them; adapters are future work).

## Architecture Overview

```
                         ┌─────────────────────────── Spray (one-way) ──────────────────────────┐
Staff ──(Spray UI)──▶ send operation (origination = Sender ID) ──▶ Amazon SNS ──▶ parents' phones
                         └──────────────────────────────────────────────────────────────────────┘

                         ┌─────────────────────────── Two-way ──────────────────────────────────┐
parent replies ──▶ AU two-way number (AWS End User Messaging)
                       └─▶ SNS topic ──(HTTPS, retries + SQS DLQ)──▶ extension API endpoint
                                                                         │ verify SNS signature
                                                                         │ handle subscribe handshake
                                                                         │ normalize → E.164
                                                                         │ resolve family
                                                                         ▼
                                                              upsert client_ticket + client_message
Staff ──(Two-way UI: Reply)──▶ send operation (origination = number) ──▶ AWS ──▶ parent
                         └──────────────────────────────────────────────────────────────────────┘
```

## Components

Each unit has one purpose, a defined interface, and is independently testable.

### 1. Channel-agnostic ticketing collections

**`client_ticket`**
- `id` (uuid, pk)
- `status` — `open` | `pending` | `closed` (default `open`)
- `channel` — `sms` (extensible: `email`, `social`, …)
- `client` — m2o → `family` (nullable; null = unmatched/triage)
- `external_identity` — the counterpart address: E.164 phone now (email/handle later)
- `assignee` — m2o → `directus_users` (nullable)
- `last_message_at` — timestamp (drives inbox sort)
- standard `date_created` / `date_updated`
- `messages` — o2m → `client_message`

**`client_message`**
- `id` (uuid, pk)
- `ticket` — m2o → `client_ticket`
- `direction` — `inbound` | `outbound`
- `channel` — `sms` (matches ticket)
- `body` — text
- `from_identity`, `to_identity` — E.164 (or future channel address)
- `external_message_id` — string, **unique** (AWS `inboundMessageId` / outbound message id) — the
  idempotency key
- `delivery_status` — nullable (`sent` | `delivered` | `failed` | inbound = null)
- `raw` — json (full provider payload, for audit/debug)
- `timestamp` — when the message occurred

SMS is the first **adapter**; future channels write into these same two collections. Only the
identity→client resolution is channel-specific.

### 2. Inbound SMS adapter (extension API endpoint)

A custom API endpoint added to the extension (a `defineEndpoint`). Responsibilities, in order:

1. **SNS signature verification** — validate `SigningCertURL` (host must be an `amazonaws.com`
   SNS cert), reconstruct the canonical string-to-sign, verify the signature. Reject otherwise.
   This is the security boundary: without it the endpoint accepts forged inbound messages.
2. **Subscription handshake** — on `SubscriptionConfirmation`, fetch the `SubscribeURL` to confirm.
3. **Parse + normalize** — extract `originationNumber`, `destinationNumber`, `messageBody`,
   `inboundMessageId`, `previousPublishedMessageId`; normalize numbers to **E.164**.
4. **Resolve family** — match `originationNumber` against `family_admin_mobile` and every
   `family_sms_cc[].to_mobile` (both normalized). Result: 0, 1, or many candidate families.
5. **Upsert ticket + message** (idempotent — see §4):
   - Find the **open** ticket for this `external_identity`; if none, create one
     (`client` = the single match, or null for 0/many; many-match flagged for staff disambiguation).
   - Insert a `client_message` (`direction: inbound`) **keyed on `external_message_id`**; a
     duplicate id is a no-op/update, never a second row.
   - Bump `last_message_at`.

### 3. Origination-aware send operation

Extend the existing send operation with an **origination** option:
- `senderId` — spray / bulk one-way (current behaviour).
- `number` — conversational; messages a parent can reply to.

Outbound sends from the Two-way UI use `number` and append an `outbound` `client_message` to the
ticket (storing the returned message id in `external_message_id`).

> Decision: **keep both providers.** The `senderId` (spray) path stays on Amazon SNS (`Publish`
> with Sender ID); the `number` (conversational) path uses AWS End User Messaging
> (`SendTextMessage` with the number as origination identity). The operation routes to the right
> provider based on the `origination` option.

### 4. Resilience & idempotency

- **SNS retries** absorb brief Directus unavailability (restarts/deploys) via the subscription's
  built-in retry policy.
- **SQS DLQ** on the SNS subscription durably captures anything that outlives the retry window
  (longer outage / repeated 5xx).
- **Replay path** — the DLQ is an AWS **SQS** queue (pull-based), so a **scheduled** Directus flow
  long-polls it every few minutes, reprocesses each message through the same upsert adapter, and
  deletes on success; a **manual "drain now"** action is also provided. Recovery is automatic once
  Directus is healthy. The DLQ only fills when an outage outlasts SNS's own retries.
- **Idempotency** — `client_message.external_message_id` is unique and the adapter upserts on it,
  so SNS retries and DLQ replays never create duplicate tickets/messages. This is mandatory the
  moment retries exist.

### 5. Spray interface (v1)

Standard Directus Studio experience: select recipient families (filtered by `family_sms_option`),
compose a message, and send via the send operation with `origination: senderId`. Each send writes
a **per-recipient `outbound` `client_message`** for audit (preferred). If per-recipient rows prove
impractical at blast volume, fall back to a single message item storing recipients in a JSON field,
queried via **Directus 12 JSON filtering** to look up a particular recipient.

### 6. Two-way interface (v1)

Standard Directus Studio collection views over `client_ticket` / `client_message`: a ticket list
sorted by `last_message_at`, the message thread, and a manual **Reply** action that sends via the
number and appends to the thread. A small custom **interface** for a chat-style thread is optional
polish; the full module is phase 2.

### 7. Number normalization & migration

- A normalization utility converts AU mobile formats to E.164, normalizing on the **`+614`**
  prefix (not local `04`), used on both inbound matching and outbound `to`.
- **`03` and other landline numbers cannot receive SMS** — identify and flag them for replacement;
  they will never match inbound and must be corrected, not silently kept.
- **Null / missing mobiles**: backfill from **Square** (existing customer records) where available.
- **Backfill migration** over `family_admin_mobile` and `family_sms_cc[].to_mobile`: normalize to
  E.164 (`+614…`), flag landline/un-normalizable entries for manual correction, and fill nulls from
  Square. Real data-quality risk — unmatched inbound is the symptom of dirty numbers.

## AWS Provisioning (split of responsibility)

**Console + approval (account owner):**
- Lease and **register** the Australian two-way number in AWS End User Messaging
  (company + use-case registration; manual approval; lead time; monthly lease fee; ~1 msg/s
  throughput on a long code).

**Scriptable via SDK/CLI (with a dedicated least-privilege provisioning credential — NOT the
send keys, rotated after use):**
- Create the SNS topic; enable two-way on the number with the topic as destination.
- Create the SQS DLQ and attach to the subscription.
- Optional observability: delivery-status IAM role + `SetSMSAttributes` for CloudWatch logging
  (per-message `DELIVERED`/`FAILED` with provider reason).

The narrow `sns:Publish` send credential cannot provision any of this and must not be repurposed.

## Testing

Reuse the existing Vitest harness. Unit coverage:
- SNS signature verification: valid / forged / missing signature; bad `SigningCertURL` host.
- Subscription-confirmation handshake.
- E.164 normalization across AU formats and edge cases.
- Family resolution: 0 / 1 / many matches (across admin mobile + cc array).
- Idempotent upsert: duplicate `inboundMessageId` produces no duplicate row.
- Origination selection: `senderId` vs `number` shapes the correct provider call.
- Ticket grouping: append to existing open ticket vs create new; closed ticket → new ticket.

## Decisions (resolved during review)

1. **Two providers, kept side by side.** Sprays send via Amazon SNS + Sender ID; conversational
   sends via AWS End User Messaging + the number. The operation routes by `origination`.
2. **Spray audit = per-recipient `outbound` rows** (preferred); fallback to a single item with a
   JSON recipients field queried via Directus 12 JSON filtering if per-recipient is impractical.
3. **Normalization on `+614`.** `03`/landline numbers identified and flagged for replacement
   (can't receive SMS); null mobiles backfilled from Square.
4. **DLQ replay = scheduled SQS-drain flow + manual "drain now"** action.

### Remaining for the implementation plan (detail, not direction)

- Specific E.164 normalization library/rules and how un-normalizable numbers surface during backfill.
- Square backfill mechanics (API/export, field mapping, one-off vs ongoing).
- Scheduled-drain interval and SQS long-poll/visibility-timeout settings.

## Phase 2 (not built in v1)

- Queue-first inbound (SNS → SQS → extension polling worker), removing reliance on endpoint
  availability at receipt time.
- Custom Directus module: polished spray composer + threaded help-desk inbox with read/unread.
- Additional channel adapters (email, social) writing into `client_ticket` / `client_message`.
