# 对话区组件实现规格（Vue3 + SCSS 版）

本文是 `chat-ui-style-guide.md` 和 `ui-clone/02-ui-design-spec.md` 的落地补充，目标是让另一个 **Vue3 + SCSS** 项目可以按本文直接实现 Evancod / Claude Code Desktop 风格的 Agent 对话区。

本文只覆盖对话区，不覆盖侧边栏、标题栏、状态栏、设置页等应用外壳。

---

## 1. 实现目标

对话区不是普通 IM 聊天气泡，而是 Agent 工作流时间线。需要同时承载：

- 用户消息
- 助手 Markdown 消息
- thinking 折叠块
- tool call 工具卡
- tool result 输出
- Bash 终端壳
- CodeViewer
- DiffViewer
- PermissionDialog
- AskUserQuestion
- PlanModePreview
- task / memory / goal / background task 状态卡
- streaming indicator
- message action bar

视觉原则：

- 低饱和、低对比、暖色、中性色为主。
- 文本消息轻，工具和状态内容卡片化。
- 默认 compact，长内容才进入 document / detailed 视图。
- 所有状态通过小图标、badge、边框、标题条表达，不用大面积强色块。

---

## 2. 推荐组件拆分

Vue3 项目建议按下面拆分：

```text
components/chat/
  ChatMessageList.vue
  UserMessage.vue
  AssistantMessage.vue
  MessageActionBar.vue
  ThinkingBlock.vue
  ToolCallBlock.vue
  ToolCallGroup.vue
  ToolResultBlock.vue
  TerminalChrome.vue
  CodeViewer.vue
  DiffViewer.vue
  PermissionDialog.vue
  AskUserQuestionCard.vue
  PlanModePreview.vue
  StreamingIndicator.vue
  InlineTaskSummary.vue
  MemoryEventCard.vue
  GoalEventCard.vue
  BackgroundTaskCard.vue
```

最小可先实现：

1. `ChatMessageList.vue`
2. `UserMessage.vue`
3. `AssistantMessage.vue`
4. `ThinkingBlock.vue`
5. `ToolCallBlock.vue`
6. `TerminalChrome.vue`
7. `CodeViewer.vue`
8. `DiffViewer.vue`
9. `PermissionDialog.vue`
10. `AskUserQuestionCard.vue`
11. `PlanModePreview.vue`
12. `StreamingIndicator.vue`

---

## 3. SCSS token

建议在 Vue 项目中建立：

```text
src/styles/chat-tokens.scss
```

### 3.1 Light 主题

```scss
:root,
[data-theme='light'] {
  color-scheme: light;

  // Font
  --chat-font-body: Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
  --chat-font-mono: 'JetBrains Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace;

  // Brand
  --chat-color-primary: #8f482f;
  --chat-color-primary-container: #ad5f45;
  --chat-color-brand: var(--chat-color-primary);
  --chat-color-secondary: #2d628f;
  --chat-color-tertiary: #4f6237;

  // Surface
  --chat-color-background: #faf9f5;
  --chat-color-surface: #faf9f5;
  --chat-color-surface-bright: #faf9f5;
  --chat-color-surface-dim: #dbdad6;
  --chat-color-surface-container-lowest: #ffffff;
  --chat-color-surface-container-low: #f4f4f0;
  --chat-color-surface-container: #efeeea;
  --chat-color-surface-container-high: #e9e8e4;
  --chat-color-surface-container-highest: #e3e2df;
  --chat-color-surface-hover: var(--chat-color-surface-container-high);
  --chat-color-surface-selected: var(--chat-color-surface-container);
  --chat-color-surface-user-msg: var(--chat-color-surface-container);

  // Text
  --chat-color-text-primary: #1b1c1a;
  --chat-color-text-secondary: #54433e;
  --chat-color-text-tertiary: #87736d;
  --chat-color-text-accent: var(--chat-color-secondary);

  // Border / outline
  --chat-color-outline: #87736d;
  --chat-color-outline-variant: #dac1ba;
  --chat-color-border: var(--chat-color-outline-variant);

  // Semantic
  --chat-color-success: #16a34a;
  --chat-color-success-container: #e8f5e2;
  --chat-color-warning: #ca8a04;
  --chat-color-warning-container: #fff3d6;
  --chat-color-error: #ba1a1a;
  --chat-color-error-container: #ffdad6;
  --chat-color-info: #2d628f;
  --chat-color-info-container: #e4f1ff;

  // Code
  --chat-color-code-bg: #fdfcf9;
  --chat-color-code-fg: #24201e;
  --chat-color-code-comment: #5c6b7a;
  --chat-color-code-string: #437220;
  --chat-color-code-keyword: #b8533b;
  --chat-color-code-function: #1d5a8c;
  --chat-color-code-number: #1b7a6a;
  --chat-color-code-property: #7a3e20;
  --chat-color-code-type: #7e5520;
  --chat-color-code-parameter: #5c3d2e;
  --chat-color-code-punctuation: #5c504a;
  --chat-color-code-inserted: #1a7f37;
  --chat-color-code-deleted: #cf222e;

  // Diff
  --chat-color-diff-added-bg: #e8f5e2;
  --chat-color-diff-added-word: #b8e4a8;
  --chat-color-diff-added-gutter: #d4edca;
  --chat-color-diff-added-text: #1a7f37;
  --chat-color-diff-removed-bg: #fdecea;
  --chat-color-diff-removed-word: #f5b8b4;
  --chat-color-diff-removed-gutter: #f9d4d0;
  --chat-color-diff-removed-text: #cf222e;
  --chat-color-diff-highlight-bg: #fff5d6;
  --chat-color-diff-highlight-gutter: #ffecb3;
  --chat-color-diff-title-bg: #f4f4f0;
  --chat-color-diff-title-color: #87736d;
  --chat-color-diff-title-border: #dac1ba;

  // Terminal
  --chat-color-terminal-header: #2d2d2d;
  --chat-color-terminal-bg: #1e1e1e;
  --chat-color-terminal-border: #1a1a1a;
  --chat-color-terminal-fg: #d4d4d4;
  --chat-color-terminal-muted: #999999;
  --chat-color-terminal-accent: #28c840;
  --chat-color-terminal-danger: #ff5f57;
  --chat-color-terminal-warning: #febc2e;

  // Memory / Goal
  --chat-color-memory-accent: #3b7068;
  --chat-color-memory-surface: #f6faf8;
  --chat-color-memory-border: #bccdc8;
  --chat-color-memory-icon-bg: #f3f8f7;

  // Radius
  --chat-radius-xs: 4px;
  --chat-radius-sm: 6px;
  --chat-radius-md: 8px;
  --chat-radius-lg: 12px;
  --chat-radius-xl: 16px;
  --chat-radius-full: 9999px;

  // Shadow
  --chat-shadow-sm: 0 1px 2px rgba(27, 28, 26, 0.06);
  --chat-shadow-card: 0 1px 2px rgba(27, 28, 26, 0.05);
  --chat-shadow-dropdown: 0 4px 20px rgba(27, 28, 26, 0.04), 0 12px 40px rgba(27, 28, 26, 0.08);
}
```

### 3.2 Dark 主题

如果另一个项目先只做 light，可以暂时跳过 dark。若需要 dark，用下面这组：

