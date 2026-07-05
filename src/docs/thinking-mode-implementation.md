# Claude 思考模式(Thinking Mode)实现方案

## 1. 概述

本文档详细说明如何在 Vue3 + Node.js 项目中复刻 Claude Code 的「思考模式」功能。该功能允许 Claude 模型在回答前进行内部推理,并将推理过程展示给用户。

### 核心原理

思考模式本质是在调用 Anthropic API 时,在请求体中增加 `thinking` 参数,指示模型返回 `thinking` 类型的 content block。判断逻辑分为两层:

1. **模型能力判断**: 该模型是否支持 thinking
2. **用户配置判断**: 用户/应用层面是否开启 thinking

只有两者同时为 `true`,才会在 API 请求中加入 `thinking` 参数。

---

## 2. 架构设计

### 2.1 数据流

```
用户发起请求
    ↓
检查用户配置 (hasThinking)
    ↓
检查模型能力 (modelCanThink)
    ↓
选择 thinking 类型 (adaptive / budget / disabled)
    ↓
构造 API 请求参数
    ↓
发送到 Anthropic API
    ↓
解析响应中的 thinking block
    ↓
渲染到前端 UI
```

### 2.2 模块划分

建议在 Node.js 后端创建以下模块:

```
src/
  utils/
    thinking.ts           # 思考模式判断逻辑
    model/
      providers.ts        # Provider 判断 (firstParty/bedrock/vertex)
      modelStrings.ts     # 模型名归一化
      modelCapabilities.ts # 模型能力覆盖配置
  services/
    api/
      claude.ts           # API 请求构造与发送
```

---

## 3. 核心实现

### 3.1 判断模型是否支持思考

**文件**: `src/utils/thinking.ts`

```typescript
/**
 * 判断模型是否支持 thinking
 */
export function modelSupportsThinking(model: string): boolean {
  // 1. 检查第三方模型能力覆盖 (通过环境变量配置)
  const supported3P = get3PModelCapabilityOverride(model, 'thinking')
  if (supported3P !== undefined) {
    return supported3P
  }

  // 2. 获取模型的标准化名称和 provider 类型
  const canonical = getCanonicalName(model)
  const provider = getAPIProvider()

  // 3. 第一方 Anthropic 或 Foundry: 所有 Claude 4+ 模型支持
  if (
    provider === 'foundry' ||
    (provider === 'firstParty' && isFirstPartyAnthropicBaseUrl())
  ) {
    return !canonical.includes('claude-3-')  // 排除 Claude 3.x
  }

  // 4. MiniMax 端点
  if (isMiniMaxAnthropicEndpoint() && canonical.includes('minimax')) {
    return true
  }

  // 5. 其他第三方 (Bedrock/Vertex): 只有 Opus 4+ 和 Sonnet 4+
  return canonical.includes('sonnet-4') || canonical.includes('opus-4')
}

/**
 * 判断模型是否支持自适应思考 (adaptive thinking)
 */
export function modelSupportsAdaptiveThinking(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'adaptive_thinking')
  if (supported3P !== undefined) {
    return supported3P
  }

  const canonical = getCanonicalName(model)
  const provider = getAPIProvider()

  // 只有第一方和 Foundry 支持
  const isFirstPartyBaseUrl =
    provider === 'firstParty' && isFirstPartyAnthropicBaseUrl()

  if (!isFirstPartyBaseUrl && provider !== 'foundry') {
    return false
  }

  // 白名单: Opus 4.6+ 和 Sonnet 4.6+
  if (canonical.includes('opus-4-6') || canonical.includes('sonnet-4-6')) {
    return true
  }

  // 排除已知旧模型
  if (
    canonical.includes('opus') ||
    canonical.includes('sonnet') ||
    canonical.includes('haiku')
  ) {
    return false
  }

  // 默认: 第一方未知模型视为支持
  return provider === 'firstParty' || provider === 'foundry'
}

/**
 * 用户配置层面是否默认开启思考
 */
export function shouldEnableThinkingByDefault(): boolean {
  // 1. 环境变量强制指定
  if (process.env.MAX_THINKING_TOKENS) {
    return parseInt(process.env.MAX_THINKING_TOKENS, 10) > 0
  }

  // 2. 用户设置显式禁用
  const settings = getSettings()
  if (settings.alwaysThinkingEnabled === false) {
    return false
  }

  // 3. 默认开启
  return true
}
```

### 3.2 第三方模型能力覆盖

**文件**: `src/utils/model/modelCapabilities.ts`

```typescript
/**
 * 检查第三方模型的能力覆盖配置
 * 用于让非 Claude 模型也能启用 thinking
 */
export function get3PModelCapabilityOverride(
  model: string,
  capability: 'thinking' | 'adaptive_thinking'
): boolean | undefined {
  const provider = getAPIProvider()
  if (provider === 'firstParty' && isFirstPartyAnthropicBaseUrl()) {
    return undefined  // 第一方模型不需要覆盖
  }

  const m = model.toLowerCase()

  // 检查 ANTHROPIC_DEFAULT_OPUS_MODEL 等环境变量
  const tiers = [
    {
      modelEnvVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
      capabilitiesEnvVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
    },
    {
      modelEnvVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
      capabilitiesEnvVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
    },
    {
      modelEnvVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      capabilitiesEnvVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
    },
  ]

  for (const tier of tiers) {
    const pinned = process.env[tier.modelEnvVar]
    const capabilities = process.env[tier.capabilitiesEnvVar]

    if (!pinned || !capabilities) continue
    if (m !== pinned.toLowerCase()) continue

    // 解析能力列表: "thinking,adaptive_thinking"
    const caps = capabilities
      .toLowerCase()
      .split(',')
      .map(s => s.trim())

    return caps.includes(capability)
  }

  return undefined
}
```

