// src/inbound/types.ts
export type SnsEnvelope = {
  Type: string;
  Message: string;
  SubscribeURL?: string;
  [k: string]: unknown;
};

export type InboundSms = {
  originationNumber: string;
  destinationNumber: string;
  messageBody: string;
  inboundMessageId: string;
  previousPublishedMessageId: string | null;
};

/** A family row as read for inbound matching. */
export type FamilyMatchRow = {
  id: string;
  family_admin_mobile?: unknown;
  family_sms_cc?: { to_name?: string; to_mobile?: unknown }[] | null;
};

/** A single family-resolution outcome. */
export type FamilyResolution = {
  matchCount: number;
  familyId: string | null; // set only when exactly one match
  matchedFamilyIds: string[]; // all matches (for staff disambiguation when many)
};
