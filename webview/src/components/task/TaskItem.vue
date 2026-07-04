<template>
  <div class="task-item" :class="statusClass" @click="$emit('select', task.id)">
    <div class="task-header">
      <div class="task-status">
        <component :is="statusIcon" class="status-icon" />
        <span class="task-id">{{ task.id }}</span>
      </div>
      <div class="task-actions">
        <Button v-if="task.status === 'pending' && !isBlocked" size="small" @click.stop="$emit('start', task.id)">开始</Button>
        <Button v-if="task.status === 'in_progress'" variant="secondary" size="small" @click.stop="$emit('complete', task.id)">完成</Button>
      </div>
    </div>

    <div class="task-content">
      <h4 class="task-subject">{{ task.subject }}</h4>
      <p class="task-description">{{ task.description }}</p>
    </div>

    <div class="task-meta">
      <div class="meta-item">
        <span class="meta-label">创建时间:</span>
        <span class="meta-value">{{ formatDate(task.createdAt) }}</span>
      </div>
      <div class="meta-item" v-if="task.owner">
        <span class="meta-label">负责人:</span>
        <span class="meta-value">{{ task.owner }}</span>
      </div>
    </div>

    <div class="task-dependencies" v-if="task.blockedBy.length > 0 || task.blocks.length > 0">
      <div class="dependency-section" v-if="task.blockedBy.length > 0">
        <Lock class="dependency-icon" />
        <span class="dependency-label">依赖:</span>
        <span class="dependency-list">{{ task.blockedBy.length }} 个任务</span>
      </div>
      <div class="dependency-section" v-if="task.blocks.length > 0">
        <Clock class="dependency-icon" />
        <span class="dependency-label">阻塞:</span>
        <span class="dependency-list">{{ task.blocks.length }} 个任务</span>
      </div>
    </div>

    <div class="task-blocked-warning" v-if="isBlocked">
      <Lock class="dependency-icon" />此任务被依赖阻塞，需要先完成依赖任务
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, Clock, LoaderCircle, Lock, Trash2 } from 'lucide-vue-next'
import Button from '../common/Button.vue'
import type { TaskItem } from '../../stores/task'

interface Props { task: TaskItem }
const props = defineProps<Props>()
defineEmits<{ select: [taskId: string]; start: [taskId: string]; complete: [taskId: string] }>()

const isBlocked = computed(() => props.task.blockedBy.length > 0)
const statusClass = computed(() => `status-${props.task.status}`)
const statusIcon = computed(() => {
  const icons = { pending: Clock, in_progress: LoaderCircle, completed: CheckCircle2, deleted: Trash2 }
  return icons[props.task.status] || Clock
})

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 7) return `${days} 天前`
  return date.toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.task-item { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 12px; margin-bottom: 8px; cursor: pointer; transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease; }
.task-item:hover { background: var(--color-surface-hover); border-color: var(--color-border-focus); box-shadow: var(--shadow-focus-ring); }
.task-item.status-completed { opacity: 0.72; }
.task-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px; }
.task-status { display: flex; align-items: center; gap: 8px; min-width: 0; }
.status-icon { width: 16px; height: 16px; color: var(--color-primary); }
.status-in_progress .status-icon { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.task-id { font-size: 11px; color: var(--color-text-secondary); font-family: var(--vscode-editor-font-family, monospace); }
.task-actions { display: flex; gap: 6px; }
.task-content { margin-bottom: 8px; }
.task-subject { font-size: 14px; font-weight: 700; margin: 0 0 4px 0; color: var(--color-text-primary); }
.task-description { font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.task-meta { display: flex; gap: 16px; margin-bottom: 8px; padding-top: 8px; border-top: 1px solid var(--color-border); }
.meta-item { display: flex; gap: 4px; font-size: 11px; }
.meta-label, .dependency-label { color: var(--color-text-secondary); }
.meta-value, .dependency-list { color: var(--color-text-primary); }
.task-dependencies { display: flex; gap: 12px; font-size: 11px; padding: 7px 9px; background: var(--color-surface-container); border-radius: var(--radius-md); margin-top: 8px; }
.dependency-section, .task-blocked-warning { display: flex; align-items: center; gap: 5px; }
.dependency-icon { width: 13px; height: 13px; color: var(--color-text-secondary); }
.task-blocked-warning { margin-top: 8px; padding: 7px 9px; background: var(--vscode-inputValidation-warningBackground, var(--color-surface-container)); border: 1px solid var(--vscode-inputValidation-warningBorder, var(--color-border)); border-radius: var(--radius-md); font-size: 11px; color: var(--vscode-inputValidation-warningForeground, var(--color-text-secondary)); }
</style>
