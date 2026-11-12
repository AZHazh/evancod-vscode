<script setup lang="ts">
import { computed } from 'vue'
import { File as FileIcon } from 'lucide-vue-next'
import type { UIMessage, MessageSkill, InlineMessageSegment } from '@/types'
import { useChatStore } from '@/stores/chat'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import CompactionStatus from './CompactionStatus.vue'
import ToolCallBlock from './ToolCallBlock.vue'
import ToolResultBlock from './ToolResultBlock.vue'
import UserQuestionBlock from './UserQuestionBlock.vue'
import PlanApproval from '@/components/plan/PlanApproval.vue'
import InlineImageGallery from './InlineImageGallery.vue'
import GeneratedImageBlock from './GeneratedImageBlock.vue'
import AgentCard from './AgentCard.vue'
import SkillBadge from '@/components/common/SkillBadge.vue'
import { useVSCode } from '@/composables/useVSCode'
import { copyText } from '@/utils/clipboard'
import { isFinalAnswer } from '@/utils/conversationGrouping'
import { collapseLongText, pastedTextTitle } from '@/utils/pastedText'

const props = defineProps<{
  message: UIMessage
}>()

const chatStore = useChatStore()
const vscode = useVSCode()

function approvePlan() {
  if (props.message.type !== 'plan_approval') return
  window.vscode?.postMessage({
    type: 'plan.approve',
    data: { planId: props.message.plan.id, sessionId: chatStore.currentSession?.id },
  })
}

function rejectPlan(reason: string) {
  if (props.message.type !== 'plan_approval') return
  window.vscode?.postMessage({
    type: 'plan.reject',
    data: { planId: props.message.plan.id, sessionId: chatStore.currentSession?.id, reason },
  })
}

function openFile(filePath: string, line?: number) {
  if (!filePath) return
  vscode.postMessage({ type: 'file.open', data: { path: filePath, line } })
}

function openPastedText(segment: InlineMessageSegment) {
  vscode.postMessage({ type: 'text.preview', data: { text: segment.text || '' } })
}

function copyInlineMessage(event: ClipboardEvent) {
  if (props.message.type !== 'user_text' || !inlineSegments.value.length) return
  event.preventDefault()
  event.clipboardData?.setData(
    'application/x-evancod-inline-segments',
    JSON.stringify(inlineSegments.value)
  )
  event.clipboardData?.setData(
    'text/plain',
    inlineSegments.value
      .map(segment => (
        segment.type === 'text' || segment.type === 'pasted_text'
          ? segment.text || '' : segment.name || ''
      ))
      .join('')
  )
}

const content = computed(() => ('content' in props.message ? props.message.content : ''))
const displayUserContent = computed(() => {
  if (props.message.type !== 'user_text') return ''
  return props.message.content
    .replace(/使用\s+([^（,，]+)\s+技能(?:（[^）]*）)?，/g, '')
    .replace(/\n*用户引用了以下工作区文件或目录：\n(?:-\s+@[^\n]+\n?)+/g, '')
    .trim()
})
const isStreamingAssistant = computed(
  () =>
    props.message.type === 'assistant_text' &&
    (props.message.status === 'streaming' || props.message.id === 'streaming-assistant') &&
    chatStore.chatState !== 'idle'
)
const documentLayout = computed(
  () =>
    props.message.type === 'assistant_text' &&
    !isStreamingAssistant.value &&
    shouldUseDocumentLayout(props.message.content)
)
const showCopy = computed(() => isFinalAnswer(props.message) && !isStreamingAssistant.value)
const nonImageAttachments = computed(() =>
  props.message.type === 'user_text'
    ? (props.message.attachments || []).filter(item => item.kind !== 'image')
    : []
)
const messageSkills = computed<MessageSkill[]>(() => {
  if (props.message.type !== 'user_text') return []
  if (props.message.skills?.length) return props.message.skills
  const found: MessageSkill[] = []
  const pattern = /使用\s+([^（,，]+)\s+技能(?:（([^）]*)）)?，/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(props.message.content))) {
    if (!found.some(skill => skill.name === match![1].trim()))
      found.push({ name: match![1].trim(), description: match![2] })
  }
  return found
})
const inlineSegments = computed<InlineMessageSegment[]>(() => {
  if (props.message.type !== 'user_text') return []
  if (props.message.inlineSegments?.length) return collapseLongText(props.message.inlineSegments)
  const fallback: InlineMessageSegment[] = []
  if (displayUserContent.value) fallback.push({ type: 'text', text: displayUserContent.value })
  nonImageAttachments.value.forEach(file =>
    fallback.push({ type: 'file', name: file.name, path: file.path })
  )
  messageSkills.value.forEach(skill =>
    fallback.push({ type: 'skill', name: skill.name, description: skill.description })
  )
  return collapseLongText(fallback)
})

