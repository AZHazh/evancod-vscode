# Evancod Agent Workbench 分批实现路线图

本文档把当前 `vscode-evancod` 从“普通聊天 UI”升级到接近 `cc-desktop-main` 的事件驱动 Agent Workbench，拆成可逐批执行的阶段。

目标不是一次性重写，而是每批都有明确产物、验收标准和下一批依赖。

## 总体目标

当前项目的核心问题是：

```text
用户消息 → 模型文本回复 → Webview 纯文本展示
```

需要升级为：

```text
用户消息
→ Agent runtime 状态流
→ assistant text / thinking / tool_use / permission_request / tool_result
→ 工具执行与权限闭环
→ tool_result 回灌模型
→ 下一轮模型推理
→ message_complete
```

最终 Webview 不再只是 chat，而是能展示：

- 模型思考状态。
- 工具调用卡片。
- 文件读取、编辑、创建。
- Bash 命令执行。
- 权限审批。
- Diff 预览。
- Task / Plan / AskUserQuestion。
- SubAgent / MCP / Skill / Memory。

## 阶段 1：Agent 事件协议 + UIMessage Block

### 目标

建立前后端统一事件协议，让 Extension 能把 Agent runtime 中的结构化事件发给 Webview。

这是后面所有能力的地基。

### 需要完成

#### 1. 定义 AgentServerEvent

在 `src/types/messages.ts` 或独立协议文件中新增：

```ts
type AgentServerEvent =
  | { type: 'content_start'; blockType: 'text' | 'tool_use'; toolName?: string; toolUseId?: string; parentToolUseId?: string }
  | { type: 'content_delta'; text?: string; toolInput?: string }
  | { type: 'tool_use_complete'; toolName: string; toolUseId: string; input: unknown; parentToolUseId?: string }
  | { type: 'tool_result'; toolUseId: string; content: unknown; isError: boolean; parentToolUseId?: string }
  | { type: 'permission_request'; requestId: string; toolName: string; toolUseId?: string; input: unknown; description?: string }
  | { type: 'thinking'; text: string }
  | { type: 'message_complete'; usage?: unknown }
  | { type: 'status'; state: string; verb?: string }
```

#### 2. 定义前端 UIMessage

在 `webview/src/types/index.ts` 中从 `{ role, content }` 升级为 block/message 类型：

```ts
type UIMessage =
  | { id: string; type: 'user_text'; content: string; timestamp: number; attachments?: UIAttachment[] }
  | { id: string; type: 'assistant_text'; content: string; timestamp: number; model?: string }
  | { id: string; type: 'thinking'; content: string; timestamp: number }
  | { id: string; type: 'tool_use'; toolName: string; toolUseId: string; input: unknown; timestamp: number; isPending?: boolean; partialInput?: string; parentToolUseId?: string }
  | { id: string; type: 'tool_result'; toolUseId: string; content: unknown; isError: boolean; timestamp: number; parentToolUseId?: string }
  | { id: string; type: 'permission_request'; requestId: string; toolName: string; toolUseId?: string; input: unknown; description?: string; timestamp: number }
```

#### 3. 扩展 Extension → Webview 消息

新增统一事件：

```ts
{
  type: 'agent.event',
  data: AgentServerEvent
}
```

或直接把事件类型作为顶层 message type。

推荐使用 `agent.event`，方便和现有 `chat.messages.update` 兼容迁移。

#### 4. Webview chat store 落地事件

在 `webview/src/stores/chat.ts` 中维护：

```ts
messages: UIMessage[]
chatState: 'idle' | 'thinking' | 'running' | 'waiting_permission' | 'stopped'
streamingText: string
streamingToolInput: string
activeToolUseId: string | null
activeToolName: string | null
pendingPermission: PermissionRequest | null
tokenUsage: TokenUsage | null
```

事件处理规则：

- `content_start(text)`：创建或准备 assistant streaming text。
- `content_delta.text`：追加到 assistant text。
- `content_start(tool_use)`：记录 active tool。
- `content_delta.toolInput`：追加 partial tool input。
- `tool_use_complete`：upsert tool_use block。
- `tool_result`：追加或绑定 tool_result。
- `permission_request`：写入 pendingPermission，并追加 permission block。
- `thinking`：生成或更新 thinking block。
- `message_complete`：清理 streaming 状态，更新 usage，回到 idle。