```scss
[data-theme='dark'] {
  color-scheme: dark;

  --chat-color-primary: #ffb59d;
  --chat-color-primary-container: #d8876b;
  --chat-color-brand: var(--chat-color-primary);
  --chat-color-secondary: #9acbfe;
  --chat-color-tertiary: #b9d99f;

  --chat-color-background: #0e0e0e;
  --chat-color-surface: #131313;
  --chat-color-surface-bright: #201f1f;
  --chat-color-surface-dim: #0e0e0e;
  --chat-color-surface-container-lowest: #0e0e0e;
  --chat-color-surface-container-low: #1c1b1b;
  --chat-color-surface-container: #201f1f;
  --chat-color-surface-container-high: #2a2929;
  --chat-color-surface-container-highest: #353534;
  --chat-color-surface-hover: var(--chat-color-surface-container-highest);
  --chat-color-surface-selected: var(--chat-color-surface-container);
  --chat-color-surface-user-msg: rgba(32, 31, 31, 0.92);

  --chat-color-text-primary: #f2f1ed;
  --chat-color-text-secondary: #d7c2ba;
  --chat-color-text-tertiary: #a08d86;
  --chat-color-text-accent: var(--chat-color-secondary);

  --chat-color-outline: #a08d86;
  --chat-color-outline-variant: #5a4138;
  --chat-color-border: var(--chat-color-outline-variant);

  --chat-color-success: #6fdc8c;
  --chat-color-success-container: #173b22;
  --chat-color-warning: #facc15;
  --chat-color-warning-container: #3b2d08;
  --chat-color-error: #ffb4ab;
  --chat-color-error-container: #5f1313;
  --chat-color-info: #9acbfe;
  --chat-color-info-container: #102a3d;

  --chat-color-code-bg: #161514;
  --chat-color-code-fg: #e6ded9;
  --chat-color-code-comment: #9aa7b3;
  --chat-color-code-string: #a7d28d;
  --chat-color-code-keyword: #ffb59d;
  --chat-color-code-function: #9acbfe;
  --chat-color-code-number: #7dd3c7;
  --chat-color-code-property: #f0b78a;
  --chat-color-code-type: #e5c07b;
  --chat-color-code-parameter: #d7c2ba;
  --chat-color-code-punctuation: #c9b8b0;
  --chat-color-code-inserted: #6fdc8c;
  --chat-color-code-deleted: #ff8a8a;

  --chat-color-diff-added-bg: #173b22;
  --chat-color-diff-added-word: #245c32;
  --chat-color-diff-added-gutter: #1d4b2b;
  --chat-color-diff-added-text: #6fdc8c;
  --chat-color-diff-removed-bg: #4a1719;
  --chat-color-diff-removed-word: #6d2427;
  --chat-color-diff-removed-gutter: #5b1d20;
  --chat-color-diff-removed-text: #ff8a8a;
  --chat-color-diff-highlight-bg: #3b2d08;
  --chat-color-diff-highlight-gutter: #4d390b;
  --chat-color-diff-title-bg: var(--chat-color-surface-container-low);
  --chat-color-diff-title-color: var(--chat-color-text-tertiary);
  --chat-color-diff-title-border: var(--chat-color-border);

  --chat-color-terminal-header: #2d2d2d;
  --chat-color-terminal-bg: #111111;
  --chat-color-terminal-border: #1a1a1a;
  --chat-color-terminal-fg: #d4d4d4;
  --chat-color-terminal-muted: #999999;
  --chat-color-terminal-accent: #28c840;
  --chat-color-terminal-danger: #ff5f57;
  --chat-color-terminal-warning: #febc2e;

  --chat-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.28);
  --chat-shadow-card: 0 1px 2px rgba(0, 0, 0, 0.32);
  --chat-shadow-dropdown: 0 12px 40px rgba(0, 0, 0, 0.42);
}
```

---

## 4. 数据模型建议

另一个项目可以不照搬后端协议，但前端最好归一成下面的 UI model：

```ts
export type ChatBlock =
  | UserMessageBlock
  | AssistantMessageBlock
  | ThinkingBlockModel
  | ToolCallBlockModel
  | PermissionBlockModel
  | AskUserQuestionBlockModel
  | PlanBlockModel
  | StatusBlockModel

export type UserMessageBlock = {
  id: string
  type: 'user'
  content: string
  timestamp?: number
  attachments?: AttachmentModel[]
}

export type AssistantMessageBlock = {
  id: string
  type: 'assistant'
  content: string
  isStreaming?: boolean
  timestamp?: number
}

export type ThinkingBlockModel = {
  id: string
  type: 'thinking'
  content: string
  isActive?: boolean
}

export type ToolCallBlockModel = {
  id: string
  type: 'tool_call'
  toolName: string
  input: Record<string, unknown>
  partialInput?: string
  status: 'pending' | 'success' | 'error' | 'cancelled'
  result?: {
    content: unknown
    isError?: boolean
  }
  compact?: boolean
}

export type PermissionBlockModel = {
  id: string
  type: 'permission'
  requestId: string
  toolName: string
  input: Record<string, unknown>
  description?: string
  status: 'pending' | 'responded'
}

export type AskUserQuestionBlockModel = {
  id: string
  type: 'ask_user_question'
  toolUseId: string
  questions: AskQuestion[]
  status: 'pending' | 'answered'
  answers?: Record<string, string>
}

export type AskQuestion = {
  question: string
  header?: string
  multiSelect?: boolean
  options?: Array<{
    label: string
    description?: string
    preview?: string
  }>
}

export type PlanBlockModel = {
  id: string
  type: 'plan'
  title: string
  plan: string
  filePath?: string
  allowedPrompts?: Array<{
    tool: string
    prompt: string
  }>
  status: 'ready' | 'approved' | 'rejected' | 'pending'
}

export type StatusBlockModel = {
  id: string
  type: 'status'
  kind: 'memory' | 'goal' | 'background_task' | 'task_summary' | 'compact_summary'
  title: string
  description?: string
  status?: 'running' | 'completed' | 'failed'
}
```

---

## 5. ChatMessageList

### 5.1 结构

```vue
<template>
  <section class="chat-list">
    <div class="chat-list__inner">
      <component
        v-for="block in blocks"
        :key="block.id"
        :is="resolveBlockComponent(block)"
        :block="block"
      />

      <StreamingIndicator v-if="streaming" :verb="streamingVerb" :elapsed="elapsed" />
    </div>
  </section>
</template>
```

### 5.2 SCSS

```scss
.chat-list {
  height: 100%;
  overflow-y: auto;
  background: var(--chat-color-background);
  font-family: var(--chat-font-body);
  color: var(--chat-color-text-primary);
}

.chat-list__inner {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 20px 32px;
}

.chat-list--compact .chat-list__inner {
  max-width: none;
}
```

布局规则：

| 项                        | 规格                           |
| ------------------------- | ------------------------------ |
| 主阅读宽度                | `max-width: 860px`             |
| 左右 padding              | `20px`                         |
| 顶部 padding              | `24px`                         |
| 底部 padding              | `32px`                         |
| 用户消息                  | 右对齐                         |
| 助手消息                  | 左对齐                         |
| 工具 / 权限 / 提问 / 计划 | 嵌入消息流，通常左对齐、近全宽 |

---

## 6. UserMessage

### 6.1 DOM

```vue
<template>
  <div class="user-message">
    <div class="user-message__shell">
      <AttachmentGallery v-if="block.attachments?.length" :attachments="block.attachments" />

      <div v-if="block.content.trim()" class="user-message__bubble">
        {{ block.content }}
      </div>

      <MessageActionBar
        v-if="block.content.trim()"
        align="end"
        :copy-text="block.content"
        :timestamp="block.timestamp"
      />
    </div>
  </div>
</template>
```

### 6.2 SCSS

```scss
.user-message {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 20px;
}

.user-message__shell {
  display: flex;
  min-width: 0;
  max-width: 82%;
  flex-direction: column;
  align-items: flex-end;

  @media (min-width: 640px) {
    max-width: 78%;
  }

  @media (min-width: 1024px) {
    max-width: 72%;
  }
}

.user-message__bubble {
  min-width: 0;
  max-width: 100%;
  padding: 12px 16px;
  border-radius: 18px 4px 18px 18px;
  background: var(--chat-color-surface-user-msg);
  color: var(--chat-color-text-primary);
  font-size: 14px;
  line-height: 1.625;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
```

---

## 7. AssistantMessage

### 7.1 Document layout 判断

助手消息默认气泡布局。满足下面任一条件时切成 document layout：

