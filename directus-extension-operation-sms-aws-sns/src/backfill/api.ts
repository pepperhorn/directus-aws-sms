// src/backfill/api.ts
import { defineOperationApi } from "@directus/extensions-sdk";
import { planNumberBackfill, type FamilyRow, type BackfillChange } from "./plan.js";

export type Options = { mode: "dry-run" | "apply" };

export default defineOperationApi<Options>({
  id: "sms-number-backfill",
  handler: async ({ mode }, { services, getSchema, accountability, logger }) => {
    const { ItemsService } = services as any;
    const schema = await getSchema();
    const families = new ItemsService("family", { schema, accountability });

    const rows: FamilyRow[] = await families.readByQuery({
      fields: ["id", "family_admin_mobile", "family_sms_cc"],
      limit: -1,
    });

    const { changes, summary } = planNumberBackfill(rows);

    if (mode !== "apply") {
      return { mode: "dry-run", summary, changeCount: changes.length, changes };
    }

    // Apply: group normalize changes per family; rebuild family_sms_cc arrays where needed.
    const byId = new Map<string, BackfillChange[]>();
    for (const c of changes) {
      if (c.action !== "normalize") continue; // flags are reported, never auto-written
      const list = byId.get(c.id) ?? [];
      list.push(c);
      byId.set(c.id, list);
    }

    let updated = 0;
    for (const [id, famChanges] of byId) {
      const current: FamilyRow = await families.readOne(id, { fields: ["id", "family_admin_mobile", "family_sms_cc"] });
      const patch: Record<string, unknown> = {};
      const ccPatch = Array.isArray(current.family_sms_cc) ? [...current.family_sms_cc] : null;
      for (const c of famChanges) {
        if (c.field === "family_admin_mobile") patch.family_admin_mobile = c.to;
        if (c.field === "family_sms_cc" && ccPatch && c.index !== undefined && ccPatch[c.index]) {
          ccPatch[c.index] = { ...ccPatch[c.index], to_mobile: c.to };
        }
      }
      if (ccPatch && famChanges.some((c) => c.field === "family_sms_cc")) patch.family_sms_cc = ccPatch;
      if (Object.keys(patch).length > 0) { await families.updateOne(id, patch); updated++; }
    }

    logger.info(`sms-number-backfill applied: ${updated} families updated; flagged ${summary.landline} landline / ${summary.unknown} unknown.`);
    return { mode: "apply", summary, updated, flagged: changes.filter((c) => c.action === "flag") };
  },
});
