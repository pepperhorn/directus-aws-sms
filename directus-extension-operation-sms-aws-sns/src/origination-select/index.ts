import { defineInterface } from "@directus/extensions-sdk";
import InterfaceComponent from "./interface.vue";

export default defineInterface({
  id: "sms-origination-select",
  name: "SMS Origination Select",
  icon: "sms",
  description:
    "Origination picker that disables the two-way option when no two-way number is configured in SMS Settings.",
  component: InterfaceComponent,
  types: ["string"],
  group: "selection",
  options: null,
});
