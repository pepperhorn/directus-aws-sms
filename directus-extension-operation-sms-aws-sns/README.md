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

In crf-admin: open the **SMS Settings** singleton from the Content module sidebar (singletons render as a single editable form, no list view). Fill in:

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
