# Directus Operation: Send SMS via AWS SNS

**Date:** 2026-05-10
**Status:** Approved design (revised 2026-05-10 to add hybrid config), pending implementation plan
**Package name:** `directus-extension-operation-sms-aws-sns`

## Summary

A custom Directus operation extension that sends a single SMS message via AWS SNS `Publish`. Modeled on the built-in email send operation: a flow author drops it into a flow, fills in recipient and message body, and the operation handles delivery. Recipient and body support `{{ }}` template interpolation against the flow's data chain.

AWS credentials and region come from a **hybrid configuration source**: environment variables take precedence; if any value is missing, the handler falls back to a Directus singleton settings collection (`sms_settings`) that admins can edit through the standard Directus UI. Either source — or a combination — is sufficient.

## Goals

- Add "Send SMS (AWS SNS)" to the Directus flow operation picker.
- Single-recipient send. One operation invocation = one SMS.
- Configuration parity with the existing email operation: panel fields for the per-message details.
- Hybrid config: env vars for prod/CI deployments; in-UI settings page for ad-hoc / non-technical operators.
- Auto-bootstrap the settings collection on extension load (no manual schema setup required).
- Return the SNS `MessageId` to the data chain so downstream operations can reference it.

## Non-goals (YAGNI)

- Bulk send / array of recipients. Loop in the flow if needed.
- Delivery status callbacks, opt-out list management, or a sends-log collection.
- AWS Pinpoint / End User Messaging features (origination identity pools, country routing, templates).
- A standalone "send ad-hoc SMS" UI panel inside crf-admin (the settings page is config only, not for sending).
- Retry logic inside the handler. Flow authors wire retry as a separate operation if they want it.
- Field-level encryption of the AWS secret in the database (see Security caveat).

## Architecture

Bundle-style Directus extension scaffolded with `@directus/extensions-sdk`. A bundle lets a single package ship multiple extension entries — here, one `operation` and one `hook`:

```
directus-extension-operation-sms-aws-sns/
├── package.json
├── src/
│   ├── index.ts              # Bundle entry — exports both operation and hook
│   ├── constants.ts          # FOOTER, E164_REGEX, SETTINGS_COLLECTION
│   ├── config.ts             # resolveAwsConfig(): env → settings collection fallback
│   ├── operation/
│   │   ├── app.ts            # Panel UI (To, Message, SMS Type)
│   │   └── api.ts            # Handler: validate, resolve config, append footer, call SNS
│   └── hook/
│       └── index.ts          # init.before/server.start hook: ensure sms_settings exists
├── tests/                    # vitest tests for constants, config, api
└── README.md
```

Runtime dependency: `@aws-sdk/client-sns` (v3, modular). No other deps beyond the Directus extension SDK.

Installed by placing the built extension into the Directus instance's `extensions/` directory and restarting.

## Operation Options (Panel UI — `operation/app.ts`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `to` | string | yes | E.164 phone number (e.g. `+15551234567`). Supports `{{ }}` template vars. |
| `message` | string (textarea) | yes | SMS body. Supports `{{ }}` template vars. |
| `smsType` | dropdown | yes | `Transactional` (default) or `Promotional`. |

The `overview` function shows `to` and a truncated `message` preview in the flow editor card.

### No-reply footer

Every outgoing message has the literal footer `\n\n(do not reply)` (16 chars, GSM-7 safe) appended by the handler after template interpolation. This is non-configurable — two-way messaging is disabled at the AWS account level, so the footer is informational for recipients. Flow authors do not need to include it in their `message` template.

## Configuration

### Resolution order (per-handler-invocation)

For each config key, the handler picks the first non-empty source in this order:

1. Environment variable
2. Field on the `sms_settings` singleton record

If the resolved `region` is empty, the handler throws and the flow takes the reject path.
Credentials may be empty if the SDK's default credential chain (IAM role, instance profile, shared profile) supplies them — the SDK handles that itself.
`senderId` is always optional.

### Environment variables

