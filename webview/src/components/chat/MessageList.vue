<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowDown } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import MessageItem from './MessageItem.vue'

const chatStore = useChatStore()
const listRef = ref<HTMLElement>()
const thinkingStartedAt = ref(Date.now())
const now = ref(Date.now())
const isPinnedToBottom = ref(true)
const showBackToLatest = ref(false)
const timer = window.setInterval(() => {
  now.value = Date.now()
}, 1000)

const messages = computed(() => chatStore.uiMessages)
const showStreamingIndicator = computed(() =>
  chatStore.chatState !== 'idle' || messages.value.some(message => message.type === 'tool_use' && message.isPending)
)
const streamingVerb = computed(() => {
  if (chatStore.chatState === 'waiting_permission') return 'Awaiting approval'
  if (chatStore.chatState === 'running') return 'Running'
  if (chatStore.chatState === 'thinking') return '思考中...'
  return 'Working'
})
const thinkingElapsedSeconds = computed(() => Math.max(0, Math.floor((now.value - thinkingStartedAt.value) / 1000)))
const thinkingTokenCount = computed(() => estimateTokenCount(chatStore.streamingText))
const latestAssistantTextLength = computed(() => {
  const latest = messages.value.at(-1)
  return latest?.type === 'assistant_text' ? latest.content.length : 0
})
const scrollSignature = computed(() => [
  messages.value.length,
  messages.value.at(-1)?.id,
  latestAssistantTextLength.value,
  chatStore.chatState,
].join(':'))

watch(() => chatStore.chatState, (state, previousState) => {
  if (state === 'thinking' && previousState !== 'thinking') {
    thinkingStartedAt.value = Date.now()
    now.value = Date.now()
  }
})

watch(scrollSignature, async () => {
  if (!isPinnedToBottom.value) {
    showBackToLatest.value = true
    return
  }
  await scrollToLatest(false)
})

function handleScroll() {
  const element = listRef.value
  if (!element) return
  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight
  isPinnedToBottom.value = distanceToBottom < 48
  showBackToLatest.value = !isPinnedToBottom.value
}

async function scrollToLatest(smooth = true) {
  await nextTick()
  const element = listRef.value
  if (!element) return
  element.scrollTo({
    top: element.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto',
  })
  isPinnedToBottom.value = true
  showBackToLatest.value = false
}

function estimateTokenCount(value: string) {
  const cjkCount = (value.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length
  const normalized = value
    .replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ')
    .trim()
  const segmentCount = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0

  return Math.max(0, Math.ceil(cjkCount + segmentCount * 1.3))
}

onMounted(() => {
  void scrollToLatest(false)
})
onBeforeUnmount(() => window.clearInterval(timer))
</script>

<template>
  <section ref="listRef" class="chat-list" @scroll="handleScroll">
    <div v-if="messages.length === 0" class="empty-state">
      <div class="empty-icon">✦</div>
      <div class="empty-text">开始新对话</div>
      <div class="empty-hint">输入消息或使用 / 命令</div>
    </div>

    <div v-else class="chat-list__inner">
      <MessageItem
        v-for="message in messages"
        :key="message.id"
        :message="message"
      />

      <div v-if="showStreamingIndicator" class="streaming-indicator">
        <span class="streaming-indicator__spark" aria-hidden="true">✦</span>
        <span class="streaming-indicator__verb">{{ streamingVerb }}</span>
        <template v-if="chatStore.chatState === 'thinking'">
          <span class="streaming-indicator__meta">{{ thinkingElapsedSeconds }}s</span>
          <span class="streaming-indicator__meta">↓ {{ thinkingTokenCount }} tokens</span>
        </template>
      </div>
    </div>

    <button v-if="showBackToLatest" class="back-to-latest" @click="scrollToLatest(true)">
      <ArrowDown />
      回到最新
    </button>
  </section>
</template>

<style scoped lang="scss">
.chat-list {
  position: relative;
  flex: 1;
  height: 100%;
  overflow-y: auto;
  background: var(--chat-color-background);
  color: var(--chat-color-text-primary);
  font-family: var(--chat-font-body);
  scrollbar-color: var(--vscode-scrollbarSlider-background, rgba(128, 128, 128, 0.35)) transparent;
}

.chat-list__inner {
  width: 100%;
  max-width: min(860px, 100%);
  margin: 0 auto;
  padding: 24px 20px 32px;
}

.empty-state {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--chat-color-text-tertiary);
  text-align: center;
}

.empty-icon {
  margin-bottom: 12px;
  color: var(--chat-color-brand);
  font-size: 28px;
  animation: chat-shimmer 1.5s ease-in-out infinite;
}

.empty-text {
  margin-bottom: 6px;
  color: var(--chat-color-text-primary);
  font-size: 16px;
  font-weight: 650;
}

.empty-hint {
  font-size: 13px;
}

.streaming-indicator {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 6px;
  margin: 6px 0 12px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 45%, transparent);
  border-radius: var(--chat-radius-full);
  background: color-mix(in srgb, var(--chat-color-surface-container-low) 82%, transparent);
  color: var(--chat-color-text-tertiary);
  font-size: 12px;
  line-height: 1;
}

.streaming-indicator__spark {
  color: #c084fc;
  font-size: 11px;
  line-height: 1;
}

.streaming-indicator__verb {
  color: var(--chat-color-text-secondary);
  font-weight: 600;
}

.streaming-indicator__meta {
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
  white-space: nowrap;
}

.back-to-latest {
  position: sticky;
  right: 18px;
  bottom: 18px;
  z-index: 20;
  float: right;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 18px 18px auto;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-surface-container) 92%, transparent);
  color: var(--color-text-primary);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.25);
  cursor: pointer;

  svg {
    width: 15px;
    height: 15px;
  }
}

@media (max-width: 640px) {
  .chat-list__inner {
    padding-right: 12px;
    padding-left: 12px;
  }
}
</style>
