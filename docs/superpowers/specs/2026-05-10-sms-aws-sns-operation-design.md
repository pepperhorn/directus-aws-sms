# Directus Operation: Send SMS via AWS SNS

**Date:** 2026-05-10
**Status:** Approved design, pending implementation plan
**Package name:** `directus-extension-operation-sms-aws-sns`

## Summary

A custom Directus operation extension that sends a single SMS message via AWS SNS `Publish`. Modeled on the built-in email send operation: a flow author drops it into a flow, fills in recipient and message body, and the operation handles delivery. Recipient and body support `{{ }}` template interpolation against the flow's data chain.

## Goals

- Add "Send SMS (AWS SNS)" to the Directus flow operation picker.
- Single-recipient send. One operation invocation = one SMS.
- Configuration parity with the existing email operation: panel fields for the per-message details, environment variables for credentials.
- Return the SNS `MessageId` to the data chain so downstream operations can reference it.

## Non-goals (YAGNI)

- Bulk send / array of recipients. Loop in the flow if needed.
- Delivery status callbacks, opt-out list management, or a sends-log collection.
- AWS Pinpoint / End User Messaging features (origination identity pools, country routing, templates).
- A standalone UI panel inside crf-admin for ad-hoc SMS.
- Retry logic inside the handler. Flow authors wire retry as a separate operation if they want it.

## Architecture

Standard Directus operation extension scaffolded with `@directus/extensions-sdk`:

```
directus-extension-operation-sms-aws-sns/
├── package.json
├── src/
│   ├── app.ts        # UI definition (operation picker entry, option fields)
│   ├── api.ts        # Handler (validates, calls SNS, returns result)
│   └── api.test.ts   # Unit tests with mocked SNS client
└── README.md
```

Runtime dependency: `@aws-sdk/client-sns` (v3, modular). No other deps beyond the Directus extension SDK.

Installed by placing the built extension into the Directus instance's `extensions/` directory and restarting.

## Operation Options (Panel UI — `app.ts`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `to` | string | yes | E.164 phone number (e.g. `+15551234567`). Supports `{{ }}` template vars. |
| `message` | string (textarea) | yes | SMS body. Supports `{{ }}` template vars. |
| `smsType` | dropdown | yes | `Transactional` (default) or `Promotional`. |

The `overview` function shows `to` and a truncated `message` preview in the flow editor card.

### No-reply footer

Every outgoing message has the literal footer `\n\n(do not reply)` (16 chars, GSM-7 safe) appended by the handler after template interpolation. This is non-configurable — two-way messaging is disabled at the AWS account level, so the footer is informational for recipients. Flow authors do not need to include it in their `message` template.

## Environment Variables (read by `api.ts`)

| Variable | Required | Notes |
|---|---|---|
| `AWS_REGION` | yes | Must be a region where SNS SMS is supported (e.g. `us-east-1`, `us-west-2`, `eu-west-1`). |
| `AWS_ACCESS_KEY_ID` | conditional | Required unless using the SDK's default credential chain (IAM role, shared profile, etc.). |
| `AWS_SECRET_ACCESS_KEY` | conditional | Same as above. |
| `AWS_SNS_SENDER_ID` | no | Alphanumeric sender ID. Honored only in countries that support it; ignored in US/Canada. |

IAM permission required: `sns:Publish`.

## Handler Behavior (`api.ts`)

Signature: `handler({ to, message, smsType }, { env, logger }) => Promise<{ messageId: string; to: string }>`

Sequence:

1. Directus interpolates `{{ }}` in `to` and `message` against the data chain before invoking the handler.
2. Validate `to` matches `^\+[1-9]\d{1,14}$` (E.164). On mismatch, throw — flow takes the reject path. No AWS call, no charge.
3. Validate `message` is a non-empty string after trim. Same reject behavior on failure.
4. Append the no-reply footer: `finalMessage = message + "\n\n(do not reply)"`.
5. Construct an `SNSClient({ region: env.AWS_REGION })`. Credentials resolve via the default SDK chain.
6. Build `MessageAttributes`:
   - `AWS.SNS.SMS.SMSType` → `{ DataType: "String", StringValue: smsType }`
   - `AWS.SNS.SMS.SenderID` → `{ DataType: "String", StringValue: env.AWS_SNS_SENDER_ID }` *(only if env var is set)*
7. Call `client.send(new PublishCommand({ PhoneNumber: to, Message: finalMessage, MessageAttributes }))`.
8. On success: return `{ messageId: result.MessageId, to }`. Directus stores this under the operation's key in the data chain — accessible downstream as `{{ <operation_key>.messageId }}`.
9. On AWS error: log via `logger.error` with the SNS error name and message, then rethrow so the flow takes the reject path.

## Error Handling

| Cause | Behavior |
|---|---|
| `to` not E.164 | Throw `Error("Invalid phone number: must be E.164 (e.g. +15551234567)")`. No AWS call. |
| `message` empty/whitespace | Throw `Error("Message body is required")`. No AWS call. |
| Missing `AWS_REGION` | Throw on handler entry with a clear message. No AWS call. |
| AWS auth/throttling/invalid number/opt-out | Logged, rethrown. Flow's reject path runs. |

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

**Unit tests (`api.test.ts`)** — mock `SNSClient` via `aws-sdk-client-mock`:

- Success: valid input → handler resolves with `{ messageId, to }`; `PublishCommand` invoked with expected `PhoneNumber`, `Message`, and `MessageAttributes`.
- Validation: bad phone number → rejects, no `client.send` call.
- Validation: empty/whitespace message → rejects, no `client.send` call.
- Missing `AWS_REGION` → rejects on handler entry.
- Sender ID present in env → `MessageAttributes['AWS.SNS.SMS.SenderID']` set.
- Sender ID absent → that attribute key is omitted.
- `smsType` propagates as `Transactional` and `Promotional` correctly.
- AWS rejection (e.g. `InvalidParameter`) → handler rethrows; logger.error called once.
- Footer: `PublishCommand` is invoked with `Message` ending in `\n\n(do not reply)` regardless of input.

**Manual end-to-end test:**

1. Set env vars (`AWS_REGION`, credentials, optional `AWS_SNS_SENDER_ID`) on the Directus host.
2. Verify a destination phone number in the SNS sandbox (or request production access).
3. Confirm the SNS monthly spend limit is set to a non-zero value (default $1 is fine for testing).
4. Build the extension and copy to `extensions/`. Restart Directus.
5. Create a manual-trigger flow with a single Send SMS operation. Hardcode `to` and `message`.
6. Run the flow. Confirm SMS received and `{{ <key>.messageId }}` is present in flow execution log.
7. Repeat with an invalid phone number and confirm the reject path runs cleanly.

## Open Questions

None at design approval. AWS prerequisites (sandbox, spending cap, IAM permission) are operator setup, not design decisions.

## References

- AWS SNS `Publish`: https://docs.aws.amazon.com/sns/latest/api/API_Publish.html
- SNS SMS `MessageAttributes`: https://docs.aws.amazon.com/sns/latest/dg/sms_publish-to-phone.html
- Directus operation extensions: https://docs.directus.io/extensions/operations.html
