# 自主任务拆分、执行与完成通知完整复刻方案

本文基于当前项目源码梳理：用户输入需求后，系统如何让 Agent 自主分析、创建任务、执行任务，以及把任务完成状态通知到 UI。目标是给另一个 `Node + Vue3 + VSCode 插件` 项目做**系统级完整复刻**，而不是最小实现。文档会同时给出原项目源码路径、目标项目建议路径、模块边界和完整链路。

## 1. 总体结论

这个项目的“自主性”不是靠前端写死一个 planner，也不是后端固定把用户需求拆成步骤，而是由三层共同完成：

1. **系统提示词 / Tool prompt 约束模型行为**  
   告诉模型什么时候必须创建任务、什么时候更新任务状态、什么时候调用子 Agent。

2. **工具系统提供可执行动作**  
   `TaskCreate`、`TaskUpdate`、`TaskList`、`TaskGet`、`Agent`、`Bash`、`Read`、`Edit` 等都被暴露给模型。模型在推理过程中选择工具，工具执行后把结果作为 `tool_result` 回灌给模型。

3. **事件流把执行过程同步到客户端**  
   CLI/Agent loop 产生 `tool_use`、`tool_result`、`task_notification` 等事件；本地 server 转成 WebSocket 消息；桌面端 store 更新消息和 Agent 状态；UI 渲染“正在执行 / 已完成 / 失败 / 查看结果”。

所以复刻时重点不是只做一个 todo list，而是要建立：

> Prompt 约束模型规划 → Tool 调用落地任务状态 → Agent loop 多轮执行 → 事件流驱动 UI → 完成通知回灌给主 Agent。

---

## 2. 用户输入后的主链路

### 2.1 桌面端发起用户消息

桌面端通过 WebSocket 发送：

```ts
{
  type: ('user_message', content, attachments)
}
```

服务端类型定义在：

- `src/server/ws/events.ts:10`

服务端处理入口：

- `src/server/ws/handler.ts:297`

关键流程：

1. 收到 `user_message`
2. 发送状态：`thinking`
3. 确保 CLI 子进程 / 会话启动
4. 把用户消息交给 `conversationService.sendMessage(...)`
5. CLI/Agent loop 开始流式返回 SDK 消息

相关代码：

- `src/server/ws/handler.ts:322`：发送 `thinking` 状态
- `src/server/ws/handler.ts:366`：确保 CLI session 启动
- `src/server/ws/handler.ts:416`：发送用户输入到会话

### 2.2 Agent loop 接收消息并调用模型

核心会话类：

- `src/QueryEngine.ts:186`

每轮用户输入进入：

- `src/QueryEngine.ts:211` 的 `submitMessage(...)`

`QueryEngine` 会组装：

- 历史消息
- system prompt
- user context
- 可用 tools
- permission / model / MCP / agent definitions

然后进入核心循环：

- `src/query.ts:221` 的 `query(...)`
- `src/query.ts:243` 的 `queryLoop(...)`

模型请求发生在：

- `src/query.ts:666`

这里会把 `tools: toolUseContext.options.tools` 一起传给模型：

- `src/query.ts:670`

模型如果输出 `tool_use`，Agent loop 不会结束，而是执行工具，再把工具结果加入消息历史，然后继续下一轮模型调用。

---

## 3. 自主任务拆分是怎么发生的

### 3.1 任务拆分主要靠 Task 工具 prompt 驱动

任务工具不是普通内部 API，而是作为模型可调用工具暴露。模型知道何时该创建任务，靠的是工具 prompt。

`TaskCreate` 的 prompt 在：

- `src/tools/TaskCreateTool/prompt.ts:15`

核心规则：

- 复杂、多步骤任务要主动创建任务
- 用户明确要求 todo list 时创建
- 用户给出多个任务时立即记录
- 开始任务前标记为 `in_progress`
- 完成任务后标记为 `completed`
- 简单单步任务不要创建任务

关键内容：

```md
Use this tool proactively in these scenarios:

- Complex multi-step tasks
- Non-trivial and complex tasks
- Plan mode
- User explicitly requests todo list
- User provides multiple tasks
- After receiving new instructions
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed
```

这意味着：

> 是否拆任务，首先是模型根据 prompt 自主判断，不是服务端固定解析用户需求。

### 3.2 TaskCreate 工具落地任务

实现文件：

- `src/tools/TaskCreateTool/TaskCreateTool.ts:47`

输入 schema：

- `subject`
- `description`
- `activeForm`
- `metadata`

创建逻辑：

- `src/tools/TaskCreateTool/TaskCreateTool.ts:79`

它调用：

- `createTask(getTaskListId(), {...})`

并将任务初始状态设置为：

```ts
status: 'pending'
owner: undefined
blocks: []
blockedBy: []
```

创建完成后还会自动展开任务视图：

- `src/tools/TaskCreateTool/TaskCreateTool.ts:114`

工具结果回灌给模型：

- `src/tools/TaskCreateTool/TaskCreateTool.ts:129`

返回文本类似：

```txt
Task #1 created successfully: xxx
```

模型拿到这个结果后，后续就可以继续 `TaskUpdate`、`TaskList` 等。

---

## 4. 任务数据结构与存储

任务类型定义在：

- `src/utils/tasks.ts:68`
- `src/utils/tasks.ts:75`

状态只有三个：

```ts
pending -> in_progress -> completed
```

任务结构：

```ts
{
  id: string
  subject: string
  description: string
  activeForm?: string
  owner?: string
  status: 'pending' | 'in_progress' | 'completed'
  blocks: string[]
  blockedBy: string[]
  metadata?: Record<string, unknown>
}
```

任务存储目录：

- `src/utils/tasks.ts:220`

实际路径：

```txt
~/.claude/tasks/<taskListId>/<taskId>.json
```

`taskListId` 的来源：

- `src/utils/tasks.ts:198`

优先级：

1. `CLAUDE_CODE_TASK_LIST_ID`
2. team context
3. session id

这能支持：

- 单会话任务列表
- 多 Agent / team 共享任务列表
- 并发 Agent 同时创建任务

