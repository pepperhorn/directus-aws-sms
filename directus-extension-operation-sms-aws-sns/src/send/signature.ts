// src/send/signature.ts

/**
 * Prepend an organisation signature to an outbound message body, e.g.
 * `"CRF Schools: See you at 3pm"`.
 *
 * Used only on the two-way ("number") *outreach* path (the Send SMS operation).
 * Two-way long codes display as a bare phone number — they cannot carry an
 * alphanumeric Sender ID like the spray path — so the org identity has to live
 * in the message text. Replies within an existing conversation are left
 * unsigned (the recipient already knows who they're talking to).
 *
 * No-op when `signature` is absent/blank, and idempotent so a body that was
 * already signed (e.g. a re-run flow) is not double-prefixed.
 */
export function applyOrgSignature(message: string, signature?: string): string {
  const sig = typeof signature === "string" ? signature.trim() : "";
  if (sig === "") return message;
  if (message.startsWith(`${sig}: `)) return message;
  return `${sig}: ${message}`;
}

/**
 * Append an org footer to a message body, e.g. `"See you at 3pm -- CRF Schools"`.
 *
 * No-op when `footer` is absent/blank, and idempotent so an already-footed body
 * is not doubled.
 */
export function applyFooter(message: string, footer?: string): string {
  const f = typeof footer === "string" ? footer.trim() : "";
  if (f === "") return message;
  const suffix = ` -- ${f}`;
  if (message.endsWith(suffix)) return message;
  return `${message}${suffix}`;
}
