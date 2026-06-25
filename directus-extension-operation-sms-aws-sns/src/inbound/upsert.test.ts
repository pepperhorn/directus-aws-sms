// src/inbound/upsert.test.ts
import { describe, it, expect, vi } from "vitest";
import { upsertInbound } from "./upsert.js";
import type { ItemsLike } from "./types.js";
import type { InboundSms, FamilyResolution } from "./types.js";

const sms = (id: string, overrides: Partial<InboundSms> = {}): InboundSms => ({
  originationNumber: "+61412345678",
  destinationNumber: "+61480000000",
  messageBody: "Yes please",
  inboundMessageId: id,
  previousPublishedMessageId: null,
  ...overrides,
});

const oneMatch: FamilyResolution = { matchCount: 1, familyId: "fam-1", matchedFamilyIds: ["fam-1"] };
const noMatch: FamilyResolution = { matchCount: 0, familyId: null, matchedFamilyIds: [] };

// Minimal in-memory fakes that honour the unique external_message_id + open-ticket lookups.
function makeDeps() {
  const ticketRows: any[] = [];
  const messageRows: any[] = [];
  let tId = 0;
  let mId = 0;

  const tickets: ItemsLike = {
    readByQuery: async (q) => {
      const f = q.filter ?? {};
      return ticketRows.filter((r) =>
        (!f.external_identity || r.external_identity === f.external_identity._eq) &&
        (!f.our_identity || r.our_identity === f.our_identity._eq) &&
        (!f.status || r.status === f.status._eq));
    },
    createOne: async (item) => { const id = `t${++tId}`; ticketRows.push({ id, ...item }); return id; },
    updateOne: async (id, patch) => { Object.assign(ticketRows.find((r) => r.id === id), patch); return id; },
  };
  const messages: ItemsLike = {
    readByQuery: async (q) => {
      const f = q.filter ?? {};
      return messageRows.filter((r) =>
        !f.external_message_id || r.external_message_id === f.external_message_id._eq);
    },
    createOne: async (item) => { const id = `m${++mId}`; messageRows.push({ id, ...item }); return id; },
    updateOne: async (id, patch) => { Object.assign(messageRows.find((r) => r.id === id), patch); return id; },
  };
  return { deps: { tickets, messages, now: () => "2026-06-25T00:00:00.000Z" }, ticketRows, messageRows };
}

describe("upsertInbound", () => {
  it("creates a new ticket + message on first inbound (single family match)", async () => {
    const { deps, ticketRows, messageRows } = makeDeps();
    const out = await upsertInbound(sms("in-1"), oneMatch, deps);
    expect(out.ticketCreated).toBe(true);
    expect(out.messageCreated).toBe(true);
    expect(ticketRows).toHaveLength(1);
    expect(ticketRows[0]).toMatchObject({
      status: "open", channel: "sms", client: "fam-1",
      external_identity: "+61412345678", our_identity: "+61480000000",
      last_message_at: "2026-06-25T00:00:00.000Z",
    });
    expect(messageRows[0]).toMatchObject({
      ticket: out.ticketId, direction: "inbound", channel: "sms",
      body: "Yes please", external_message_id: "in-1",
      from_identity: "+61412345678", to_identity: "+61480000000", delivery_status: null,
    });
  });

  it("links client=null when family resolution has no match", async () => {
    const { deps, ticketRows } = makeDeps();
    await upsertInbound(sms("in-1"), noMatch, deps);
    expect(ticketRows[0].client).toBeNull();
  });

  it("appends to the existing OPEN ticket rather than creating a new one", async () => {
    const { deps, ticketRows, messageRows } = makeDeps();
    const first = await upsertInbound(sms("in-1"), oneMatch, deps);
    const second = await upsertInbound(sms("in-2"), oneMatch, deps);
    expect(second.ticketCreated).toBe(false);
    expect(second.ticketId).toBe(first.ticketId);
    expect(ticketRows).toHaveLength(1);
    expect(messageRows).toHaveLength(2);
  });

  it("is idempotent: a duplicate inboundMessageId never creates a second message", async () => {
    const { deps, messageRows, ticketRows } = makeDeps();
    const a = await upsertInbound(sms("dup"), oneMatch, deps);
    const b = await upsertInbound(sms("dup"), oneMatch, deps);
    expect(b.messageCreated).toBe(false);
    expect(b.ticketId).toBe(a.ticketId);
    expect(messageRows).toHaveLength(1);
    expect(ticketRows).toHaveLength(1);
  });

  it("opens a NEW ticket when the only matching ticket is closed", async () => {
    const { deps, ticketRows } = makeDeps();
    await upsertInbound(sms("in-1"), oneMatch, deps);
    ticketRows[0].status = "closed"; // staff closed it
    const out = await upsertInbound(sms("in-2"), oneMatch, deps);
    expect(out.ticketCreated).toBe(true);
    expect(ticketRows).toHaveLength(2);
  });

  it("bumps last_message_at on the existing ticket when appending", async () => {
    const { deps, ticketRows } = makeDeps();
    await upsertInbound(sms("in-1"), oneMatch, deps);
    ticketRows[0].last_message_at = "2000-01-01T00:00:00.000Z";
    await upsertInbound(sms("in-2"), oneMatch, deps);
    expect(ticketRows[0].last_message_at).toBe("2026-06-25T00:00:00.000Z");
  });
});
