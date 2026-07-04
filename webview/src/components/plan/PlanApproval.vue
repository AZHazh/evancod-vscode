<template>
  <div class="plan-approval">
    <div v-if="plan.state === 'planning'" class="approval-pending">
      <div class="approval-header">
        <h3 class="approval-title">⏳ 等待审批</h3>
        <p class="approval-description">
          AI 已制定详细的执行计划，请审批后继续执行
        </p>
      </div>

      <div class="approval-warning" v-if="hasHighRisks">
        <span class="warning-icon">⚠️</span>
        <span class="warning-text">
          此计划包含 {{ highRisksCount }} 个高风险项，请仔细审阅
        </span>
      </div>

      <div class="approval-actions">
        <Button
          variant="primary"
          size="large"
          icon="✅"
          @click="handleApprove"
          :disabled="loading"
          :loading="loading && action === 'approve'"
        >
          批准计划
        </Button>
        <Button
          variant="danger"
          size="large"
          icon="❌"
          @click="showRejectDialog = true"
          :disabled="loading"
        >
          拒绝计划
        </Button>
      </div>
    </div>

    <div v-else-if="plan.state === 'approved'" class="approval-approved">
      <div class="status-icon">✅</div>
      <h3 class="status-title">计划已批准</h3>
      <p class="status-description">
        批准时间: {{ formatDate(plan.approvedAt!) }}
      </p>
    </div>

    <div v-else-if="plan.state === 'rejected'" class="approval-rejected">
      <div class="status-icon">❌</div>
      <h3 class="status-title">计划已拒绝</h3>
      <p class="status-description" v-if="plan.rejectedReason">
        拒绝原因: {{ plan.rejectedReason }}
      </p>
    </div>

    <!-- 拒绝对话框 -->
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
import type { Plan } from '../../stores/plan'
import Button from '../common/Button.vue'
import Modal from '../common/Modal.vue'
import Input from '../common/Input.vue'

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

async function handleApprove() {
  console.log('[PlanApproval] handleApprove 被调用')
  loading.value = true
  action.value = 'approve'

  try {
    console.log('[PlanApproval] 发出 approve 事件')
    emit('approve')
    // 模拟网络延迟
    await new Promise(resolve => setTimeout(resolve, 500))
    console.log('[PlanApproval] approve 完成')
  } finally {
    loading.value = false
    action.value = null
  }
}

async function handleReject() {
  console.log('[PlanApproval] handleReject 被调用')
  if (!rejectReason.value.trim()) {
    console.warn('[PlanApproval] 拒绝原因为空')
    return
  }

  loading.value = true
  action.value = 'reject'

  try {
    console.log('[PlanApproval] 发出 reject 事件，原因:', rejectReason.value.trim())
    emit('reject', rejectReason.value.trim())
    // 模拟网络延迟
    await new Promise(resolve => setTimeout(resolve, 500))
    showRejectDialog.value = false
    rejectReason.value = ''
    console.log('[PlanApproval] reject 完成')
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

<style scoped>
.plan-approval {
  margin-top: 24px;
  padding: 20px;
  background: var(--vscode-editor-background);
  border: 2px solid var(--vscode-panel-border);
  border-radius: 8px;
}

.approval-pending {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.approval-header {
  text-align: center;
}

.approval-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--vscode-foreground);
}

.approval-description {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
  margin: 0;
}

.approval-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--vscode-inputValidation-warningBackground);
  border: 1px solid var(--vscode-inputValidation-warningBorder);
  border-radius: 6px;
}

.warning-icon {
  font-size: 20px;
}

.warning-text {
  font-size: 13px;
  color: var(--vscode-inputValidation-warningForeground);
}

.approval-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 8px;
}

.approval-approved,
.approval-rejected {
  text-align: center;
  padding: 20px;
}

.status-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.status-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--vscode-foreground);
}

.status-description {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
  margin: 0;
}

.reject-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reject-hint {
  font-size: 13px;
  color: var(--vscode-descriptionForeground);
  margin: 0;
  line-height: 1.5;
}
</style>