并发安全靠文件锁：

- `src/utils/tasks.ts:287`
- `src/utils/tasks.ts:370`

创建任务时会读最高 ID，然后加 1：

- `src/utils/tasks.ts:294`

---

## 5. 任务状态更新与完成钩子

### 5.1 TaskUpdate 工具

实现文件：

- `src/tools/TaskUpdateTool/TaskUpdateTool.ts:87`

prompt 在：

- `src/tools/TaskUpdateTool/prompt.ts:2`

关键规则：

- 开始前标记 `in_progress`
- 完成后标记 `completed`
- 只有完全完成才能标记 completed
- 如果失败、阻塞、测试不通过，不能标 completed
- 完成后调用 `TaskList` 找下一个任务

### 5.2 状态更新逻辑

核心执行：

- `src/tools/TaskUpdateTool/TaskUpdateTool.ts:122`

先读取现有任务：

- `src/tools/TaskUpdateTool/TaskUpdateTool.ts:145`

更新字段：

- `subject`
- `description`
- `activeForm`
- `owner`
- `metadata`
- `status`
- `blocks`
- `blockedBy`

写入磁盘：

- `src/tools/TaskUpdateTool/TaskUpdateTool.ts:271`

### 5.3 任务完成时的 hook

当状态变成 `completed` 时，会执行完成 hook：

- `src/tools/TaskUpdateTool/TaskUpdateTool.ts:230`
- `src/tools/TaskUpdateTool/TaskUpdateTool.ts:234`

如果 hook 返回 blocking error，就不会把任务标为 completed：

- `src/tools/TaskUpdateTool/TaskUpdateTool.ts:254`

这点很重要：

> “任务完成”不是前端本地状态，而是工具执行 + hook 校验后的结果。

### 5.4 完成后提醒模型继续找任务

如果是 teammate / swarm Agent 完成任务，工具结果会追加提醒：

- `src/tools/TaskUpdateTool/TaskUpdateTool.ts:386`

内容：

```txt
Task completed. Call TaskList now to find your next available task or see if your work unblocked others.
```

这使得模型不会完成一个子任务后直接停掉，而是继续检查是否有未完成或被解锁的任务。

---

## 6. Agent 如何执行任务

### 6.1 工具调用执行器

模型输出 `tool_use` 后，核心执行入口是：

- `src/services/tools/toolOrchestration.ts:18` 的 `runTools(...)`

它会把工具调用分批：

- 并发安全的工具可以并发执行
- 非并发安全工具串行执行

分批逻辑：

- `src/services/tools/toolOrchestration.ts:90`

真正执行单个工具：

- `src/services/tools/toolExecution.ts:337` 的 `runToolUse(...)`

执行流程：

1. 找到工具定义
2. 校验 input schema
3. 运行 `PreToolUse` hooks
4. 做权限判断
5. 调用 `tool.call(...)`
6. 映射成 `tool_result`
7. 运行 `PostToolUse` hooks
8. 把 `tool_result` 作为 user message 回灌给模型

关键代码：

- `src/services/tools/toolExecution.ts:642`：Zod schema 校验
- `src/services/tools/toolExecution.ts:829`：PreToolUse hooks
- `src/services/tools/toolExecution.ts:950`：权限决策
- `src/services/tools/toolExecution.ts:1236`：调用具体工具
- `src/services/tools/toolExecution.ts:1321`：映射工具结果
- `src/services/tools/toolExecution.ts:1485`：生成 tool_result 消息

### 6.2 多轮循环让 Agent 自主推进

`query.ts` 中有一个关键变量：

- `src/query.ts:560` 的 `toolUseBlocks`
- `src/query.ts:561` 的 `needsFollowUp`

模型如果调用工具，Agent loop 会执行工具并继续下一轮模型请求；如果没有工具调用，才进入结束逻辑：

- `src/query.ts:1070`

因此自主执行的基本循环是：

```txt
用户需求
  ↓
模型分析并输出 tool_use，例如 TaskCreate / Read / Grep / Edit / Bash
  ↓
运行工具
  ↓
工具结果作为上下文返回给模型
  ↓
模型继续决定下一步
  ↓
直到模型不再调用工具，输出最终回复
```

这就是“自主分析、执行任务”的核心。

---

## 7. 子 Agent / 后台 Agent 机制

复杂任务不仅可以拆成 Task，还可以通过 `Agent` 工具启动子 Agent。

### 7.1 Agent 工具 prompt

实现：

- `src/tools/AgentTool/AgentTool.tsx:195`

prompt：

- `src/tools/AgentTool/prompt.ts:201`

它告诉模型：

- 复杂多步骤任务可以交给子 Agent
- 可以选择 `subagent_type`
- 可以后台运行 `run_in_background`
- 后台 Agent 完成后会自动通知
- 不要轮询后台任务结果，等通知

关键提示：

- `src/tools/AgentTool/prompt.ts:263`

```md
When an agent runs in the background, you will be automatically notified when it completes — do NOT sleep, poll, or proactively check on its progress.
```

### 7.2 Agent 工具 schema

输入 schema：

- `src/tools/AgentTool/AgentTool.tsx:81`

核心字段：

```ts
{
  description: string
  prompt: string
  subagent_type?: string
  model?: 'sonnet' | 'opus' | 'haiku'
  run_in_background?: boolean
  name?: string
  team_name?: string
  isolation?: 'worktree'
  cwd?: string
}
```

### 7.3 前台 / 后台执行分流

判断是否后台执行：

- `src/tools/AgentTool/AgentTool.tsx:567`

只要满足以下之一就后台：

- `run_in_background === true`
- Agent definition 标记 background
- coordinator / fork / kairos / proactive 强制后台

### 7.4 后台 Agent 注册

后台任务注册：