````ts
export function shouldUseDocumentLayout(content: string) {
  const normalized = content.trim()
  if (!normalized) return false
  if (/```/.test(normalized)) return true
  if (/^\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.+\|)/m.test(normalized)) return true

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map(chunk => chunk.trim())
    .filter(Boolean)

  return paragraphs.length >= 2 || normalized.split('\n').filter(line => line.trim()).length >= 8
}
````

### 7.2 DOM

```vue
<template>
  <div class="assistant-message">
    <div
      class="assistant-message__shell"
      :class="{ 'assistant-message__shell--document': documentLayout }"
    >
      <div
        class="assistant-message__bubble"
        :class="{ 'assistant-message__bubble--document': documentLayout }"
      >
        <MarkdownRenderer
          :content="block.content"
          :variant="documentLayout ? 'document' : 'default'"
        />
        <span v-if="block.isStreaming" class="assistant-message__cursor" />
      </div>

      <MessageActionBar
        align="start"
        :copy-text="block.isStreaming ? undefined : block.content"
        :timestamp="block.timestamp"
      />
    </div>
  </div>
</template>
```

### 7.3 SCSS

```scss
.assistant-message {
  display: flex;
  justify-content: flex-start;
  margin-bottom: 20px;
}

.assistant-message__shell {
  display: flex;
  min-width: 0;
  max-width: 88%;
  flex-direction: column;
  align-items: flex-start;

  @media (min-width: 640px) {
    max-width: 80%;
  }

  @media (min-width: 1024px) {
    max-width: 72%;
  }
}

.assistant-message__shell--document {
  width: 100%;
  max-width: 100%;
}

.assistant-message__bubble {
  max-width: 100%;
  padding: 12px 16px;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 60%, transparent);
  border-radius: 20px;
  border-top-left-radius: 8px;
  background: var(--chat-color-surface);
  color: var(--chat-color-text-primary);
  font-size: 14px;
  line-height: 1.625;
  box-shadow: var(--chat-shadow-sm);
}

.assistant-message__bubble--document {
  width: 100%;
}

.assistant-message__cursor {
  display: inline-block;
  width: 2px;
  height: 16px;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--chat-color-brand);
  animation: chat-shimmer 1.5s ease-in-out infinite;
}
```

---

## 8. MarkdownRenderer 样式

如果 Vue 项目使用 `markdown-it`、`marked` 或 `md-editor-v3`，最终渲染容器建议统一套 `.chat-markdown`。

```scss
.chat-markdown {
  font-size: 14px;
  line-height: 1.625;
  color: var(--chat-color-text-primary);

  > :first-child {
    margin-top: 0;
  }

  > :last-child {
    margin-bottom: 0;
  }

  p {
    margin: 0.5em 0;
  }

  h1,
  h2,
  h3,
  h4 {
    margin: 1em 0 0.45em;
    font-weight: 650;
    line-height: 1.25;
  }

  h1 {
    font-size: 20px;
  }
  h2 {
    font-size: 18px;
  }
  h3 {
    font-size: 16px;
  }
  h4 {
    font-size: 15px;
  }

  ul,
  ol {
    margin: 0.5em 0;
    padding-left: 1.4em;
  }

  li + li {
    margin-top: 0.25em;
  }

  blockquote {
    margin: 0.75em 0;
    padding-left: 12px;
    border-left: 3px solid var(--chat-color-border);
    color: var(--chat-color-text-secondary);
  }

  code:not(pre code) {
    padding: 1px 5px;
    border: 1px solid color-mix(in srgb, var(--chat-color-border) 60%, transparent);
    border-radius: 5px;
    background: var(--chat-color-surface-container-low);
    font-family: var(--chat-font-mono);
    font-size: 0.9em;
  }

  pre {
    margin: 0.75em 0;
  }

  a {
    color: var(--chat-color-text-accent);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  table {
    width: 100%;
    margin: 0.75em 0;
    border-collapse: collapse;
    font-size: 13px;
  }

  th,
  td {
    padding: 6px 8px;
    border: 1px solid var(--chat-color-border);
  }

  th {
    background: var(--chat-color-surface-container-low);
    font-weight: 600;
  }
}

.chat-markdown--compact {
  font-size: 12px;
  line-height: 1.5;

  p,
  ul,
  ol,
  pre,
  blockquote {
    margin-top: 0.35em;
    margin-bottom: 0.35em;
  }
}
```

---

## 9. MessageActionBar

### 9.1 行为

- 默认透明隐藏。
- 父消息 hover 或 focus-within 时显示。
- 包含 copy、branch、timestamp。
- 用户消息右对齐，助手消息左对齐。

### 9.2 SCSS

```scss
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
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--chat-radius-full);
  background: transparent;
  color: var(--chat-color-text-tertiary);
  cursor: pointer;

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
```

---

## 10. ThinkingBlock

### 10.1 DOM

```vue
<template>
  <div class="thinking-block">
    <button class="thinking-block__toggle" @click="expanded = !expanded">
      <span class="thinking-block__chevron">{{ expanded ? '▾' : '▸' }}</span>
      <span class="thinking-block__label">
        {{ block.isActive ? 'Thinking' : 'Thought' }}
        <span v-if="block.isActive" class="thinking-block__dots" />
      </span>
    </button>

    <div v-if="expanded && block.content.trim()" class="thinking-block__content">
      <MarkdownRenderer :content="block.content" variant="compact" />
      <span v-if="block.isActive" class="thinking-block__cursor" />
    </div>
  </div>
</template>
```

### 10.2 SCSS

```scss
.thinking-block {
  margin-bottom: 4px;
}

.thinking-block__toggle {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--chat-color-text-tertiary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: color 150ms ease;

  &:hover {
    color: var(--chat-color-text-secondary);
  }
}

.thinking-block__chevron {
  color: var(--chat-color-outline);
  font-size: 10px;
}

.thinking-block__label {
  flex-shrink: 0;
  font-style: italic;
  font-weight: 500;
}

.thinking-block__content {
  position: relative;
  max-height: 300px;
  margin-top: 4px;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 40%, transparent);
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container-lowest);
  color: var(--chat-color-text-secondary);
  font-size: 11px;
}

.thinking-block__cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 1px;
  vertical-align: middle;
  background: var(--chat-color-text-tertiary);
  animation: chat-cursor-blink 1s step-end infinite;
}

.thinking-block__dots::after {
  content: '';
  animation: chat-thinking-dots 1.4s steps(1, end) infinite;
}
```

---

## 11. ToolCallBlock

### 11.1 状态矩阵

| 状态   | `status`    | 标题行              | 右侧摘要                          | 展开区               |
| ------ | ----------- | ------------------- | --------------------------------- | -------------------- |
| 准备中 | `pending`   | 工具名 + input 摘要 | spinner + `Preparing` / `Running` | 可显示 partial input |
| 成功   | `success`   | 工具名 + 路径/摘要  | 简短成功摘要                      | 可展开结果           |
| 错误   | `error`     | 工具名 + 路径/摘要  | 红色错误摘要 + error icon         | 展示错误输出         |
| 取消   | `cancelled` | 工具名 + 路径/摘要  | 灰色 `Cancelled`                  | 通常不展开           |

### 11.2 工具图标

| 工具          | 图标建议         |
| ------------- | ---------------- |
| Bash          | `terminal`       |
| Read          | `description`    |
| Write         | `edit_document`  |
| Edit          | `edit_note`      |
| Glob          | `search`         |
| Grep          | `find_in_page`   |
| Agent         | `smart_toy`      |
| WebSearch     | `travel_explore` |
| WebFetch      | `cloud_download` |
| NotebookEdit  | `note`           |
| Skill         | `auto_awesome`   |
| MCP / unknown | `build`          |

如果不用 Material Symbols，可以用 lucide：`Terminal`, `FileText`, `Edit3`, `Search`, `Bot`, `Globe`, `Sparkles`, `Wrench`。

### 11.3 DOM

```vue
<template>
  <div
    class="tool-call"
    :class="[`tool-call--${block.status}`, { 'tool-call--compact': block.compact }]"
  >
    <button class="tool-call__header" @click="toggleIfExpandable">
      <span class="tool-call__icon material-symbols-outlined">{{ icon }}</span>
      <span class="tool-call__name">{{ block.toolName }}</span>
      <span class="tool-call__summary">{{ summary }}</span>

      <span v-if="block.status === 'pending'" class="tool-call__pending">
        <span class="tool-call__spinner" />
        {{ pendingText }}
      </span>

      <span v-else-if="resultSummary" class="tool-call__result-summary">
        {{ resultSummary }}
      </span>

      <span v-if="block.status === 'error'" class="tool-call__error-icon material-symbols-outlined"
        >error</span
      >
      <span v-if="expandable" class="tool-call__chevron material-symbols-outlined">
        {{ expanded ? 'expand_less' : 'expand_more' }}
      </span>
    </button>

    <div v-if="expandable && expanded" class="tool-call__body">
      <DiffViewer
        v-if="isEditLike"
        :file-path="filePath"
        :old-string="oldString"
        :new-string="newString"
      />
      <TerminalChrome v-else-if="block.toolName === 'Bash'" :title="bashTitle">
        <pre class="tool-call__bash-command"><span>$</span> {{ command }}</pre>
      </TerminalChrome>
      <ToolResultBlock
        v-if="visibleResultText"
        :text="visibleResultText"
        :is-error="block.status === 'error'"
      />
    </div>
  </div>
