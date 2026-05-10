# Marketplace Publishing TODO

Steps to make `directus-aws-sms` publishable to npm and listable in the Directus Marketplace. None of these are required for self-hosted (Tailscale / manual) installs — they're additive prep for public distribution.

## Background

Directus Marketplace lists extensions published to npm with the `directus-extension` keyword. Admins click "Install" in the Directus UI → Directus runs `npm install <pkg>` against the configured registry → the extension loads from `node_modules/<pkg>`.

Our extension uses `CollectionsService` (hook) and raw network credentials (handler), so it requires **registered** mode (not sandboxed). Marketplace allows registered extensions, but consumers may need to opt in (`MARKETPLACE_TRUST` env var or similar — verify against current Directus docs at publish time) or wait for Directus team verification before it surfaces to anonymous users.

## Bundling decision

Choose one before publishing. Default recommendation: **A**.

- **A. Pre-bundled (current build).** `dist/api.js` already contains AWS SDK inlined. Move `@aws-sdk/client-sns` from `dependencies` → `devDependencies` so consumers' `npm install` doesn't redundantly fetch it. Smaller install footprint, simpler updates.
- **B. Unbundled.** Strip the AWS SDK out of the rollup output and let consumers' `npm install` pull it. Keep it in `dependencies`. Smaller `dist/`, larger install footprint, but cleaner upgrade story when AWS SDK has security patches.

## Checklist

### `package.json` additions

- [ ] `keywords`: `["directus-extension", "directus-custom-extension", "directus-extension-bundle", "directus-extension-operation", "sms", "aws", "sns"]`
- [ ] `files`: `["dist", "README.md", "LICENSE"]` so `npm publish` only ships those
- [ ] `repository`: `{ "type": "git", "url": "https://github.com/pepperhorn/directus-aws-sms" }`
- [ ] `homepage`: `https://github.com/pepperhorn/directus-aws-sms`
- [ ] `bugs`: `{ "url": "https://github.com/pepperhorn/directus-aws-sms/issues" }`
- [ ] `license`: e.g. `"MIT"`
- [ ] `author`: name + email/url
- [ ] Move `@aws-sdk/client-sns` to `devDependencies` (Option A) **OR** keep in `dependencies` and unbundle (Option B)

### Files to add at package root (`directus-extension-operation-sms-aws-sns/`)

- [ ] `LICENSE` file matching the chosen license
- [ ] `CHANGELOG.md` — start with the v0.1.0 entry (initial release)

### Package name decision

- [ ] Confirm npm package name. Current: `directus-extension-operation-sms-aws-sns`. Directus marketplace prefers `directus-extension-` prefix, so this is correct. Alternative shorter name: `directus-extension-aws-sms` (matches the repo name).

### Repo-level

- [ ] Verify `dist/` is **not** gitignored at the package root if you want git users to install via `git+https://...` syntax. (Current state: it IS gitignored. That's fine for npm-only distribution. If git-installs matter, add `dist/` to the publishable artifacts another way — e.g. release tarballs.)
- [ ] Consider adding GitHub Actions CI: run `npm install && npm test && npm run build` on push.
- [ ] Add a `prepublishOnly` script to `package.json`: `"prepublishOnly": "npm run build && npm test"` so a broken build can't accidentally get published.

### Pre-publish verification

- [ ] Run `npm pack` locally and inspect the resulting tarball — confirm only `dist/`, `package.json`, `README.md`, `LICENSE` are inside.
- [ ] Run `npx publint` against the package (catches common npm metadata mistakes).
- [ ] Install the packed tarball into a real Directus instance (`npm install /path/to/pack.tgz`) and confirm the operation appears + the bootstrap hook runs.

### Publish

- [ ] `npm login` (or use an automation token in CI)
- [ ] `npm publish --access public`
- [ ] Tag the matching git release on GitHub (already done for v0.1.0 via the repo; subsequent versions will need their own tags + npm publishes).
- [ ] Wait for Directus marketplace indexer to pick it up (cadence varies; usually under 24h).

## Notes

- Marketplace auto-update: when a new version is published to npm, marketplace consumers see an update available in their Directus admin. Bumping the version in `package.json` and `npm publish` is the entire release flow once set up.
- Verification: registered (non-sandboxed) extensions may require Directus team review before showing to anonymous marketplace users. Self-hosted users can install regardless via npm or git URL.
- Trademarks: avoid mentioning AWS as if endorsed; current naming and copy is fine ("Send SMS via AWS SNS" is descriptive use).