- `src/tools/AgentTool/AgentTool.tsx:686`
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx:466`

注册后会创建 `LocalAgentTaskState`：

- `src/tasks/LocalAgentTask/LocalAgentTask.tsx:487`

包含：

```ts
status: 'running'
agentId
prompt
selectedAgent
agentType
abortController
progress
messages
isBackgrounded
pendingMessages
```

### 7.5 后台 Agent 执行

后台执行启动在：

- `src/tools/AgentTool/AgentTool.tsx:733`

实际调用：

```ts
runAsyncAgentLifecycle({
  taskId,
  makeStream: () => runAgent(...),
  metadata,
  description,
  ...
})
```

`runAgent(...)` 本质上是为子 Agent 单独开一套 query loop：

- `src/tools/AgentTool/runAgent.ts:247`

它会构建子 Agent 的 system prompt、tool pool、MCP、上下文，并持续读取子 Agent 产生的消息。

---

## 8. 后台 Agent 完成通知

### 8.1 Agent 完成后标记任务完成

后台 Agent 执行结束后，会生成结果并标记任务完成：

- `src/tools/AgentTool/AgentTool.tsx:951`
- `src/tools/AgentTool/AgentTool.tsx:957`

```ts
completeAsyncAgent(agentResult, rootSetAppState)
```

对应实现：

- `src/tasks/LocalAgentTask/LocalAgentTask.tsx:412`

它会把 task 状态改为：

```ts
status: 'completed'
```

失败时类似调用 `failAgentTask(...)`：

- `src/tasks/LocalAgentTask/LocalAgentTask.tsx:437`

### 8.2 入队完成通知

完成后调用：

- `src/tools/AgentTool/AgentTool.tsx:959`

```ts
enqueueAgentNotification({
  taskId,
  description,
  status: 'completed',
  finalMessage,
  usage,
  toolUseId,
})
```

通知生成逻辑：

- `src/tasks/LocalAgentTask/LocalAgentTask.tsx:196`

它会生成 XML：

```xml
<task-notification>
  <task-id>...</task-id>
  <tool-use-id>...</tool-use-id>
  <output-file>...</output-file>
  <status>completed</status>
  <summary>Agent "xxx" completed</summary>
  <result>...</result>
  <usage>...</usage>
</task-notification>
```

然后进入 message queue：

- `src/tasks/LocalAgentTask/LocalAgentTask.tsx:257`

这个通知会在后续作为一条 user-role 消息重新进入主 Agent 上下文，让主 Agent 知道后台任务完成，并能基于结果继续回复用户。

### 8.3 SDK 事件通知

除了 XML 通知，还有 SDK system event：

- `src/utils/sdkEventQueue.ts:115`

事件类型：

```ts
{
  type: 'system',
  subtype: 'task_notification',
  task_id,
  tool_use_id,
  status,
  output_file,
  summary,
  usage,
}
```

这对 VS Code 插件尤其重要：可以不依赖解析聊天文本，直接监听结构化 `task_notification`。

---

## 9. Server 如何把完成通知推给桌面端

Server 将 CLI/SDK 消息映射为 WebSocket 消息。

当收到 system subtype 为 `task_notification`：

- `src/server/ws/handler.ts:1892`

转成：

```ts
{
  type: 'system_notification',
  subtype: 'task_notification',
  message,
  data: cliMsg,
}
```

WebSocket 类型定义：

- `src/server/ws/events.ts:85`

桌面端对应类型：

- `desktop/src/types/chat.ts:113`

---

## 10. 桌面端如何展示任务与 Agent 状态

### 10.1 Store 处理 task_notification

桌面端 store：

- `desktop/src/stores/chatStore.ts:2066`

收到：

```ts
system_notification + subtype === 'task_notification'
```

会解析：

- `taskId`
- `toolUseId`
- `status`
- `summary`
- `result`
- `outputFile`
- `usage`

并写入：

```ts
session.agentTaskNotifications[toolUseId] = notification
```

关键代码：

- `desktop/src/stores/chatStore.ts:2087`

### 10.2 UI 类型

通知类型定义：

- `desktop/src/types/chat.ts:205`

```ts
export type AgentTaskNotification = {
  taskId: string
  toolUseId: string
  status: 'completed' | 'failed' | 'stopped'
  summary?: string
  result?: string
  outputFile?: string
  usage?: BackgroundAgentTaskUsage
  timestamp?: string
}
```

### 10.3 Agent 工具卡片展示状态

Agent 工具调用组：

- `desktop/src/components/chat/ToolCallGroup.tsx:332`

它根据 `agentTaskNotifications[toolUseId]?.status` 判断：

- running
- starting
- done
- failed
- stopped

关键代码：

- `desktop/src/components/chat/ToolCallGroup.tsx:337`
- `desktop/src/components/chat/ToolCallGroup.tsx:344`
- `desktop/src/components/chat/ToolCallGroup.tsx:400`

Agent 卡片读取 summary/result：

- `desktop/src/components/chat/ToolCallGroup.tsx:508`

并提供“查看结果”：

- `desktop/src/components/chat/ToolCallGroup.tsx:562`

---

## 11. 任务列表 UI 与工具调用 UI 的关系

这个项目里有两类“任务”：

### 11.1 TaskCreate/TaskUpdate 的结构化任务列表

用途：

- 给主 Agent / 多 Agent 跟踪工作分解
- 显示当前有哪些步骤、哪些已完成、哪些被阻塞
- 主要由模型主动调用 `TaskCreate` / `TaskUpdate`

核心文件：

- `src/tools/TaskCreateTool/TaskCreateTool.ts`
- `src/tools/TaskUpdateTool/TaskUpdateTool.ts`
- `src/utils/tasks.ts`

### 11.2 AgentTool 的后台 Agent 任务

用途：

- 跟踪一个子 Agent 的生命周期
- 输出完成通知
- 给 UI 展示 Agent 是否完成、失败、停止

核心文件：

- `src/tools/AgentTool/AgentTool.tsx`
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx`
- `desktop/src/stores/chatStore.ts`
- `desktop/src/components/chat/ToolCallGroup.tsx`

复刻时不要混淆：

| 类型            | 谁创建             | 主要用途                    |
| --------------- | ------------------ | --------------------------- |
| TaskCreate 任务 | 模型主动拆解       | 当前会话的任务规划与进度    |
| LocalAgentTask  | AgentTool 自动注册 | 子 Agent / 后台任务生命周期 |