</template>
```

### 11.4 SCSS

```scss
.tool-call {
  margin-bottom: 8px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 50%, transparent);
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container-lowest);
}

.tool-call--compact {
  margin-bottom: 0;
}

.tool-call--error {
  border-color: color-mix(in srgb, var(--chat-color-error) 45%, var(--chat-color-border));
}

.tool-call__header {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ease;

  &:hover {
    background: color-mix(in srgb, var(--chat-color-surface-hover) 50%, transparent);
  }
}

.tool-call__icon {
  flex-shrink: 0;
  color: var(--chat-color-outline);
  font-size: 14px;
}

.tool-call__name {
  flex-shrink: 0;
  color: var(--chat-color-text-secondary);
  font-size: 11px;
  font-weight: 700;
}

.tool-call__summary {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--chat-color-text-tertiary);
  font-family: var(--chat-font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-call__pending,
.tool-call__result-summary {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  color: var(--chat-color-outline);
  font-size: 10px;
}

.tool-call--error .tool-call__result-summary,
.tool-call__error-icon {
  color: var(--chat-color-error);
}

.tool-call__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, var(--chat-color-outline) 30%, transparent);
  border-top-color: var(--chat-color-outline);
  border-radius: 999px;
  animation: chat-spin 1s linear infinite;
}

.tool-call__chevron {
  flex-shrink: 0;
  color: var(--chat-color-outline);
  font-size: 14px;
}

.tool-call__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-top: 1px solid color-mix(in srgb, var(--chat-color-border) 60%, transparent);
}

.tool-call__bash-command {
  margin: 0;
  padding: 10px 12px;
  color: var(--chat-color-terminal-fg);
  font-family: var(--chat-font-mono);
  font-size: 11px;
  line-height: 1.3;
  white-space: pre-wrap;
  word-break: break-word;

  span {
    color: var(--chat-color-terminal-accent);
  }
}
```

### 11.5 摘要规则

| 工具                | 标题摘要                                      |
| ------------------- | --------------------------------------------- |
| Bash                | `description` 优先，否则 `command` 前 80 字符 |
| Read / Write / Edit | `file_path` 的 basename                       |
| Glob                | `pattern`                                     |
| Grep                | `pattern`                                     |
| Agent               | `description`                                 |
| WebFetch            | `url`                                         |
| WebSearch           | `query`                                       |
| Skill               | skill name / args                             |
| unknown             | JSON 单行截断                                 |

---

## 12. ToolResultBlock

```scss
.tool-result {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 50%, transparent);
  border-radius: var(--chat-radius-lg);
  background: var(--chat-color-surface-container-low);
}

.tool-result--error {
  border-color: color-mix(in srgb, var(--chat-color-error) 50%, transparent);
  background: color-mix(
    in srgb,
    var(--chat-color-error-container) 35%,
    var(--chat-color-surface-container-low)
  );
}

.tool-result__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--chat-color-border) 45%, transparent);
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
  font-weight: 600;
}

.tool-result__content {
  max-height: 320px;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  color: var(--chat-color-text-secondary);
  font-family: var(--chat-font-mono);
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}
```

---

## 13. TerminalChrome

### 13.1 DOM

```vue
<template>
  <div class="terminal-chrome">
    <div class="terminal-chrome__header">
      <div class="terminal-chrome__lights">
        <span class="terminal-chrome__light terminal-chrome__light--danger" />
        <span class="terminal-chrome__light terminal-chrome__light--warning" />
        <span class="terminal-chrome__light terminal-chrome__light--success" />
      </div>
      <span v-if="title" class="terminal-chrome__title">{{ title }}</span>
    </div>
    <div class="terminal-chrome__body">
      <slot />
    </div>
  </div>
</template>
```

### 13.2 SCSS

```scss
.terminal-chrome {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 20%, transparent);
  border-radius: var(--chat-radius-xl);
  background: var(--chat-color-surface-dim);
}

.terminal-chrome__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--chat-color-terminal-border);
  background: var(--chat-color-terminal-header);
}

.terminal-chrome__lights {
  display: flex;
  gap: 6px;
}

.terminal-chrome__light {
  width: 10px;
  height: 10px;
  border-radius: 999px;
}

.terminal-chrome__light--danger {
  background: var(--chat-color-terminal-danger);
}
.terminal-chrome__light--warning {
  background: var(--chat-color-terminal-warning);
}
.terminal-chrome__light--success {
  background: var(--chat-color-terminal-accent);
}

.terminal-chrome__title {
  min-width: 0;
  overflow: hidden;
  margin-left: 8px;
  color: var(--chat-color-terminal-muted);
  font-family: var(--chat-font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-chrome__body {
  background: var(--chat-color-terminal-bg);
  color: var(--chat-color-terminal-fg);
}
```

---

## 14. CodeViewer

### 14.1 规格

| 项             | 值                                   |
| -------------- | ------------------------------------ |
| 外壳圆角       | `12px`                               |
| 外壳背景       | `--chat-color-surface-container-low` |
| 外壳边框       | `--chat-color-outline-variant / 50%` |
| Header 背景    | `--chat-color-surface-container`     |
| Header padding | `6px 12px`                           |
| Header 字号    | `11px`                               |
| 代码背景       | `--chat-color-code-bg`               |
| 代码字号       | `12px`                               |
| 代码行高       | `1.3`                                |
| 代码 padding   | `8px 12px`                           |
| 最大高度       | `420px`                              |
| 默认最大行数   | `20`                                 |
| 行号字号       | `11px`                               |

### 14.2 SCSS

```scss
.code-viewer {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 50%, transparent);
  border-radius: var(--chat-radius-lg);
  background: var(--chat-color-surface-container-low);
}

.code-viewer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 40%, transparent);
  background: var(--chat-color-surface-container);
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
}

.code-viewer__meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.code-viewer__language {
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.code-viewer__copy {
  padding: 4px 8px;
  border: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 40%, transparent);
  border-radius: 6px;
  background: var(--chat-color-surface-container-lowest);
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
  cursor: pointer;

  &:hover {
    background: var(--chat-color-surface-container-high);
    color: var(--chat-color-text-primary);
  }
}

.code-viewer__area {
  max-height: 420px;
  overflow: auto;
  background: var(--chat-color-code-bg);
}

.code-viewer__pre {
  margin: 0;
  padding: 8px 12px;
  color: var(--chat-color-code-fg);
  font-family: var(--chat-font-mono);
  font-size: 12px;
  line-height: 1.3;
  white-space: pre;
  word-break: normal;
}

.code-viewer__line {
  display: block;

  &:hover {
    background: var(--chat-color-surface-hover);
  }
}

.code-viewer__line-number {
  display: inline-block;
  min-width: 2.5ch;
  margin-right: 1.5ch;
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
  text-align: right;
  user-select: none;
}

.code-viewer__toggle {
  width: 100%;
  padding: 6px 0;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 40%, transparent);
  background: var(--chat-color-surface-container);
  color: var(--chat-color-text-tertiary);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;

  &:hover {
    background: var(--chat-color-surface-container-high);
    color: var(--chat-color-text-primary);
  }
}
```

语法高亮 token 映射：

| 语法             | 颜色 token                      |
| ---------------- | ------------------------------- |
| comment          | `--chat-color-code-comment`     |
| string           | `--chat-color-code-string`      |
| keyword          | `--chat-color-code-keyword`     |
| function         | `--chat-color-code-function`    |
| number / boolean | `--chat-color-code-number`      |
| property         | `--chat-color-code-property`    |
| type / class     | `--chat-color-code-type`        |
| punctuation      | `--chat-color-code-punctuation` |

---

## 15. DiffViewer

### 15.1 规格

| 项                        | 值                                   |
| ------------------------- | ------------------------------------ |
| 外壳圆角                  | `12px`                               |
| 外壳边框                  | `--chat-color-outline-variant / 50%` |
| Header padding            | `6px 12px`                           |
| 文件路径字体              | mono, `11px`                         |
| additions/deletions badge | `10px`, uppercase                    |
| Diff 最大高度             | `400px`                              |
| Diff 字号                 | `12px`                               |
| Diff 行高                 | `1.45`                               |
| gutter 宽度               | `40px`                               |
| word diff 圆角            | `2px`                                |

### 15.2 SCSS

```scss
.diff-viewer {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 50%, transparent);
  border-radius: var(--chat-radius-lg);
  background: var(--chat-color-surface-container-low);
}

