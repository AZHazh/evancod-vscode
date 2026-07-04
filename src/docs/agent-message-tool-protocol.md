# Agent 消息协议、工具执行与权限流程

本文梳理 `cc-desktop-main` 中一次对话从桌面端发出，到 server、CLI/agent runtime、工具执行、权限审批，再回到 UI 的完整链路。重点覆盖三块：消息协议、工具执行/权限流程、关键 UI 组件数据结构。

## 1. 总体架构

`cc-desktop-main` 的 Agent 链路分为四层：

```text
Desktop React UI
  ↓ WebSocket ClientMessage
Local Server WebSocket
  ↓ SDK stream-json / control protocol
CLI / Agent Runtime
  ↓ Provider streaming + tool loop
Model / Tools / Permission System
```

一次用户对话不是简单的“发文本、收文本”，而是一个结构化事件流：

```text
user_message
→ status / thinking
→ assistant text stream
→ tool_use stream
→ permission_request
→ permission_response
→ tool execution
→ tool_result
→ next model turn
→ final assistant text
→ message_complete
```

核心特征：

- 工具调用会被转换成 UI 可见事件。
- 工具输入支持 streaming partial JSON。
- 工具结果作为 `tool_result` 回灌给模型，也同步展示到 UI。
- 权限审批发生在 runtime 执行工具前，不是纯前端状态。
- Plan Mode、AskUserQuestion、Task 工具都走统一 tool protocol。

## 2. Desktop 与 Server 消息协议

协议类型主要定义在：

- `desktop/src/types/chat.ts`
- `src/server/ws/events.ts`

### 2.1 Desktop → Server：ClientMessage

```ts
export type ClientMessage =
  | { type: 'prewarm_session' }
  | {
      type: 'user_message'
      content: string
      attachments?: AttachmentRef[]
    }
  | {
      type: 'permission_response'
      requestId: string
      allowed: boolean
      rule?: string
      updatedInput?: Record<string, unknown>
      denyMessage?: string
      permissionUpdates?: PermissionUpdate[]
    }
  | {
      type: 'computer_use_permission_response'
      requestId: string
      response: ComputerUsePermissionResponse
    }
  | { type: 'set_permission_mode'; mode: PermissionMode }
  | ({ type: 'set_runtime_config' } & RuntimeSelection)
  | { type: 'stop_generation' }
  | { type: 'ping' }
```

#### `user_message`

用户发送普通对话。

```ts
{
  type: 'user_message',
  content: '帮我修改这个 bug',
  attachments?: []
}
```

Server 收到后会：

1. 设置 session 状态为 `thinking`。
2. 启动或复用 CLI 子进程。
3. 通过 SDK socket 把 user message 发给 CLI runtime。
4. 等待 CLI 返回 stream events。

#### `permission_response`

用户审批工具权限。

```ts
{
  type: 'permission_response',
  requestId: string,
  allowed: boolean,
  rule?: 'once' | 'always',
  updatedInput?: Record<string, unknown>,
  denyMessage?: string,
  permissionUpdates?: PermissionUpdate[]
}
```

Server 会把它转换成 SDK control response，恢复 CLI runtime 中被暂停的工具执行。

#### `set_permission_mode`

切换权限模式。

```ts
{
  type: 'set_permission_mode',
  mode: 'default' | 'acceptEdits' | 'bypassPermissions'
}
```

权限模式不是单纯 UI 状态。Server 会把模式传给 CLI runtime；部分模式变化可能需要重启 CLI session。

#### `stop_generation`

停止当前生成。

Server 会先通过 SDK 发 interrupt；如果短时间内仍未停止，则强制 stop CLI session，并通知 UI 回到 `idle`。

### 2.2 Server → Desktop：ServerMessage

