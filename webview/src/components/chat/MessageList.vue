<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowDown } from 'lucide-vue-next'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import type { UIMessage } from '@/types'
import { useChatStore } from '@/stores/chat'
import MessageItem from './MessageItem.vue'

const chatStore = useChatStore()
// DynamicScroller 组件实例。它是泛型函数式组件，无法用 InstanceType 取类型，
// 这里只声明我们实际用到的 $el 与 scrollToBottom
const scrollerRef = ref<{ $el: HTMLElement; scrollToBottom: () => void }>()
// 指向内部滚动元素，scrollTop/scrollHeight/clientHeight 从这里读取
const listRef = ref<HTMLElement>()
const thinkingStartedAt = ref(Date.now())
const now = ref(Date.now())
const isPinnedToBottom = ref(true)
const showBackToLatest = ref(false)
const timer = window.setInterval(() => {
  now.value = Date.now()
}, 1000)

const messages = computed(() => chatStore.uiMessages)

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

// 建立 toolUseId -> toolName 索引，避免 filter 时 O(n²) 嵌套查找
const toolUseMap = computed(() => {
  const map = new Map<string, string>()
  messages.value.forEach(msg => {
    if (msg.type === 'tool_use') {
      map.set(msg.toolUseId, msg.toolName)
    }
  })
  return map
})

// 性能优化：将需要隐藏的工具名称提取为常量
const HIDDEN_TOOL_RESULTS = new Set([
  'read_file',
  'grep',
  'glob',
  'edit_file',
  'write_file',
  'image_gen',
])
const RESULT_INJECTABLE_TOOLS = new Set(['read_file', 'grep', 'glob', 'image_gen'])

// task_* 工具（task_create/task_update/task_list/task_get）的结果统一合并进对应卡片，
// 不再作为独立 tool_result 渲染，避免错误结果块与相邻卡片粘连或产生空行
function isTaskTool(toolName: string) {
  return toolName.startsWith('task_')
}

// 增强的消息列表，将 tool_result 数据注入到 tool_use 中
const enhancedMessages = computed(() => {
  return messages.value
    .filter(msg => {
      // 过滤掉 agent 子工具调用（在 AgentCard 内展示，不在主消息流重复）
      if (
        (msg.type === 'tool_use' || msg.type === 'tool_result') &&
        msg.parentToolUseId &&
        agentToolUseIds.value.has(msg.parentToolUseId)
      ) {
        return false
      }
      // 过滤掉特定工具的 tool_result 消息（用 Map 查 O(1) 代替 find O(n)）
      if (msg.type === 'tool_result') {
        const toolName = toolUseMap.value.get(msg.toolUseId)
        if (toolName) {
          return !HIDDEN_TOOL_RESULTS.has(toolName) && !isTaskTool(toolName)
        }
      }
      return true
    })
    .map(msg => {
      // 将 tool_result 数据注入到对应的 tool_use 消息中
      if (msg.type === 'tool_use') {
        const result = toolResultMap.value.get(msg.toolUseId)
        if (result && (RESULT_INJECTABLE_TOOLS.has(msg.toolName) || isTaskTool(msg.toolName))) {
          return {
            ...msg,
            result: result.content,
            resultError: result.isError,
          }
        }
      }
      return msg
    })
})
const showThinkingIndicator = computed(() => {
  // 如果消息列表中已有活跃的 thinking 块，不显示底部指示器（避免重复）
  const hasActiveThinking = enhancedMessages.value.some(
    message => message.type === 'thinking' && message.id === 'streaming-thinking'
  )
  if (hasActiveThinking) return false

  return (
    chatStore.chatState !== 'idle' ||
    enhancedMessages.value.some(
      message =>
        message.type === 'tool_use' && message.isPending && message.toolName !== 'image_gen'
    )
  )
})
const streamingVerb = computed(() => {
  if (chatStore.chatState === 'waiting_permission') return '等待授权'
  return '思考中...'
})
const thinkingElapsedSeconds = computed(() =>
  Math.max(0, Math.floor((now.value - thinkingStartedAt.value) / 1000))
)
const thinkingTokenCount = computed(() => estimateTokenCount(chatStore.streamingText))
const latestAssistantTextLength = computed(() => {
  const latest = enhancedMessages.value.at(-1)
  return latest?.type === 'assistant_text' ? latest.content.length : 0
})
// 对流式文本长度进行分段，避免每个字符都触发滚动更新（每200字符触发一次）
const throttledTextLength = computed(() => Math.floor(latestAssistantTextLength.value / 200))
const scrollSignature = computed(() =>
  [
    enhancedMessages.value.length,
    enhancedMessages.value.at(-1)?.id,
    throttledTextLength.value,
    chatStore.chatState,
  ].join(':')
)