.diff-viewer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 40%, transparent);
  background: var(--chat-color-surface-container);
}

.diff-viewer__path {
  overflow: hidden;
  color: var(--chat-color-text-tertiary);
  font-family: var(--chat-font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-viewer__stats {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.diff-viewer__stat {
  padding: 2px 8px;
  border-radius: 999px;
}

.diff-viewer__stat--added {
  background: var(--chat-color-diff-added-bg);
  color: var(--chat-color-diff-added-text);
}

.diff-viewer__stat--removed {
  background: var(--chat-color-diff-removed-bg);
  color: var(--chat-color-diff-removed-text);
}

.diff-viewer__body {
  max-height: 400px;
  overflow: auto;
  background: var(--chat-color-code-bg);
  color: var(--chat-color-code-fg);
  font-family: var(--chat-font-mono);
  font-size: 12px;
  line-height: 1.45;
}

.diff-line {
  display: grid;
  grid-template-columns: 40px 1fr;
  min-width: max-content;
}

.diff-line__gutter {
  padding: 1px 8px;
  background: var(--chat-color-surface-container-low);
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
  text-align: right;
  user-select: none;
}

.diff-line__content {
  padding: 1px 8px;
  white-space: pre;
}

.diff-line--added .diff-line__gutter {
  background: var(--chat-color-diff-added-gutter);
  color: var(--chat-color-diff-added-text);
}

.diff-line--added .diff-line__content {
  background: var(--chat-color-diff-added-bg);
}

.diff-line--removed .diff-line__gutter {
  background: var(--chat-color-diff-removed-gutter);
  color: var(--chat-color-diff-removed-text);
}

.diff-line--removed .diff-line__content {
  background: var(--chat-color-diff-removed-bg);
}

.diff-word--added {
  padding: 1px 2px;
  border-radius: 2px;
  background: var(--chat-color-diff-added-word);
}

.diff-word--removed {
  padding: 1px 2px;
  border-radius: 2px;
  background: var(--chat-color-diff-removed-word);
}
```

---

## 16. PermissionDialog

### 16.1 状态矩阵

| 状态      | 外壳                            | Header         | Badge                         | 底部按钮                              |
| --------- | ------------------------------- | -------------- | ----------------------------- | ------------------------------------- |
| pending   | warning 边框，白底              | container 背景 | `awaiting approval`，黄点闪烁 | 显示 Allow / Allow for session / Deny |
| responded | outline 边框，低底，opacity 70% | low 背景       | `responded` 灰色              | 不显示按钮                            |

### 16.2 预览规则

| 工具  | 预览                                 |
| ----- | ------------------------------------ |
| Edit  | DiffViewer                           |
| Write | DiffViewer                           |
| Bash  | terminal command preview             |
| 其他  | compact detail row + 可展开 raw JSON |

### 16.3 SCSS

```scss
.permission-card {
  margin-bottom: 16px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 40%, transparent);
  border-radius: var(--chat-radius-lg);
  background: var(--chat-color-surface-container-low);
}

.permission-card--pending {
  border-color: var(--chat-color-warning);
  background: var(--chat-color-surface-container-lowest);
  opacity: 1;
}

.permission-card--responded {
  opacity: 0.7;
}

.permission-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--chat-color-surface-container-low);
}

.permission-card--pending .permission-card__header {
  background: var(--chat-color-surface-container);
}

.permission-card__icon-wrap {
  display: flex;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: var(--chat-radius-md);
  background: color-mix(
    in srgb,
    var(--permission-color, var(--chat-color-warning)) 10%,
    transparent
  );
  color: var(--permission-color, var(--chat-color-warning));
}

.permission-card__title-row {
  display: flex;
  min-width: 0;
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
  border-radius: 999px;
  background: var(--chat-color-surface-container-high);
  color: var(--chat-color-text-tertiary);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.permission-card__badge--pending {
  background: color-mix(in srgb, var(--chat-color-warning) 15%, transparent);
  color: var(--chat-color-warning);
}

.permission-card__badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--chat-color-warning);
  animation: chat-pulse-dot 1.4s ease-in-out infinite;
}

.permission-card__body {
  padding: 12px 16px;
  border-top: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 20%, transparent);
}

.permission-card__detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container);
  color: var(--chat-color-text-secondary);
  font-family: var(--chat-font-mono);
  font-size: 12px;
}

.permission-card__raw-toggle {
  margin-top: 8px;
  border: 0;
  background: transparent;
  color: var(--chat-color-text-accent);
  font-size: 11px;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.permission-card__raw {
  max-height: 220px;
  margin: 8px 0 0;
  overflow: auto;
  padding: 10px 12px;
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-terminal-bg);
  color: var(--chat-color-terminal-fg);
  font-family: var(--chat-font-mono);
  font-size: 11px;
  line-height: 1.3;
  white-space: pre-wrap;
  word-break: break-word;
}

.permission-card__actions {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 20%, transparent);
  background: var(--chat-color-surface-container-low);
}
```

---

## 17. AskUserQuestionCard

### 17.1 状态矩阵

| 状态     | 外壳                            | Header         | 内容                          | 底部        |
| -------- | ------------------------------- | -------------- | ----------------------------- | ----------- |
| pending  | secondary 蓝边框，白底          | container 背景 | tab + option cards + textarea | Submit 按钮 |
| answered | outline 边框，低底，opacity 70% | low 背景       | 答案摘要                      | 无按钮      |

### 17.2 SCSS

```scss
.ask-card {
  margin-bottom: 16px;
  overflow: hidden;
  border: 1px solid var(--chat-color-secondary);
  border-radius: var(--chat-radius-lg);
  background: var(--chat-color-surface-container-lowest);
}

.ask-card--answered {
  border-color: color-mix(in srgb, var(--chat-color-outline-variant) 40%, transparent);
  background: var(--chat-color-surface-container-low);
  opacity: 0.7;
}

.ask-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--chat-color-surface-container);
}

.ask-card--answered .ask-card__header {
  background: var(--chat-color-surface-container-low);
}

.ask-card__icon-wrap {
  display: flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: var(--chat-radius-md);
  background: color-mix(in srgb, var(--chat-color-secondary) 10%, transparent);
  color: var(--chat-color-secondary);
}

.ask-card__title {
  color: var(--chat-color-text-primary);
  font-size: 14px;
  font-weight: 700;
}

.ask-card__answered-badge {
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--chat-color-surface-container-high);
  color: var(--chat-color-text-tertiary);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ask-card__tabs {
  display: flex;
  overflow-x: auto;
  padding: 0 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 20%, transparent);
  background: var(--chat-color-surface-container-low);
}

.ask-card__tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border: 0;
  background: transparent;
  color: var(--chat-color-text-tertiary);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    color: var(--chat-color-text-secondary);
  }
}

.ask-card__tab--active {
  color: var(--chat-color-secondary);

  &::after {
    content: '';
    position: absolute;
    right: 8px;
    bottom: 0;
    left: 8px;
    height: 2px;
    border-radius: 2px 2px 0 0;
    background: var(--chat-color-secondary);
  }
}

.ask-card__body {
  padding: 12px 16px;
}

.ask-card__question {
  margin: 0 0 12px;
  color: var(--chat-color-text-primary);
  font-size: 14px;
  font-weight: 600;
}

.ask-card__options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.ask-card__option {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 40%, transparent);
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    box-shadow 150ms ease;

  &:hover {
    border-color: var(--chat-color-outline-variant);
    background: var(--chat-color-surface-container-low);
  }
}

.ask-card__option--selected {
  border-color: var(--chat-color-secondary);
  background: color-mix(in srgb, var(--chat-color-secondary) 8%, var(--chat-color-surface));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--chat-color-secondary) 30%, transparent);
}

.ask-card__option-inner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.ask-card__option-check {
  display: flex;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  border: 2px solid var(--chat-color-outline);
  border-radius: 999px;
}

.ask-card__option-check--multi {
  border-radius: var(--chat-radius-xs);
}

.ask-card__option--selected .ask-card__option-check {
  border-color: var(--chat-color-secondary);
  background: var(--chat-color-secondary);
  color: white;
}

.ask-card__option-label {
  display: block;
  color: var(--chat-color-text-primary);
  font-size: 14px;
  font-weight: 600;
}

.ask-card__option--selected .ask-card__option-label {
  color: var(--chat-color-secondary);
}

.ask-card__option-description {
  margin-top: 2px;
  color: var(--chat-color-text-secondary);
  font-size: 12px;
}

