<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { Check, ChevronDown, ClipboardList, RefreshCw, X } from 'lucide-vue-next'
import { useTaskStore } from '../../stores/task'

const emit = defineEmits<{ close: [] }>()
const taskStore = useTaskStore()
const loading = ref(false)
const collapsed = ref(false)

const completedCount = computed(() => taskStore.completedTasks.length)
const totalCount = computed(() => taskStore.stats.total)
const progressPercent = computed(() => totalCount.value === 0 ? 0 : Math.round((completedCount.value / totalCount.value) * 100))

onMounted(() => {
  handleRefresh()
})

async function handleRefresh() {
  loading.value = true
  await taskStore.fetchTasks()
  setTimeout(() => {
    loading.value = false
  }, 300)
}

function taskLabel(task: { id: string; subject: string }) {
  const numericId = task.id.match(/\d+/)?.[0] || task.id
  return `#${numericId} ${task.subject}`
}
</script>

<template>
  <div class="task-panel">
    <div class="panel-header">
      <div class="header-left">
        <div class="title-badge"><ClipboardList class="title-icon" /></div>
        <span class="panel-title">任务</span>
        <div class="progress-track"><div class="progress-fill" :style="{ width: `${progressPercent}%` }" /></div>
        <span class="progress-text">{{ completedCount }}/{{ totalCount }}</span>
        <button class="icon-button" type="button" @click="collapsed = !collapsed" aria-label="折叠任务面板">
          <ChevronDown class="chevron" :class="{ collapsed }" />
        </button>
      </div>

      <div class="header-actions">
        <button class="icon-button" type="button" :class="{ spinning: loading }" @click="handleRefresh" aria-label="刷新任务">
          <RefreshCw />
        </button>
        <button class="close-button" type="button" @click="emit('close')" aria-label="关闭任务面板">
          <X />
        </button>
      </div>
    </div>

    <div v-if="!collapsed" class="panel-content">
      <div v-if="taskStore.tasks.length > 0" class="task-rows">
        <div v-for="task in taskStore.tasks" :key="task.id" class="task-row" :class="`status-${task.status}`">
          <span class="status-dot"><Check v-if="task.status === 'completed'" /></span>
          <span class="task-text">{{ taskLabel(task) }}</span>
        </div>
      </div>

      <div v-else class="empty-state">暂无任务</div>
    </div>
  </div>
</template>

<style scoped>
.task-panel {
  height: auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}

.panel-header {
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 14px;
  background: var(--color-surface-container);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 45%, transparent);
}

.header-left,
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.title-badge {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 14px;
  background: #302d3d;
  color: #c5b9ff;
}

.title-icon {
  width: 18px;
  height: 18px;
}

.panel-title {
  font-size: 16px;
  font-weight: 800;
  color: #f2ece8;
  white-space: nowrap;
}

.progress-track {
  width: min(220px, 20vw);
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #3b3938;
}

.progress-fill {
  height: 100%;
  border-radius: inherit;
  background: #7ee08f;
  transition: width 180ms ease;
}

.progress-text {
  font-size: 13px;
  color: #9f9691;
  white-space: nowrap;
}

.icon-button,
.close-button {
  border: 0;
  padding: 0;
  display: inline-grid;
  place-items: center;
  background: transparent;
  color: #9f9691;
  cursor: pointer;
}

.icon-button:hover,
.close-button:hover {
  color: #f2ece8;
}

.icon-button svg {
  width: 18px;
  height: 18px;
}

.close-button svg {
  width: 20px;
  height: 20px;
}

.chevron {
  transition: transform 160ms ease;
}

.chevron.collapsed {
  transform: rotate(-90deg);
}

.spinning svg {
  animation: spin 1s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.panel-content {
  max-height: 220px;
  overflow-y: auto;
  padding: 10px 18px 12px;
}

.task-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 28px;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.35;
}

.task-row.status-completed .task-text {
  text-decoration: line-through;
  opacity: 0.7;
}

.status-dot {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #353331;
  color: #101010;
}

.status-completed .status-dot {
  background: #82e391;
}

.status-in_progress .status-dot {
  background: var(--vscode-charts-blue, #3794ff);
}

.status-pending .status-dot {
  background: #5a5550;
}

.status-dot svg {
  width: 14px;
  height: 14px;
  stroke-width: 4;
}

.task-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-state {
  padding: 36px 0;
  color: #9f9691;
  font-size: 13px;
}
</style>