watch(
  () => chatStore.chatState,
  (state, previousState) => {
    if (state !== 'idle' && previousState === 'idle') {
      thinkingStartedAt.value = Date.now()
      now.value = Date.now()
    }
  }
)

watch(scrollSignature, async () => {
  // 用户主动向上滚动时，不要因为流式内容更新而自动滚动
  if (!isPinnedToBottom.value) {
    showBackToLatest.value = true
    return
  }
  await scrollToLatest(false)
})

// 切换会话时重新 pin 到底部（虚拟滚动的高度缓存随 key-field 自动重置）
watch(
  () => chatStore.currentSession?.id,
  async () => {
    isPinnedToBottom.value = true
    showBackToLatest.value = false
    await scrollToLatest(false)
  }
)

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

// 用户主动向上滚（滚轮/触摸）时同步立即 unpin。
// 必须同步：流式高频 delta 下 scrollSignature watch 会先于 handleScroll 的 rAF 落地，
// 读到滞后的 isPinnedToBottom=true 而把视图重新拽回底部，导致向上滚被反复吞掉。
function handleUserScrollUp(deltaY: number) {
  if (deltaY < 0 && isPinnedToBottom.value) {
    isPinnedToBottom.value = false
    showBackToLatest.value = true
  }
}

function handleWheel(event: WheelEvent) {
  handleUserScrollUp(event.deltaY)
}

let lastTouchY = 0
function handleTouchStart(event: TouchEvent) {
  lastTouchY = event.touches[0]?.clientY ?? 0
}
function handleTouchMove(event: TouchEvent) {
  const y = event.touches[0]?.clientY ?? 0
  // 手指下移 = 内容上滚查看历史
  handleUserScrollUp(lastTouchY - y)
  lastTouchY = y
}

function jumpToBottom() {
  // 直接把内部滚动元素推到底，比库的 scrollToBottom() 更可靠：
  // scrollToBottom() 依据库“已测量”的尺寸计算，流式增长时测量落后于内容，
  // 会滚到偏短的旧底部。直接读实时 scrollHeight 则始终到真实底部。
  const element = listRef.value
  if (element) {
    element.scrollTop = element.scrollHeight
  } else {
    scrollerRef.value?.scrollToBottom()
  }
}

async function scrollToLatest(smooth = true) {
  await nextTick()
  if (smooth) {
    const element = listRef.value
    if (element) {
      element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
    }
  } else {
    // 流式内容的高度重新测量是异步的（ResizeObserver）。先滚一次，
    // 再等一帧让重测量落地后补滚一次，确保真正到达增长后的底部。
    jumpToBottom()
    requestAnimationFrame(() => {
      if (isPinnedToBottom.value) jumpToBottom()
    })
  }
  isPinnedToBottom.value = true
  showBackToLatest.value = false
}

// 计算影响消息高度的字段，供 DynamicScrollerItem 的 size-dependencies 使用。
// item 是联合类型，用 'in' 收窄后安全取值，任一变化触发重新测量高度。
// 对流式文本内容进行分段，避免每个字符都触发重测量（每100字符触发一次）
function sizeDependencies(item: UIMessage): unknown[] {
  const deps: unknown[] = []

  if ('content' in item && typeof item.content === 'string') {
    deps.push(Math.floor(item.content.length / 100))
  } else if ('content' in item) {
    deps.push(item.content)
  }

  if ('result' in item) deps.push(item.result)
  if ('partialInput' in item) deps.push(item.partialInput)
  if ('isPending' in item) deps.push(item.isPending)
  if ('image' in item) deps.push(item.image)

  return deps
}