### 3.3 Provider 判断

**文件**: `src/utils/model/providers.ts`

```typescript
export type APIProvider = 
  | 'firstParty'   // Anthropic 官方 API
  | 'bedrock'      // AWS Bedrock
  | 'vertex'       // Google Vertex AI
  | 'foundry'      // Anthropic Foundry
  | 'azureOpenAI'  // Azure OpenAI

export function getAPIProvider(): APIProvider {
  if (process.env.CLAUDE_CODE_USE_BEDROCK === 'true') return 'bedrock'
  if (process.env.CLAUDE_CODE_USE_VERTEX === 'true') return 'vertex'
  if (process.env.CLAUDE_CODE_USE_FOUNDRY === 'true') return 'foundry'
  if (process.env.CLAUDE_CODE_USE_AZURE_OPENAI === 'true') return 'azureOpenAI'
  return 'firstParty'
}

export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) return true  // 未设置默认是第一方

  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com', 'api-staging.anthropic.com']
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}

function isMiniMaxAnthropicEndpoint(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL?.toLowerCase() ?? ''
  return baseUrl.includes('minimax') || baseUrl.includes('minimaxi')
}
```

### 3.4 模型名归一化

**文件**: `src/utils/model/modelStrings.ts`

```typescript
/**
 * 将各种格式的模型名转为标准格式
 * 例如: 
 *   - "claude-opus-4-20250514" → "claude-opus-4"
 *   - "anthropic.claude-opus-4-v1:0" (Bedrock) → "claude-opus-4"
 */
export function getCanonicalName(fullModelName: string): string {
  let normalized = fullModelName.toLowerCase()

  // 移除 Bedrock ARN 前缀
  if (normalized.includes('anthropic.claude')) {
    normalized = normalized.replace(/^.*anthropic\.claude-/, 'claude-')
    normalized = normalized.replace(/:[0-9]+$/, '')  // 移除版本号
  }

  // 移除日期后缀: claude-opus-4-20250514 → claude-opus-4
  normalized = normalized.replace(/-\d{8}$/, '')

  // 移除 v1/v2 后缀
  normalized = normalized.replace(/-v\d+$/, '')

  return normalized
}
```

### 3.5 计算 Thinking Budget

**文件**: `src/utils/context.ts`

```typescript
/**
 * 获取模型的最大输出 token 限制
 */
export function getModelMaxOutputTokens(model: string): {
  default: number
  upperLimit: number
} {
  const canonical = getCanonicalName(model)

  let defaultTokens: number
  let upperLimit: number

  // 按模型系列分配
  if (canonical.includes('opus-4-6')) {
    defaultTokens = 64_000
    upperLimit = 128_000
  } else if (canonical.includes('sonnet-4-6')) {
    defaultTokens = 32_000
    upperLimit = 128_000
  } else if (
    canonical.includes('opus-4-5') ||
    canonical.includes('sonnet-4') ||
    canonical.includes('haiku-4')
  ) {
    defaultTokens = 32_000
    upperLimit = 64_000
  } else if (canonical.includes('opus-4')) {
    defaultTokens = 32_000
    upperLimit = 32_000
  } else if (canonical.includes('claude-3-opus')) {
    defaultTokens = 4_096
    upperLimit = 4_096
  } else if (canonical.includes('claude-3-sonnet')) {
    defaultTokens = 8_192
    upperLimit = 8_192
  } else if (canonical.includes('claude-3-haiku')) {
    defaultTokens = 4_096
    upperLimit = 4_096
  } else {
    // 未知模型默认值
    defaultTokens = 32_000
    upperLimit = 64_000
  }

  return { default: defaultTokens, upperLimit }
}

/**
 * 获取模型的最大 thinking token budget
 * 必须小于 maxOutputTokens
 */
export function getMaxThinkingTokensForModel(model: string): number {
  return getModelMaxOutputTokens(model).upperLimit - 1
}
```

### 3.6 构造 API 请求参数

