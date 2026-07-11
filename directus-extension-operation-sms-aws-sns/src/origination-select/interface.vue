<template>
  <div class="sms-origination-select">
    <v-select
      :model-value="value ?? 'senderId'"
      :items="items"
      :disabled="loading"
      @update:model-value="$emit('input', $event)"
    />
    <v-notice
      v-if="value === 'number' && !twoWayConfigured && !loading"
      class="sms-origination-warning"
      type="warning"
    >
      This flow is set to send from the two-way number, but no two-way number is
      configured in SMS Settings. The send will fail until one is set.
    </v-notice>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useApi } from "@directus/extensions-sdk";
import { originationChoices, isConfiguredNumber } from "./choices.js";

defineProps<{ value: string | null }>();
defineEmits<{ (e: "input", value: string): void }>();

const api = useApi();
const loading = ref(true);
const twoWayConfigured = ref(false);

const items = computed(() => originationChoices(twoWayConfigured.value));

onMounted(async () => {
  try {
    const res = await api.get("/items/sms_settings", {
      params: { fields: ["aws_two_way_number"] },
    });
    twoWayConfigured.value = isConfiguredNumber(res?.data?.data?.aws_two_way_number);
  } catch {
    // Fail open: if settings can't be read (permissions, not yet created, or the
    // number lives only in an env var the browser can't see), don't wrongly block
    // the two-way option — the send-time guard still catches a genuine misconfig.
    twoWayConfigured.value = true;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.sms-origination-warning {
  margin-top: 8px;
}
</style>
