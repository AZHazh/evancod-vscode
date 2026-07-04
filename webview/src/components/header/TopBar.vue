<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { History, Plus, RefreshCw, ServerCog } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import Button from '@/components/common/Button.vue'
import HistorySessionPopover from './HistorySessionPopover.vue'

const chatStore = useChatStore()
const historyOpen = ref(false)
const historyWrap = ref<HTMLElement>()

const emit = defineEmits<{
  syncNewApi: []
  openProviders: []
}>()

const handleNewSession = () => {
  chatStore.createNewSession()
}

const handleSync = () => {
  emit('syncNewApi')
}

const handleOpenProviders = () => {
  emit('openProviders')
}

function toggleHistory() {
  historyOpen.value = !historyOpen.value
  if (historyOpen.value) chatStore.fetchSessions()
}

function selectSession(sessionId: string) {
  if (['thinking', 'running', 'waiting_permission'].includes(chatStore.chatState)) {
    chatStore.stopGeneration()
  }
  chatStore.openSession(sessionId)
  historyOpen.value = false
}

function handleDocumentClick(event: MouseEvent) {
  if (!historyWrap.value?.contains(event.target as Node)) {
    historyOpen.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', handleDocumentClick))
onUnmounted(() => document.removeEventListener('mousedown', handleDocumentClick))
</script>

<template>
  <div class="top-bar">
    <div class="top-bar__left">
      <Button variant="primary" size="small" @click="handleNewSession">
        <template #icon><Plus /></template>
        新建会话
      </Button>

      <Button variant="secondary" size="small" @click="handleSync">
        <template #icon><RefreshCw /></template>
        同步 new-api
      </Button>

      <Button variant="secondary" size="small" @click="handleOpenProviders">
        <template #icon><ServerCog /></template>
        服务商
      </Button>
    </div>

    <div ref="historyWrap" class="top-bar__right">
      <button class="history-trigger" :class="{ active: historyOpen }" title="历史会话" @click="toggleHistory">
        <History />
      </button>
      <HistorySessionPopover
        v-if="historyOpen"
        :sessions="chatStore.sessions"
        :active-session-id="chatStore.currentSession?.id"
        @select="selectSession"
        @close="historyOpen = false"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-glass);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  flex-shrink: 0;

  &__left {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  &__right {
    position: relative;
  }
}

.history-trigger {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-surface-container) 74%, transparent);
  color: var(--color-text-primary);
  cursor: pointer;

  &:hover,
  &.active {
    border-color: var(--vscode-focusBorder);
    background: var(--color-surface-hover);
  }

  svg {
    width: 18px;
    height: 18px;
  }
}
</style>