**文件**: `src/services/api/claude.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk'

type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }

/**
 * 构造 Anthropic API 请求参数
 */
export async function createMessageRequest(
  messages: Anthropic.MessageParam[],
  model: string,
  thinkingConfig: ThinkingConfig
): Promise<Anthropic.MessageCreateParams> {
  // 1. 判断是否应该加思考参数
  const hasThinking =
    thinkingConfig.type !== 'disabled' &&
    process.env.CLAUDE_CODE_DISABLE_THINKING !== 'true'

  const modelCanThink = modelSupportsThinking(model)

  // 2. 构造 thinking 参数
  let thinking: Anthropic.MessageCreateParams['thinking'] | undefined

  if (hasThinking && modelCanThink) {
    // 2.1 优先使用 adaptive thinking (如果模型支持)
    if (
      process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING !== 'true' &&
      modelSupportsAdaptiveThinking(model)
    ) {
      thinking = {
        type: 'adaptive',
      }
    } else {
      // 2.2 使用 budget thinking
      let thinkingBudget = getMaxThinkingTokensForModel(model)

      // 用户可以显式指定 budget
      if (
        thinkingConfig.type === 'enabled' &&
        thinkingConfig.budgetTokens !== undefined
      ) {
        thinkingBudget = thinkingConfig.budgetTokens
      }

      // budget 必须小于 maxOutputTokens
      const maxOutputTokens = getModelMaxOutputTokens(model).upperLimit
      thinkingBudget = Math.min(maxOutputTokens - 1, thinkingBudget)

      thinking = {
        type: 'enabled',
        budget_tokens: thinkingBudget,
      }
    }
  } else if (!hasThinking && modelCanThink) {
    // 2.3 显式禁用 (部分场景需要告知模型)
    thinking = {
      type: 'disabled',
    }
  }

  // 3. 构造完整请求
  return {
    model,
    messages,
    max_tokens: getModelMaxOutputTokens(model).default,
    thinking,  // 关键参数
    // ... 其他参数
  }
}
```

---

## 4. 环境变量配置

### 4.1 Provider 选择

```bash
# 使用 Anthropic 第一方 API (默认)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://api.anthropic.com  # 可选,默认就是这个

# 使用 AWS Bedrock
CLAUDE_CODE_USE_BEDROCK=true
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# 使用 Google Vertex AI
CLAUDE_CODE_USE_VERTEX=true
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# 使用 Foundry
CLAUDE_CODE_USE_FOUNDRY=true
ANTHROPIC_BASE_URL=https://your-foundry-endpoint.com
```

### 4.2 思考模式控制

```bash
# 全局禁用思考
CLAUDE_CODE_DISABLE_THINKING=true

# 全局禁用自适应思考 (降级到 budget thinking)
CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=true

# 强制指定 thinking budget (覆盖默认值)
MAX_THINKING_TOKENS=16000

# 显式发送 disabled thinking (用于某些测试场景)
CC_EVANCOD_SEND_DISABLED_THINKING=true
```

### 4.3 第三方模型能力覆盖

**让非 Claude 模型支持思考的关键配置**:

```bash
# 例如: 让 GPT-4 支持思考 (假设你的代理服务支持)
ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-4
ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES=thinking,adaptive_thinking

# 例如: 让 DeepSeek 支持 budget thinking
ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-chat
ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES=thinking
```

---

## 5. 前端 UI 渲染

### 5.1 解析响应中的 thinking block

Anthropic API 的响应中,`thinking` 内容是独立的 content block:

```json
{
  "id": "msg_01...",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "让我先分析这个问题...\n\n1. 首先需要...\n2. 然后...",
      "signature": "..."
    },
    {
      "type": "text",
      "text": "根据分析,我认为..."
    }
  ]
}
```

### 5.2 数据结构定义

```typescript
// types/message.ts
export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
  signature?: string
}

export interface TextBlock {
  type: 'text'
  text: string
}

export type ContentBlock = ThinkingBlock | TextBlock

export interface UIMessage {
  id: string
  type: 'thinking' | 'assistant_text' | 'user_text' | 'tool_use' | 'tool_result' | ...
  content: string
  timestamp: number
}

// 用于 Store 管理
export interface ChatSession {
  messages: UIMessage[]
  chatState: 'idle' | 'thinking' | 'tool_executing' | 'compacting'
  activeThinkingId: string | null  // 当前正在流式输出的 thinking block ID
  streamingResponseChars: number   // 用于估算输出 token 数
  elapsedSeconds: number
}
```

### 5.3 React ThinkingBlock 组件 (参考实现)

项目中的实际实现使用 React,这是完整的生产级组件:

```tsx
// components/chat/ThinkingBlock.tsx
import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from '../../i18n'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'

export function ThinkingBlock({ 
  content, 
  isActive = false 
}: { 
  content: string
  isActive?: boolean  // 是否正在流式输出
}) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  
  // 清理内容格式
  const displayContent = useMemo(
    () => content.replace(/\r\n?/g, '\n').trimEnd(),
    [content]
  )
  const hasDisplayContent = displayContent.trim().length > 0

  // 流式输出时自动滚动到底部
  useEffect(() => {
    if (expanded && isActive && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [displayContent, expanded, isActive])

  return (
    <div className="mb-1">
      <style>{thinkingStyles}</style>
      
      {/* 可折叠的标题 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]"
      >
        {/* 折叠箭头 */}
        <span className="text-[10px] text-[var(--color-outline)]">
          {expanded ? '\u25BE' : '\u25B8'}
        </span>
        
        {/* 标题文本 + 动画点 */}
        <span className="shrink-0 font-medium italic">
          {isActive ? t('thinking.label') : t('thinking.labelDone')}
          {isActive && <span className="thinking-dots" />}
        </span>
      </button>

      {/* 展开的内容区域 */}
      {expanded && hasDisplayContent && (
        <div
          ref={contentRef}
          data-thinking-content="expanded"
          className="relative mt-1 max-h-[300px] overflow-y-auto rounded-lg border border-[var(--color-border)]/40 bg-[var(--color-surface-container-lowest)] p-2.5 text-[11px] text-[var(--color-text-secondary)]"
        >
          {/* 使用 Markdown 渲染器 */}
          <MarkdownRenderer
            content={displayContent}
            variant="compact"
            cache={!isActive}
            streaming={isActive}
            className="thinking-markdown text-[var(--color-text-secondary)]"
          />
          
          {/* 流式输出时的光标动画 */}
          {isActive && <span className="thinking-cursor" />}
        </div>
      )}
    </div>
  )
}

// 动画样式
const thinkingStyles = `
@keyframes thinking-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@keyframes thinking-dots {
  0%, 20% { content: ''; }
  40% { content: '.'; }
  60% { content: '..'; }
  80%, 100% { content: '...'; }
}

