// src/inbound/sns-verify.test.ts
import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { snsCertUrlIsValid, buildStringToSign, verifySnsSignature } from "./sns-verify.js";

// One throwaway RSA keypair for the whole suite — keeps tests fully offline.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const certPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const CERT_URL = "https://sns.ap-southeast-2.amazonaws.com/SimpleNotificationService-abc123.pem";

const signWith = (stringToSign: string, algorithm = "RSA-SHA1"): string => {
  const signer = createSign(algorithm);
  signer.update(stringToSign, "utf8");
  return signer.sign(privateKey, "base64");
};

const baseNotification = () => ({
  Type: "Notification",
  MessageId: "msg-1",
  TopicArn: "arn:aws:sns:ap-southeast-2:111:two-way",
  Message: "hello",
  Timestamp: "2026-06-25T00:00:00.000Z",
  SignatureVersion: "1",
  SigningCertURL: CERT_URL,
});

const fetchCert = async () => certPem;

describe("snsCertUrlIsValid", () => {
  it("accepts a regional sns amazonaws.com cert host", () => {
    expect(snsCertUrlIsValid(CERT_URL)).toBe(true);
  });
  it("rejects a non-amazonaws host", () => {
    expect(snsCertUrlIsValid("https://evil.example.com/x.pem")).toBe(false);
  });
  it("rejects an amazonaws look-alike host (suffix spoof)", () => {
    expect(snsCertUrlIsValid("https://sns.ap-southeast-2.amazonaws.com.evil.com/x.pem")).toBe(false);
  });
  it("rejects a non-https url", () => {
    expect(snsCertUrlIsValid("http://sns.ap-southeast-2.amazonaws.com/x.pem")).toBe(false);
  });
});

describe("buildStringToSign", () => {
  it("orders Notification keys canonically (Message, MessageId, Subject?, Timestamp, TopicArn, Type)", () => {
    const s = buildStringToSign({ ...baseNotification(), Subject: "subj" });
    expect(s).toBe(
      ["Message", "hello", "MessageId", "msg-1", "Subject", "subj",
       "Timestamp", "2026-06-25T00:00:00.000Z", "TopicArn",
       "arn:aws:sns:ap-southeast-2:111:two-way", "Type", "Notification"].join("\n") + "\n"
    );
  });
  it("omits Subject when absent", () => {
    const s = buildStringToSign(baseNotification());
    expect(s.includes("Subject")).toBe(false);
  });
  it("uses SubscribeURL/Token keys for SubscriptionConfirmation", () => {
    const s = buildStringToSign({
      Type: "SubscriptionConfirmation", MessageId: "m", Message: "m-body",
      SubscribeURL: "https://sns/confirm", Timestamp: "t",
      Token: "tok", TopicArn: "arn",
    });
    expect(s).toBe(
      ["Message", "m-body", "MessageId", "m", "SubscribeURL", "https://sns/confirm",
       "Timestamp", "t", "Token", "tok", "TopicArn", "arn", "Type",
       "SubscriptionConfirmation"].join("\n") + "\n"
    );
  });
});

describe("verifySnsSignature", () => {
  it("accepts a correctly signed Notification", async () => {
    const msg = baseNotification();
    const signed = { ...msg, Signature: signWith(buildStringToSign(msg)) };
    expect(await verifySnsSignature(signed, { fetchCert })).toBe(true);
  });
  it("rejects a forged/altered message (signature no longer matches)", async () => {
    const msg = baseNotification();
    const signed = { ...msg, Signature: signWith(buildStringToSign(msg)), Message: "tampered" };
    expect(await verifySnsSignature(signed, { fetchCert })).toBe(false);
  });
  it("rejects a missing Signature", async () => {
    expect(await verifySnsSignature(baseNotification(), { fetchCert })).toBe(false);
  });
  it("rejects a bad SigningCertURL host without fetching the cert", async () => {
    const msg = { ...baseNotification(), SigningCertURL: "https://evil.example.com/x.pem" };
    const signed = { ...msg, Signature: signWith(buildStringToSign(msg)) };
    let fetched = false;
    const spyFetch = async () => { fetched = true; return certPem; };
    expect(await verifySnsSignature(signed, { fetchCert: spyFetch })).toBe(false);
    expect(fetched).toBe(false);
  });
  it("accepts a correctly signed v2 (SHA256) Notification", async () => {
    const msg = { ...baseNotification(), SignatureVersion: "2" };
    const signed = { ...msg, Signature: signWith(buildStringToSign(msg), "RSA-SHA256") };
    expect(await verifySnsSignature(signed, { fetchCert })).toBe(true);
  });
  it("rejects a v2 message signed with the wrong (SHA1) digest", async () => {
    const msg = { ...baseNotification(), SignatureVersion: "2" };
    const signed = { ...msg, Signature: signWith(buildStringToSign(msg), "RSA-SHA1") };
    expect(await verifySnsSignature(signed, { fetchCert })).toBe(false);
  });
  it("rejects an unsupported SignatureVersion", async () => {
    const msg = { ...baseNotification(), SignatureVersion: "3" };
    const signed = { ...msg, Signature: signWith(buildStringToSign(msg)) };
    expect(await verifySnsSignature(signed, { fetchCert })).toBe(false);
  });
});