function estimateTokenCount(value: string) {
  const cjkCount = (value.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length
  const normalized = value.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').trim()
  const segmentCount = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0

  return Math.max(0, Math.ceil(cjkCount + segmentCount * 1.3))
}

function bindScrollElement(el: HTMLElement) {
  // 直接监听内部滚动元素，section 上的 @scroll 不会触发
  el.addEventListener('scroll', handleScroll, { passive: true })
  // wheel/touch 同步捕获用户主动上滚，绕开 handleScroll 的 rAF 竞态
  el.addEventListener('wheel', handleWheel, { passive: true })
  el.addEventListener('touchstart', handleTouchStart, { passive: true })
  el.addEventListener('touchmove', handleTouchMove, { passive: true })
}

function unbindScrollElement(el: HTMLElement) {
  el.removeEventListener('scroll', handleScroll)
  el.removeEventListener('wheel', handleWheel)
  el.removeEventListener('touchstart', handleTouchStart)
  el.removeEventListener('touchmove', handleTouchMove)
}

// DynamicScroller 是 v-else 条件渲染：空会话时不存在，消息到达后才挂载。
// onMounted 单次绑定会错过这个时机，改用 watch 跟随 scroller 的出现/消失动态绑定。
watch(
  scrollerRef,
  async (scroller, previous) => {
    if (previous?.$el) {
      unbindScrollElement(previous.$el as HTMLElement)
    }
    const el = scroller?.$el as HTMLElement | undefined
    if (el) {
      listRef.value = el
      bindScrollElement(el)
      await nextTick()
      void scrollToLatest(false)
    } else {
      listRef.value = undefined
    }
  },
  { immediate: true, flush: 'post' }
)

onBeforeUnmount(() => {
  window.clearInterval(timer)
  if (scrollRaf) window.cancelAnimationFrame(scrollRaf)
  const el = listRef.value
  if (el) unbindScrollElement(el)
})
</script>

<template>
  <section class="chat-list">
    <div v-if="enhancedMessages.length === 0" class="empty-state">
      <div class="empty-icon">✦</div>
      <div class="empty-text">开始新对话</div>
      <div class="empty-hint">输入消息或使用 / 命令</div>
    </div>

    <DynamicScroller
      v-else
      ref="scrollerRef"
      :items="enhancedMessages"
      :min-item-size="80"
      :buffer="1000"
      key-field="id"
      class="chat-scroller"
    >
      <template #before>
        <div class="chat-scroller__spacer-top" />
      </template>

      <template #default="{ item, index, active }">
        <DynamicScrollerItem
          :item="item"
          :active="active"
          :data-index="index"
          :size-dependencies="sizeDependencies(item)"
        >
          <div class="chat-list__row">
            <MessageItem :message="item" />
          </div>
        </DynamicScrollerItem>
      </template>

      <template #after>
        <div v-if="showThinkingIndicator" class="chat-list__row">
          <div class="streaming-indicator">
            <span class="streaming-indicator__spark" aria-hidden="true">✦</span>
            <span class="streaming-indicator__verb">{{ streamingVerb }}</span>
            <span class="streaming-indicator__meta">{{ thinkingElapsedSeconds }}s</span>
            <span class="streaming-indicator__meta">↓ {{ thinkingTokenCount }} tokens</span>
          </div>
        </div>
        <div class="chat-scroller__spacer-bottom" />
      </template>
    </DynamicScroller>

    <button v-if="showBackToLatest" class="back-to-latest" @click="scrollToLatest(true)">
      <ArrowDown />
      回到最新
    </button>
  </section>
</template>

<style scoped lang="scss">
.chat-list {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--chat-color-background);
  color: var(--chat-color-text-primary);
  font-family: var(--chat-font-body);
}

/* DynamicScroller 自身接管滚动：用 flex:1 + min-height:0 拿到确定的有界高度，
   否则百分比高度在 flex 容器下解析不出有效值，内部 overflow 无法滚动 */
.chat-scroller {
  flex: 1;
  min-height: 0;
  scrollbar-color: var(--vscode-scrollbarSlider-background, rgba(128, 128, 128, 0.35)) transparent;
}

/* 每个消息行的居中容器，替代原 .chat-list__inner 的居中逻辑 */
.chat-list__row {
  width: 100%;
  max-width: min(860px, 100%);
  margin: 0 auto;
  padding: 0 20px 16px;
}

/* 顶部/底部留白 spacer（虚拟滚动下无法可靠给首/末项加 padding） */
.chat-scroller__spacer-top {
  height: 24px;
}

.chat-scroller__spacer-bottom {
  height: 12px;
}

.empty-state {
  display: flex;
  flex: 1;
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
  position: absolute;
  right: 18px;
  bottom: 18px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
  .chat-list__row {
    padding-right: 12px;
    padding-left: 12px;
  }
}
</style>