.thinking-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--color-text-tertiary);
  vertical-align: middle;
  margin-left: 1px;
  animation: thinking-cursor-blink 1s step-end infinite;
}

.thinking-dots::after {
  content: '';
  animation: thinking-dots 1.4s steps(1, end) infinite;
}

.thinking-markdown > :first-child,
.thinking-markdown > :first-child > :first-child {
  margin-top: 0;
}

.thinking-markdown > :last-child,
.thinking-markdown > :last-child > :last-child {
  margin-bottom: 0;
}
`
```

### 5.4 Vue3 完整实现版本

将上述 React 组件转换为 Vue3:

```vue
<template>
  <div class="mb-1">
    <!-- 可折叠标题 -->
    <button
      type="button"
      class="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs text-gray-500 transition-colors hover:text-gray-700"
      @click="expanded = !expanded"
      :aria-expanded="expanded"
    >
      <!-- 折叠箭头 -->
      <span class="text-[10px] text-gray-400">
        {{ expanded ? '▾' : '▸' }}
      </span>
      
      <!-- 标题 + 动画点 -->
      <span class="shrink-0 font-medium italic">
        {{ isActive ? t('thinking.label') : t('thinking.labelDone') }}
        <span v-if="isActive" class="thinking-dots"></span>
      </span>
    </button>

    <!-- 展开的内容 -->
    <div
      v-if="expanded && hasContent"
      ref="contentRef"
      class="relative mt-1 max-h-[300px] overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-xs text-gray-700"
    >
      <!-- 使用 v-html 或 Markdown 组件渲染 -->
      <div 
        v-html="renderedContent" 
        class="thinking-markdown"
      ></div>
      
      <!-- 流式输出光标 -->
      <span v-if="isActive" class="thinking-cursor"></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'  // 或你的 i18n 方案
import { marked } from 'marked'      // 或使用 markdown-it

const props = defineProps<{
  content: string
  isActive?: boolean
}>()

const { t } = useI18n()
const expanded = ref(false)
const contentRef = ref<HTMLDivElement | null>(null)

// 清理内容
const displayContent = computed(() => 
  props.content.replace(/\r\n?/g, '\n').trimEnd()
)

const hasContent = computed(() => 
  displayContent.value.trim().length > 0
)

// 渲染 Markdown
const renderedContent = computed(() => {
  try {
    return marked.parse(displayContent.value)
  } catch {
    return displayContent.value
  }
})

// 流式输出时自动滚动
watch([displayContent, expanded, () => props.isActive], async () => {
  if (expanded.value && props.isActive && contentRef.value) {
    await nextTick()
    contentRef.value.scrollTop = contentRef.value.scrollHeight
  }
})
</script>

<style scoped>
@keyframes thinking-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@keyframes thinking-dots {
  0%, 20% { content: ''; }
  40% { content: '.'; }
  60% { content: '..'; }
  80%, 100% { content: '...'; }
}

.thinking-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: #9ca3af;
  vertical-align: middle;
  margin-left: 1px;
  animation: thinking-cursor-blink 1s step-end infinite;
}

.thinking-dots::after {
  content: '';
  animation: thinking-dots 1.4s steps(1, end) infinite;
}

.thinking-markdown :deep(> :first-child) {
  margin-top: 0;
}

.thinking-markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.thinking-markdown :deep(pre) {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 8px;
  overflow-x: auto;
}

.thinking-markdown :deep(code) {
  font-family: 'SF Mono', Monaco, 'Courier New', monospace;
  font-size: 11px;
}
</style>
```

### 5.5 消息列表中的渲染逻辑

```typescript
// stores/chatStore.ts (Pinia/Vuex)
import { defineStore } from 'pinia'

export const useChatStore = defineStore('chat', {
  state: () => ({
    sessions: {} as Record<string, ChatSession>,
  }),

  actions: {
    // 处理 WebSocket 消息
    handleWSMessage(sessionId: string, msg: any) {
      const session = this.sessions[sessionId]
      if (!session) return

      switch (msg.type) {
        case 'thinking': {
          // 1. 查找是否已有 thinking block
          const messages = [...session.messages]
          const lastMsg = messages[messages.length - 1]

          if (lastMsg && lastMsg.type === 'thinking') {
            // 追加内容到现有 thinking block
            messages[messages.length - 1] = {
              ...lastMsg,
              content: lastMsg.content + msg.text,
            }
            session.activeThinkingId = lastMsg.id
          } else {
            // 创建新的 thinking block
            const newId = generateId()
            messages.push({
              id: newId,
              type: 'thinking',
              content: msg.text,
              timestamp: Date.now(),
            })
            session.activeThinkingId = newId
          }

          session.messages = messages
          session.chatState = 'thinking'
          session.streamingResponseChars += msg.text.length
          break
        }

        case 'content_delta': {
          // 处理普通文本增量
          if (msg.text) {
            session.streamingText += msg.text
            session.streamingResponseChars += msg.text.length
          }
          break
        }

        case 'message_start': {
          // 开始新回合
          session.chatState = 'thinking'
          session.activeThinkingId = null
          session.streamingText = ''
          session.streamingResponseChars = 0
          break
        }

        case 'message_stop': {
          // 完成回合
          session.chatState = 'idle'
          session.activeThinkingId = null
          break
        }
      }
    },
  },
})
```