---

## 12. 完美复刻到 Node + Vue3 + VSCode 插件的系统路径

这一节不是最小实现，而是按原项目能力做**完整复刻**。目标项目应该把能力拆成四层：

1. **Extension Host / Agent Runtime**：运行 Agent loop、模型调用、工具执行、任务存储、后台 Agent。
2. **Protocol Layer**：定义 Extension Host 与 WebView 之间的结构化事件。
3. **Vue3 WebView**：渲染聊天流、工具调用、Agent 卡片、任务面板、权限弹窗。
4. **Persistence / Transcript / Notification**：保存会话、任务、后台输出、完成通知，支持恢复。

### 12.1 原项目源码路径总览

| 系统能力             | 原项目源码路径                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| CLI / Agent 会话入口 | `src/QueryEngine.ts`、`src/query.ts`                                                                          |
| 模型 API 调用        | `src/services/api/claude.ts`、`src/services/api/azureOpenAI.ts`                                               |
| 工具定义基类         | `src/Tool.ts`                                                                                                 |
| 工具池组装           | `src/tools.ts`                                                                                                |
| 工具编排             | `src/services/tools/toolOrchestration.ts`                                                                     |
| 单工具执行           | `src/services/tools/toolExecution.ts`                                                                         |
| Tool hook            | `src/services/tools/toolHooks.ts`、`src/utils/hooks.ts`                                                       |
| Task 工具            | `src/tools/TaskCreateTool/`、`src/tools/TaskUpdateTool/`、`src/tools/TaskListTool/`、`src/tools/TaskGetTool/` |
| Task 存储            | `src/utils/tasks.ts`                                                                                          |
| Task UI / TUI hooks  | `src/hooks/useTasksV2.ts`、`src/hooks/useTaskListWatcher.ts`、`src/components/TaskListV2.tsx`                 |
| Agent 工具           | `src/tools/AgentTool/AgentTool.tsx`                                                                           |
| 子 Agent 执行        | `src/tools/AgentTool/runAgent.ts`                                                                             |
| Agent 类型加载       | `src/tools/AgentTool/loadAgentsDir.ts`、`src/tools/AgentTool/builtInAgents.ts`                                |
| 内置 Agent           | `src/tools/AgentTool/built-in/`                                                                               |
| 后台 Agent task      | `src/tasks/LocalAgentTask/LocalAgentTask.tsx`                                                                 |
| task 输出文件        | `src/utils/task/diskOutput.ts`、`src/utils/task/TaskOutput.ts`                                                |
| task framework       | `src/utils/task/framework.ts`                                                                                 |
| SDK task event       | `src/utils/sdkEventQueue.ts`                                                                                  |
| CLI 输出映射         | `src/cli/print.ts`、`src/remote/sdkMessageAdapter.ts`                                                         |
| Server WS 协议       | `src/server/ws/events.ts`                                                                                     |
| Server WS handler    | `src/server/ws/handler.ts`                                                                                    |
| Desktop 类型         | `desktop/src/types/chat.ts`                                                                                   |
| Desktop chat store   | `desktop/src/stores/chatStore.ts`                                                                             |
| Desktop 消息列表     | `desktop/src/components/chat/MessageList.tsx`                                                                 |
| Desktop 工具卡片     | `desktop/src/components/chat/ToolCallBlock.tsx`                                                               |
| Desktop Agent 工具组 | `desktop/src/components/chat/ToolCallGroup.tsx`                                                               |

### 12.2 目标项目完整路径建议

建议在 VS Code 插件项目里直接按“运行时 / 协议 / WebView / 持久化”拆分。示例：

```txt
vscode-agent-extension/
  package.json
  src/
    extension.ts

    runtime/
      AgentSession.ts                 # 对标 src/QueryEngine.ts：一会话多轮 submitMessage
      AgentLoop.ts                    # 对标 src/query.ts：模型调用、tool_use 循环、停止条件
      ModelRouter.ts                  # 对标 src/services/api/*：供应商、模型、重试、streaming fallback
      MessageTypes.ts                 # 对标 src/types/message.ts：assistant/user/tool/progress/system
      SystemPromptBuilder.ts          # 对标 constants/prompts + queryContext：系统提示词拼装
      ContextManager.ts               # 历史、附件、压缩、会话上下文
      PermissionService.ts            # 工具权限、用户确认、策略规则

    tools/
      Tool.ts                         # 对标 src/Tool.ts：ToolDef、schema、call、render、权限标记
      ToolRegistry.ts                 # 对标 src/tools.ts：组装所有工具
      ToolExecutor.ts                 # 对标 toolExecution.ts：校验、权限、hook、call、result
      ToolOrchestrator.ts             # 对标 toolOrchestration.ts：并发安全工具并发，其他串行
      hooks/
        ToolHooks.ts                  # PreToolUse / PostToolUse / PermissionDenied
        TaskHooks.ts                  # TaskCreated / TaskCompleted
      task/
        TaskCreateTool.ts
        TaskUpdateTool.ts
        TaskListTool.ts
        TaskGetTool.ts
        TaskOutputTool.ts
        TaskStopTool.ts
        prompts.ts
      agent/
        AgentTool.ts                  # 对标 AgentTool.tsx
        RunAgent.ts                   # 对标 runAgent.ts
        AgentDefinitions.ts           # AgentDefinition、frontmatter、内置 Agent
        BuiltInAgents.ts
        agents/
          generalPurpose.ts
          explore.ts
          verification.ts
          plan.ts
      file/
        FileReadTool.ts
        FileEditTool.ts
        FileWriteTool.ts
        GlobTool.ts
        GrepTool.ts
      shell/
        BashTool.ts

    tasks/
      TaskTypes.ts                    # 对标 src/Task.ts + src/utils/tasks.ts schema
      TaskStore.ts                    # 结构化任务列表 JSON 存储、锁、高水位 ID
      TaskListWatcher.ts              # 对标 useTaskListWatcher：监听任务变更并通知 UI
      TaskFramework.ts                # 对标 utils/task/framework.ts：统一 background task 注册/更新/驱逐
      LocalAgentTask.ts               # 对标 LocalAgentTask.tsx
      LocalShellTask.ts               # shell/background command 生命周期
      TaskOutputStore.ts              # outputFile/transcript/symlink 或普通文件
      TaskNotificationQueue.ts        # enqueuePendingNotification / drain

    protocol/
      extensionMessages.ts            # WebView -> Extension
      webviewMessages.ts              # Extension -> WebView
      sdkEvents.ts                    # task_started/task_progress/task_notification
      messageMapper.ts                # runtime Message -> WebView UI event

    persistence/
      SessionStore.ts                 # 会话列表、当前会话、标题
      TranscriptStore.ts              # JSONL transcript
      SettingsStore.ts                # 权限、provider、模型配置
      AgentMetadataStore.ts           # 子 Agent metadata、transcript 路径

    webview/
      index.html
      main.ts
      App.vue
      stores/
        chatStore.ts                  # 对标 desktop/src/stores/chatStore.ts
        sessionStore.ts
        taskStore.ts
        permissionStore.ts
      types/
        chat.ts                       # 对标 desktop/src/types/chat.ts
      components/
        chat/
          MessageList.vue             # 对标 MessageList.tsx
          ToolCallBlock.vue           # 对标 ToolCallBlock.tsx
          ToolCallGroup.vue           # 对标 ToolCallGroup.tsx
          AgentCallCard.vue
          ToolResultBlock.vue
          StreamingIndicator.vue
        tasks/
          TaskListPanel.vue           # 结构化任务列表
          BackgroundTaskPanel.vue     # 后台 Agent / shell task
        permission/
          PermissionDialog.vue
          PlanModeDialog.vue
```

