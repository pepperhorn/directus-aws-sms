// src/send/outbound.test.ts
import { describe, it, expect, vi } from "vitest";
import { appendOutboundMessage, type ItemsServiceLike } from "./outbound.js";

const makeItems = (existingTickets: any[] = []) => {
  const tickets: any[] = [...existingTickets];
  const messages: any[] = [];
  let ticketSeq = existingTickets.length;
  let messageSeq = 0;

  const ticketService: ItemsServiceLike = {
    readByQuery: vi.fn(async (q: any) => {
      const filter = q.filter ?? {};
      const ext = filter.external_identity?._eq;
      const our = filter.our_identity?._eq;
      const status = filter.status?._eq;
      return tickets.filter(
        (t) =>
          (ext === undefined || t.external_identity === ext) &&
          (our === undefined || t.our_identity === our) &&
          (status === undefined || t.status === status),
      );
    }),
    createOne: vi.fn(async (item: any) => {
      const id = `t${++ticketSeq}`;
      tickets.push({ id, ...item });
      return id;
    }),
    updateOne: vi.fn(async (id: any, patch: any) => {
      const t = tickets.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
      return id;
    }),
  };

  const messageService: ItemsServiceLike = {
    readByQuery: vi.fn(async () => messages),
    createOne: vi.fn(async (item: any) => {
      const id = `m${++messageSeq}`;
      messages.push({ id, ...item });
      return id;
    }),
    updateOne: vi.fn(async (id: any) => id),
  };

  const items = (collection: string): ItemsServiceLike =>
    collection === "client_ticket" ? ticketService : messageService;

  return { items, ticketService, messageService, tickets, messages };
};

const input = {
  externalIdentity: "+61400000001",
  ourIdentity: "+61480000001",
  body: "See you at 3pm",
  externalMessageId: "eum-1",
  client: "fam-1",
};

describe("appendOutboundMessage", () => {
  it("creates a ticket when no open ticket exists, then inserts the outbound message", async () => {
    const h = makeItems([]);
    const res = await appendOutboundMessage(input, { items: h.items, now: () => "2026-06-25T00:00:00.000Z" });

    expect(res.createdTicket).toBe(true);
    expect(h.ticketService.createOne).toHaveBeenCalledTimes(1);
    const ticketArg = (h.ticketService.createOne as any).mock.calls[0][0];
    expect(ticketArg).toMatchObject({
      status: "open",
      channel: "sms",
      external_identity: "+61400000001",
      our_identity: "+61480000001",
      client: "fam-1",
      last_message_at: "2026-06-25T00:00:00.000Z",
    });

    const msgArg = (h.messageService.createOne as any).mock.calls[0][0];
    expect(msgArg).toMatchObject({
      ticket: res.ticketId,
      direction: "outbound",
      channel: "sms",
      body: "See you at 3pm",
      from_identity: "+61480000001",
      to_identity: "+61400000001",
      external_message_id: "eum-1",
      delivery_status: "sent",
      timestamp: "2026-06-25T00:00:00.000Z",
    });
  });

  it("appends to the existing OPEN ticket for the same (external, our) pair and bumps last_message_at", async () => {
    const h = makeItems([
      { id: "t-open", status: "open", external_identity: "+61400000001", our_identity: "+61480000001", client: "fam-1" },
    ]);
    const res = await appendOutboundMessage(input, { items: h.items, now: () => "2026-06-25T01:00:00.000Z" });

    expect(res.createdTicket).toBe(false);
    expect(res.ticketId).toBe("t-open");
    expect(h.ticketService.createOne).not.toHaveBeenCalled();
    expect(h.ticketService.updateOne).toHaveBeenCalledWith("t-open", { last_message_at: "2026-06-25T01:00:00.000Z" });
    expect((h.messageService.createOne as any).mock.calls[0][0].ticket).toBe("t-open");
  });

  it("ignores a CLOSED ticket and creates a new open one (closed → new thread)", async () => {
    const h = makeItems([
      { id: "t-closed", status: "closed", external_identity: "+61400000001", our_identity: "+61480000001" },
    ]);
    const res = await appendOutboundMessage(input, { items: h.items });
    expect(res.createdTicket).toBe(true);
    expect(h.ticketService.createOne).toHaveBeenCalledTimes(1);
  });

  it("does not match a ticket on a different our_identity (N-number isolation)", async () => {
    const h = makeItems([
      { id: "t-other", status: "open", external_identity: "+61400000001", our_identity: "+61480000999" },
    ]);
    const res = await appendOutboundMessage(input, { items: h.items });
    expect(res.createdTicket).toBe(true);
  });

  it("ticket create-conflict race: ticket createOne throws unique violation, re-reads winner's ticket, resolves without throw", async () => {
    // Simulate two concurrent outbound sends for the same brand-new conversation:
    // - initial open-ticket readByQuery: miss (no open ticket yet)
    // - ticket createOne: throws unique constraint (another request won the race)
    // - follow-up open-ticket readByQuery: returns the winner's ticket
    // Expected: resolves with ticketId = "t-raced", createdTicket = false, no second createOne
    let ticketReadCallCount = 0;
    let ticketCreateCallCount = 0;

    const ticketService: ItemsServiceLike = {
      readByQuery: vi.fn(async (_q: any) => {
        ticketReadCallCount++;
        if (ticketReadCallCount === 1) return []; // initial open-ticket lookup: miss
        return [{ id: "t-raced" }];               // post-conflict re-read: winner's ticket
      }),
      createOne: vi.fn(async (_item: any) => {
        ticketCreateCallCount++;
        throw new Error(
          `duplicate key value violates unique constraint "client_ticket_open_conversation_uq"`,
        );
      }),
      updateOne: vi.fn(async (id: any) => id),
    };

    const messages: any[] = [];
    let messageSeq = 0;
    const messageService: ItemsServiceLike = {
      readByQuery: vi.fn(async () => messages),
      createOne: vi.fn(async (item: any) => {
        const id = `m${++messageSeq}`;
        messages.push({ id, ...item });
        return id;
      }),
      updateOne: vi.fn(async (id: any) => id),
    };

    const items = (collection: string): ItemsServiceLike =>
      collection === "client_ticket" ? ticketService : messageService;

    const res = await appendOutboundMessage(input, { items, now: () => "2026-06-25T00:00:00.000Z" });

    expect(res.ticketId).toBe("t-raced");
    expect(res.createdTicket).toBe(false);
    expect(ticketCreateCallCount).toBe(1); // only one attempt, no retry loop
    expect(messageService.createOne).toHaveBeenCalledTimes(1);
    expect((messageService.createOne as any).mock.calls[0][0].ticket).toBe("t-raced");
  });
});
