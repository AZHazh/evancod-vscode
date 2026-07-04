<script setup lang="ts">
import { computed } from 'vue'
import type { UIMessage } from '@/types'
import { useChatStore } from '@/stores/chat'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolCallBlock from './ToolCallBlock.vue'
import ToolResultBlock from './ToolResultBlock.vue'
import PermissionRequestBlock from './PermissionRequestBlock.vue'

const props = defineProps<{
  message: UIMessage
}>()

const chatStore = useChatStore()

const content = computed(() => 'content' in props.message ? props.message.content : '')
const documentLayout = computed(() =>
  props.message.type === 'assistant_text' && shouldUseDocumentLayout(props.message.content)
)
const formattedTime = computed(() => new Date(props.message.timestamp).toLocaleTimeString())

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
  await navigator.clipboard.writeText(content.value)
}
</script>

<template>
  <div class="message-item" :class="[`message-${message.type}`]">
    <div v-if="message.type === 'user_text'" class="user-message">
      <div class="user-message__shell">
        <div v-if="message.content.trim()" class="user-message__bubble">
          {{ message.content }}
        </div>
        <div v-if="message.content.trim()" class="message-action-bar message-action-bar--end">
          <button class="message-action-bar__button" type="button" title="复制" @click="copyMessage">复制</button>
          <span class="message-action-bar__timestamp">{{ formattedTime }}</span>
        </div>
      </div>
    </div>

    <div v-else-if="message.type === 'assistant_text'" class="assistant-message">
      <div class="assistant-message__shell" :class="{ 'assistant-message__shell--document': documentLayout }">
        <div class="assistant-message__bubble" :class="{ 'assistant-message__bubble--document': documentLayout }">
          <MarkdownRenderer :content="message.content" :variant="documentLayout ? 'document' : 'default'" />
        </div>
        <div class="message-action-bar message-action-bar--start">
          <button class="message-action-bar__button" type="button" title="复制" @click="copyMessage">复制</button>
          <span class="message-action-bar__timestamp">{{ formattedTime }}</span>
        </div>
      </div>
    </div>

    <ThinkingBlock
      v-else-if="message.type === 'thinking'"
      :content="message.content"
      :timestamp="message.timestamp"
    />

    <ToolCallBlock
      v-else-if="message.type === 'tool_use'"
      :tool-name="message.toolName"
      :tool-use-id="message.toolUseId"
      :input="message.input"
      :is-pending="message.isPending"
      :partial-input="message.partialInput"
      :parent-tool-use-id="message.parentToolUseId"
      :bash="message.bash"
      :notification="message.notification"
      @cancel-bash="chatStore.cancelBash"
    />

    <ToolResultBlock
      v-else-if="message.type === 'tool_result'"
      :content="message.content"
      :is-error="message.isError"
    />

    <PermissionRequestBlock
      v-else-if="message.type === 'permission_request'"
      :request-id="message.requestId"
      :tool-name="message.toolName"
      :input="message.input"
      :description="message.description"
      :response-state="message.responseState"
    />
  </div>
</template>

<style scoped lang="scss">
.message-item {
  margin-bottom: 20px;
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

.assistant-message__shell {
  max-width: 88%;
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
  font-size: 14px;
  line-height: 1.625;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.user-message__bubble {
  padding: 12px 16px;
  border-radius: 18px 4px 18px 18px;
  background: var(--chat-color-surface-user-msg);
  white-space: pre-wrap;
}

.assistant-message__bubble {
  padding: 12px 16px;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 60%, transparent);
  border-radius: 20px;
  border-top-left-radius: 8px;
  background: var(--chat-color-surface);
  box-shadow: var(--chat-shadow-sm);
}

.assistant-message__bubble--document {
  width: 100%;
}

.message-action-bar {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  opacity: 0;
  transition: opacity 150ms ease;
}

.user-message__shell:hover .message-action-bar,
.user-message__shell:focus-within .message-action-bar,
.assistant-message__shell:hover .message-action-bar,
.assistant-message__shell:focus-within .message-action-bar {
  opacity: 1;
}

.message-action-bar--end {
  justify-content: flex-end;
}

.message-action-bar--start {
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

.message-action-bar__timestamp {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 6px;
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
}

@media (min-width: 640px) {
  .user-message__shell {
    max-width: 78%;
  }

  .assistant-message__shell {
    max-width: 80%;
  }
}

@media (min-width: 1024px) {
  .user-message__shell,
  .assistant-message__shell {
    max-width: 72%;
  }

  .assistant-message__shell--document {
    max-width: 100%;
  }
}

@media (max-width: 640px) {
  .user-message__shell,
  .assistant-message__shell {
    max-width: 94%;
  }

  .assistant-message__shell--document {
    max-width: 100%;
  }
}
</style>