### 关键文件

- `src/types/messages.ts`
- `src/types/index.ts`
- `src/services/webview/WebviewManager.ts`
- `webview/src/types/index.ts`
- `webview/src/stores/chat.ts`
- `webview/src/components/chat/MessageList.vue`
- `webview/src/components/chat/MessageItem.vue`

### 验收标准

- Webview 能接收并保存 `agent.event`。
- 前端 store 能落地 text / tool / permission / thinking / complete 事件。
- 不要求工具真的执行，但 UI 状态结构已经能表达完整 Agent 流。

## 阶段 2：Anthropic 真实 Tool Loop

### 目标

让模型工具调用真正闭环：

```text
tool_use → execute tool → tool_result → 回灌模型 → 下一轮推理
```

### 需要完成

#### 1. 保留 Anthropic 原生 content blocks

当前 `AnthropicClient` 把消息压平成 string，并过滤 tool role。需要改成支持 Anthropic 标准格式：

- assistant message 可以包含 `text` 和 `tool_use` block。
- user message 可以包含 `tool_result` block。
- 每个 `tool_use.id` 必须对应一个 `tool_result.tool_use_id`。

#### 2. QueryEngine 发事件

在模型 streaming 时发：

- `content_start(text)`
- `content_delta.text`
- `content_start(tool_use)`
- `content_delta.toolInput`
- `tool_use_complete`
- `message_complete`

#### 3. 执行工具后发 tool_result

工具执行完成后：

```ts
{
  type: 'tool_result',
  toolUseId,
  content,
  isError
}
```

同时把标准 `tool_result` block 加回模型上下文。

#### 4. 保证每个 tool_use 都有 tool_result

即使工具失败、权限拒绝、参数错误，也必须生成 error tool result。

```text
工具失败 ≠ 丢弃工具调用
工具失败 = isError tool_result
```

#### 5. 修正 tool call 字段命名

当前类型里有 `ToolCall.args`，QueryEngine 实际用 `toolCall.input`。需要统一。

推荐统一为：

```ts
{
  id: string
  name: string
  input: unknown
}
```

### 关键文件

- `src/core/engine/QueryEngine.ts`
- `src/core/services/api/AnthropicClient.ts`
- `src/types/index.ts`
- `src/core/tools/base/Tool.ts`

### 验收标准

- 用户要求“读取某文件”时，模型能调用 read tool。
- UI 能收到 `tool_use_complete` 和 `tool_result`。
- 模型下一轮能基于文件内容继续回答。
- 工具失败也会回传 error tool_result。

## 阶段 3：权限系统闭环

### 目标

让权限模式真正进入 runtime，而不是只存在于 UI。

需要实现：

```text
tool_use generated
→ canUseTool()
→ allow / deny / ask
→ permission_request
→ permission_response
→ continue tool execution / deny tool_result
```

### 需要完成

#### 1. 定义 PermissionDecision

```ts
type PermissionDecision<Input = unknown> =
  | { behavior: 'allow'; updatedInput?: Input }
  | { behavior: 'deny'; message?: string }
  | { behavior: 'ask'; requestId: string; description?: string }
```

#### 2. 实现 canUseTool

权限判断至少考虑：

- 当前 `permissionMode`。
- 工具是否只读。
- 工具风险等级。
- Plan Mode 限制。
- Bash 命令安全分类。
- 用户本次 session 的 allow/deny rules。

基础策略：

```text
default:
  read/search/git status 类允许
  edit/write/bash/delete 询问

acceptEdits:
  edit/write 允许
  bash/delete 仍询问

bypassPermissions:
  大部分允许，但危险命令仍可硬拦截

plan:
  只允许 read/search/analyze/git query/task query/plan tools
```

#### 3. 实现权限等待器

QueryEngine 需要能暂停工具执行并等待 Webview 回应。

```ts
permissionManager.requestPermission(request)
→ WebviewManager.postMessage(permission_request)
→ Promise pending
→ Webview sends permission_response
→ Promise resolve
```

