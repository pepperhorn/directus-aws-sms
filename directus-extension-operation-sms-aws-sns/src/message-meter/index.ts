import { defineInterface } from "@directus/extensions-sdk";
import InterfaceComponent from "./interface.vue";

export default defineInterface({
  id: "sms-message-meter",
  name: "SMS Message (with length meter)",
  icon: "sms",
  description:
    "Multiline SMS body with a live character/segment counter that accounts for the signature, footer, and encoding, and warns past a single SMS.",
  component: InterfaceComponent,
  types: ["text", "string"],
  group: "standard",
  options: [
    {
      field: "placeholder",
      name: "Placeholder",
      type: "string",
      meta: { width: "full", interface: "input" },
    },
  ],
});
