import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "sms-ticket-reply",
  name: "Reply to SMS Ticket",
  icon: "reply",
  description: "Send a reply on a client ticket from the ticket's own two-way number and append it to the thread.",
  overview: ({ ticketId, body }) => [
    { label: "Ticket", text: (ticketId as string) ?? "—" },
    { label: "Message", text: (body as string) ?? "—" },
  ],
  options: [
    {
      field: "ticketId",
      name: "Ticket",
      type: "string",
      meta: { width: "half", interface: "input", note: "client_ticket id (bound to the trigger ticket in the flow)." },
    },
    {
      field: "body",
      name: "Message",
      type: "text",
      meta: { width: "full", interface: "input-multiline", note: "Reply text. Sends from the ticket's our_identity number." },
    },
  ],
});
