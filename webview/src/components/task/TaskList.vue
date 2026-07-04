<template>
  <div class="task-list">
    <div class="list-header">
      <h3 class="list-title">{{ title }}</h3>
      <span class="list-count">{{ tasks.length }}</span>
    </div>

    <div class="list-content" v-if="tasks.length > 0">
      <TaskItem
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        @select="handleSelect"
        @start="handleStart"
        @complete="handleComplete"
      />
    </div>

    <div class="list-empty" v-else>
      <div class="empty-icon">📋</div>
      <p class="empty-text">{{ emptyMessage }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import TaskItem from './TaskItem.vue'
import type { TaskItem as TaskItemType } from '../../stores/task'

interface Props {
  title: string
  tasks: TaskItemType[]
  emptyMessage?: string
}

withDefaults(defineProps<Props>(), {
  emptyMessage: '暂无任务'
})

const emit = defineEmits<{
  select: [taskId: string]
  start: [taskId: string]
  complete: [taskId: string]
}>()

function handleSelect(taskId: string) {
  emit('select', taskId)
}

function handleStart(taskId: string) {
  emit('start', taskId)
}

function handleComplete(taskId: string) {
  emit('complete', taskId)
}
</script>

<style scoped>
.task-list {
  margin-bottom: 16px;
}

.list-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.list-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: var(--vscode-editor-foreground);
}

.list-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  font-size: 11px;
  font-weight: 600;
  border-radius: 10px;
}

.list-content {
  max-height: 400px;
  overflow-y: auto;
}

.list-empty {
  text-align: center;
  padding: 32px 16px;
  color: var(--vscode-descriptionForeground);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 8px;
  opacity: 0.5;
}

.empty-text {
  font-size: 13px;
  margin: 0;
}
</style>
