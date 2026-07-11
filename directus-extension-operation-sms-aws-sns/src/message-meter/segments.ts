// src/message-meter/segments.ts
// Pure SMS length/segment math + effective-message composition, factored out of
// the Vue interface so it can be unit-tested without a DOM.
import { FOOTER } from "../constants.js";
import { applyOrgSignature, applyFooter } from "../send/signature.js";

// GSM 03.38 basic set — each character encodes to one 7-bit septet.
const GSM7_BASIC = new Set<string>([
  ...'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
  "", // ESC
]);
// GSM 03.38 extension set — each of these encodes to TWO septets (ESC + char).
const GSM7_EXTENDED = new Set<string>([..."^{}\\[~]|€\f"]);

export type Encoding = "GSM-7" | "UCS-2";
export type SmsMetrics = {
  encoding: Encoding;
  length: number; // billable length in the message's encoding units
  segments: number; // number of SMS parts (0 for empty)
  singleLimit: number; // max length that still fits in ONE part
  perSegment: number; // length per part once concatenated
  /** The character that forced UCS-2, if any (first non-GSM-7 char). */
  forcedUnicodeBy: string | null;
};

/**
 * Compute encoding, billable length, and segment count for an SMS body.
 * A single non-GSM-7 character switches the whole message to UCS-2 (limit 70).
 * GSM-7 "extended" characters (^ { } [ ] ~ \ | €) each count as two.
 */
export function smsMetrics(text: string): SmsMetrics {
  let gsmLen = 0;
  let gsm = true;
  let forcedBy: string | null = null;

  for (const ch of text) {
    if (GSM7_BASIC.has(ch)) {
      gsmLen += 1;
    } else if (GSM7_EXTENDED.has(ch)) {
      gsmLen += 2;
    } else {
      gsm = false;
      forcedBy = ch;
      break;
    }
  }

  if (gsm) {
    const singleLimit = 160;
    const perSegment = 153;
    const segments = gsmLen === 0 ? 0 : gsmLen <= singleLimit ? 1 : Math.ceil(gsmLen / perSegment);
    return { encoding: "GSM-7", length: gsmLen, segments, singleLimit, perSegment, forcedUnicodeBy: null };
  }

  // UCS-2: billed per UTF-16 code unit (a non-BMP emoji counts as 2).
  const length = text.length;
  const singleLimit = 70;
  const perSegment = 67;
  const segments = length === 0 ? 0 : length <= singleLimit ? 1 : Math.ceil(length / perSegment);
  return { encoding: "UCS-2", length, segments, singleLimit, perSegment, forcedUnicodeBy: forcedBy };
}

export type ComposeOpts = {
  origination: string; // "number" (two-way) or anything else (senderId/spray)
  signature?: string;
  footer?: string;
};

/**
 * Build the exact string that will go over the wire, so the meter counts what is
 * actually sent — not just the typed body. Mirrors operation/api.ts:
 * - two-way ("number"): footer suffix then org signature prefix (worst case:
 *   the signature is assumed present even under the first-message-only toggle).
 * - senderId/spray: the automatic `(do not reply)` footer is appended.
 */
export function composeEffectiveMessage(body: string, opts: ComposeOpts): string {
  if (opts.origination === "number") {
    return applyOrgSignature(applyFooter(body, opts.footer), opts.signature);
  }
  return `${body}${FOOTER}`;
}

/** True when the body contains a `{{ ... }}` template variable (runtime-expanded). */
export function hasTemplateVars(text: string): boolean {
  return /\{\{[^}]*\}\}/.test(text);
}
