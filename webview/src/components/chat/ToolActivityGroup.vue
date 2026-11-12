<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, LoaderCircle, Wrench } from 'lucide-vue-next'
import type { ToolActivityGroup } from '@/utils/activityGrouping'
import { summarizeToolActivity } from '@/utils/activityGrouping'
import { useChatStore } from '@/stores/chat'
import MessageItem from './MessageItem.vue'

const props = defineProps<{ group: ToolActivityGroup }>()
const chatStore = useChatStore()
const expanded = computed({
  get: () => chatStore.isExpandedState(props.group.id),
  set: value => chatStore.setExpandedState(props.group.id, value),
})
const summary = computed(() => summarizeToolActivity(props.group.messages))
const waitingPermission = computed(() =>
  chatStore.pendingPermissions.some(request =>
    props.group.messages.some(
      message => message.type === 'tool_use' && message.toolUseId === request.toolUseId
    )
  )
)
const state = computed(() => {
  const value = summary.value
  if (waitingPermission.value) return '等待授权'
  if (value.running) return `${value.running} 项执行中`
  if (value.errors) return `${value.errors} 项失败`
  if (value.cancelled) return '已停止'
  return '已结束'
})
</script>

<template>
  <section class="tool-activity" :class="{ 'tool-activity--error': summary.errors }">
    <button
      class="tool-activity__toggle"
      type="button"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <LoaderCircle
        v-if="summary.running && !waitingPermission"
        class="tool-activity__spinner"
        :size="14"
      />
      <Wrench v-else :size="14" />
      <span class="tool-activity__title">{{ summary.count }} 项工具操作</span>
      <!-- <span class="tool-activity__categories">{{ summary.categories.join(' · ') }}</span> -->
      <span class="tool-activity__state">{{ state }}</span>
      <ChevronRight :size="14" :class="{ 'tool-activity__chevron--open': expanded }" />
    </button>
    <div v-if="expanded" class="tool-activity__details">
      <MessageItem v-for="message in group.messages" :key="message.id" :message="message" />
    </div>
  </section>
</template>

<style scoped lang="scss">
.tool-activity {
  color: var(--chat-color-text-secondary);
  font-size: 12px;
}
.tool-activity__toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  &:hover {
    color: var(--chat-color-text-primary);
  }
  &:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 3px;
  }
  > svg {
    flex-shrink: 0;
  }
}
.tool-activity__title {
  flex-shrink: 0;
}
.tool-activity__categories {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--chat-color-text-tertiary);
}
.tool-activity__state {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
}
.tool-activity--error .tool-activity__state {
  color: var(--chat-color-error);
}
.tool-activity__chevron--open {
  transform: rotate(90deg);
}
.tool-activity__details {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 6px 0 4px 6px;
  padding: 4px 0 4px 14px;
  border-left: 1px solid var(--chat-color-border);
}
.tool-activity__spinner {
  animation: activity-spin 1s linear infinite;
}
@keyframes activity-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .tool-activity__spinner {
    animation: none;
  }
}
</style>
