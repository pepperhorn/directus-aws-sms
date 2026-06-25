// src/inbound/upsert.test.ts
import { describe, it, expect } from "vitest";
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
const manyMatch: FamilyResolution = { matchCount: 2, familyId: null, matchedFamilyIds: ["a", "b"] };

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

  it("handles create-conflict race: pre-check misses but createOne throws unique violation, returns existing row without throwing", async () => {
    // Simulate: idempotency pre-check sees nothing (miss), but by the time createOne runs
    // another concurrent request has already inserted the row. createOne throws, then the
    // follow-up read finds the now-existing row.
    const ticketRows: any[] = [];
    let tId = 0;

    const tickets: ItemsLike = {
      readByQuery: async () => [],
      createOne: async (item) => {
        const id = `t${++tId}`;
        ticketRows.push({ id, ...item });
        return id;
      },
      updateOne: async (id, patch) => {
        Object.assign(ticketRows.find((r) => r.id === id), patch);
        return id;
      },
    };

    // messages.readByQuery: first call (idempotency pre-check) returns [] (miss),
    // all subsequent calls (after createOne throws) return the existing row.
    let readCallCount = 0;
    const existingRow = { id: "m-existing", ticket: "t-existing", external_message_id: "race-msg-1" };
    const messages: ItemsLike = {
      readByQuery: async () => {
        readCallCount++;
        if (readCallCount === 1) return []; // pre-check: miss
        return [existingRow];              // post-conflict re-read: hit
      },
      createOne: async () => {
        throw new Error("duplicate key value violates unique constraint");
      },
      updateOne: async (id) => id,
    };

    const deps = { tickets, messages, now: () => "2026-06-25T00:00:00.000Z" };
    const result = await upsertInbound(sms("race-msg-1"), oneMatch, deps);

    expect(result.messageCreated).toBe(false);
    expect(result.ticketId).toBe("t-existing");
    // Should not throw — the race-condition duplicate is handled gracefully.
  });

  it("links client=null when family resolution has many matches (triage)", async () => {
    const { deps, ticketRows } = makeDeps();
    await upsertInbound(sms("in-1"), manyMatch, deps);
    expect(ticketRows[0].client).toBeNull();
  });

  it("ticket create-conflict race: ticket createOne throws unique violation, re-reads winner's ticket, resolves without throw", async () => {
    // Simulate two concurrent inbound events for the same brand-new conversation:
    // - initial open-ticket readByQuery: miss (no open ticket yet)
    // - ticket createOne: throws unique constraint (another request won the race)
    // - follow-up open-ticket readByQuery: returns the winner's ticket
    // Expected: resolves with ticketId = "t-raced", ticketCreated = false, no second createOne
    let ticketReadCallCount = 0;
    let ticketCreateCallCount = 0;

    const tickets: ItemsLike = {
      readByQuery: async (_q) => {
        ticketReadCallCount++;
        if (ticketReadCallCount === 1) return []; // initial open-ticket lookup: miss
        return [{ id: "t-raced" }];               // post-conflict re-read: winner's ticket
      },
      createOne: async (_item) => {
        ticketCreateCallCount++;
        throw new Error(
          `duplicate key value violates unique constraint "client_ticket_open_conversation_uq"`,
        );
      },
      updateOne: async (id) => id,
    };

    const messages: ItemsLike = {
      readByQuery: async () => [],
      createOne: async (_item) => "m-new",
      updateOne: async (id) => id,
    };

    const deps = { tickets, messages, now: () => "2026-06-25T00:00:00.000Z" };
    const result = await upsertInbound(sms("in-race-ticket"), oneMatch, deps);

    expect(result.ticketId).toBe("t-raced");
    expect(result.ticketCreated).toBe(false);
    expect(result.messageCreated).toBe(true);
    expect(ticketCreateCallCount).toBe(1); // only one attempt, no retry loop
  });
});
