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

const messages = computed(() => chatStore.uiMessages.filter(m => m.type !== 'thinking'))

// 收集所有 agent 工具调用的 toolUseId，用于过滤其子工具调用（子工具在 AgentCard 内展示）
const agentToolUseIds = computed(() => {
  const ids = new Set<string>()
  chatStore.uiMessages.forEach(msg => {
    if (msg.type === 'tool_use' && msg.toolName === 'agent') {
      ids.add(msg.toolUseId)
    }
  })
  return ids
})

// 创建一个 Map 来关联 tool_result 到 tool_use
const toolResultMap = computed(() => {
  const map = new Map<string, { content: unknown; isError: boolean }>()
  messages.value.forEach(msg => {
    if (msg.type === 'tool_result') {
      map.set(msg.toolUseId, { content: msg.content, isError: msg.isError })
    }
  })
  return map
})

// 性能优化：将需要隐藏的工具名称提取为常量
const HIDDEN_TOOL_RESULTS = new Set(['read_file', 'grep', 'glob', 'edit_file', 'write_file', 'image_gen'])
const RESULT_INJECTABLE_TOOLS = new Set(['read_file', 'grep', 'glob', 'image_gen'])

// 增强的消息列表，将 tool_result 数据注入到 tool_use 中
const enhancedMessages = computed(() => {
  return messages.value
    .filter(msg => {
      // 过滤掉 agent 子工具调用（在 AgentCard 内展示，不在主消息流重复）
      if ((msg.type === 'tool_use' || msg.type === 'tool_result') && msg.parentToolUseId && agentToolUseIds.value.has(msg.parentToolUseId)) {
        return false
      }
      // 过滤掉特定工具的 tool_result 消息
      if (msg.type === 'tool_result') {
        const toolUse = messages.value.find(m => m.type === 'tool_use' && m.toolUseId === msg.toolUseId)
        if (toolUse && toolUse.type === 'tool_use') {
          return !HIDDEN_TOOL_RESULTS.has(toolUse.toolName)
        }
      }
      return true
    })
    .map(msg => {
      // 将 tool_result 数据注入到对应的 tool_use 消息中
      if (msg.type === 'tool_use') {
        const result = toolResultMap.value.get(msg.toolUseId)
        if (result && RESULT_INJECTABLE_TOOLS.has(msg.toolName)) {
          return {
            ...msg,
            result: result.content,
            resultError: result.isError
          }
        }
      }
      return msg
    })
})
const showThinkingIndicator = computed(() => {
  return chatStore.chatState !== 'idle' || enhancedMessages.value.some(message => message.type === 'tool_use' && message.isPending && message.toolName !== 'image_gen')
})
const streamingVerb = computed(() => {
  if (chatStore.chatState === 'waiting_permission') return '等待授权'
  return '思考中...'
})
const thinkingElapsedSeconds = computed(() => Math.max(0, Math.floor((now.value - thinkingStartedAt.value) / 1000)))
const thinkingTokenCount = computed(() => estimateTokenCount(chatStore.streamingText))
const latestAssistantTextLength = computed(() => {
  const latest = enhancedMessages.value.at(-1)
  return latest?.type === 'assistant_text' ? latest.content.length : 0
})
const scrollSignature = computed(() => [
  enhancedMessages.value.length,
  enhancedMessages.value.at(-1)?.id,
  latestAssistantTextLength.value,
  chatStore.chatState,
].join(':'))

watch(() => chatStore.chatState, (state, previousState) => {
  if (state !== 'idle' && previousState === 'idle') {
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

let scrollRaf = 0

function handleScroll() {
  // rAF 节流：滚动期间每帧最多同步一次状态，避免频繁读取布局属性触发强制重排
  if (scrollRaf) return
  scrollRaf = window.requestAnimationFrame(() => {
    scrollRaf = 0
    const element = listRef.value
    if (!element) return
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    const pinned = distanceToBottom < 48
    if (isPinnedToBottom.value !== pinned) {
      isPinnedToBottom.value = pinned
    }
    if (showBackToLatest.value === pinned) {
      showBackToLatest.value = !pinned
    }
  })
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
onBeforeUnmount(() => {
  window.clearInterval(timer)
  if (scrollRaf) window.cancelAnimationFrame(scrollRaf)
})
</script>

<template>
  <section ref="listRef" class="chat-list" @scroll.passive="handleScroll">
    <div v-if="enhancedMessages.length === 0" class="empty-state">
      <div class="empty-icon">✦</div>
      <div class="empty-text">开始新对话</div>
      <div class="empty-hint">输入消息或使用 / 命令</div>
    </div>

    <div v-else class="chat-list__inner">
      <MessageItem
        v-for="message in enhancedMessages"
        :key="message.id"
        v-memo="[message.id, message]"
        :message="message"
      />

      <div v-if="showThinkingIndicator" class="streaming-indicator">
        <span class="streaming-indicator__spark" aria-hidden="true">✦</span>
        <span class="streaming-indicator__verb">{{ streamingVerb }}</span>
        <span class="streaming-indicator__meta">{{ thinkingElapsedSeconds }}s</span>
        <span class="streaming-indicator__meta">↓ {{ thinkingTokenCount }} tokens</span>
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
