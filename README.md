# directus-aws-sms

Directus bundle extension that adds a **Send SMS (AWS SNS)** flow operation, plus a hook that auto-creates an `sms_settings` singleton collection so admins can configure AWS credentials directly in the UI (or use environment variables — env wins per-key).

- **Package README:** [`directus-extension-operation-sms-aws-sns/README.md`](directus-extension-operation-sms-aws-sns/README.md) — full feature docs and configuration.
- **Spec:** [`docs/superpowers/specs/2026-05-10-sms-aws-sns-operation-design.md`](docs/superpowers/specs/2026-05-10-sms-aws-sns-operation-design.md)
- **Plan:** [`docs/superpowers/plans/2026-05-10-sms-aws-sns-operation.md`](docs/superpowers/plans/2026-05-10-sms-aws-sns-operation.md)

## What it does

A flow author drops the **Send SMS (AWS SNS)** operation into any Directus flow, fills in recipient (E.164) and message body (both support `{{ }}` template vars), picks Transactional or Promotional, and the handler validates input, resolves AWS config (env → settings collection fallback), appends `\n\n(do not reply)`, calls SNS `Publish`, and returns `{ messageId, to }` to the data chain.

## Build

```bash
cd directus-extension-operation-sms-aws-sns
npm install
npm run build
```

Output lands in `directus-extension-operation-sms-aws-sns/dist/` (`app.js` + `api.js`).

## Install on a remote Directus host (via Tailscale)

Assuming the Directus host is reachable as `directus.tail-scale-name.ts.net` (or whatever your tailnet name is) and Directus loads extensions from `/directus/extensions/` (the default for the Docker image):

```bash
# 1. Build locally
cd directus-extension-operation-sms-aws-sns
npm install
npm run build

# 2. Bundle the package (everything Directus needs at runtime)
cd ..
tar -czf sms-aws-sns.tar.gz \
  -C directus-extension-operation-sms-aws-sns \
  package.json dist node_modules

# 3. Copy over Tailscale
scp sms-aws-sns.tar.gz directus.your-tailnet.ts.net:~/

# 4. On the remote host, extract into Directus's extensions dir
ssh directus.your-tailnet.ts.net '
  set -e
  EXT=/directus/extensions/directus-extension-operation-sms-aws-sns
  sudo mkdir -p "$EXT"
  sudo tar -xzf ~/sms-aws-sns.tar.gz -C "$EXT"
  rm ~/sms-aws-sns.tar.gz
'

# 5. Restart Directus
ssh directus.your-tailnet.ts.net 'sudo systemctl restart directus'
# or, if Dockerized:
# ssh directus.your-tailnet.ts.net 'docker restart directus'
```

Adjust paths and the restart command for your deployment (bare-metal vs Docker vs Compose). Bundling `node_modules` avoids needing to `npm install` on the remote host.

On first restart, watch the Directus log for:

```
Created singleton collection "sms_settings".
```

That confirms the bootstrap hook ran and the settings form is ready in the Content module sidebar.

## Configure

See the [package README](directus-extension-operation-sms-aws-sns/README.md#configure-two-options-can-be-combined) for the two config paths (settings UI vs env vars), AWS prerequisites (sandbox mode, spend cap, IAM permission), and the security caveat about plaintext credential storage.

## Status

- ✅ v0.1.0 — initial release
- 27 unit tests, build green
- Manual end-to-end verification pending on a real Directus + AWS install
