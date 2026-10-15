<template>
  <div class="sms-message-meter">
    <v-textarea
      :model-value="value ?? ''"
      :placeholder="placeholder"
      :expand-on-focus="false"
      @update:model-value="$emit('input', $event)"
    />

    <div class="meter" :class="{ 'meter--warn': metrics.segments > 1 }">
      {{ metrics.length }} chars · {{ metrics.encoding }} ·
      {{ metrics.segments }} {{ metrics.segments === 1 ? "SMS" : "SMS segments" }}
      <span class="meter__limit">(1 SMS = {{ metrics.singleLimit }})</span>
    </div>

    <v-notice v-if="metrics.segments > 1" type="warning" class="meter__notice">
      This message will send as {{ metrics.segments }} SMS segments
      ({{ metrics.length }} {{ metrics.encoding }} chars; a single SMS holds
      {{ metrics.singleLimit }}). It includes {{ pathNote }}.
      <template v-if="unicodeNote"> {{ unicodeNote }}</template>
    </v-notice>
    <v-notice
      v-else-if="metrics.encoding === 'UCS-2' && metrics.length > 0"
      type="info"
      class="meter__notice"
    >
      {{ unicodeNote }} A single Unicode SMS holds only 70 characters.
    </v-notice>

    <v-notice v-if="hasVars" type="info" class="meter__notice">
      {{ varsHint }}
    </v-notice>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, inject } from "vue";
import { useApi } from "@directus/extensions-sdk";
import { smsMetrics, composeEffectiveMessage, hasTemplateVars } from "./segments.js";

const props = defineProps<{ value: string | null; placeholder?: string }>();
defineEmits<{ (e: "input", value: string): void }>();

const api = useApi();
// Sibling field values from the surrounding form (to read `origination`).
const values = inject<{ value: Record<string, unknown> }>("values", ref({}));
const signature = ref<string | undefined>(undefined);
const footer = ref<string | undefined>(undefined);

const origination = computed(() =>
  values.value?.origination === "number" ? "number" : "senderId",
);

const composed = computed(() =>
  composeEffectiveMessage(props.value ?? "", {
    origination: origination.value,
    signature: signature.value,
    footer: footer.value,
  }),
);
const metrics = computed(() => smsMetrics(composed.value));
const hasVars = computed(() => hasTemplateVars(props.value ?? ""));

const unicodeNote = computed(() =>
  metrics.value.encoding === "UCS-2"
    ? `A special character${
        metrics.value.forcedUnicodeBy ? ` (${metrics.value.forcedUnicodeBy})` : ""
      } switched this to Unicode mode.`
    : "",
);
const pathNote = computed(() =>
  origination.value === "number"
    ? "the org signature/footer from SMS Settings (counted as present, worst case)"
    : "the automatic “(do not reply)” footer",
);
const varsHint =
  "Contains {{ }} template variables — the real length will vary at send time; this counts the literal template text.";

onMounted(async () => {
  try {
    const res = await api.get("/items/sms_settings", {
      params: { fields: ["aws_org_signature", "aws_org_footer"] },
    });
    signature.value = res?.data?.data?.aws_org_signature ?? undefined;
    footer.value = res?.data?.data?.aws_org_footer ?? undefined;
  } catch {
    // Fail open: without settings we still measure the body (+ path footer).
  }
});
</script>

<style scoped>
.meter {
  margin-top: 4px;
  font-size: 12px;
  color: var(--theme--foreground-subdued, #a2b5cd);
}
.meter--warn {
  color: var(--theme--warning, #e35169);
  font-weight: 600;
}
.meter__limit {
  opacity: 0.75;
}
.meter__notice {
  margin-top: 8px;
}
</style>