| Variable | Maps to | Notes |
|---|---|---|
| `AWS_REGION` | `region` | e.g. `us-east-1`. |
| `AWS_ACCESS_KEY_ID` | `accessKeyId` | Optional if using SDK credential chain. |
| `AWS_SECRET_ACCESS_KEY` | `secretAccessKey` | Same. |
| `AWS_SNS_SENDER_ID` | `senderId` | Honored only in countries that support it. |

### Settings collection (`sms_settings`)

A Directus singleton collection auto-created by the extension's hook on Directus startup if missing. Admins find it in the navigation under **Settings → SMS Settings** (a singleton renders as one editable form, no list view).

Schema:

| Field | Type | Interface | Notes |
|---|---|---|---|
| `id` | integer | (hidden) | Singleton primary key. |
| `aws_region` | string | input | Default `us-east-1`. |
| `aws_access_key_id` | string | input | Stored plaintext (see Security caveat). |
| `aws_secret_access_key` | string | input (masked) | `meta.special: ["conceal"]` so the value is dot-masked in the UI. Stored plaintext. |
| `aws_sns_sender_id` | string | input | Optional. |

Permissions: collection is admin-only by default. The hook does not grant any non-admin role read or write access.

### Security caveat

Storing AWS credentials in the Directus database is **less secure than env vars**:

- Plaintext at rest in Postgres.
- Visible to anyone with admin DB access or admin-role API access.
- Goes into DB backups.

Production deployments should prefer env vars (or IAM role / SDK credential chain) and leave the settings collection empty. The hybrid resolver makes this seamless: if env vars are set, the DB values are never read.

IAM permission required (regardless of source): `sns:Publish`.

## Bootstrap Hook (`hook/index.ts`)

A Directus hook registered on `('init.before')` (or equivalent server-start lifecycle event) that:

1. Checks whether the `sms_settings` collection exists.
2. If not, creates it as a singleton with the four fields above and a single empty record.
3. Logs creation at `info` level.
4. Does nothing if the collection already exists (idempotent).

The hook never modifies an existing collection. Schema migrations beyond v1 are out of scope; if the schema needs to change in a future version, the hook will detect a mismatch and log a warning rather than auto-migrating.

## Handler Behavior (`operation/api.ts`)

Signature: `handler({ to, message, smsType }, { env, services, getSchema, accountability, logger }) => Promise<{ messageId: string; to: string }>`

Sequence:

1. Directus interpolates `{{ }}` in `to` and `message` against the data chain before invoking the handler.
2. Validate `to` matches `^\+[1-9]\d{1,14}$` (E.164). On mismatch, throw — flow takes the reject path. No AWS call, no DB read, no charge.
3. Validate `message` is a non-empty string after trim. Same reject behavior on failure.
4. Resolve config via `resolveAwsConfig({ env, services, getSchema, accountability })`:
   - Read each key from env first, then fall back to the `sms_settings` singleton via `ItemsService`.
   - Throw if `region` is empty after both sources are checked.
5. Append the no-reply footer: `finalMessage = message + "\n\n(do not reply)"`.
6. Construct an `SNSClient`:
   - `region` → from resolved config
   - If both `accessKeyId` and `secretAccessKey` were resolved, pass `credentials: { accessKeyId, secretAccessKey }`
   - Otherwise omit `credentials` so the SDK's default credential chain is used
7. Build `MessageAttributes`:
   - `AWS.SNS.SMS.SMSType` → `{ DataType: "String", StringValue: smsType }`
   - `AWS.SNS.SMS.SenderID` → `{ DataType: "String", StringValue: senderId }` *(only if resolved)*
8. Call `client.send(new PublishCommand({ PhoneNumber: to, Message: finalMessage, MessageAttributes }))`.
9. On success: return `{ messageId: result.MessageId, to }`. Directus stores this under the operation's key in the data chain — accessible downstream as `{{ <operation_key>.messageId }}`.
10. On AWS error: log via `logger.error` with the SNS error name and message, then rethrow so the flow takes the reject path.

## Error Handling