```ts
export type ServerMessage =
  | { type: 'connected'; sessionId: string }
  | {
      type: 'content_start'
      blockType: 'text' | 'tool_use'
      toolName?: string
      toolUseId?: string
      parentToolUseId?: string
    }
  | {
      type: 'content_delta'
      text?: string
      toolInput?: string
    }
  | {
      type: 'tool_use_complete'
      toolName: string
      toolUseId: string
      input: unknown
      parentToolUseId?: string
    }
  | {
      type: 'tool_result'
      toolUseId: string
      content: unknown
      isError: boolean
      parentToolUseId?: string
    }
  | {
      type: 'permission_request'
      requestId: string
      toolName: string
      toolUseId?: string
      input: unknown
      description?: string
    }
  | {
      type: 'message_complete'
      usage: TokenUsage
    }
  | {
      type: 'thinking'
      text: string
    }
  | {
      type: 'status'
      state: ChatState
      verb?: string
    }
```

#### `content_start`

表示一个新的 assistant 内容块开始。

```ts
{ type: 'content_start', blockType: 'text' }
```

或：

```ts
{
  type: 'content_start',
  blockType: 'tool_use',
  toolName: 'Bash',
  toolUseId: 'toolu_xxx'
}
```

UI 用它判断后续 `content_delta` 应该进入普通文本，还是进入工具输入 JSON。

#### `content_delta`

流式增量。

```ts
{ type: 'content_delta', text: '正在分析...' }
```

或：

```ts
{ type: 'content_delta', toolInput: '{"command":"bun test' }
```

`toolInput` 用于展示 pending tool card，例如模型正在生成 Bash 命令或 Write 内容。

#### `tool_use_complete`

模型完整生成了工具调用。

```ts
{
  type: 'tool_use_complete',
  toolName: 'Bash',
  toolUseId: 'toolu_123',
  input: {
    command: 'bun test src/foo.test.ts',
    description: 'Run focused test'
  }
}
```

UI 会创建或更新一条 `tool_use` 消息块。

#### `permission_request`

runtime 准备执行工具，但权限系统要求用户确认。

```ts
{
  type: 'permission_request',
  requestId: 'req_123',
  toolName: 'Bash',
  toolUseId: 'toolu_123',
  input: { command: 'rm file' },
  description: 'Run shell command'
}
```

UI 显示审批卡片。用户选择允许或拒绝后，发回 `permission_response`。

#### `tool_result`

工具执行完成。

```ts
{
  type: 'tool_result',
  toolUseId: 'toolu_123',
  content: 'test passed',
  isError: false
}
```

UI 用 `toolUseId` 把 result 绑定到对应 tool card。runtime 也会把这个结果作为 Anthropic `tool_result` block 回灌给模型。

#### `thinking`

模型 thinking 内容。

```ts
{
  type: 'thinking',
  text: 'I need to inspect the failing test...'
}
```

UI 会渲染为 thinking block。它是独立 block，不应该混进普通 assistant 文本里。

#### `message_complete`

一次 agent turn 完成。

```ts
{
  type: 'message_complete',
  usage: {
    input_tokens: 1234,
    output_tokens: 456
  }
}
```

UI 用它停止 loading、清理 streaming 状态、更新 token usage。

## 3. Server 如何翻译 CLI / SDK 消息

核心位置：

- `src/server/ws/handler.ts`
- `src/server/services/conversationService.ts`

### 3.1 CLI 启动参数

Server 启动 CLI 时会使用 stream-json 协议：

```ts
[
  '--print',
  '--verbose',
  '--sdk-url',
  sdkUrl,
  '--enable-auth-status',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--include-partial-messages',
  '--session-id',
  sessionId,
  '--replay-user-messages'
]
```

关键参数：

- `--sdk-url`：让 CLI 连接 server 的 SDK WebSocket。
- `--input-format stream-json`：server 可以持续给 CLI 发 JSON message。
- `--output-format stream-json`：CLI 输出结构化事件。
- `--include-partial-messages`：允许 UI 展示工具输入的 streaming JSON。

### 3.2 stream_event → UI event

Server 通过 `translateCliMessage(cliMsg, sessionId)` 把 CLI event 转成 UI event。

