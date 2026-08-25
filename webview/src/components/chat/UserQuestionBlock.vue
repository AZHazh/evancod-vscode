<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { CircleCheck, CircleHelp, CircleX, Play, X } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import OptionSelector from '@/components/agent/OptionSelector.vue'
import CustomInput from '@/components/agent/CustomInput.vue'

interface QuestionOption {
  label: string
  description: string
  preview?: string
}

interface Question {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect?: boolean
}

interface UserAnswer {
  selectedOptions: string[]
  customInput?: string
}

const props = defineProps<{
  requestId: string
  input: unknown
  responseState?: 'pending' | 'answered' | 'cancelled'
  responseAnswers?: unknown
}>()

const chatStore = useChatStore()
const state = ref(props.responseState || 'pending')
const activeIndex = ref(0)
const answers = reactive<Array<{ selectedOptions: string[]; customInput: string }>>(
  Array.from({ length: 4 }, () => ({ selectedOptions: [], customInput: '' })),
)

watch(
  () => props.responseState,
  value => {
    state.value = value || 'pending'
  },
)

const questions = computed<Question[]>(() => {
  if (!props.input || typeof props.input !== 'object' || Array.isArray(props.input)) return []
  const value = (props.input as { questions?: unknown }).questions
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is Question =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as Question).question === 'string' &&
      Array.isArray((item as Question).options),
  )
})

function normalizeAnswers(value: unknown) {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

  return questions.value.map((_, index) => {
    const answer = record[`question_${index}`]
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
      return { selectedOptions: [], customInput: '' }
    }

    const item = answer as Partial<UserAnswer>
    return {
      selectedOptions: Array.isArray(item.selectedOptions)
        ? item.selectedOptions.filter((option): option is string => typeof option === 'string')
        : [],
      customInput: typeof item.customInput === 'string' ? item.customInput : '',
    }
  })
}

watch(
  [questions, () => props.responseAnswers],
  ([, responseAnswers]) => {
    if (responseAnswers === undefined) return
    normalizeAnswers(responseAnswers).forEach((answer, index) => {
      answers[index].selectedOptions = answer.selectedOptions
      answers[index].customInput = answer.customInput
    })
  },
  { immediate: true },
)

const allAnswered = computed(() =>
  questions.value.every((_, index) => {
    const answer = answers[index]
    return answer.selectedOptions.length > 0 || answer.customInput.trim().length > 0
  }),
)

function submit() {
  if (state.value !== 'pending' || !allAnswered.value) return
  const result: Record<string, { selectedOptions: string[]; customInput?: string }> = {}
  questions.value.forEach((_, index) => {
    result[`question_${index}`] = {
      selectedOptions: [...answers[index].selectedOptions],
      customInput: answers[index].customInput.trim() || undefined,
    }
  })
  state.value = 'answered'
  chatStore.sendInteractionResponse({
    requestId: props.requestId,
    answered: true,
    answers: result,
  })
}

function cancel() {
  if (state.value !== 'pending') return

  state.value = 'cancelled'
  chatStore.sendInteractionResponse({
    requestId: props.requestId,
    answered: false,
    reason: '用户取消了问题',
  })
}
</script>

<template>
  <section class="question-card">
    <header class="question-card__header">
      <CircleHelp :size="20" />
      <h3>Evancod 需要你的输入</h3>
      <span v-if="state !== 'pending'" class="question-card__status">
        {{ state === 'answered' ? '已回答' : '已取消' }}
      </span>
    </header>

    <nav v-if="questions.length > 1" class="question-card__tabs">
      <button
        v-for="(question, index) in questions"
        :key="index"
        type="button"
        :class="{ active: activeIndex === index }"
        @click="activeIndex = index"
      >
        {{ question.header || `问题 ${index + 1}` }}
      </button>
    </nav>

    <div
      v-for="(question, index) in questions"
      v-show="activeIndex === index"
      :key="index"
      class="question-card__body"
    >
      <h4>{{ question.question }}</h4>
      <OptionSelector
        v-model:selected="answers[index].selectedOptions"
        :options="question.options"
        :allow-multiple="question.multiSelect || false"
        :disabled="state !== 'pending'"
      />
      <CustomInput
        v-model="answers[index].customInput"
        placeholder="输入其他答案..."
        :disabled="state !== 'pending'"
      />

    </div>

    <footer v-if="state === 'pending'" class="question-card__footer">
      <button type="button" class="secondary" title="取消" @click="cancel">
        <X :size="16" />取消
      </button>
      <button type="button" class="primary" :disabled="!allAnswered" @click="submit">
        <Play :size="16" />提交
      </button>
    </footer>
    <div v-else class="question-card__complete">
      <CircleCheck v-if="state === 'answered'" :size="17" />
      <CircleX v-else :size="17" />
      {{ state === 'answered' ? '答案已提交，任务将继续执行' : '问题已取消' }}
    </div>
  </section>
</template>

<style scoped lang="scss">
.question-card {
  overflow: hidden;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-editor-background);
}

.question-card__header,
.question-card__footer,
.question-card__complete {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
}

.question-card__header {
  border-bottom: 1px solid var(--vscode-panel-border);
  color: var(--vscode-foreground);
}

.question-card__header h3 {
  flex: 1;
  margin: 0;
  font-size: 14px;
  letter-spacing: 0;
}

.question-card__status {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.question-card__tabs {
  display: flex;
  gap: 2px;
  padding: 8px 12px 0;
}

.question-card__tabs button {
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 6px 10px;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
}

.question-card__tabs button.active {
  border-bottom-color: var(--vscode-focusBorder);
  color: var(--vscode-foreground);
}

.question-card__body {
  display: grid;
  gap: 12px;
  padding: 16px;
}

.question-card__body h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0;
}

.question-card__footer {
  justify-content: flex-end;
  border-top: 1px solid var(--vscode-panel-border);
}

.question-card__footer button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 4px;
  padding: 5px 12px;
  cursor: pointer;
}

.question-card__footer .primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.question-card__footer .secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.question-card__footer button:disabled {
  cursor: default;
  opacity: 0.5;
}

.question-card__complete {
  border-top: 1px solid var(--vscode-panel-border);
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
</style>
