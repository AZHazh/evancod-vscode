<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatRelativeTime } from '@/lib/time'
import type { Session } from '@/types'

const props = defineProps<{
  sessions: Session[]
  activeSessionId?: string
}>()

const emit = defineEmits<{
  select: [sessionId: string]
  close: []
}>()

const query = ref('')

const filteredSessions = computed(() => {
  const q = query.value.trim().toLowerCase()
  const items = [...props.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  if (!q) return items
  return items.filter(session => {
    return session.name.toLowerCase().includes(q) || session.workDir.toLowerCase().includes(q)
  })
})
</script>

<template>
  <Teleport to="body">
    <div class="history-popover" @mousedown.stop>
      <input v-model="query" placeholder="搜索历史会话" @keydown.esc="emit('close')" />
      <div class="history-list">
        <button
          v-for="session in filteredSessions"
          :key="session.id"
          class="history-item"
          :class="{ active: session.id === activeSessionId }"
          @click="emit('select', session.id)"
        >
          <div class="title">{{ session.name }}</div>
          <div class="meta">{{ formatRelativeTime(session.updatedAt) }} · {{ session.messageCount ?? session.messages.length }} 条消息</div>
          <div class="path">{{ session.workDir }}</div>
        </button>
        <div v-if="!filteredSessions.length" class="empty">没有历史会话</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.history-popover {
  position: fixed;
  top: 56px;
  right: 16px;
  z-index: 10000;
  width: min(420px, calc(100vw - 32px));
  max-height: min(620px, calc(100vh - 72px));
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: #0c0c0c;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.58);
}

input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 9px 10px;
  background: var(--vscode-input-background, rgba(255, 255, 255, 0.08));
  color: var(--color-text-primary);
  outline: none;
}

.history-list {
  max-height: min(560px, calc(100vh - 128px));
  margin-top: 8px;
  overflow-y: auto;
}

.history-item {
  width: 100%;
  display: block;
  border: none;
  border-radius: 10px;
  padding: 10px;
  background: transparent;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;

  &:hover,
  &.active {
    background: rgba(255, 255, 255, 0.1);
  }
}

.title {
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta,
.path,
.empty {
  margin-top: 4px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  padding: 14px;
}
</style>