.ask-card__textarea-label {
  display: block;
  margin-bottom: 6px;
  color: var(--chat-color-text-tertiary);
  font-size: 12px;
}

.ask-card__textarea {
  width: 100%;
  min-height: 84px;
  max-height: 192px;
  resize: vertical;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 40%, transparent);
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface);
  color: var(--chat-color-text-primary);
  font-family: var(--chat-font-body);
  font-size: 14px;
  line-height: 1.625;

  &::placeholder {
    color: var(--chat-color-text-tertiary);
  }

  &:focus {
    border-color: var(--chat-color-secondary);
    outline: none;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--chat-color-secondary) 30%, transparent);
  }
}

.ask-card__answer {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--chat-color-text-secondary);
  font-size: 12px;
}

.ask-card__footer {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 20%, transparent);
  background: var(--chat-color-surface-container-low);
}
```

---

## 18. PlanModePreview

```scss
.plan-card {
  overflow: hidden;
  border: 1px solid var(--chat-color-border);
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface);
}

.plan-card__header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--chat-color-border) 65%, transparent);
  background: var(--chat-color-surface-container-low);
}

.plan-card__icon {
  margin-top: 2px;
  color: var(--chat-color-brand);
}

.plan-card__title {
  color: var(--chat-color-text-primary);
  font-size: 12px;
  font-weight: 700;
}

.plan-card__path {
  margin-top: 2px;
  overflow: hidden;
  color: var(--chat-color-text-tertiary);
  font-family: var(--chat-font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-card__body {
  max-height: 520px;
  overflow: auto;
  padding: 12px;
}

.plan-card__permissions {
  padding: 10px 12px;
  border-top: 1px solid color-mix(in srgb, var(--chat-color-border) 65%, transparent);
  background: var(--chat-color-surface-container-low);
}

.plan-card__permissions-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--chat-color-outline);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.plan-card__permission-item {
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 70%, transparent);
  border-radius: 6px;
  background: var(--chat-color-surface);
  color: var(--chat-color-text-secondary);
  font-size: 11px;

  & + & {
    margin-top: 4px;
  }
}

.plan-card__permission-tool {
  color: var(--chat-color-text-primary);
  font-family: var(--chat-font-mono);
  font-weight: 700;
}
```

Plan tool 外壳建议和 `ToolCallBlock` 类似，但边框用品牌色：

```scss
.tool-call--plan {
  border-color: color-mix(in srgb, var(--chat-color-brand) 35%, transparent);
}

.tool-call--plan .tool-call__icon {
  color: var(--chat-color-brand);
}
```

---

## 19. ToolCallGroup / Agent 树

Agent 工具组用于展示嵌套调用，不要做成大卡片。重点是层级和状态。

```scss
.tool-group {
  margin-bottom: 12px;
  padding: 8px 0;
}

.tool-group__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--chat-color-text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.tool-group__children {
  margin-left: 12px;
  padding-left: 12px;
  border-left: 2px solid color-mix(in srgb, var(--chat-color-border) 70%, transparent);
}

.agent-node {
  position: relative;
  margin-bottom: 6px;
}

.agent-node__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  color: var(--chat-color-text-secondary);
  font-size: 12px;
}

.agent-node__badge {
  padding: 2px 6px;
  border-radius: var(--chat-radius-xs);
  background: var(--chat-color-surface-container);
  color: var(--chat-color-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.agent-node__status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
}

.agent-node--running .agent-node__status-dot {
  background: var(--chat-color-warning);
  animation: chat-pulse-dot 1.4s ease-in-out infinite;
}

.agent-node--completed .agent-node__status-dot {
  background: var(--chat-color-success);
}

.agent-node--failed .agent-node__status-dot {
  background: var(--chat-color-error);
}
```

---

## 20. StreamingIndicator

```scss
.streaming-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 12px;
  padding: 5px 10px;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 45%, transparent);
  border-radius: 999px;
  background: var(--chat-color-surface-container-lowest);
  color: var(--chat-color-text-tertiary);
  font-size: 13px;
}

.streaming-indicator__spark {
  color: var(--chat-color-brand);
  font-size: 16px;
  animation: chat-shimmer 1.5s ease-in-out infinite;
}

.streaming-indicator__verb {
  color: var(--chat-color-brand);
  font-weight: 600;
}

.streaming-indicator__meta {
  color: var(--chat-color-text-tertiary);
  font-size: 12px;
}

.streaming-indicator--retry {
  display: flex;
  width: 100%;
  border-color: color-mix(in srgb, var(--chat-color-warning) 45%, transparent);
  border-radius: var(--chat-radius-lg);
  background: var(--chat-color-warning-container);
  color: var(--chat-color-warning);
}
```

---

## 21. Task / Memory / Goal / Background task 卡

这类都是辅助状态，不要抢主消息视觉权重。

```scss
.status-card {
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 50%, transparent);
  border-radius: var(--chat-radius-lg);
  background: var(--chat-color-surface-container-low);
  color: var(--chat-color-text-secondary);
  font-size: 12px;
}

.status-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
}

.status-card__description {
  margin-top: 4px;
  color: var(--chat-color-text-tertiary);
  line-height: 1.45;
}

.status-card--memory,
.status-card--goal {
  border-color: var(--chat-color-memory-border);
  background: var(--chat-color-memory-surface);
}

.status-card--memory .status-card__icon,
.status-card--goal .status-card__icon {
  color: var(--chat-color-memory-accent);
}

.status-card--running .status-card__dot {
  background: var(--chat-color-warning);
  animation: chat-pulse-dot 1.4s ease-in-out infinite;
}

.status-card--completed .status-card__dot {
  background: var(--chat-color-success);
}

.status-card--failed .status-card__dot {
  background: var(--chat-color-error);
}
```

---

## 22. 通用按钮

对话区卡片中的按钮建议统一：

```scss
.chat-button {
  display: inline-flex;
  height: 30px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--chat-radius-md);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 150ms ease,
    border-color 150ms ease,
    color 150ms ease;
}

