<template>
  <div class="plan-approval">
    <div v-if="plan.state === 'planning'" class="permission-card permission-card--pending">
      <div class="permission-card__header">
        <FileText class="permission-card__file-icon permission-card__file-icon--pending" />
        <div class="permission-card__main">
          <div class="permission-card__title-row">
            <span class="permission-card__title">允许 Evancod Plan 执行计划?</span>
            <span class="permission-card__badge permission-card__badge--pending">
              <span class="permission-card__badge-dot" /> 等待审批
            </span>
          </div>
          <div class="permission-card__description">
            审阅模型返回的计划内容后，选择批准或拒绝。
          </div>
        </div>
      </div>

      <div class="permission-card__body">
        <div v-if="plan.filePath" class="permission-card__path-row" :title="plan.filePath">
          <Folder class="permission-card__path-icon" />
          <span>{{ plan.filePath }}</span>
        </div>

        <div class="plan-markdown">
          <MarkdownRenderer :content="planMarkdown" variant="document" />
        </div>

        <div v-if="hasHighRisks" class="approval-warning">
          此计划包含 {{ highRisksCount }} 个高风险项，请仔细审阅。
        </div>
      </div>

      <div class="permission-card__actions">
        <button class="chat-button chat-button--primary" type="button" :disabled="loading" @click="handleApprove">
          <Check class="chat-button__icon" />{{ loading && action === 'approve' ? '处理中...' : '批准计划' }}
        </button>
        <button class="chat-button chat-button--danger" type="button" :disabled="loading" @click="showRejectDialog = true">
          <X class="chat-button__icon" />拒绝
        </button>
      </div>
    </div>

    <div v-else-if="plan.state === 'approved'" class="permission-card permission-card--approved result-card">
      <div class="permission-card__header">
        <CircleCheck class="permission-card__file-icon permission-card__file-icon--approved" />
        <div class="permission-card__main">
          <div class="permission-card__title-row">
            <span class="permission-card__title">计划已批准</span>
            <span class="permission-card__badge permission-card__badge--approved">
              <CircleCheck class="permission-card__badge-icon" /> 已授权
            </span>
          </div>
          <div class="permission-card__description">批准时间: {{ formatDate(plan.approvedAt!) }}</div>
        </div>
      </div>
    </div>

    <div v-else-if="plan.state === 'rejected'" class="permission-card permission-card--denied result-card">
      <div class="permission-card__header">
        <CircleX class="permission-card__file-icon permission-card__file-icon--denied" />
        <div class="permission-card__main">
          <div class="permission-card__title-row">
            <span class="permission-card__title">计划已拒绝</span>
            <span class="permission-card__badge permission-card__badge--denied">
              <CircleX class="permission-card__badge-icon" /> 已拒绝
            </span>
          </div>
          <div v-if="plan.rejectedReason" class="permission-card__description">
            拒绝原因: {{ plan.rejectedReason }}
          </div>
        </div>
      </div>
    </div>

    <Modal
      v-model="showRejectDialog"
      title="拒绝计划"
      size="medium"
      @confirm="handleReject"
      @close="handleRejectClose"
    >
      <div class="reject-form">
        <p class="reject-hint">
          请说明拒绝原因，AI 将根据您的反馈重新制定计划：
        </p>
        <Input
          v-model="rejectReason"
          type="textarea"
          placeholder="例如：任务拆解过于粗糙，需要更详细的步骤..."
          :rows="4"
          required
        />
      </div>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Check, CircleCheck, CircleX, FileText, Folder, X } from 'lucide-vue-next'
import type { Plan } from '../../stores/plan'
import Modal from '../common/Modal.vue'
import Input from '../common/Input.vue'
import MarkdownRenderer from '../markdown/MarkdownRenderer.vue'

interface Props {
  plan: Plan
}

const props = defineProps<Props>()

const emit = defineEmits<{
  approve: []
  reject: [reason: string]
}>()

const showRejectDialog = ref(false)
const rejectReason = ref('')
const loading = ref(false)
const action = ref<'approve' | 'reject' | null>(null)

const hasHighRisks = computed(() => {
  return props.plan.risks.some(r => r.level === 'high')
})

const highRisksCount = computed(() => {
  return props.plan.risks.filter(r => r.level === 'high').length
})

const planMarkdown = computed(() => {
  const sections: string[] = []

  sections.push(`# ${props.plan.title}`)

  if (props.plan.description) {
    sections.push(`## Context\n\n${props.plan.description}`)
  }

  if (props.plan.tasks.length > 0) {
    sections.push([
      '## Plan',
      '',
      ...props.plan.tasks.map((task, index) => {
        const lines = [`${index + 1}. **${task.subject}**`]
        if (task.description) lines.push(`   - ${task.description}`)
        if (task.estimatedTime) lines.push(`   - 预计：${task.estimatedTime}`)
        if (task.risks?.length) lines.push(`   - 风险：${task.risks.join('、')}`)
        return lines.join('\n')
      })
    ].join('\n'))
  }

  if (props.plan.steps.length > 0) {
    sections.push([
      '## Steps',
      '',
      ...props.plan.steps.map(step => `- ${step}`)
    ].join('\n'))
  }

  if (props.plan.risks.length > 0) {
    sections.push([
      '## Risks',
      '',
      ...props.plan.risks.map(risk => `- **${riskLevelText(risk.level)}** ${risk.description}\n  - 缓解：${risk.mitigation}`)
    ].join('\n'))
  }

  return sections.join('\n\n')
})