### 5.6 MessageList 渲染逻辑

```vue
<template>
  <div class="message-list">
    <!-- 遍历消息 -->
    <template v-for="msg in messages" :key="msg.id">
      <!-- User Message -->
      <UserMessage 
        v-if="msg.type === 'user_text'"
        :content="msg.content"
      />

      <!-- Thinking Block -->
      <ThinkingBlock
        v-else-if="msg.type === 'thinking'"
        :content="msg.content"
        :isActive="msg.id === activeThinkingId"
      />

      <!-- Assistant Text -->
      <AssistantMessage
        v-else-if="msg.type === 'assistant_text'"
        :content="msg.content"
        :isStreaming="isLastMessage(msg) && chatState === 'responding'"
      />

      <!-- Tool Calls, Results, etc. -->
      <ToolCallBlock
        v-else-if="msg.type === 'tool_use'"
        :toolName="msg.toolName"
        :input="msg.input"
      />
    </template>

    <!-- 流式指示器 -->
    <StreamingIndicator
      v-if="chatState === 'thinking' && !activeThinkingId"
      :verb="t('thinking.label')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useChatStore } from '@/stores/chatStore'
import ThinkingBlock from './ThinkingBlock.vue'
import AssistantMessage from './AssistantMessage.vue'
import UserMessage from './UserMessage.vue'
import ToolCallBlock from './ToolCallBlock.vue'
import StreamingIndicator from './StreamingIndicator.vue'

const props = defineProps<{
  sessionId: string
}>()

const chatStore = useChatStore()

const messages = computed(() => 
  chatStore.sessions[props.sessionId]?.messages || []
)

const chatState = computed(() => 
  chatStore.sessions[props.sessionId]?.chatState || 'idle'
)

const activeThinkingId = computed(() => 
  chatStore.sessions[props.sessionId]?.activeThinkingId
)

function isLastMessage(msg: any) {
  return messages.value[messages.value.length - 1]?.id === msg.id
}
</script>
```

### 5.7 StreamingIndicator 组件

```vue
<template>
  <div class="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 w-fit mb-2">
    <!-- 闪烁的装饰符号 -->
    <span class="text-blue-500 animate-pulse text-xs">✦</span>
    
    <!-- 状态文本 -->
    <span class="text-xs font-medium text-gray-600">
      {{ verb }}...
    </span>
    
    <!-- 已用时间 -->
    <span v-if="elapsedSeconds > 0" class="text-[10px] text-gray-400">
      {{ formatElapsed(elapsedSeconds) }}
    </span>
    
    <!-- 输出 token 估算 -->
    <span v-if="streamingTokens > 0" class="text-[10px] text-gray-400">
      · ↓ {{ formatTokenCount(streamingTokens) }} tokens
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useChatStore } from '@/stores/chatStore'

const props = defineProps<{
  sessionId: string
  verb: string
}>()

const chatStore = useChatStore()

const session = computed(() => chatStore.sessions[props.sessionId])

const elapsedSeconds = computed(() => session.value?.elapsedSeconds || 0)

// chars ÷ 4 估算 tokens (粗略)
const streamingTokens = computed(() => 
  Math.round((session.value?.streamingResponseChars || 0) / 4)
)

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function formatTokenCount(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
}
</script>

<style scoped>
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>
```

### 5.8 流式处理与 WebSocket 集成

#### 5.8.1 Anthropic SDK 流式调用

```typescript
// services/api/claude.ts
import Anthropic from '@anthropic-ai/sdk'

export async function streamChatCompletion(
  messages: Anthropic.MessageParam[],
  model: string,
  thinkingConfig: ThinkingConfig,
  onChunk: (chunk: StreamChunk) => void
) {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const params = await createMessageRequest(messages, model, thinkingConfig)

  const stream = await anthropic.messages.create({
    ...params,
    stream: true,  // 关键:启用流式
  })

  for await (const event of stream) {
    switch (event.type) {
      case 'message_start':
        onChunk({ type: 'message_start', data: event.message })
        break

      case 'content_block_start':
        // thinking block 或 text block 开始
        if (event.content_block.type === 'thinking') {
          onChunk({
            type: 'thinking_start',
            index: event.index,
          })
        } else if (event.content_block.type === 'text') {
          onChunk({
            type: 'text_start',
            index: event.index,
          })
        }
        break

      case 'content_block_delta':
        // 增量内容
        if (event.delta.type === 'thinking_delta') {
          onChunk({
            type: 'thinking',
            text: event.delta.thinking,
            index: event.index,
          })
        } else if (event.delta.type === 'text_delta') {
          onChunk({
            type: 'content_delta',
            text: event.delta.text,
            index: event.index,
          })
        }
        break

      case 'content_block_stop':
        onChunk({
          type: 'content_block_stop',
          index: event.index,
        })
        break

      case 'message_delta':
        // 使用情况更新
        if (event.usage) {
          onChunk({
            type: 'usage',
            usage: event.usage,
          })
        }
        break

      case 'message_stop':
        onChunk({ type: 'message_stop' })
        break

      case 'error':
        onChunk({ type: 'error', error: event.error })
        break
    }
  }
}

type StreamChunk =
  | { type: 'message_start'; data: any }
  | { type: 'thinking_start'; index: number }
  | { type: 'text_start'; index: number }
  | { type: 'thinking'; text: string; index: number }
  | { type: 'content_delta'; text: string; index: number }
  | { type: 'content_block_stop'; index: number }
  | { type: 'usage'; usage: any }
  | { type: 'message_stop' }
  | { type: 'error'; error: any }
```