.chat-button--primary {
  background: linear-gradient(
    135deg,
    var(--chat-color-primary),
    var(--chat-color-primary-container)
  );
  color: white;

  &:hover {
    filter: brightness(0.96);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

.chat-button--ghost {
  border-color: color-mix(in srgb, var(--chat-color-border) 60%, transparent);
  background: var(--chat-color-surface-container-lowest);
  color: var(--chat-color-text-secondary);

  &:hover {
    background: var(--chat-color-surface-container-high);
    color: var(--chat-color-text-primary);
  }
}

.chat-button--danger {
  border-color: color-mix(in srgb, var(--chat-color-error) 35%, transparent);
  background: color-mix(in srgb, var(--chat-color-error-container) 45%, var(--chat-color-surface));
  color: var(--chat-color-error);

  &:hover {
    background: color-mix(
      in srgb,
      var(--chat-color-error-container) 70%,
      var(--chat-color-surface)
    );
  }
}
```

---

## 23. 动画

```scss
@keyframes chat-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes chat-shimmer {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.38;
  }
}

@keyframes chat-cursor-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

@keyframes chat-thinking-dots {
  0%,
  20% {
    content: '';
  }
  40% {
    content: '.';
  }
  60% {
    content: '..';
  }
  80%,
  100% {
    content: '...';
  }
}

@keyframes chat-pulse-dot {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.45;
    transform: scale(0.82);
  }
}
```

---

## 24. Vue3 实现注意事项

### 24.1 不建议把所有 block 写在一个组件里

`ChatMessageList` 只负责分发：

```ts
function resolveBlockComponent(block: ChatBlock) {
  switch (block.type) {
    case 'user':
      return UserMessage
    case 'assistant':
      return AssistantMessage
    case 'thinking':
      return ThinkingBlock
    case 'tool_call':
      return ToolCallBlock
    case 'permission':
      return PermissionDialog
    case 'ask_user_question':
      return AskUserQuestionCard
    case 'plan':
      return PlanModePreview
    case 'status':
      return StatusCard
  }
}
```

### 24.2 展开状态保存在组件内即可

这些组件的展开/收起通常不需要进全局 store：

- ThinkingBlock
- ToolCallBlock
- CodeViewer 长代码
- raw JSON
- Plan card

但如果消息列表虚拟化会卸载组件，则需要把展开状态放到 `expandedStateById`。

### 24.3 长内容必须限制高度

| 组件                     | 最大高度 |
| ------------------------ | -------- |
| Thinking expanded        | `300px`  |
| CodeViewer               | `420px`  |
| DiffViewer body          | `400px`  |
| Permission raw JSON      | `220px`  |
| AskUserQuestion textarea | `192px`  |
| Plan body                | `520px`  |
| Tool result              | `320px`  |

### 24.4 移动端策略

小屏幕下：

```scss
@media (max-width: 640px) {
  .chat-list__inner {
    padding-right: 12px;
    padding-left: 12px;
  }

  .user-message__shell,
  .assistant-message__shell {
    max-width: 94%;
  }

  .assistant-message__shell--document {
    max-width: 100%;
  }

  .permission-card__title-row,
  .tool-call__header {
    align-items: flex-start;
  }

  .tool-call__summary {
    display: none;
  }
}
```

---

## 25. Mock data

### 25.1 基础消息

```ts
export const basicChatBlocks: ChatBlock[] = [
  {
    id: 'u1',
    type: 'user',
    content: '分析下这个项目的对话区 UI，列出可以复刻的组件。',
    timestamp: Date.now(),
  },
  {
    id: 'a1',
    type: 'assistant',
    content: '我会先查看对话区相关组件，然后整理视觉结构和落地顺序。',
    timestamp: Date.now(),
  },
]
```

### 25.2 Thinking

```ts
export const thinkingBlock: ThinkingBlockModel = {
  id: 't1',
  type: 'thinking',
  isActive: true,
  content: '需要先确认消息流入口，再看 UserMessage、AssistantMessage、ToolCallBlock。',
}
```

### 25.3 Bash 工具

```ts
export const bashToolBlock: ToolCallBlockModel = {
  id: 'tool-bash-1',
  type: 'tool_call',
  toolName: 'Bash',
  status: 'success',
  input: {
    command: 'bun run test desktop/src/components/chat/chatBlocks.test.tsx',
    description: 'Run chat block tests',
  },
  result: {
    content: 'All tests passed',
    isError: false,
  },
}
```

### 25.4 Edit 工具

```ts
export const editToolBlock: ToolCallBlockModel = {
  id: 'tool-edit-1',
  type: 'tool_call',
  toolName: 'Edit',
  status: 'success',
  input: {
    file_path: '/project/src/components/UserMessage.vue',
    old_string: '<div class="message">{{ content }}</div>',
    new_string: '<div class="user-message__bubble">{{ content }}</div>',
  },
  result: {
    content: 'Updated UserMessage.vue',
    isError: false,
  },
}
```

### 25.5 权限请求

```ts
export const permissionBlock: PermissionBlockModel = {
  id: 'perm-1',
  type: 'permission',
  requestId: 'req-1',
  toolName: 'Edit',
  status: 'pending',
  description: 'Update chat bubble styles',
  input: {
    file_path: '/project/src/components/chat/UserMessage.vue',
    old_string: 'border-radius: 12px;',
    new_string: 'border-radius: 18px 4px 18px 18px;',
  },
}
```

### 25.6 AskUserQuestion

```ts
export const askBlock: AskUserQuestionBlockModel = {
  id: 'ask-1',
  type: 'ask_user_question',
  toolUseId: 'tool-ask-1',
  status: 'pending',
  questions: [
    {
      header: '样式版本',
      question: '助手消息要采用哪种样式？',
      options: [
        {
          label: '卡片气泡',
          description: '更像 Agent 工作台，适合工具流和结构化内容。',
        },
        {
          label: '透明正文',
          description: '更接近传统 Claude Desktop，视觉更轻。',
        },
      ],
    },
  ],
}
```

### 25.7 Plan

```ts
export const planBlock: PlanBlockModel = {
  id: 'plan-1',
  type: 'plan',
  title: '实现对话区 UI 复刻',
  status: 'ready',
  filePath: '/tmp/plan.md',
  plan: `## 目标\n\n复刻 Evancod 对话区基础组件。\n\n## 步骤\n\n1. 建立 token。\n2. 实现消息气泡。\n3. 实现工具卡。`,
  allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
}
```

---

## 26. 落地顺序

Vue3 + SCSS 项目建议按这个顺序做：

1. `chat-tokens.scss` 和全局字体。
2. `ChatMessageList` 宽度、滚动、间距。
3. `UserMessage` / `AssistantMessage` / `MarkdownRenderer`。
4. `MessageActionBar`。
5. `ThinkingBlock`。
6. `TerminalChrome`。
7. `CodeViewer`。
8. `DiffViewer`。
9. `ToolCallBlock`。
10. `PermissionDialog`。
11. `AskUserQuestionCard`。
12. `PlanModePreview`。
13. `ToolCallGroup` / Agent 树。
14. `StatusCard` / memory / goal / background task。
15. 移动端和虚拟化。

---

## 27. 验收清单

实现完成后，用下面清单对照：

- [ ] 用户消息右对齐，最大宽度 72%–82%，右上角尖。
- [ ] 助手消息左对齐，普通内容是气泡，长 Markdown 是 document layout。
- [ ] MessageActionBar 默认隐藏，hover 显示。
- [ ] Thinking 默认一行，展开后低对比容器，active 有 dots 和 cursor。
- [ ] ToolCallBlock 标题行紧凑，支持 pending / success / error。
- [ ] Bash 预览使用 TerminalChrome。
- [ ] Edit / Write 使用 DiffViewer。
- [ ] CodeViewer 有 header、复制、行数、最大高度、展开按钮。
- [ ] DiffViewer 有文件路径、增删 badge、word diff 色。
- [ ] PermissionDialog pending 态有 warning 边框和三个决策按钮。
- [ ] AskUserQuestion 有 header、tab、option card、textarea、answered 态。
- [ ] Plan 卡有标题、文件路径、Markdown 内容、allowed prompts。
- [ ] 状态卡低调，不抢正文视觉。
- [ ] 所有长内容都有 max-height 和 overflow。
- [ ] light / dark token 可切换，至少 light 完整可用。

---

## 28. VS Code Webview / 插件环境适配

如果另一个 Vue3 + SCSS 项目运行在 VS Code 插件的 Webview 里，需要额外处理主题、字体、资源路径、通信和快捷键。不要完全按普通 Web / Electron 环境假设。

### 28.1 推荐 token 覆盖

VS Code Webview 会注入 `--vscode-*` CSS 变量。建议在 Webview 根节点加一个类，例如：

```html
<body class="vscode-webview-theme"></body>
```

然后用 VS Code token 覆盖 chat token，保留 Evancod 色值作为 fallback：

```scss
.vscode-webview-theme {
  --chat-font-body: var(
    --vscode-font-family,
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif
  );
  --chat-font-mono: var(--vscode-editor-font-family, 'JetBrains Mono', 'SF Mono', Menlo, monospace);

  --chat-color-background: var(--vscode-editor-background, #faf9f5);
  --chat-color-surface: var(--vscode-editor-background, #faf9f5);
  --chat-color-surface-container-lowest: var(--vscode-sideBar-background, #ffffff);
  --chat-color-surface-container-low: var(--vscode-sideBar-background, #f4f4f0);
  --chat-color-surface-container: var(--vscode-input-background, #efeeea);
  --chat-color-surface-container-high: var(--vscode-list-hoverBackground, #e9e8e4);
  --chat-color-surface-container-highest: var(--vscode-list-activeSelectionBackground, #e3e2df);
  --chat-color-surface-hover: var(
    --vscode-list-hoverBackground,
    var(--chat-color-surface-container-high)
  );
  --chat-color-surface-selected: var(
    --vscode-list-activeSelectionBackground,
    var(--chat-color-surface-container)
  );
  --chat-color-surface-user-msg: var(
    --vscode-input-background,
    var(--chat-color-surface-container)
  );

  --chat-color-text-primary: var(--vscode-editor-foreground, #1b1c1a);
  --chat-color-text-secondary: var(--vscode-descriptionForeground, #54433e);
  --chat-color-text-tertiary: var(--vscode-disabledForeground, #87736d);
  --chat-color-text-accent: var(--vscode-textLink-foreground, #2d628f);

  --chat-color-outline: var(--vscode-descriptionForeground, #87736d);
  --chat-color-outline-variant: var(--vscode-panel-border, #dac1ba);
  --chat-color-border: var(--vscode-panel-border, #dac1ba);

  --chat-color-brand: var(--vscode-button-background, #8f482f);
  --chat-color-secondary: var(--vscode-textLink-foreground, #2d628f);
  --chat-color-success: var(--vscode-testing-iconPassed, #16a34a);
  --chat-color-warning: var(--vscode-editorWarning-foreground, #ca8a04);
  --chat-color-error: var(--vscode-errorForeground, #ba1a1a);

  --chat-color-terminal-bg: var(--vscode-terminal-background, #1e1e1e);
  --chat-color-terminal-fg: var(--vscode-terminal-foreground, #d4d4d4);
  --chat-color-terminal-header: var(--vscode-titleBar-activeBackground, #2d2d2d);
  --chat-color-terminal-border: var(--vscode-panel-border, #1a1a1a);
  --chat-color-terminal-muted: var(--vscode-descriptionForeground, #999999);

  --chat-shadow-sm: none;
  --chat-shadow-card: none;
  --chat-shadow-dropdown: 0 4px 16px rgba(0, 0, 0, 0.24);
}
```

说明：

- VS Code 用户可能使用 dark、light、high contrast 或自定义主题。
- Webview 里最好优先跟随 VS Code 主题变量，再 fallback 到本文 token。
- 不要只靠颜色表达状态，错误、成功、pending 都要同时有 icon / badge / 文案。

### 28.2 VS Code 主题类

VS Code Webview 的 `body` 通常会带主题类：

```text
vscode-light
vscode-dark
vscode-high-contrast
```

可以针对高对比主题加强边框：

```scss
body.vscode-high-contrast,
body.vscode-high-contrast-light {
  .assistant-message__bubble,
  .tool-call,
  .permission-card,
  .ask-card,
  .plan-card,
  .code-viewer,
  .diff-viewer {
    border-width: 2px;
  }

  .message-action-bar__button:focus-visible,
  .tool-call__header:focus-visible,
  .permission-card button:focus-visible,
  .ask-card button:focus-visible {
    outline: 2px solid var(--vscode-focusBorder, var(--chat-color-brand));
    outline-offset: 2px;
  }
}
```

### 28.3 资源路径

VS Code Webview 不能直接依赖普通相对路径加载本地字体、图片、svg sprite。插件侧应使用：

```ts
const uri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'font.woff2'))
```

建议：

- 图标优先使用 Codicons、inline SVG 或 lucide 打包后的 SVG。
- 如果用 Material Symbols，需要把字体文件放入 extension 资源目录，并通过 `asWebviewUri` 注入。
- 不要在 CSS 里写死 `../../public/fonts/...` 这类 Electron / Vite 路径。

### 28.4 Webview 通信

Webview 前端不能直接访问 Node、文件系统或 VS Code API。统一通过 `postMessage`：

```ts
const vscode = acquireVsCodeApi()

vscode.postMessage({
  type: 'chat.send',
  payload: {
    text: inputText,
  },
})
```

插件 host 侧监听：

```ts
webviewView.webview.onDidReceiveMessage(async message => {
  switch (message.type) {
    case 'chat.send':
      // 调用后端 / agent / extension command
      break
    case 'permission.respond':
      // 处理 Allow / Deny
      break
  }
})
```

推荐消息类型：

| 类型                 | 用途                                |
| -------------------- | ----------------------------------- |
| `chat.send`          | 用户发送输入                        |
| `chat.copy`          | 复制内容，可前端处理，也可交给 host |
| `tool.expand`        | 可选，保存工具展开状态              |
| `permission.respond` | 权限 Allow / Deny                   |
| `ask.submit`         | AskUserQuestion 提交答案            |
| `file.open`          | 点击文件路径，在 VS Code 打开文件   |
| `link.openExternal`  | 打开外部链接                        |
| `webview.ready`      | Webview 初始化完成                  |

### 28.5 状态持久化

VS Code Webview 重新加载比较常见。轻量 UI 状态可以用 VS Code Webview state：

```ts
const vscode = acquireVsCodeApi()

vscode.setState({
  draftText,
  expandedToolIds,
  scrollAnchorId,
})

const restored = vscode.getState()
```

适合保存：

- 输入框草稿
- 工具卡展开状态
- thinking 展开状态
- 当前查看的 Agent transcript
- 滚动锚点

不适合保存：

- 真实会话 transcript
- 权限决策结果
- 大型 tool result
- 敏感 token / key

这些应由插件 host 或后端持久化。

### 28.6 快捷键和焦点

VS Code 有自己的快捷键系统，Webview 内部要避免抢占全局快捷键。

建议规则：

| 快捷键           | 行为                                                  |
| ---------------- | ----------------------------------------------------- |
| `Enter`          | 输入框发送，输入法 composing 时不要发送               |
| `Shift+Enter`    | 换行                                                  |
| `Cmd/Ctrl+Enter` | AskUserQuestion textarea 提交                         |
| `Esc`            | 关闭当前展开浮层 / dropdown，不要直接清空输入         |
| `Cmd/Ctrl+F`     | 默认交给 VS Code 或实现本地搜索，二选一               |
| `Cmd/Ctrl+C`     | 有选中文本时复制选中文本，否则复制按钮复制 block 内容 |

输入法处理必须加：

```ts
if (event.isComposing || event.keyCode === 229) return
```

### 28.7 滚动和虚拟化

VS Code Webview 宽度可能很窄，且 panel/sidebar 会频繁 resize。

建议：

```scss
.chat-list {
  height: 100vh;
  overflow: auto;
  scrollbar-color: var(--vscode-scrollbarSlider-background, rgba(128, 128, 128, 0.35)) transparent;
}

.chat-list__inner {
  max-width: min(860px, 100%);
}
```

如果消息很多：

- 优先用虚拟列表。
- tool result / diff / code 自己内部滚动，不要撑爆整页。
- streaming 时只在用户接近底部时自动滚到底，用户手动向上滚动后不要强制拉回底部。

### 28.8 安全限制

VS Code Webview 默认有 CSP，建议显式设置：

```html
<meta
  http-equiv="Content-Security-Policy"
  content="
  default-src 'none';
  img-src ${webview.cspSource} https: data:;
  font-src ${webview.cspSource};
  style-src ${webview.cspSource} 'unsafe-inline';
  script-src 'nonce-${nonce}';
"
/>
```

注意：

- Markdown 渲染必须 sanitize，禁止直接 `v-html` 渲染未清洗 HTML。
- 外部链接点击要发给 extension host，由 `vscode.env.openExternal` 打开。
- 文件路径点击要发给 host，由 VS Code API 打开，不要在 Webview 内自己拼 URL。
- 工具输出可能包含 ANSI、HTML、路径、命令，默认按文本渲染。

### 28.9 图标建议

VS Code 插件环境优先级：

1. Codicons：和 VS Code 原生风格一致。
2. inline SVG：最稳定，不依赖字体加载。
3. lucide 静态 SVG：适合现代线性图标。
4. Material Symbols：可以用，但需要额外打包字体。

工具图标映射可以改成：

| 工具                 | Codicon 建议 |
| -------------------- | ------------ |
| Bash                 | `terminal`   |
| Read                 | `file`       |
| Write / Edit         | `edit`       |
| Glob / Grep          | `search`     |
| Agent                | `hubot`      |
| WebFetch / WebSearch | `globe`      |
| Skill                | `sparkle`    |
| Permission           | `shield`     |
| Error                | `error`      |
| Success              | `check`      |

### 28.10 VS Code 环境验收清单

- [ ] Webview 跟随 VS Code light / dark 主题。
- [ ] 高对比主题下边框、焦点、状态仍清晰。
- [ ] 字体使用 `--vscode-font-family` 和 `--vscode-editor-font-family`。
- [ ] 字体、图标、图片路径通过 `asWebviewUri` 生成。
- [ ] 前端只通过 `postMessage` 和 extension host 通信。
- [ ] Markdown 输出经过 sanitize。
- [ ] `Enter` 发送兼容中文输入法 composing。
- [ ] 点击文件路径能在 VS Code editor 打开。
- [ ] 外部链接由 VS Code API 打开。
- [ ] Webview reload 后能恢复草稿和展开状态。

---

## 29. 与前两份文档的关系

- `docs/ui-clone/02-ui-design-spec.md`：全局 Desktop App 设计规范。
- `chat-ui-style-guide.md`：对话区视觉语言和组件总览。
- 本文：Vue3 + SCSS 的对话区实现规格，额外包含 VS Code Webview 适配。

如果另一个项目只实现对话区，优先读本文；如果要复刻整个桌面应用，再结合前两份文档。