| CLI stream event | ServerMessage | UI 含义 |
| --- | --- | --- |
| `message_start` | `status: thinking` | agent 开始响应 |
| `content_block_start` text | `content_start: text` | assistant 文本开始 |
| `content_block_start` tool_use | `content_start: tool_use` | 工具调用开始 |
| `content_block_delta.text_delta` | `content_delta.text` | 文本流式追加 |
| `content_block_delta.input_json_delta` | `content_delta.toolInput` | 工具 JSON 输入流式追加 |
| `content_block_delta.thinking_delta` | `thinking` | thinking 流式追加 |
| `content_block_stop` tool_use | `tool_use_complete` | 工具调用 JSON 完整 |
| `result` | `message_complete` | agent turn 完成 |

### 3.3 control_request → permission_request

CLI runtime 执行工具前如果需要权限，会发 SDK control request：

```ts
{
  type: 'control_request',
  request_id: 'req_xxx',
  request: {
    subtype: 'can_use_tool',
    tool_name: 'Bash',
    tool_use_id: 'toolu_xxx',
    input: {},
    description: 'Run command'
  }
}
```

Server 翻译成：

```ts
{
  type: 'permission_request',
  requestId: cliMsg.request_id,
  toolName: cliMsg.request.tool_name,
  toolUseId: cliMsg.request.tool_use_id,
  input: cliMsg.request.input ?? {},
  description: cliMsg.request.description
}
```

这是工具权限请求能显示到 UI 的关键。

## 4. Desktop UI 消息模型

核心定义在 `desktop/src/types/chat.ts`。

```ts
export type UIMessage =
  | {
      id: string
      type: 'user_text'
      content: string
      modelContent?: string
      transcriptMessageId?: string
      timestamp: number
      attachments?: UIAttachment[]
      pending?: boolean
      optimisticQueued?: boolean
    }
  | {
      id: string
      type: 'assistant_text'
      content: string
      transcriptMessageId?: string
      timestamp: number
      model?: string
    }
  | {
      id: string
      type: 'thinking'
      content: string
      timestamp: number
    }
  | {
      id: string
      type: 'tool_use'
      toolName: string
      toolUseId: string
      input: unknown
      timestamp: number
      parentToolUseId?: string
      isPending?: boolean
      partialInput?: string
    }
  | {
      id: string
      type: 'tool_result'
      toolUseId: string
      content: unknown
      isError: boolean
      timestamp: number
      parentToolUseId?: string
    }
  | {
      id: string
      type: 'permission_request'
      requestId: string
      toolName: string
      toolUseId?: string
      input: unknown
      description?: string
      timestamp: number
    }
```

这个结构的价值在于，它能表达真正 Agent UI 需要的 block：

- 用户文本。
- assistant 文本。
- thinking。
- tool use。
- tool result。
- permission request。
- streaming pending input。
- subagent parent tool relation。

如果消息模型只有 `{ role, content }`，就无法可靠表达工具调用、工具结果、权限审批和 Plan/AskUserQuestion 等交互。

## 5. Desktop Store 如何落地事件

核心位置：

- `desktop/src/stores/chatStore.ts`

每个 session 的状态大致包括：

```ts
type PerSessionState = {
  messages: UIMessage[]
  chatState: ChatState
  streamingText: string
  streamingToolInput: string
  activeToolUseId: string | null
  activeToolName: string | null
  pendingPermission: unknown
  pendingComputerUsePermission: unknown
  tokenUsage: TokenUsage
  queuedUserMessages: unknown[]
  agentTaskNotifications: unknown[]
  backgroundAgentTasks: unknown[]
}
```

事件落地规则：

- `content_start` 为 text：开始新的 assistant streaming text。
- `content_start` 为 tool_use：记录 `activeToolUseId`、`activeToolName`，初始化 `streamingToolInput`。
- `content_delta.text`：追加到当前 assistant text block。
- `content_delta.toolInput`：追加到 `streamingToolInput`，用于 pending tool card。
- `thinking`：生成或更新 thinking UI message。
- `tool_use_complete`：upsert `tool_use` UIMessage，并清空 active tool streaming 状态。
- `tool_result`：追加 `tool_result` UIMessage，并通过 `toolUseId` 和 tool card 配对。
- `permission_request`：写入 `pendingPermission` 并触发权限 UI。
- `message_complete`：清理 streaming 状态，更新 token usage，回到 idle。