### 12.3 目标项目模块与原源码一一映射

| 目标模块                                    | 对标原源码                                      | 必须复刻的职责                                                                   |
| ------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `runtime/AgentSession.ts`                   | `src/QueryEngine.ts`                            | 持有会话消息、配置、工具、权限状态；每次用户输入调用 `submitMessage`             |
| `runtime/AgentLoop.ts`                      | `src/query.ts`                                  | while-loop 调模型；收集 `tool_use`；执行工具；回灌 `tool_result`；直到无工具调用 |
| `runtime/ModelRouter.ts`                    | `src/services/api/claude.ts`                    | 流式模型调用、tool schema 注入、usage、错误降级、重试                            |
| `tools/Tool.ts`                             | `src/Tool.ts`                                   | 工具定义接口、input/output schema、权限、并发安全、结果映射                      |
| `tools/ToolExecutor.ts`                     | `src/services/tools/toolExecution.ts`           | Zod 校验、hook、权限、执行、telemetry、result block 生成                         |
| `tools/ToolOrchestrator.ts`                 | `src/services/tools/toolOrchestration.ts`       | 按 `isConcurrencySafe` 分批，安全工具并发执行                                    |
| `tasks/TaskStore.ts`                        | `src/utils/tasks.ts`                            | JSON 文件任务存储、锁、ID、依赖关系、更新通知                                    |
| `tools/task/*`                              | `src/tools/Task*Tool/*`                         | 给模型可调用的任务工具，不是前端本地 todo                                        |
| `tools/agent/AgentTool.ts`                  | `src/tools/AgentTool/AgentTool.tsx`             | 启动子 Agent、前后台分流、worktree/cwd、输出 async result                        |
| `tools/agent/RunAgent.ts`                   | `src/tools/AgentTool/runAgent.ts`               | 子 Agent 独立 prompt、tool pool、query loop、transcript                          |
| `tasks/LocalAgentTask.ts`                   | `src/tasks/LocalAgentTask/LocalAgentTask.tsx`   | 后台 Agent 生命周期、progress、complete/fail、notification                       |
| `protocol/messageMapper.ts`                 | `src/server/ws/handler.ts`                      | runtime message 转 WebView 事件                                                  |
| `webview/stores/chatStore.ts`               | `desktop/src/stores/chatStore.ts`               | 处理流式文本、tool_use、tool_result、task_notification                           |
| `webview/components/chat/ToolCallGroup.vue` | `desktop/src/components/chat/ToolCallGroup.tsx` | Agent 多调用分组、状态、结果预览                                                 |

### 12.4 完整运行链路路径

复刻时按下面完整路径实现，不要跳步：

```txt
Vue ChatInput.vue
  -> postMessage({ type: 'user_message' })

VS Code extension protocol handler
  -> AgentSession.submitMessage(content, attachments)

AgentSession
  -> 构造 messages / systemPrompt / userContext / tools / permissionContext
  -> AgentLoop.run(...)

AgentLoop
  -> ModelRouter.streamChat({ messages, tools, systemPrompt })
  -> 向 WebView 发 content_start/content_delta/thinking/status
  -> 收集 assistant tool_use blocks

ToolOrchestrator
  -> 根据 Tool.isConcurrencySafe 分批
  -> ToolExecutor.runToolUse(toolUse)

ToolExecutor
  -> input schema 校验
  -> PreToolUse hooks
  -> PermissionService.canUseTool
  -> tool.call(input, context)
  -> PostToolUse hooks
  -> 生成 tool_result

AgentLoop
  -> messages.push(assistant tool_use)
  -> messages.push(user/tool_result)
  -> 继续下一轮 ModelRouter.streamChat

如果模型调用 TaskCreate
  -> TaskCreateTool.call
  -> TaskStore.createTask
  -> TaskListWatcher 通知 WebView task list 更新
  -> tool_result 回灌模型

如果模型调用 TaskUpdate completed
  -> TaskUpdateTool.call
  -> TaskCompleted hooks
  -> TaskStore.updateTask
  -> tool_result 追加“完成后 TaskList 找下一项”的提醒
  -> AgentLoop 继续

如果模型调用 Agent run_in_background
  -> AgentTool.call
  -> LocalAgentTask.register
  -> 返回 async_launched tool_result 给主 Agent
  -> 子 Agent 后台独立 RunAgent.run
  -> progress 通过 task_progress 发给 WebView
  -> complete/fail 后 enqueue task_notification
  -> task_notification 同时进入 WebView 和主 Agent 消息队列
  -> 主 Agent 下一轮收到通知后总结/继续决策
```