function riskLevelText(level: 'low' | 'medium' | 'high') {
  const map = {
    low: '低风险',
    medium: '中风险',
    high: '高风险'
  }
  return map[level]
}

async function handleApprove() {
  loading.value = true
  action.value = 'approve'

  try {
    emit('approve')
  } finally {
    loading.value = false
    action.value = null
  }
}

async function handleReject() {
  if (!rejectReason.value.trim()) {
    return
  }

  loading.value = true
  action.value = 'reject'

  try {
    emit('reject', rejectReason.value.trim())
    showRejectDialog.value = false
    rejectReason.value = ''
  } finally {
    loading.value = false
    action.value = null
  }
}

function handleRejectClose() {
  showRejectDialog.value = false
  rejectReason.value = ''
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString('zh-CN')
}
</script>

<style scoped lang="scss">
.plan-approval {
  width: 100%;
}

.permission-card {
  overflow: hidden;
  border: 1px solid var(--chat-color-warning);
  border-radius: var(--chat-radius-lg);
  background: var(--chat-color-surface-container-lowest);
}

.permission-card--approved {
  border-color: color-mix(in srgb, #69f08d 45%, var(--chat-color-border));
}

.permission-card--denied {
  border-color: color-mix(in srgb, var(--chat-color-error) 45%, var(--chat-color-border));
}

.permission-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--chat-color-surface-container-lowest);
}

.permission-card__file-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: var(--chat-color-warning);
  stroke-width: 2;
}

.permission-card__file-icon--approved {
  color: #69f08d;
}

.permission-card__file-icon--denied {
  color: var(--chat-color-error);
}

.permission-card__file-icon--pending {
  color: var(--chat-color-warning);
}

.permission-card__main {
  min-width: 0;
  flex: 1;
}

.permission-card__title-row {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.permission-card__title {
  min-width: 0;
  overflow: hidden;
  color: var(--chat-color-text-primary);
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-card__description {
  margin-top: 2px;
  overflow: hidden;
  color: var(--chat-color-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-card__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--chat-radius-full);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.permission-card__badge--pending {
  background: color-mix(in srgb, var(--chat-color-warning) 15%, transparent);
  color: var(--chat-color-warning);
}

.permission-card__badge--approved {
  background: color-mix(in srgb, #69f08d 16%, transparent);
  color: #69f08d;
}

.permission-card__badge--denied {
  background: color-mix(in srgb, var(--chat-color-error) 16%, transparent);
  color: var(--chat-color-error);
}

.permission-card__badge-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.permission-card__badge-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--chat-radius-full);
  background: var(--chat-color-warning);
  animation: chat-pulse-dot 1.4s ease-in-out infinite;
}

.permission-card__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px 12px;
}

.permission-card__path-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container);
  color: var(--chat-color-text-secondary);
  font-family: var(--chat-font-mono);
  font-size: 12px;
}

.permission-card__path-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-card__path-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--chat-color-text-tertiary);
}

.plan-markdown {
  max-height: min(56vh, 620px);
  overflow: auto;
  padding: 12px 14px;
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container);
  color: var(--chat-color-text-primary);
}

.approval-warning {
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--chat-color-warning) 35%, transparent);
  border-radius: var(--chat-radius-md);
  background: color-mix(in srgb, var(--chat-color-warning) 10%, transparent);
  color: var(--chat-color-warning);
  font-size: 12px;
}

.permission-card__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 20%, transparent);
  background: var(--chat-color-surface-container-low);
}

.chat-button {
  display: inline-flex;
  height: 32px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--chat-radius-md);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease,
    transform 0.16s ease;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
}

.chat-button__icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.chat-button--primary {
  background: #ff7f5f;
  color: #18120f;

  &:hover:not(:disabled) {
    background: #ff9478;
    box-shadow: 0 6px 16px color-mix(in srgb, #ff7f5f 25%, transparent);
  }
}

.chat-button--danger {
  border-color: color-mix(in srgb, var(--chat-color-error) 35%, transparent);
  background: color-mix(in srgb, var(--chat-color-error-container) 45%, var(--chat-color-surface));
  color: var(--chat-color-error);

  &:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--chat-color-error) 55%, transparent);
    background: color-mix(
      in srgb,
      var(--chat-color-error-container) 70%,
      var(--chat-color-surface)
    );
  }
}

.result-card .permission-card__header {
  padding: 16px;
}

.reject-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reject-hint {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

@keyframes chat-pulse-dot {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.9);
  }

  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}
</style>