function shouldUseDocumentLayout(value: string) {
  const normalized = value.trim()
  if (!normalized) return false
  if (/```/.test(normalized)) return true
  if (/^\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.+\|)/m.test(normalized)) return true

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map(chunk => chunk.trim())
    .filter(Boolean)

  return paragraphs.length >= 2 || normalized.split('\n').filter(line => line.trim()).length >= 8
}

async function copyMessage() {
  if (typeof content.value !== 'string' || !content.value.trim()) return
  await copyText(content.value)
}
</script>

<template>
  <div class="message-item" :class="[`message-${message.type}`]">
    <div v-if="message.type === 'user_text'" class="user-message">
      <div class="user-message__shell">
        <div
          v-if="inlineSegments.length"
          class="user-message__bubble"
          @copy="copyInlineMessage"
        >
          <template v-for="(segment, index) in inlineSegments" :key="`${segment.type}-${index}`">
            <span v-if="segment.type === 'text'">{{ segment.text }}</span>
            <button
              v-else-if="segment.type === 'pasted_text'"
              type="button"
              class="message-pasted-text"
              :title="`在编辑器中查看：${pastedTextTitle(segment.text || '')}`"
              @click="openPastedText(segment)"
            >
              <FileIcon :size="14" /><span>{{ pastedTextTitle(segment.text || '') }}</span>
            </button>
            <button
              v-else-if="segment.type === 'file'"
              type="button"
              class="message-file-token"
              :data-file-path="segment.path"
              @click="openFile(segment.path || '', segment.startLine)"
            >
              <FileIcon /><span>{{
                segment.startLine && segment.endLine
                  ? `${segment.name}:${segment.startLine}-${segment.endLine}`
                  : segment.name
              }}</span>
            </button>
            <span v-else class="message-skill-token"
              ><SkillBadge :skill="{ name: segment.name || '', description: segment.description }"
            /></span>
          </template>
        </div>
        <InlineImageGallery
          v-if="message.attachments?.length"
          class="user-message__gallery"
          :attachments="message.attachments"
        />
      </div>
    </div>

    <div
      v-else-if="message.type === 'assistant_text'"
      class="assistant-message"
      :class="{ 'assistant-message--commentary': message.phase === 'commentary' }"
    >
      <div
        class="assistant-message__shell"
        :class="{ 'assistant-message__shell--document': documentLayout }"
      >
        <div
          class="assistant-message__bubble"
          :class="{ 'assistant-message__bubble--document': documentLayout }"
        >
          <MarkdownRenderer
            :content="message.content"
            :streaming="isStreamingAssistant"
            :variant="documentLayout ? 'document' : 'default'"
            @file-open="openFile"
          />
        </div>
        <span v-if="message.status === 'interrupted'" class="assistant-message__interrupted">
          本轮未完成
        </span>
        <div v-if="showCopy" class="message-action-bar">
          <button
            class="message-action-bar__button"
            type="button"
            title="复制"
            @click="copyMessage"
          >
            复制
          </button>
        </div>
      </div>
    </div>

    <CompactionStatus
      v-else-if="message.type === 'context_compaction'"
      :status="message.status"
      :message="message.message"
    />

    <ThinkingBlock
      v-else-if="message.type === 'thinking'"
      :message-id="message.id"
      :content="message.content"
      :timestamp="message.timestamp"
      :ended-at="message.endedAt"
      :is-active="message.id === chatStore.activeThinkingMessageId"
      @file-open="openFile"
    />

    <AgentCard
      v-else-if="message.type === 'tool_use' && message.toolName === 'agent'"
      :tool-use-id="message.toolUseId"
      :description="
        message.input && typeof message.input === 'object' && 'description' in message.input
          ? (message.input.description as string)
          : undefined
      "
      :notification="message.notification"
      :input="message.input"
    />

    <ToolCallBlock
      v-else-if="message.type === 'tool_use'"
      :tool-name="message.toolName"
      :tool-use-id="message.toolUseId"
      :input="message.input"
      :is-pending="message.isPending"
      :execution-status="message.executionStatus"
      :partial-input="message.partialInput"
      :parent-tool-use-id="message.parentToolUseId"
      :bash="message.bash"
      :notification="message.notification"
      :result="'result' in message ? message.result : undefined"
      :result-error="'resultError' in message ? (message.resultError as boolean) : undefined"
      :result-outcome="
        'resultOutcome' in message
          ? (message.resultOutcome as import('@/types').ToolOutcome)
          : undefined
      "
      @cancel-bash="chatStore.cancelBash"
    />

    <ToolResultBlock
      v-else-if="message.type === 'tool_result' && message.isError"
      :message-id="message.id"
      :content="message.content"
      :is-error="message.isError"
      :outcome="message.outcome"
    />

    <UserQuestionBlock
      v-else-if="message.type === 'interaction_request'"
      :request-id="message.requestId"
      :input="message.input"
      :deferred="message.deferred"
      :requested-at="message.requestedAt"
      :response-state="message.responseState"
      :response-answers="message.responseAnswers"
    />

    <div v-else-if="message.type === 'plan_approval'" class="plan-message">
      <PlanApproval
        :plan="message.plan"
        @approve="approvePlan"
        @reject="rejectPlan"
        @file-open="openFile"
      />
    </div>

    <GeneratedImageBlock
      v-else-if="message.type === 'image_generation'"
      :is-pending="message.isPending"
      :prompt="message.prompt"
      :image="message.image"
    />
  </div>
</template>

<style scoped lang="scss">
.message-item {
  /* 间距由父容器 .chat-list__row 的 padding-bottom 控制，避免虚拟滚动高度测量问题 */
}

.user-message,
.assistant-message {
  display: flex;
}

.user-message {
  justify-content: flex-end;
}

.assistant-message {
  justify-content: flex-start;
}

.user-message__shell,
.assistant-message__shell {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.user-message__shell {
  max-width: 82%;
  align-items: flex-end;
}

.user-message__gallery {
  width: 100%;
  max-width: 320px;
}

.message-file-token {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  border-radius: 7px;
  background: transparent;
  color: #f3c777;
  vertical-align: bottom;
  border: 0;
  cursor: pointer;
  font: inherit;
}
.message-file-token svg {
  width: 12px;
  height: 12px;
  color: #55b7ff;
}
.message-pasted-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: min(320px, 100%);
  box-sizing: border-box;
  padding: 4px 9px;
  margin: 2px 0;
  border: 1px solid var(--chat-color-border);
  border-radius: 8px;
  background: var(--chat-color-surface-container);
  color: var(--chat-color-text-primary);
  font: inherit;
  vertical-align: middle;
  cursor: pointer;

  svg { flex-shrink: 0; }
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  &:hover { background: var(--chat-color-surface-container-high); }
  &:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
}
.message-skill-token {
  display: inline-flex;
  margin: 0 3px;
}

.assistant-message__shell {
  width: 100%;
  max-width: 100%;
  align-items: flex-start;
}

.assistant-message__shell--document {
  width: 100%;
  max-width: 100%;
}

.user-message__bubble,
.assistant-message__bubble {
  max-width: 100%;
  color: var(--chat-color-text-primary);
  font-size: 12px;
  line-height: 1.625;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.user-message__bubble {
  padding: 5px 10px;
  border-radius: 18px 4px 18px 18px;
  background: var(--chat-color-surface-user-msg);
  white-space: pre-wrap;
}

.assistant-message__bubble {
  padding: 2px 0;
  background: transparent;
  font-size: 13px;
}

.assistant-message--commentary .assistant-message__bubble {
  color: var(--chat-color-text-primary);
}
.assistant-message__interrupted {
  margin-top: 6px;
  font-size: 11px;
  color: var(--chat-color-text-tertiary);
}

.assistant-message__bubble--document {
  width: 100%;
}

.message-action-bar {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  justify-content: flex-start;
}

.message-action-bar__button {
  display: inline-flex;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--chat-radius-full);
  background: transparent;
  color: var(--chat-color-text-tertiary);
  cursor: pointer;
  font-size: 11px;

  &:hover {
    border-color: color-mix(in srgb, var(--chat-color-border) 50%, transparent);
    background: var(--chat-color-surface-container-low);
    color: var(--chat-color-text-primary);
  }
}

.plan-message {
  width: 100%;
}

@media (min-width: 640px) {
  .user-message__shell {
    max-width: 78%;
  }

}

@media (min-width: 1024px) {
  .user-message__shell {
    max-width: 72%;
  }

  .assistant-message__shell--document {
    max-width: 100%;
  }
}

@media (max-width: 640px) {
  .user-message__shell {
    max-width: 94%;
  }

  .assistant-message__shell--document {
    max-width: 100%;
  }
}
</style>