### 12.5 完整复刻必须有的事件协议

不要只发纯文本。需要复刻结构化事件：

```ts
type WebviewMessage =
  | { type: 'connected'; sessionId: string }
  | {
      type: 'content_start'
      blockType: 'text' | 'tool_use'
      toolName?: string
      toolUseId?: string
      parentToolUseId?: string
    }
  | { type: 'content_delta'; text?: string; toolInput?: string }
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
  | { type: 'message_complete'; usage?: TokenUsage }
  | { type: 'thinking'; text: string }
  | {
      type: 'status'
      state: 'idle' | 'thinking' | 'tool_executing' | 'streaming' | 'permission_pending'
      verb?: string
    }
  | {
      type: 'system_notification'
      subtype: 'task_started' | 'task_progress' | 'task_notification'
      message?: string
      data?: unknown
    }
  | { type: 'error'; message: string; code: string; retryable?: boolean }
```

其中 `task_notification` 必须包含：

```ts
type AgentTaskNotification = {
  taskId: string
  toolUseId: string
  status: 'completed' | 'failed' | 'stopped'
  summary?: string
  result?: string
  outputFile?: string
  usage?: {
    totalTokens?: number
    toolUses?: number
    durationMs?: number
  }
  timestamp?: string
}
```

### 12.6 完整复刻必须有的 Prompt 契约

需要把以下内容放进 system prompt 或对应 tool prompt，不能只写在代码里：

```md
Use TaskCreate proactively for complex multi-step work, plan mode, explicit todo requests, and user requests containing multiple tasks.

Before starting a task, call TaskUpdate with status=in_progress.

Only mark a task completed when the work is fully done. Do not mark completed if tests fail, implementation is partial, files are missing, or blockers remain.

After completing a task, call TaskList to find the next available task or newly unblocked work.

Use Agent for complex, independent, or context-heavy tasks. Use background Agent only when the result is not needed immediately. When a background Agent is launched, do not poll; wait for task_notification.

When a background task notification arrives, treat it as new user-role context and continue from the result.
```

### 12.7 完整复刻的 UI 要求

Vue3 WebView 至少要有这些视图状态：

1. **聊天消息流**：用户文本、助手文本、thinking、streaming。
2. **工具调用块**：显示工具名、输入摘要、pending、result、error。
3. **Agent 工具组**：多个 Agent 并发时分组展示，显示 running/done/failed/stopped。
4. **任务列表面板**：展示 `TaskCreate` 的结构化任务，支持 pending/in_progress/completed、blockedBy、owner、activeForm。
5. **后台任务面板**：展示 LocalAgentTask / shell task 的进度、summary、outputFile。
6. **权限弹窗**：工具执行需要确认时暂停 Agent loop，用户允许/拒绝后继续。
7. **完成结果预览**：`task_notification.result` 可展开查看。

### 12.8 完整复刻的持久化要求

建议持久化这些数据：

```txt
<vscode globalStorage>/
  sessions/
    <sessionId>.json                 # session metadata
  transcripts/
    <sessionId>.jsonl                # 消息历史
  tasks/
    <taskListId>/
      .highwatermark
      <taskId>.json                  # TaskCreate 任务
  agent-tasks/
    <agentTaskId>.json               # LocalAgentTask 状态
  agent-output/
    <agentTaskId>.md                 # 后台 Agent 输出
  agent-transcripts/
    <agentTaskId>.jsonl              # 子 Agent transcript
  settings.json                      # provider/model/permission
```

要支持重启恢复：

- transcript 映射回 UI messages
- `task_notification` 从历史恢复到 `agentTaskNotifications`
- 未完成后台任务标记为 stopped/failed 或恢复运行
- task list 从 JSON 文件恢复

### 12.9 完整复刻验收标准

达到下面标准才算“像这个项目”：

1. 用户给一个复杂需求，模型会主动 `TaskCreate` 多个任务。
2. 每个任务开始前会 `TaskUpdate in_progress`。
3. 完成后会 `TaskUpdate completed`，并继续 `TaskList` 找下一项。
4. 工具执行结果会进入模型上下文，模型能基于结果继续行动。
5. 多个只读工具可并发，写操作/危险操作串行或走权限。
6. `Agent` 可以启动子 Agent，并可后台运行。
7. 后台 Agent 完成后，UI 和主 Agent 都能收到 `task_notification`。
8. 主 Agent 收到后台结果后能继续总结、修复或启动下一步。
9. WebView 能按 `toolUseId` 把 `tool_result`、`task_notification` 挂回原工具卡片。
10. 会话重载后，历史消息、任务列表、Agent 完成状态可恢复。
11. 权限拒绝、工具失败、任务阻塞不会被错误标记为 completed。
12. 子 Agent 有独立 prompt、tool pool、transcript、outputFile。

---

## 13. 最容易缺失的点

另一个项目如果“总是差点意思”，通常缺的是这些：

1. **没有把任务工具作为模型可调用工具**  
   只在前端生成 todo，不会影响模型后续行为。

2. **没有在 prompt 里强约束任务生命周期**  
   模型不知道什么时候必须 create/update/list。

3. **工具结果没有回灌给模型**  
   工具执行了，但模型上下文不知道结果，无法继续自主推进。

4. **没有多轮 agent loop**  
   执行一次工具后就结束，模型不会继续下一步。

5. **后台 Agent 完成后只通知 UI，没有通知主 Agent**  
   UI 知道完成了，但主 Agent 不知道，所以不会基于结果继续总结或决策。

6. **任务列表和后台 Agent 生命周期混在一起**  
   规划任务与后台执行任务应分开建模，再通过 `toolUseId` 关联 UI。

7. **没有任务完成后的继续提醒**  
   完成一个任务后，需要 prompt/tool_result 提醒模型 `TaskList` 找下一个任务。