任务工具会触发 task store 刷新：

```ts
const TASK_TOOL_NAMES = new Set([
  'TaskCreate',
  'TaskUpdate',
  'TaskGet',
  'TaskList',
  'TodoWrite'
])
```

## 6. 工具执行流程

核心位置：

- `src/QueryEngine.ts`
- `src/query.ts`
- `src/services/tools/toolExecution.ts`
- `src/Tool.ts`

总体流程：

```text
User sends message
→ QueryEngine.submitMessage()
→ query()
→ provider streaming response
→ model emits tool_use
→ runTools()
→ runToolUse()
→ validate input
→ pre-tool hooks
→ canUseTool()
→ allow / deny / ask
→ tool.call()
→ create tool_result user message
→ feed tool_result back to model
→ next model turn
```

### 6.1 QueryEngine

`QueryEngine.submitMessage()` 是 agent loop 入口，负责：

- 准备 cwd。
- 准备 system prompt。
- 准备 user context。
- 注入 tools。
- 注入 commands。
- 注入 MCP clients。
- 注入 `canUseTool`。
- 调用 `query()`。
- 持久化 messages 和 token usage。

### 6.2 query loop

`src/query.ts` 负责模型循环：

1. 调 provider。
2. 处理 streaming response。
3. 识别 text / thinking / tool_use。
4. 执行 tools。
5. 把 tool_result 回灌到 messages。
6. 继续下一轮，直到模型不再调用工具或达到 max turns。

关键约束：每个 `tool_use` 必须有对应 `tool_result`，否则下一轮模型上下文会不完整。

### 6.3 runToolUse

`src/services/tools/toolExecution.ts` 中的 `runToolUse()` 是工具真正执行的位置。

```text
runToolUse(toolUse)
→ 根据 tool name 找 Tool
→ 校验 / 规范化 input
→ runPreToolUseHooks
→ canUseTool(tool, input, ...)
→ 如果 allow：tool.call()
→ 如果 deny：生成 is_error tool_result
→ 如果 error：生成 is_error tool_result
→ createUserMessage({ content: [tool_result] })
```

## 7. 权限流程

核心位置：

- `src/hooks/useCanUseTool.tsx`
- `src/hooks/toolPermission/handlers/interactiveHandler.ts`
- `src/utils/permissions/permissions.ts`
- `src/entrypoints/sdk/controlSchemas.ts`

权限判断发生在 runtime 执行工具前：

```text
tool_use generated
→ runToolUse()
→ canUseTool()
→ permission decision
```

UI 只是权限请求的展示端，不是权限系统本身。

### 7.1 CanUseToolFn

```ts
export type CanUseToolFn<Input extends Record<string, unknown> = Record<string, unknown>> =
  (
    tool,
    input,
    toolUseContext,
    assistantMessage,
    toolUseID,
    forceDecision?
  ) => Promise<PermissionDecision<Input>>
```

权限结果大致包括：

```ts
type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: Input }
  | { behavior: 'deny'; message?: string }
  | { behavior: 'ask' }
```

### 7.2 权限来源

`hasPermissionsToUseTool()` 会综合：

- 当前 permission mode。
- allow rules。
- deny rules。
- ask rules。
- tool 自身的 `checkPermissions()`。
- Bash 命令安全分类。
- plan mode 限制。
- session / settings / cliArg / command 来源的规则。

规则来源包括：

```ts
const PERMISSION_RULE_SOURCES = [
  ...SETTING_SOURCES,
  'cliArg',
  'command',
  'session'
]
```

### 7.3 ask 权限如何进入 UI

当权限结果是 ask：

```text
canUseTool()
→ handleInteractivePermission()
→ bridgeCallbacks.sendRequest()
→ SDK control_request can_use_tool
→ server translateCliMessage()
→ Desktop permission_request
```

SDK control schema：