#### 5.8.2 Node.js 后端 WebSocket 服务

```typescript
// server/websocket.ts
import { WebSocketServer, WebSocket } from 'ws'
import { streamChatCompletion } from '../services/api/claude'

const wss = new WebSocketServer({ port: 8080 })

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected')

  ws.on('message', async (data: string) => {
    try {
      const request = JSON.parse(data)

      if (request.type === 'chat') {
        const { messages, model, sessionId } = request

        // 构造 thinking 配置
        const thinkingConfig: ThinkingConfig = 
          shouldEnableThinkingByDefault()
            ? { type: 'adaptive' }
            : { type: 'disabled' }

        // 流式调用
        await streamChatCompletion(
          messages,
          model,
          thinkingConfig,
          (chunk) => {
            // 转发给前端
            ws.send(JSON.stringify({
              sessionId,
              ...chunk,
            }))
          }
        )
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message,
      }))
    }
  })

  ws.on('close', () => {
    console.log('Client disconnected')
  })
})

console.log('WebSocket server started on ws://localhost:8080')
```

#### 5.8.3 前端 WebSocket 客户端

```typescript
// services/websocket.ts
import { useChatStore } from '@/stores/chatStore'

export class ChatWebSocket {
  private ws: WebSocket | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 5

  connect() {
    this.ws = new WebSocket('ws://localhost:8080')

    this.ws.onopen = () => {
      console.log('WebSocket connected')
      this.reconnectAttempts = 0
    }

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      this.handleMessage(data)
    }

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    this.ws.onclose = () => {
      console.log('WebSocket closed')
      this.scheduleReconnect()
    }
  }

  private handleMessage(msg: any) {
    const chatStore = useChatStore()
    const { sessionId } = msg

    if (!sessionId) return

    switch (msg.type) {
      case 'message_start':
        chatStore.handleMessageStart(sessionId)
        break

      case 'thinking':
        chatStore.handleThinkingDelta(sessionId, msg.text)
        break

      case 'content_delta':
        chatStore.handleContentDelta(sessionId, msg.text)
        break

      case 'message_stop':
        chatStore.handleMessageStop(sessionId)
        break

      case 'error':
        chatStore.handleError(sessionId, msg.error)
        break
    }
  }

  sendMessage(sessionId: string, messages: any[], model: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected')
      return
    }

    this.ws.send(JSON.stringify({
      type: 'chat',
      sessionId,
      messages,
      model,
    }))
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached')
      return
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000)
    this.reconnectAttempts++

    this.reconnectTimer = window.setTimeout(() => {
      console.log(`Reconnecting (attempt ${this.reconnectAttempts})...`)
      this.connect()
    }, delay)
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

// 单例
export const chatWebSocket = new ChatWebSocket()
```

#### 5.8.4 Store 中的流式处理逻辑

```typescript
// stores/chatStore.ts
import { defineStore } from 'pinia'

export const useChatStore = defineStore('chat', {
  state: () => ({
    sessions: {} as Record<string, ChatSession>,
  }),

  actions: {
    handleMessageStart(sessionId: string) {
      const session = this.sessions[sessionId]
      if (!session) return

      session.chatState = 'thinking'
      session.activeThinkingId = null
      session.streamingText = ''
      session.streamingResponseChars = 0
      session.elapsedSeconds = 0

      // 启动计时器
      if (session.elapsedTimer) {
        clearInterval(session.elapsedTimer)
      }
      session.elapsedTimer = setInterval(() => {
        session.elapsedSeconds++
      }, 1000)
    },

    handleThinkingDelta(sessionId: string, text: string) {
      const session = this.sessions[sessionId]
      if (!session) return

      const messages = [...session.messages]
      const lastMsg = messages[messages.length - 1]

      if (lastMsg && lastMsg.type === 'thinking') {
        // 追加到现有 thinking block
        messages[messages.length - 1] = {
          ...lastMsg,
          content: lastMsg.content + text,
        }
        session.activeThinkingId = lastMsg.id
      } else {
        // 创建新 thinking block
        const newId = this.generateId()
        messages.push({
          id: newId,
          type: 'thinking',
          content: text,
          timestamp: Date.now(),
        })
        session.activeThinkingId = newId
      }

      session.messages = messages
      session.chatState = 'thinking'
      session.streamingResponseChars += text.length
    },

    handleContentDelta(sessionId: string, text: string) {
      const session = this.sessions[sessionId]
      if (!session) return

      // 累积文本增量
      session.streamingText += text
      session.streamingResponseChars += text.length
      session.chatState = 'responding'

      // 可选:实时显示(debounce 优化)
      this.flushStreamingText(sessionId)
    },

    flushStreamingText(sessionId: string) {
      const session = this.sessions[sessionId]
      if (!session || !session.streamingText.trim()) return

      const messages = [...session.messages]
      const lastMsg = messages[messages.length - 1]

      if (lastMsg && lastMsg.type === 'assistant_text') {
        // 追加到现有文本
        messages[messages.length - 1] = {
          ...lastMsg,
          content: lastMsg.content + session.streamingText,
        }
      } else {
        // 创建新消息
        messages.push({
          id: this.generateId(),
          type: 'assistant_text',
          content: session.streamingText,
          timestamp: Date.now(),
        })
      }

      session.messages = messages
      session.streamingText = ''
    },

    handleMessageStop(sessionId: string) {
      const session = this.sessions[sessionId]
      if (!session) return

      // 刷新剩余文本
      this.flushStreamingText(sessionId)

      session.chatState = 'idle'
      session.activeThinkingId = null
      session.streamingText = ''

      // 停止计时器
      if (session.elapsedTimer) {
        clearInterval(session.elapsedTimer)
        session.elapsedTimer = null
      }
    },

    handleError(sessionId: string, error: string) {
      const session = this.sessions[sessionId]
      if (!session) return

      session.messages.push({
        id: this.generateId(),
        type: 'error',
        content: error,
        timestamp: Date.now(),
      })

      session.chatState = 'idle'
      session.activeThinkingId = null
    },

    generateId(): string {
      return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    },
  },
})
```