| Cause | Behavior |
|---|---|
| `to` not E.164 | Throw `Error("Invalid phone number: must be E.164 (e.g. +15551234567)")`. No AWS call. |
| `message` empty/whitespace | Throw `Error("Message body is required")`. No AWS call. |
| `region` missing from both sources | Throw `Error("AWS region not configured. Set AWS_REGION env var or configure SMS Settings.")`. No AWS call. |
| AWS auth/throttling/invalid number/opt-out | Logged, rethrown. Flow's reject path runs. |
| `sms_settings` read fails (DB error) | Logged, rethrown — env vars alone could not satisfy the request. |

The handler does not retry. Network or throttling retries are the flow author's choice via additional operations.

## Data Flow Example

```
Trigger (manual or event)
  └─> Get user record (read_data)
        └─> Send SMS (this operation)
              to:      "{{ get_user.phone }}"
              message: "Hi {{ get_user.first_name }}, your code is {{ $trigger.payload.code }}."
              smsType: "Transactional"
              └─> Log result (e.g. update record with {{ send_sms.messageId }})
```

## Testing

**Unit tests (vitest, all use mocked dependencies):**

`constants.test.ts`:
- `FOOTER` is `"\n\n(do not reply)"` and 16 chars.
- `E164_REGEX` accepts valid E.164, rejects unprefixed/hyphenated/empty/over-length.

`config.test.ts` — `resolveAwsConfig`:
- All env vars set → returns env values, never reads ItemsService.
- All env vars empty + settings record populated → returns settings values.
- Region from env, secret from settings → mixed result preserves precedence.
- Both env and settings empty for region → throws with clear message.
- Settings record absent (empty `sms_settings` collection) → handled as all-empty.
- ItemsService throws → error propagates with clear context.

`api.test.ts` — handler with mocked `SNSClient` via `aws-sdk-client-mock`:
- Success: valid input → resolves with `{ messageId, to }`; `PublishCommand` invoked with expected `PhoneNumber`, `Message` (footer-appended), and `MessageAttributes`.
- Validation: bad phone number → rejects, no `client.send` call, no config resolution.
- Validation: empty/whitespace message → rejects, no `client.send` call.
- Missing region (env + settings empty) → rejects on config resolution.
- Credentials provided via env → `SNSClient` constructed with explicit `credentials`.
- Credentials missing → `SNSClient` constructed without `credentials` (relies on default chain).
- Sender ID present (env or settings) → `MessageAttributes['AWS.SNS.SMS.SenderID']` set.
- Sender ID absent → that attribute key is omitted.
- `smsType` propagates as `Transactional` and `Promotional` correctly.
- AWS rejection (e.g. `InvalidParameter`) → handler rethrows; logger.error called once.

**Manual end-to-end test:**

1. Build the extension, drop into `extensions/`, restart Directus.
2. Confirm Directus startup log contains the hook's "created sms_settings collection" message on first run.
3. Navigate to **Settings → SMS Settings** (or wherever singletons render). Confirm form shows four fields, secret field is masked.
4. Test path A — settings only: leave env vars unset; fill in region + credentials in the UI; verify a destination number in SNS sandbox; confirm spend cap > 0; build a manual-trigger flow with the operation; run; confirm SMS received with `\n\n(do not reply)` footer.
5. Test path B — env override: set `AWS_REGION=us-west-2` (different from settings) in env; restart; run flow; confirm SMS sent (proves env precedence — verify via SNS logs in `us-west-2`).
6. Negative test: invalid phone in operation config → flow takes reject path, no SMS sent.

## Open Questions

None.

## References

- AWS SNS `Publish`: https://docs.aws.amazon.com/sns/latest/api/API_Publish.html
- SNS SMS `MessageAttributes`: https://docs.aws.amazon.com/sns/latest/dg/sms_publish-to-phone.html
- Directus operation extensions: https://docs.directus.io/extensions/operations.html
- Directus bundle extensions: https://docs.directus.io/extensions/bundles.html
- Directus hooks: https://docs.directus.io/extensions/hooks.html
- Directus singleton collections: https://docs.directus.io/configuration/data-model/collections.html#collection-setup