---

## 14. 完整复刻实施顺序

这里不是“最小实现”，而是建议按依赖顺序完整落地，避免后面返工。

### 第一阶段：Runtime 与协议骨架

实现：

- `runtime/AgentSession.ts`
- `runtime/AgentLoop.ts`
- `runtime/ModelRouter.ts`
- `protocol/webviewMessages.ts`
- `protocol/messageMapper.ts`
- `webview/stores/chatStore.ts`
- `MessageList.vue` / `ToolCallBlock.vue`

验收：用户输入后，能流式输出文本；模型输出 `tool_use` 时 UI 能展示 pending 工具块。

### 第二阶段：Tool 系统完整化

实现：

- `tools/Tool.ts`
- `tools/ToolRegistry.ts`
- `tools/ToolExecutor.ts`
- `tools/ToolOrchestrator.ts`
- schema 校验
- permission_request / permission_response
- PreToolUse / PostToolUse hooks
- 工具结果回灌 AgentLoop

验收：模型可连续调用 `Read -> Grep -> Edit -> Bash`，每一步结果都进入下一轮上下文。

### 第三阶段：TaskCreate 结构化任务系统

实现：

- `tasks/TaskTypes.ts`
- `tasks/TaskStore.ts`
- `tasks/TaskListWatcher.ts`
- `tools/task/TaskCreateTool.ts`
- `tools/task/TaskUpdateTool.ts`
- `tools/task/TaskListTool.ts`
- `tools/task/TaskGetTool.ts`
- `TaskListPanel.vue`

验收：复杂需求会被模型主动拆成任务，任务开始/完成状态会被模型用工具更新，UI 能实时展示。

### 第四阶段：AgentTool 与子 Agent

实现：

- `tools/agent/AgentTool.ts`
- `tools/agent/RunAgent.ts`
- `tools/agent/AgentDefinitions.ts`
- `tools/agent/BuiltInAgents.ts`
- 子 Agent 独立 tool pool
- 子 Agent 独立 transcript
- 子 Agent result 汇总

验收：主 Agent 能启动子 Agent；子 Agent 能独立读代码/执行工具/返回结果；主 Agent 能基于结果继续。

### 第五阶段：后台任务与完成通知

实现：

- `tasks/TaskFramework.ts`
- `tasks/LocalAgentTask.ts`
- `tasks/TaskOutputStore.ts`
- `tasks/TaskNotificationQueue.ts`
- `protocol/sdkEvents.ts`
- `system_notification: task_started/task_progress/task_notification`
- `AgentCallCard.vue` / `ToolCallGroup.vue`

验收：后台 Agent 启动后主 Agent 不阻塞；后台完成后 UI 显示 completed；主 Agent 收到 notification 后继续总结或下一步。

### 第六阶段：恢复、并发与可靠性

实现：

- transcript JSONL
- task JSON 恢复
- background agent outputFile
- 会话重载恢复 `agentTaskNotifications`
- 工具并发控制
- 任务 ID 文件锁 / 原子写
- 停止任务 / 中断任务
- 失败任务不误标 completed

验收：VS Code 重载窗口后，聊天历史、工具状态、任务列表、Agent 完成结果都能恢复。

---

## 15. 关键源码索引与目标路径映射

