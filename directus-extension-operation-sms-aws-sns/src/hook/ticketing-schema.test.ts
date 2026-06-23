import { describe, it, expect } from "vitest";
import {
  ticketCollectionPayload,
  messageCollectionPayload,
  ticketingRelations,
} from "./ticketing-schema.js";
import { TICKET_COLLECTION, MESSAGE_COLLECTION } from "../constants.js";

const fieldNames = (payload: { fields: { field: string }[] }) =>
  payload.fields.map((f) => f.field);

describe("ticketing schema", () => {
  it("client_ticket has the expected fields", () => {
    expect(ticketCollectionPayload.collection).toBe(TICKET_COLLECTION);
    expect(fieldNames(ticketCollectionPayload)).toEqual(
      expect.arrayContaining([
        "id", "status", "channel", "client", "external_identity",
        "our_identity", "assignee", "last_message_at",
      ]),
    );
  });

  it("client_message has the expected fields including a unique external_message_id", () => {
    expect(messageCollectionPayload.collection).toBe(MESSAGE_COLLECTION);
    const ext = messageCollectionPayload.fields.find((f) => f.field === "external_message_id");
    expect(ext).toBeDefined();
    expect(ext!.schema?.is_unique).toBe(true);
    expect(fieldNames(messageCollectionPayload)).toEqual(
      expect.arrayContaining([
        "id", "ticket", "direction", "channel", "body",
        "from_identity", "to_identity", "external_message_id",
        "delivery_status", "raw", "timestamp",
      ]),
    );
  });

  it("defines client→family, ticket→client_ticket (with messages o2m), assignee→users relations", () => {
    const byField = Object.fromEntries(ticketingRelations.map((r) => [`${r.collection}.${r.field}`, r]));
    expect(byField["client_ticket.client"].related_collection).toBe("family");
    expect(byField["client_ticket.assignee"].related_collection).toBe("directus_users");
    expect(byField["client_message.ticket"].related_collection).toBe(TICKET_COLLECTION);
    expect(byField["client_message.ticket"].meta.one_field).toBe("messages");
  });
});