#### 4. Webview 发送 permission_response

前端 PermissionCard 用户点击后发送：

```ts
{
  type: 'permission_response',
  data: {
    requestId,
    allowed,
    rule?: 'once' | 'always',
    updatedInput?,
    denyMessage?
  }
}
```

#### 5. deny 也必须回灌模型

拒绝后生成：

```ts
{
  type: 'tool_result',
  toolUseId,
  content: 'User denied permission...',
  isError: true
}
```

### 关键文件

- `src/services/chat/ChatService.ts`
- `src/core/engine/QueryEngine.ts`
- `src/services/webview/WebviewManager.ts`
- `src/services/plan/PlanModeManager.ts`
- `webview/src/stores/chat.ts`
- `webview/src/components/chat/PermissionRequestBlock.vue`

### 验收标准

- 默认模式下，`edit_file` 会弹审批卡。
- 用户允许后工具继续执行。
- 用户拒绝后模型收到 error tool_result 并继续响应。
- Plan Mode 下 `edit_file/bash` 被阻止。

## 阶段 4：前端 Tool UI 对标

### 目标

把 Agent 事件渲染成可理解、可交互的工作台 UI。

### 需要完成

#### 1. MessageItem 分发渲染

`MessageItem.vue` 不再只做 `{{ message.content }}`，而是按 `message.type` 分发：

- `user_text` → UserTextBlock
- `assistant_text` → AssistantTextBlock
- `thinking` → ThinkingBlock
- `tool_use` → ToolCallBlock
- `tool_result` → ToolResultBlock 或合并进 ToolCallBlock
- `permission_request` → PermissionRequestBlock

#### 2. ToolCallBlock

Props：

```ts
type Props = {
  toolName: string
  input: unknown
  result?: { content: unknown; isError: boolean } | null
  isPending?: boolean
  partialInput?: string
  parentToolUseId?: string
}
```

渲染规则：

- `read_file`：显示文件路径、读取状态、结果摘要。
- `edit_file`：显示 diff。
- `write_file`：显示新文件 diff / content preview。
- `bash`：显示 terminal chrome。
- `glob/grep`：显示搜索条件和结果。
- `agent`：显示子 Agent 状态。
- `exit_plan_mode`：显示 PlanPreview。
- `ask_user_question`：显示问题表单。
- 其他工具：展示 JSON input/result。

#### 3. DiffViewer

用于：

- `edit_file.old_string → new_string`
- `write_file.content`
- 文件变更汇总

最低要求：

- 新增行绿色。
- 删除行红色。
- 文件路径可复制。

#### 4. BashCard / TerminalChrome

展示：

- command。
- description。
- running / completed / error 状态。
- stdout / stderr。
- exit code。
- timeout。

#### 5. ThinkingBlock

展示模型 thinking / 状态，和普通 assistant 文本分开。

#### 6. PermissionRequestBlock

展示：

- toolName。
- description。
- input 摘要。
- 允许。
- 拒绝。
- 本次会话允许。
- 可选输入修改。

### 关键文件

- `webview/src/components/chat/MessageItem.vue`
- `webview/src/components/chat/ToolCallBlock.vue`
- `webview/src/components/chat/ToolResultBlock.vue`
- `webview/src/components/chat/PermissionRequestBlock.vue`
- `webview/src/components/chat/ThinkingBlock.vue`
- `webview/src/components/diff/DiffViewer.vue`
- `webview/src/components/terminal/TerminalChrome.vue`

### 验收标准

- 工具调用不再显示成普通文本。
- 文件编辑能看到 diff。
- Bash 能看到命令卡片和输出。
- 权限请求能交互。
- thinking 和 assistant text 分开显示。

## 阶段 5：Plan / AskUserQuestion / Task 统一协议闭环

### 目标

把已有半成品能力迁移到统一 tool protocol，而不是单独 UI hack。

### 需要完成

#### 1. Plan Mode

当前已有 `PlanModeManager`，但需要接入工具执行前权限判断。

需要完成：