```ts
{
  subtype: 'can_use_tool',
  tool_name: string,
  input: Record<string, unknown>,
  permission_suggestions?: PermissionUpdate[],
  blocked_path?: string,
  decision_reason?: string,
  title?: string,
  display_name?: string,
  tool_use_id: string,
  agent_id?: string,
  description?: string
}
```

### 7.4 用户审批后如何恢复

```text
Desktop permission_response
→ Server handlePermissionResponse()
→ conversationService.respondToPermission()
→ SDK control_response
→ CLI runtime resolve permission promise
→ runToolUse() 继续执行或返回 deny result
```

允许时：

```ts
{
  behavior: 'allow',
  updatedInput: updatedInput ?? {},
  updatedPermissions?: []
}
```

拒绝时：

```ts
{
  behavior: 'deny',
  message: 'User denied via UI'
}
```

如果拒绝，runtime 仍会生成 `tool_result`，通常带 `is_error`，告诉模型工具未执行。

## 8. 关键 UI 组件数据结构

### 8.1 ToolCallBlock

位置：

- `desktop/src/components/chat/ToolCallBlock.tsx`

Props：

```ts
type Props = {
  toolName: string
  input: unknown
  result?: { content: unknown; isError: boolean } | null
  agentTaskNotification?: AgentTaskNotification
  compact?: boolean
  isPending?: boolean
  partialInput?: string
}
```

工具 icon 映射：

```ts
const TOOL_ICONS: Record<string, string> = {
  Bash: 'terminal',
  Read: 'description',
  Write: 'edit_document',
  Edit: 'edit_note',
  Glob: 'search',
  Grep: 'find_in_page',
  Agent: 'smart_toy',
  WebSearch: 'travel_explore',
  WebFetch: 'cloud_download',
  NotebookEdit: 'note',
  Skill: 'auto_awesome'
}
```

渲染规则：

- `Edit`：用 `DiffViewer` 展示 `old_string` 到 `new_string` 的 diff。
- `Write`：用 `DiffViewer` 展示新文件内容；streaming 时可基于 `partialInput` 预览 content。
- `Bash`：用 `TerminalChrome` 展示命令。
- `Read`：主要展示 result output。
- `ExitPlanMode`：进入 `PlanToolCallBlock`，渲染 `PlanPreviewCard`。
- 其他工具：展示 tool name、input JSON、result output、error state、copy button。

### 8.2 ToolResultBlock

位置：

- `desktop/src/components/chat/ToolResultBlock.tsx`

Props：

```ts
type Props = {
  content: unknown
  isError: boolean
  toolName?: string
  standalone?: boolean
}
```

行为：

- `standalone=false` 时通常不渲染，避免和 `ToolCallBlock` 组合展示重复。
- `content` 支持 string / array / object。
- error result 用 error 样式。
- normal result 用 `CodeViewer`。

## 9. Plan Mode 协议

核心位置：

- `src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`
- `desktop/src/components/chat/PlanModePreview.tsx`
- `desktop/src/components/chat/ToolCallBlock.tsx`

Plan Mode 不是纯 UI 模式，而是 runtime permission mode + 特殊工具。

### 9.1 ExitPlanMode 工具

输入包含：

```ts
{
  allowedPrompts?: Array<{
    tool: 'Bash'
    prompt: string
  }>
}
```

SDK input 还会注入：

```ts
{
  plan: string
  planFilePath: string
}
```

工具属性：

```ts
shouldDefer: true
requiresUserInteraction(): true
isReadOnly(): false
```

权限逻辑：

- 必须处于 plan mode。
- 非 teammate 场景下 `checkPermissions()` 返回 ask。
- 用户批准后，工具读取 plan 文件。
- 必要时写回用户编辑过的 plan。
- 退出 plan mode。

### 9.2 UI 渲染

`ToolCallBlock` 检测 `isExitPlanModeTool(toolName)` 后进入 `PlanToolCallBlock`，展示：

- plan 内容。
- plan file path。
- requested permissions。
- approve / reject 状态。

这意味着 Plan Mode 的批准过程和普通工具权限是同一套机制。

## 10. AskUserQuestion 协议

核心位置：

- `src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`