| 能力                          | 原项目源码位置                                                                                        | 目标项目建议路径                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| WebSocket / WebView 协议      | `/Users/mr_an/Documents/cc-desktop-main/src/server/ws/events.ts`                                      | `/Users/mr_an/Documents/cc-desktop-main/src/protocol/webviewMessages.ts`                     |
| 用户消息入口                  | `/Users/mr_an/Documents/cc-desktop-main/src/server/ws/handler.ts:297`                                 | `src/extension.ts` + `/Users/mr_an/Documents/cc-desktop-main/src/protocol/messageHandler.ts` |
| CLI 会话管理                  | `/Users/mr_an/Documents/cc-desktop-main/src/QueryEngine.ts:186`                                       | `/Users/mr_an/Documents/cc-desktop-main/src/runtime/AgentSession.ts`                         |
| Agent 主循环                  | `/Users/mr_an/Documents/cc-desktop-main/src/query.ts:221`                                             | `/Users/mr_an/Documents/cc-desktop-main/src/runtime/AgentLoop.ts`                            |
| 模型调用携带 tools            | `/Users/mr_an/Documents/cc-desktop-main/src/query.ts:666`                                             | `src/runtime/ModelRouter.ts`                                                                 |
| Claude API 适配               | `/Users/mr_an/Documents/cc-desktop-main/src/services/api/claude.ts`                                   | `/Users/mr_an/Documents/cc-desktop-main/src/runtime/providers/ClaudeProvider.ts`             |
| 工具定义接口                  | `/Users/mr_an/Documents/cc-desktop-main/src/Tool.ts`                                                  | `/Users/mr_an/Documents/cc-desktop-main/src/tools/Tool.ts`                                   |
| 工具池组装                    | `/Users/mr_an/Documents/cc-desktop-main/src/tools.ts`                                                 | `/Users/mr_an/Documents/cc-desktop-main/src/tools/ToolRegistry.ts`                           |
| 工具编排                      | `/Users/mr_an/Documents/cc-desktop-main/src/services/tools/toolOrchestration.ts:18`                   | `src/tools/ToolOrchestrator.ts`                                                              |
| 单工具执行                    | `/Users/mr_an/Documents/cc-desktop-main/src/services/tools/toolExecution.ts:337`                      | `src/tools/ToolExecutor.ts`                                                                  |
| Tool hooks                    | `/Users/mr_an/Documents/cc-desktop-main/src/services/tools/toolHooks.ts`                              | `/Users/mr_an/Documents/cc-desktop-main/src/tools/hooks/ToolHooks.ts`                        |
| TaskCreate                    | `/Users/mr_an/Documents/cc-desktop-main/src/tools/TaskCreateTool/TaskCreateTool.ts:47`                | `/Users/mr_an/Documents/cc-desktop-main/src/tools/task/TaskCreateTool.ts`                    |
| TaskCreate prompt             | `/Users/mr_an/Documents/cc-desktop-main/src/tools/TaskCreateTool/prompt.ts:15`                        | `/Users/mr_an/Documents/cc-desktop-main/src/tools/task/prompts.ts`                           |
| TaskUpdate                    | `/Users/mr_an/Documents/cc-desktop-main/src/tools/TaskUpdateTool/TaskUpdateTool.ts:87`                | `/Users/mr_an/Documents/cc-desktop-main/src/tools/task/TaskUpdateTool.ts`                    |
| TaskUpdate prompt             | `/Users/mr_an/Documents/cc-desktop-main/src/tools/TaskUpdateTool/prompt.ts:2`                         | `/Users/mr_an/Documents/cc-desktop-main/src/tools/task/prompts.ts`                           |
| TaskList                      | `/Users/mr_an/Documents/cc-desktop-main/src/tools/TaskListTool/TaskListTool.ts`                       | `/Users/mr_an/Documents/cc-desktop-main/src/tools/task/TaskListTool.ts`                      |
| TaskGet                       | `/Users/mr_an/Documents/cc-desktop-main/src/tools/TaskGetTool/TaskGetTool.ts`                         | `/Users/mr_an/Documents/cc-desktop-main/src/tools/task/TaskGetTool.ts`                       |
| 任务存储                      | `/Users/mr_an/Documents/cc-desktop-main/src/utils/tasks.ts`                                           | `/Users/mr_an/Documents/cc-desktop-main/src/tasks/TaskStore.ts`                              |
| 任务 UI watcher               | `/Users/mr_an/Documents/cc-desktop-main/src/hooks/useTaskListWatcher.ts`                              | `/Users/mr_an/Documents/cc-desktop-main/src/tasks/TaskListWatcher.ts`                        |
| 任务列表 UI                   | `/Users/mr_an/Documents/cc-desktop-main/src/components/TaskListV2.tsx`                                | `/Users/mr_an/Documents/cc-desktop-main/src/webview/components/tasks/TaskListPanel.vue`      |
| AgentTool                     | `/Users/mr_an/Documents/cc-desktop-main/src/tools/AgentTool/AgentTool.tsx:195`                        | `/Users/mr_an/Documents/cc-desktop-main/src/tools/agent/AgentTool.ts`                        |
| AgentTool prompt              | `/Users/mr_an/Documents/cc-desktop-main/src/tools/AgentTool/prompt.ts:201`                            | `/Users/mr_an/Documents/cc-desktop-main/src/tools/agent/prompts.ts`                          |
| Agent 定义加载                | `/Users/mr_an/Documents/cc-desktop-main/src/tools/AgentTool/loadAgentsDir.ts`                         | `/Users/mr_an/Documents/cc-desktop-main/src/tools/agent/AgentDefinitions.ts`                 |
| 内置 Agent                    | `/Users/mr_an/Documents/cc-desktop-main/src/tools/AgentTool/built-in/`                                | `/Users/mr_an/Documents/cc-desktop-main/src/tools/agent/agents/`                             |
| 子 Agent 执行                 | `/Users/mr_an/Documents/cc-desktop-main/src/tools/AgentTool/runAgent.ts:247`                          | `/Users/mr_an/Documents/cc-desktop-main/src/tools/agent/RunAgent.ts`                         |
| 后台 Agent task               | `/Users/mr_an/Documents/cc-desktop-main/src/tasks/LocalAgentTask/LocalAgentTask.tsx`                  | `/Users/mr_an/Documents/cc-desktop-main/src/tasks/LocalAgentTask.ts`                         |
| 后台任务 framework            | `/Users/mr_an/Documents/cc-desktop-main/src/utils/task/framework.ts`                                  | `/Users/mr_an/Documents/cc-desktop-main/src/tasks/TaskFramework.ts`                          |
| task 输出                     | `/Users/mr_an/Documents/cc-desktop-main/src/utils/task/diskOutput.ts`、`src/utils/task/TaskOutput.ts` | `/Users/mr_an/Documents/cc-desktop-main/src/tasks/TaskOutputStore.ts`                        |
| SDK task notification         | `/Users/mr_an/Documents/cc-desktop-main/src/utils/sdkEventQueue.ts:115`                               | `/Users/mr_an/Documents/cc-desktop-main/src/protocol/sdkEvents.ts`                           |
| Server 转发 task_notification | `/Users/mr_an/Documents/cc-desktop-main/src/server/ws/handler.ts:1892`                                | `/Users/mr_an/Documents/cc-desktop-main/src/protocol/messageMapper.ts`                       |
| 桌面端通知类型                | `/Users/mr_an/Documents/cc-desktop-main/desktop/src/types/chat.ts:205`                                | `/Users/mr_an/Documents/cc-desktop-main/src/webview/types/chat.ts`                           |
| 桌面端处理通知                | `/Users/mr_an/Documents/cc-desktop-main/desktop/src/stores/chatStore.ts:2066`                         | `/Users/mr_an/Documents/cc-desktop-main/src/webview/stores/chatStore.ts`                     |
| 消息列表                      | `desktop/src/components/chat/MessageList.tsx`                                                         | `/Users/mr_an/Documents/cc-desktop-main/src/webview/components/chat/MessageList.vue`         |
| 普通工具卡片                  | `/Users/mr_an/Documents/cc-desktop-main/desktop/src/components/chat/ToolCallBlock.tsx`                | `/Users/mr_an/Documents/cc-desktop-main/src/webview/components/chat/ToolCallBlock.vue`       |
| Agent 工具组                  | `/Users/mr_an/Documents/cc-desktop-main/desktop/src/components/chat/ToolCallGroup.tsx:332`            | `/Users/mr_an/Documents/cc-desktop-main/src/webview/components/chat/ToolCallGroup.vue`       |
| Agent 卡片                    | `/Users/mr_an/Documents/cc-desktop-main/desktop/src/components/chat/ToolCallGroup.tsx:475`            | `/Users/mr_an/Documents/cc-desktop-main/src/webview/components/chat/AgentCallCard.vue`       |
