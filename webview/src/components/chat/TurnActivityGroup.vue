<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import { formatElapsed } from '@/utils/formatElapsed'
import type { TurnActivityGroup } from '@/utils/conversationGrouping'
import MessageItem from './MessageItem.vue'
import ToolActivityGroup from './ToolActivityGroup.vue'

const props = defineProps<{ group: TurnActivityGroup }>()
const chatStore = useChatStore()
const expanded = computed({
  get: () => chatStore.isExpandedState(props.group.id),
  set: value => chatStore.setExpandedState(props.group.id, value),
})
const elapsed = computed(() => formatElapsed((props.group.endedAt - props.group.startedAt) / 1000))
</script>

<template>
  <section class="turn-activity">
    <button
      class="turn-activity__toggle"
      type="button"
      :aria-expanded="expanded"
      :aria-controls="`${group.id}:details`"
      :aria-label="`本轮执行过程，用时 ${elapsed}`"
      @click="expanded = !expanded"
    >
      <span>用时 {{ elapsed }}</span>
      <ChevronDown :size="13" :class="{ 'turn-activity__chevron--open': expanded }" />
    </button>
    <div class="turn-activity__separator"></div>
    <div
      v-if="expanded"
      :id="`${group.id}:details`"
      class="turn-activity__details"
      role="region"
      aria-label="本轮执行过程"
    >
      <template v-for="item in group.items" :key="item.id">
        <ToolActivityGroup v-if="item.type === 'tool_activity_group'" :group="item" />
        <MessageItem v-else :message="item" />
      </template>
    </div>
  </section>
</template>

<style scoped lang="scss">
.turn-activity {
  min-width: 0;
  color: var(--chat-color-text-secondary);
  font-size: 12px;
}
.turn-activity__separator {
  width: 100%;
  height: 1px;
  margin: 4px 0;
  background-color: var(--chat-color-border);
}
.turn-activity__toggle {
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  gap: 5px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;

  &:hover {
    color: var(--chat-color-text-primary);
  }

  &:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, var(--chat-color-primary));
    outline-offset: 3px;
    border-radius: 3px;
  }
}

.turn-activity__chevron--open {
  transform: rotate(180deg);
}

.turn-activity__details {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 6px;
  padding: 10px 0 4px;
}
</style>