AskUserQuestion 用于让模型主动向用户提问，并把答案作为 `tool_result` 回灌给模型。

### 10.1 输入结构

```ts
{
  questions: Array<{
    question: string
    header: string
    multiSelect: boolean
    options: Array<{
      label: string
      description: string
      preview?: string
    }>
  }>
  answers?: Record<string, string>
  annotations?: Record<string, {
    notes?: string
    preview?: string
  }>
  metadata?: Record<string, unknown>
}
```

限制：

- `questions` 数量 1-4。
- 每个问题 2-4 个 options。
- 用户始终可以选择 Other 并输入自定义内容。

### 10.2 工具属性

```ts
shouldDefer: true
isReadOnly(): true
requiresUserInteraction(): true
checkPermissions(): ask
```

`call()` 返回：

```ts
{
  questions,
  answers,
  annotations
}
```

然后 `mapToolResultToToolResultBlockParam()` 把用户回答转换成模型可读文本。

### 10.3 闭环

```text
model emits AskUserQuestion tool_use
→ runtime sees requiresUserInteraction
→ permission / user interaction request
→ UI renders question choices
→ user answers
→ Desktop sends response
→ runtime creates tool_result
→ model receives answer and continues
```

如果只是前端弹窗，但没有 `tool_result` 回灌给模型，就是半截实现。

## 11. Task / Todo 工具协议

Desktop store 识别任务工具：

```ts
const TASK_TOOL_NAMES = new Set([
  'TaskCreate',
  'TaskUpdate',
  'TaskGet',
  'TaskList',
  'TodoWrite'
])
```

停止类工具：

```ts
const TASK_STOP_TOOL_NAMES = new Set([
  'TaskStop',
  'KillShell'
])
```

任务链路：

```text
model emits TaskCreate / TaskUpdate
→ runtime executes task tool
→ tool_result arrives
→ desktop chatStore detects task tool
→ useCLITaskStore.refreshTasks(sessionId)
→ UI task summary / task panel 更新
```

任务系统不是纯前端 todo list，而是工具执行结果驱动的状态刷新。

## 12. Bash / 后台任务设计要点

Bash 在 UI 层至少有这些字段：

```ts
{
  command: string
  description?: string
  run_in_background?: boolean
  timeout?: number
}
```

展示规则：

- pending 时显示命令正在准备。
- complete 后显示 terminal chrome。
- result 到达后展示 stdout / stderr 或 error。
- 后台任务需要 task id / notification，否则 UI 无法追踪。

关键点：

- command 不能降级成普通 assistant text。
- command 必须作为 `tool_use.input.command` 保存。
- stdout / stderr 必须作为 `tool_result.content` 保存。
- `isError` 必须保留。
- 后台任务必须有可追踪 id。

## 13. 一次用户消息的端到端时序

```text
1. 用户在 Desktop 输入消息
2. chatStore 添加 optimistic user_text
3. WebSocketManager 发送 ClientMessage.user_message
4. Server handleUserMessage()
5. Server ensureCliSessionStarted()
6. conversationService 启动或复用 CLI
7. Server 通过 SDK socket 发 user message 给 CLI
8. CLI QueryEngine.submitMessage()
9. query() 调 provider
10. provider streaming 返回 text / thinking / tool_use
11. CLI 发 stream_event 给 Server
12. Server translateCliMessage()
13. Desktop 收 content_start / content_delta / thinking
14. UI 渲染 assistant text / thinking / tool pending card
15. 模型 tool_use 完成
16. Server 发 tool_use_complete
17. UI 渲染完整 ToolCallBlock
18. runtime runToolUse()
19. canUseTool() 判断权限
20. 如果 ask，CLI 发 control_request can_use_tool
21. Server 转 permission_request
22. UI 展示权限请求
23. 用户 approve / deny
24. Desktop 发 permission_response
25. Server 转 control_response
26. runtime 继续执行或拒绝工具
27. tool.call() 执行
28. runtime 生成 tool_result user message
29. CLI / Server 发 tool_result 给 UI
30. UI 把 result 合并进 tool card
31. query() 把 tool_result 回灌给模型
32. 模型继续下一轮
33. 最终 assistant text 完成
34. CLI 发 result
35. Server 发 message_complete
36. UI 清理 streaming 状态，更新 usage
```

