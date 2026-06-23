import { TICKET_COLLECTION, MESSAGE_COLLECTION } from "../constants.js";

export const ticketCollectionPayload = {
  collection: TICKET_COLLECTION,
  meta: {
    icon: "support_agent",
    note: "Channel-agnostic client tickets. SMS is the first adapter.",
    sort_field: "sort",
    archive_field: "status",
    archive_value: "closed",
    unarchive_value: "open",
  },
  schema: { name: TICKET_COLLECTION },
  fields: [
    { field: "id", type: "uuid", meta: { hidden: true, readonly: true, interface: "input", special: ["uuid"] }, schema: { is_primary_key: true } },
    { field: "status", type: "string", schema: { default_value: "open" },
      meta: { interface: "select-dropdown", width: "half", display: "labels",
        options: { choices: [
          { text: "Open", value: "open", color: "var(--theme--primary)" },
          { text: "Pending", value: "pending", color: "var(--theme--warning)" },
          { text: "Closed", value: "closed", color: "var(--theme--foreground-subdued)" },
        ] } } },
    { field: "channel", type: "string", schema: { default_value: "sms" },
      meta: { interface: "select-dropdown", width: "half",
        options: { choices: [{ text: "SMS", value: "sms" }, { text: "Email", value: "email" }, { text: "Social", value: "social" }] } } },
    { field: "external_identity", type: "string",
      meta: { interface: "input", width: "half", note: "Counterpart address (E.164 phone for SMS)." },
      schema: { is_indexed: true } },
    { field: "our_identity", type: "string",
      meta: { interface: "input", width: "half", note: "Our address the conversation is on (the two-way number the parent texted)." } },
    { field: "client", type: "uuid",
      meta: { interface: "select-dropdown-m2o", width: "half", special: ["m2o"], note: "Linked family (null = unmatched/triage)." } },
    { field: "assignee", type: "uuid",
      meta: { interface: "select-dropdown-m2o", width: "half", special: ["m2o"] } },
    { field: "last_message_at", type: "timestamp",
      meta: { interface: "datetime", width: "half", display: "datetime", display_options: { relative: true } } },
    { field: "sort", type: "integer", meta: { hidden: true, interface: "input" } },
    { field: "date_created", type: "timestamp", meta: { special: ["date-created"], interface: "datetime", readonly: true, hidden: true } },
    { field: "date_updated", type: "timestamp", meta: { special: ["date-updated"], interface: "datetime", readonly: true, hidden: true } },
  ],
};

export const messageCollectionPayload = {
  collection: MESSAGE_COLLECTION,
  meta: {
    icon: "chat",
    note: "Individual inbound/outbound messages within a client ticket.",
    sort_field: "sort",
  },
  schema: { name: MESSAGE_COLLECTION },
  fields: [
    { field: "id", type: "uuid", meta: { hidden: true, readonly: true, interface: "input", special: ["uuid"] }, schema: { is_primary_key: true } },
    { field: "ticket", type: "uuid", meta: { interface: "select-dropdown-m2o", width: "half", special: ["m2o"] } },
    { field: "direction", type: "string",
      meta: { interface: "select-dropdown", width: "half",
        options: { choices: [{ text: "Inbound", value: "inbound" }, { text: "Outbound", value: "outbound" }] } } },
    { field: "channel", type: "string", schema: { default_value: "sms" }, meta: { interface: "input", width: "half" } },
    { field: "body", type: "text", meta: { interface: "input-multiline", width: "full" } },
    { field: "from_identity", type: "string", meta: { interface: "input", width: "half" } },
    { field: "to_identity", type: "string", meta: { interface: "input", width: "half" } },
    { field: "external_message_id", type: "string",
      meta: { interface: "input", width: "half", note: "Provider message id; idempotency key." },
      schema: { is_unique: true } },
    { field: "delivery_status", type: "string", meta: { interface: "input", width: "half", note: "sent | delivered | failed (null for inbound)." } },
    { field: "raw", type: "json", meta: { interface: "input-code", width: "full", options: { language: "json" }, special: ["cast-json"] } },
    { field: "timestamp", type: "timestamp", meta: { interface: "datetime", width: "half", display: "datetime" } },
    { field: "sort", type: "integer", meta: { hidden: true, interface: "input" } },
  ],
};

export const ticketingRelations = [
  {
    collection: TICKET_COLLECTION, field: "client", related_collection: "family",
    meta: { sort_field: null }, schema: { on_delete: "SET NULL" },
  },
  {
    collection: TICKET_COLLECTION, field: "assignee", related_collection: "directus_users",
    meta: { sort_field: null }, schema: { on_delete: "SET NULL" },
  },
  {
    collection: MESSAGE_COLLECTION, field: "ticket", related_collection: TICKET_COLLECTION,
    meta: { one_field: "messages", sort_field: "sort", one_deselect_action: "delete" },
    schema: { on_delete: "CASCADE" },
  },
];
