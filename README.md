# directus-aws-sms

Directus flow operation extension that sends a single SMS via AWS SNS. Modeled on the built-in email send operation.

## Status

Spec and implementation plan complete. Implementation in progress.

- **Spec:** [`docs/superpowers/specs/2026-05-10-sms-aws-sns-operation-design.md`](docs/superpowers/specs/2026-05-10-sms-aws-sns-operation-design.md)
- **Plan:** [`docs/superpowers/plans/2026-05-10-sms-aws-sns-operation.md`](docs/superpowers/plans/2026-05-10-sms-aws-sns-operation.md)

The extension package will be built into `directus-extension-operation-sms-aws-sns/`.

## What it does

Adds a **Send SMS (AWS SNS)** operation to Directus flows. Configure recipient phone (E.164) and message body in the flow editor; the handler validates input, appends a `\n\n(do not reply)` footer, calls SNS `Publish`, and returns `{ messageId, to }` to the data chain.

See the spec for full design details.
