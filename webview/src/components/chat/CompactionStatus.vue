<script setup lang="ts">
import { computed } from 'vue'
import { Copy, LoaderCircle } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()

const status = computed(() => chatStore.compactionStatus)
const isVisible = computed(() => status.value !== 'idle')
const isCompacting = computed(() => status.value === 'compacting')
const label = computed(() => (isCompacting.value ? '上下文正在压缩' : '上下文已自动压缩'))
</script>

<template>
  <div v-if="isVisible" class="compaction-status" :class="{ 'is-completed': !isCompacting }">
    <span class="line" />
    <div class="content">
      <LoaderCircle v-if="isCompacting" class="icon spinning" :size="14" />
      <Copy v-else class="icon" :size="14" />
      <span>{{ label }}</span>
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
  line-height: 1;
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
  white-space: nowrap;
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
