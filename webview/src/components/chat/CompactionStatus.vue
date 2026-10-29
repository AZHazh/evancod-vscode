<script setup lang="ts">
import { computed } from 'vue'
import { Copy, LoaderCircle, CircleAlert } from 'lucide-vue-next'

const props = defineProps<{
  status: 'compacting' | 'completed' | 'failed'
  message: string
}>()
const isCompacting = computed(() => props.status === 'compacting')
</script>

<template>
  <div class="compaction-status" :class="{ 'is-failed': status === 'failed' }" role="status">
    <span class="line" />
    <div class="content">
      <LoaderCircle v-if="isCompacting" class="icon spinning" :size="14" />
      <CircleAlert v-else-if="status === 'failed'" class="icon" :size="14" />
      <Copy v-else class="icon" :size="14" />
      <span>{{ message }}</span>
    </div>
    <span class="line" />
  </div>
</template>

<style scoped lang="scss">
.compaction-status {
  display: flex;
  align-items: center;
  gap: 16px;
  width: min(100%, 820px);
  margin: 4px auto 10px;
  padding: 0 12px;
  color: var(--vscode-descriptionForeground, #9ca3af);
  font-size: 12px;
  line-height: 1.5;
  flex: 0 0 auto;
}

.line {
  flex: 1;
  height: 1px;
  background: var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
}

.content {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.is-failed {
  color: var(--vscode-errorForeground, #f48771);
}

.icon {
  flex: 0 0 auto;
  color: currentColor;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
