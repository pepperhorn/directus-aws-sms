// src/inbound/sns-verify.ts
import { createVerify } from "node:crypto";

export type SnsMessage = Record<string, unknown>;
export type VerifyDeps = { fetchCert: (url: string) => Promise<string> };

// Keys included in the string-to-sign, in canonical (alphabetical) order, per message type.
const SIGN_KEYS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
  UnsubscribeConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
};

/**
 * The SigningCertURL must be https and its host must be an AWS SNS cert host:
 * `sns.<region>.amazonaws.com`. We require the host to END WITH `.amazonaws.com`
 * AND START WITH `sns.` to defeat suffix-spoof hosts like `...amazonaws.com.evil.com`.
 */
export function snsCertUrlIsValid(url: string, _region?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return host.startsWith("sns.") && host.endsWith(".amazonaws.com");
}

/** Build the newline-joined `key\nvalue\n…` string AWS signs for this message type. */
export function buildStringToSign(msg: SnsMessage): string {
  const type = String(msg.Type ?? "");
  const keys = SIGN_KEYS[type];
  if (!keys) return "";
  let out = "";
  for (const key of keys) {
    const val = msg[key];
    if (val === undefined || val === null) continue; // e.g. optional Subject
    out += `${key}\n${String(val)}\n`;
  }
  return out;
}

// SNS signs v1 messages with SHA1 and v2 messages with SHA256. AWS defaults new
// topics to SignatureVersion 2 and is deprecating SHA1, so we accept both.
const DIGEST_BY_VERSION: Record<string, string> = { "1": "RSA-SHA1", "2": "RSA-SHA256" };

export async function verifySnsSignature(msg: SnsMessage, deps: VerifyDeps): Promise<boolean> {
  const algorithm = DIGEST_BY_VERSION[String(msg.SignatureVersion ?? "")];
  if (!algorithm) return false;

  const signature = msg.Signature;
  if (typeof signature !== "string" || signature.length === 0) return false;

  const certUrl = msg.SigningCertURL;
  if (typeof certUrl !== "string" || !snsCertUrlIsValid(certUrl)) return false;

  const stringToSign = buildStringToSign(msg);
  if (stringToSign === "") return false;

  let certPem: string;
  try {
    certPem = await deps.fetchCert(certUrl);
  } catch {
    return false;
  }

  try {
    const verifier = createVerify(algorithm);
    verifier.update(stringToSign, "utf8");
    return verifier.verify(certPem, signature, "base64");
  } catch {
    return false;
  }
}