- `permissionMode = plan` 时进入 runtime 限制。
- 禁止写文件、bash 等修改工具。
- `exit_plan_mode` 作为交互型工具，触发 approval。
- 用户批准后生成 tool_result。
- 用户拒绝后生成 error tool_result。

UI：

- PlanPreviewBlock。
- 计划内容。
- 请求的权限。
- approve / reject。

#### 2. AskUserQuestion

当前 `AskUserQuestionTool` 没有真正发 UI，也没有闭环。

需要完成：

```text
model emits ask_user_question
→ tool_use_complete
→ permission/user interaction request
→ UI renders question form
→ user answers
→ permission_response 或 question.answer
→ tool_result 回灌模型
```

建议复用权限/交互等待器，不要单独做全局 callback hack。

#### 3. Task 工具

TaskCreate / TaskUpdate / TaskList / TaskGet 都应该：

- 作为 tool_use 展示。
- 执行后返回 tool_result。
- Webview 检测任务工具后刷新 task store。
- TaskPanel 由实际任务状态驱动。

### 关键文件

- `src/services/plan/PlanModeManager.ts`
- `src/core/tools/advanced/EnterPlanModeTool.ts`
- `src/core/tools/advanced/ExitPlanModeTool.ts`
- `src/core/tools/agent/AskUserQuestionTool.ts`
- `src/core/tools/task/*`
- `webview/src/components/plan/*`
- `webview/src/components/task/*`
- `webview/src/components/agent/*`

### 验收标准

- Plan Mode 真的限制工具。
- ExitPlanMode 能通过 UI 审批继续。
- AskUserQuestion 能显示问题，用户回答后模型继续。
- Task 工具调用和 TaskPanel 状态一致。

## 阶段 6：MCP / Skill / Memory 接入统一工具协议

### 目标

把已初始化但未真正注入 QueryEngine 的能力接入工具系统。

### 需要完成

#### 1. MCPTool 注入

当前 `MCPConnectionManager` 已初始化，但 `QueryEngine` 没把 `MCPTool` 加入工具列表。

需要：

- 把 mcpManager 传入 QueryEngineConfig。
- 初始化 MCPTool。
- MCP 工具调用走统一 tool_use / permission / tool_result。
- MCP 资源读取和工具调用保留 server/tool 名称。

#### 2. SkillTool 注入

当前 `SkillManager` 已初始化，但未注入 QueryEngine。

需要：

- 把 skillManager 传入 QueryEngineConfig。
- 初始化 SkillTool。
- slash command 与 Skill 触发关系统一。
- Skill 执行结果作为 tool_result。

#### 3. Memory 系统接入上下文

Memory 不一定是普通 tool，也可以作为上下文服务。

需要明确：

- 何时读取 memory。
- 如何注入 system/user context。
- 何时写入 memory。
- 是否需要 Memory UI。

### 关键文件

- `src/core/engine/QueryEngine.ts`
- `src/services/chat/ChatService.ts`
- `src/services/mcp/*`
- `src/core/tools/mcp/MCPTool.ts`
- `src/services/skill/*`
- `src/core/tools/skill/SkillTool.ts`
- `src/services/memory/*`

### 验收标准

- 模型能调用 MCP tool。
- Skill 能作为工具触发并返回结果。
- Memory 能正确注入上下文或被工具访问。
- 所有结果都走统一 `tool_result`。

## 阶段 7：Bash Runtime 强化

### 目标

把当前 `execAsync` 风格的 Bash 工具升级为可观测、可取消、可后台执行的任务系统。

### 需要完成

#### 1. Bash input schema 扩展

```ts
{
  command: string
  description?: string
  run_in_background?: boolean
  timeout?: number
}
```

#### 2. 实时输出

不要只等命令结束后返回 stdout/stderr。

需要支持：

- stdout delta。
- stderr delta。
- exit code。
- running state。
- timeout state。

#### 3. 取消和后台任务

需要：

- task id。
- stop command / kill shell。
- 后台任务完成通知。
- UI 中持续显示 running。

#### 4. 安全策略

Bash 权限应综合：

- permission mode。
- 命令危险等级。
- cwd。
- 是否 destructive。
- 是否影响外部系统。

### 关键文件