## 14. 对 vscode-evancod 的最小改造建议

如果要把普通 chat UI 改成真正 Agent UI，最小需要补齐三层。

### 14.1 消息协议层

不要只传：

```ts
{ role: 'assistant', content: string }
```

至少支持：

```ts
type AgentServerEvent =
  | { type: 'content_start'; blockType: 'text' | 'tool_use'; toolName?: string; toolUseId?: string }
  | { type: 'content_delta'; text?: string; toolInput?: string }
  | { type: 'tool_use_complete'; toolName: string; toolUseId: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: unknown; isError: boolean }
  | { type: 'permission_request'; requestId: string; toolName: string; toolUseId?: string; input: unknown; description?: string }
  | { type: 'thinking'; text: string }
  | { type: 'message_complete'; usage?: unknown }
  | { type: 'status'; state: string; verb?: string }
```

### 14.2 Runtime 工具层

模型响应必须保留并执行 tool calls：

```text
model response
→ parse tool_use / tool_calls
→ validate tool input
→ permission check
→ execute tool
→ append tool_result
→ call model again
```

不能把 tool call 丢掉，也不能只把它转成文本展示。

### 14.3 UI block 层

前端消息结构至少支持：

```ts
type UIBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown; partialInput?: string; pending?: boolean }
  | { type: 'tool_result'; toolUseId: string; content: unknown; isError: boolean }
  | { type: 'permission_request'; requestId: string; toolUseId?: string; toolName: string; input: unknown }
```

渲染组件至少需要：

- `AssistantTextBlock`
- `ThinkingBlock`
- `ToolCallBlock`
- `ToolResultBlock`
- `PermissionRequestBlock`
- `PlanPreviewBlock`
- `AskUserQuestionBlock`
- `TaskSummaryBlock`

## 15. 最小可用实现清单

### P0：消息事件

必须实现：

- `content_start`
- `content_delta`
- `tool_use_complete`
- `tool_result`
- `permission_request`
- `permission_response`
- `thinking`
- `message_complete`

没有这些，工具链路无法闭环。

### P1：工具执行 loop

必须实现：

```text
tool_use → permission → execute → tool_result → next model turn
```

并保证：

- 每个 `tool_use` 都有 `tool_result`。
- `tool_result` 不被消息转换层丢掉。
- `isError` 被保留。
- `toolUseId` 被保留。
- 如果支持 subagent，也要保留 `parentToolUseId`。

### P2：权限系统

必须让 permission mode 进入 runtime：

```text
permissionMode
→ canUseTool()
→ allow / deny / ask
```

前端只负责展示和响应，不负责决定所有安全逻辑。

### P3：UI 组件

至少实现：

- 工具卡片。
- 工具结果。
- 权限请求。
- thinking。
- Plan preview。
- AskUserQuestion 表单。
- Task list / task summary。

### P4：高级工具

再补：

- Bash background task。
- SubAgent `parentToolUseId`。
- MCP tools。
- Skills。
- Memory events。
- Computer Use permission。

## 16. 结论

`cc-desktop-main` 的核心不是普通聊天 UI，而是事件驱动的 Agent Workbench：

```text
模型输出结构化 block
→ runtime 执行工具
→ 权限系统真实拦截
→ server 转换成 UI 事件
→ UI 展示每个工具和结果
→ 用户审批 / 回答再回到 runtime
→ tool_result 回灌模型继续推理
```

对 `vscode-evancod` 来说，最关键的迁移点是：

1. 把模型 tool call 保留为结构化事件。
2. 建立 `tool_use` / `tool_result` / `permission_request` 的 UI message block。
3. 权限模式必须接入工具执行前的 `canUseTool()`。
4. AskUserQuestion 和 Plan Mode 必须走 `tool_result` 闭环。
5. Bash、Task、SubAgent、MCP、Skill、Memory 都应作为统一工具协议上的扩展，而不是单独 UI hack。
