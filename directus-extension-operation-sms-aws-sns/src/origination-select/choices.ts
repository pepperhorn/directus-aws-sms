// src/origination-select/choices.ts
// Pure choice-building for the origination interface, factored out of the Vue
// component so the availability logic is unit-testable without a DOM.

export type OriginationChoice = { text: string; value: string; disabled: boolean };

/**
 * Build the origination dropdown choices. The Sender ID (spray/one-way) path is
 * always available — SNS auto-selects an origination when no Sender ID is set.
 * The two-way ("number") path is only selectable when a two-way number is
 * configured in SMS Settings; otherwise it is shown but disabled so the operator
 * can see it exists and why it's unavailable.
 */
export function originationChoices(twoWayConfigured: boolean): OriginationChoice[] {
  return [
    {
      text: "Sender ID (one-way, footer appended)",
      value: "senderId",
      disabled: false,
    },
    {
      text: twoWayConfigured
        ? "Two-way number (replyable — no do-not-reply footer; logs a ticket message)"
        : "Two-way number — not configured (set a two-way number in SMS Settings)",
      value: "number",
      disabled: !twoWayConfigured,
    },
  ];
}

/** True when the settings value is a non-empty (trimmed) string. */
export function isConfiguredNumber(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
