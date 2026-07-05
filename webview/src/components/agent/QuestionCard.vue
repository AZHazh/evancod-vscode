<template>
  <div class="question-card" :class="`question-card--${responseState}`">
    <div class="card-header">
      <div class="card-title-row">
        <h3 class="question-title">{{ question.question }}</h3>
        <span class="status-badge" :class="`status-badge--${responseState}`">
          <span v-if="responseState === 'pending'" class="status-dot" />
          <CircleCheck v-else-if="responseState === 'approved'" class="status-icon" />
          <CircleX v-else class="status-icon" />
          {{ statusText }}
        </span>
      </div>
    </div>

    <div class="card-body">
      <OptionSelector
        :options="question.options"
        :allow-multiple="question.allowMultiple"
        v-model:selected="selectedOptions"
      />

      <CustomInput
        v-model="customInput"
        placeholder="模型的选项可能不准确，你可以在此输入自己的想法..."
      />
    </div>

    <div v-if="responseState === 'pending'" class="card-footer">
      <Button variant="primary" size="large" @click="handleSubmit" :disabled="!canSubmit">
        {{ submitButtonText }}
      </Button>
      <Button v-if="showCancelButton" variant="ghost" size="large" @click="handleCancel"> 跳过 </Button>
    </div>

    <div class="card-hint" v-if="question.allowMultiple && responseState === 'pending'">
      可以选择多个选项
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { CircleCheck, CircleX } from 'lucide-vue-next'
import Button from '../common/Button.vue'
import OptionSelector from './OptionSelector.vue'
import CustomInput from './CustomInput.vue'

export interface QuestionOption {
  label: string
  description: string
  preview?: string
}

export interface Question {
  id: string
  question: string
  options: QuestionOption[]
  allowMultiple?: boolean
  allowCustomInput?: boolean
}

interface Props {
  question: Question
  responseState?: 'pending' | 'approved' | 'denied'
  submitButtonText?: string
  showCancelButton?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  responseState: 'pending',
  submitButtonText: '提交答案',
  showCancelButton: true,
})

const emit = defineEmits<{
  submit: [answer: { selectedOptions: string[]; customInput?: string }]
  cancel: []
}>()

const selectedOptions = ref<string[]>([])
const customInput = ref('')

const statusText = computed(() => {
  if (props.responseState === 'approved') return '已授权'
  if (props.responseState === 'denied') return '已拒绝'
  return '等待审批'
})

const canSubmit = computed(() => {
  return selectedOptions.value.length > 0 || customInput.value.trim().length > 0
})

function handleSubmit() {
  if (!canSubmit.value || props.responseState !== 'pending') return

  emit('submit', {
    selectedOptions: [...selectedOptions.value],
    customInput: customInput.value.trim() || undefined,
  })
}

function handleCancel() {
  if (props.responseState !== 'pending') return
  emit('cancel')
}
</script>

<style scoped>
.question-card {
  background: var(--vscode-editor-background);
  border: 1px solid var(--chat-color-warning, var(--vscode-panel-border));
  border-radius: 8px;
  padding: 20px;
}

.question-card--approved {
  border-color: color-mix(in srgb, #69f08d 45%, var(--vscode-panel-border));
}

.question-card--denied {
  border-color: color-mix(in srgb, var(--chat-color-error) 45%, var(--vscode-panel-border));
}

.card-header {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.question-title {
  min-width: 0;
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--vscode-foreground);
  line-height: 1.5;
}

.status-badge {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.status-badge--pending {
  background: color-mix(in srgb, var(--chat-color-warning) 15%, transparent);
  color: var(--chat-color-warning);
}

.status-badge--approved {
  background: color-mix(in srgb, #69f08d 16%, transparent);
  color: #69f08d;
}

.status-badge--denied {
  background: color-mix(in srgb, var(--chat-color-error) 16%, transparent);
  color: var(--chat-color-error);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  animation: chat-pulse-dot 1.4s ease-in-out infinite;
}

.status-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 20px;
}

.card-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.card-footer :deep(button) {
  transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease,
    transform 0.16s ease;
}

.card-footer :deep(button:hover:not(:disabled)) {
  transform: translateY(-1px);
}

.card-hint {
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--vscode-input-background);
  border-radius: 4px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  text-align: center;
}
</style>