- `src/core/tools/execution/BashTool.ts`
- `src/services/task/TaskManager.ts`
- `src/core/engine/QueryEngine.ts`
- `webview/src/components/chat/BashToolBlock.vue`
- `webview/src/components/terminal/TerminalChrome.vue`

### 验收标准

- Bash 卡片能显示实时输出。
- 长命令可以取消。
- 后台命令有 task id。
- 命令失败保留 exit code 和 stderr。

## 阶段 8：会话持久化、上下文与恢复

### 目标

让 Agent 工作流可以跨重载恢复，并支持上下文管理。

### 需要完成

#### 1. 会话 transcript 持久化

保存：

- user_text。
- assistant_text。
- thinking。
- tool_use。
- tool_result。
- permission_request / response。
- token usage。
- attachments。
- runtime config。

#### 2. 附件内容注入

当前附件只是把路径拼进 prompt。

需要：

- 文件附件读取内容。
- 图片附件转 provider 支持格式。
- 附件 token 统计。
- 大文件截断或摘要。

#### 3. Token usage 和 context panel

需要把真实 usage 从 provider response 传到 UI。

显示：

- input tokens。
- output tokens。
- cache read/write。
- context window。
- estimated remaining。

#### 4. Compact / Memory

长上下文需要：

- auto compact。
- manual compact。
- compact summary。
- memory 注入。

### 关键文件

- `src/services/chat/ChatService.ts`
- `src/core/engine/QueryEngine.ts`
- `src/core/services/api/AnthropicClient.ts`
- `src/services/memory/MemoryManager.ts`
- `webview/src/stores/chat.ts`
- `webview/src/components/input/ChatInput.vue`

### 验收标准

- 重启后能恢复历史会话。
- 工具卡片和结果不会丢失。
- 附件内容真正进入模型上下文。
- Context 面板显示真实 token usage。

## 推荐执行顺序

```text
阶段 1：Agent 事件协议 + UIMessage Block
↓
阶段 2：Anthropic 真实 Tool Loop
↓
阶段 3：权限系统闭环
↓
阶段 4：前端 Tool UI 对标
↓
阶段 5：Plan / AskUserQuestion / Task 统一闭环
↓
阶段 6：MCP / Skill / Memory 接入
↓
阶段 7：Bash Runtime 强化
↓
阶段 8：会话持久化、上下文与恢复
```

## 每批提交建议

### 每个阶段都应包含

- 类型定义更新。
- Runtime 逻辑更新。
- Webview store 更新。
- UI 最小展示。
- 至少一个手动验收场景。

### 不建议跨阶段混做

尤其不要在阶段 1 还没稳定时直接做复杂 UI，否则会出现：

- UI 看起来有工具卡片，但 runtime 不闭环。
- 工具执行了，但模型收不到 tool_result。
- 权限卡显示了，但无法恢复执行。
- Plan/AskUserQuestion 前端有弹窗，但模型不知道用户回答。

## 最小可用里程碑

完成阶段 1-2 后：

```text
普通 chat → 可见 tool_use/tool_result 的 Agent 雏形
```

完成阶段 1-4 后：

```text
Agent 雏形 → 可交互、可审批、可展示 Diff/Bash 的 Agent UI
```

完成阶段 1-6 后：

```text
Agent UI → 接近 cc-desktop-main 主体能力
```

完成阶段 1-8 后：

```text
Agent Workbench → 支持持久化、上下文、后台任务和高级工具生态
```

## 当前项目最需要优先修的点

结合现有代码，优先级最高的是：

1. `QueryEngine` 增加事件回调，不要只返回最终文本。
2. `AnthropicClient` 保留标准 `tool_use/tool_result` block。
3. `WebviewManager` 转发 agent events。
4. `webview` chat store 改为 UIMessage block。
5. `MessageItem` 改成 block 分发渲染。
6. `permissionMode` 接入工具执行前判断。
7. `PlanModeManager.isToolAllowedInPlanMode()` 接入 `QueryEngine`。
8. `AskUserQuestionTool` 接入 Webview 交互并回灌 tool_result。
9. `MCPTool/SkillTool` 注入 QueryEngine。
10. Bash 从一次性 `execAsync` 升级为可观测任务。