#### 5.8.5 Vue 组件中使用

```vue
<!-- ChatPanel.vue -->
<template>
  <div class="chat-panel">
    <MessageList :sessionId="sessionId" />
    <ChatInput @send="handleSend" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useChatStore } from '@/stores/chatStore'
import { chatWebSocket } from '@/services/websocket'
import MessageList from './MessageList.vue'
import ChatInput from './ChatInput.vue'

const props = defineProps<{
  sessionId: string
}>()

const chatStore = useChatStore()

onMounted(() => {
  // 连接 WebSocket
  chatWebSocket.connect()
})

onUnmounted(() => {
  // 断开连接
  chatWebSocket.disconnect()
})

function handleSend(text: string) {
  const session = chatStore.sessions[props.sessionId]
  if (!session) return

  // 添加用户消息
  chatStore.addUserMessage(props.sessionId, text)

  // 构造历史消息
  const messages = session.messages
    .filter(m => m.type === 'user_text' || m.type === 'assistant_text')
    .map(m => ({
      role: m.type === 'user_text' ? 'user' : 'assistant',
      content: m.content,
    }))

  // 发送到后端
  chatWebSocket.sendMessage(
    props.sessionId,
    messages,
    session.model || 'claude-opus-4-20250514'
  )
}
</script>
```

### 5.9 VSCode 扩展中的实现

如果你的项目是 VSCode 扩展,可以使用 Webview 来渲染 thinking:

```typescript
// extension.ts
import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context.extensionUri)

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'evancod.chatView',
      provider
    )
  )
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
    }

    webviewView.webview.html = this.getHtmlContent(webviewView.webview)

    // 监听来自 Webview 的消息
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'sendMessage') {
        await this.handleChat(webviewView.webview, message.text)
      }
    })
  }

  private async handleChat(webview: vscode.Webview, userMessage: string) {
    // 调用 Anthropic API
    const stream = await this.streamChatCompletion(userMessage)

    for await (const chunk of stream) {
      // 发送到 Webview
      webview.postMessage(chunk)
    }
  }

  private getHtmlContent(webview: vscode.Webview): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          /* 复用上面的 ThinkingBlock 样式 */
        </style>
      </head>
      <body>
        <div id="app"></div>
        <script>
          const vscode = acquireVsCodeApi()
          
          // 监听后端消息
          window.addEventListener('message', (event) => {
            const msg = event.data
            
            if (msg.type === 'thinking') {
              appendThinking(msg.text)
            } else if (msg.type === 'content_delta') {
              appendText(msg.text)
            }
          })
          
          function appendThinking(text) {
            // 渲染 thinking block
          }
          
          function appendText(text) {
            // 渲染普通文本
          }
        </script>
      </body>
      </html>
    `
  }
}
```

---

## 6. 实现步骤

### 6.1 后端实现 (Node.js)

1. **安装依赖**
   ```bash
   npm install @anthropic-ai/sdk
   ```

2. **创建工具函数**
   - `src/utils/thinking.ts` - 判断逻辑
   - `src/utils/model/providers.ts` - Provider 检测
   - `src/utils/model/modelStrings.ts` - 模型名归一化
   - `src/utils/context.ts` - Budget 计算

3. **修改 API 调用**
   - 在 `src/services/api/claude.ts` 中集成 thinking 参数构造
   - 根据 `thinkingConfig` 动态添加 `thinking` 字段

4. **配置环境变量**
   - 创建 `.env` 文件
   - 根据使用场景配置 Provider 和能力覆盖

### 6.2 前端实现 (Vue3)

1. **更新类型定义**
   ```typescript
   // types/message.ts
   export interface ThinkingBlock {
     type: 'thinking'
     thinking: string
     signature?: string
   }

   export interface TextBlock {
     type: 'text'
     text: string
   }

   export type ContentBlock = ThinkingBlock | TextBlock

   export interface Message {
     role: 'assistant' | 'user'
     content: ContentBlock[]
   }
   ```

2. **创建 Thinking 组件**
   - `src/components/ThinkingBlock.vue` - 可折叠的思考块
   - 支持展开/收起
   - 支持语法高亮(可选)

3. **修改消息渲染逻辑**
   - 解析 `content` 数组
   - 按 block 类型分别渲染
   - Thinking block 在前,Text block 在后

### 6.3 测试验证

1. **测试 Claude 4 模型**
   ```bash
   # .env
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_DEFAULT_MODEL=claude-opus-4-20250514
   ```
   
   预期: 返回 adaptive thinking

2. **测试 Claude 3 模型**
   ```bash
   ANTHROPIC_DEFAULT_MODEL=claude-3-opus-20240229
   ```
   
   预期: 不返回 thinking block

3. **测试第三方模型(需代理)**
   ```bash
   ANTHROPIC_BASE_URL=https://your-proxy.com
   ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-4
   ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES=thinking
   ```
   
   预期: 如果代理支持,返回 thinking

---

## 7. 常见问题

### Q1: 为什么我的第三方模型没有思考?

**A**: 第三方模型默认不在白名单中。需要配置环境变量:

```bash
ANTHROPIC_DEFAULT_SONNET_MODEL=your-model-name
ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES=thinking
```

注意: 
- `your-model-name` 必须与请求时的 model 参数**完全一致**(大小写敏感)
- 你的 API 端点(或代理)必须真正支持 `thinking` 参数,否则会报错

### Q2: adaptive thinking 和 budget thinking 有什么区别?

**A**:
- **Adaptive thinking**: 模型自主决定思考深度,不设 token 上限。适用于 Claude 4.6+ 高级模型。
- **Budget thinking**: 指定固定的 token 预算(如 32k),适用于旧模型。

### Q3: 如何全局禁用思考?

**A**: 设置环境变量:
```bash
CLAUDE_CODE_DISABLE_THINKING=true
```

### Q4: thinking block 太长怎么办?

**A**: 前端可以:
- 默认折叠,点击展开
- 限制最大高度,超出滚动
- 提供「简洁模式」,只显示最后几行

### Q5: 在 VSCode 扩展中如何显示 thinking?

**A**: 
1. 使用 Webview 渲染(类似 Chat 面板)
2. 或在 Output Channel 中用不同颜色区分 thinking 和 response
3. 可参考 GitHub Copilot Chat 的实现

---

## 8. 性能优化建议

### 8.1 缓存判断结果

```typescript
// 使用 memoize 避免重复计算
import memoize from 'lodash-es/memoize'

export const modelSupportsThinking = memoize(_modelSupportsThinking)
export const modelSupportsAdaptiveThinking = memoize(_modelSupportsAdaptiveThinking)
```

### 8.2 延迟加载 thinking 内容

如果 thinking 很长,可以先只传输前 N 个 token,用户点击「查看完整思考」时再加载全部:

```typescript
// API 返回时截断
if (thinkingBlock.thinking.length > 1000) {
  thinkingBlock.thinkingPreview = thinkingBlock.thinking.slice(0, 1000)
  thinkingBlock.hasMore = true
}
```

### 8.3 流式渲染

Anthropic SDK 支持 streaming,可以实时渲染 thinking:

```typescript
const stream = await anthropic.messages.create({
  model: 'claude-opus-4-20250514',
  messages: [...],
  thinking: { type: 'adaptive' },
  stream: true,
})

for await (const event of stream) {
  if (event.type === 'content_block_delta') {
    if (event.delta.type === 'thinking_delta') {
      // 实时追加 thinking 内容
      appendThinking(event.delta.thinking)
    } else if (event.delta.type === 'text_delta') {
      appendText(event.delta.text)
    }
  }
}
```

---

## 9. 安全注意事项

1. **不要在前端暴露 API Key**
   - 所有 Anthropic API 调用必须在 Node.js 后端进行
   - 前端通过你的后端 API 间接调用

2. **验证环境变量**
   - 在启动时检查必需的环境变量
   - 对 `ANTHROPIC_BASE_URL` 进行 URL 格式验证

3. **限制 thinking budget**
   - 避免用户设置过大的 budget 导致成本失控
   - 建议上限 128k tokens

4. **内容过滤**
   - thinking 内容可能包含敏感推理过程
   - 根据业务需求决定是否需要脱敏

---

## 10. 参考资源

- [Anthropic API 文档 - Thinking](https://docs.anthropic.com/en/docs/build-with-claude/thinking)
- [Claude Code 源码分析](https://github.com/example/cc-desktop-main)
- [Anthropic SDK (TypeScript)](https://github.com/anthropics/anthropic-sdk-typescript)

---

## 附录: 完整配置示例

### A.1 .env 文件

```bash
# Provider 配置
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
ANTHROPIC_BASE_URL=https://api.anthropic.com

# 思考模式开关
CLAUDE_CODE_DISABLE_THINKING=false
CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=false

# 第三方模型能力覆盖 (如果需要)
# ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-4
# ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES=thinking

# 其他配置
MAX_THINKING_TOKENS=
```

### A.2 package.json 依赖

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.29.0",
    "vue": "^3.4.0",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

### A.3 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

---

**文档版本**: v1.0  
**最后更新**: 2026-07-04  
**适用范围**: Vue3 + Node.js + TypeScript 项目
