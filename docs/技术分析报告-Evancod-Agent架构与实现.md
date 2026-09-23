# Evancod 技术分析报告

> 基于源码静态分析（版本 1.0.3）。所有结论均标注来源文件与关键行号，可直接对照代码复核。
> 分析范围：`src/`（Extension Host，约 90 个 TS 文件）、`webview/`（Vue 3 前端）、持久化与协议层。

---

## 目录

1. [项目是什么](#1-项目是什么)
2. [整体架构](#2-整体架构)
3. [项目整体如何流转（端到端数据流）](#3-项目整体如何流转端到端数据流)
4. [Agentic Loop：Agent 主循环的完整实现](#4-agentic-loopagent-主循环的完整实现)
5. [上下文怎么控制](#5-上下文怎么控制)
6. [会话怎么隔离（多会话、工作区、子 Agent）](#6-会话怎么隔离)
7. [提示词工程](#7-提示词工程)
8. [如何精准控制 Agent](#8-如何精准控制-agent)
9. [能力清单：它实现了什么](#9-能力清单它实现了什么)
10. [设计亮点与可借鉴模式](#10-设计亮点与可借鉴模式)

---

## 1. 项目是什么

**Evancod 是一款运行在 VS Code 中的 AI 编程 Agent 插件**（`package.json`：`vscode-evancod`，入口 `./out/extension.js`，挂载于辅助侧边栏 Webview）。

它不是简单的"聊天补全"工具，而是一个完整的 **Agentic 编码系统**：

- 在授权范围内**读取/修改项目文件、执行 Shell 命令、检索代码**；
- 通过**计划模式 → 任务拆解 → 子 Agent 协作 → 完成复核**完成复杂开发工作；
- 支持**多 AI Provider**（Anthropic Messages / OpenAI Chat Completions / OpenAI Responses / OpenAI Image 四种协议）；
- 通过 **MCP 协议**与 **Skill（Markdown 指令包）**动态扩展能力。

技术栈：Extension Host = TypeScript + Node.js + VS Code Extension API；Webview = Vue 3 + Pinia + Vite + SCSS；数据校验 = Zod。

---

## 2. 整体架构

### 2.1 双应用架构

```
┌──────────────────────────────── VS Code ────────────────────────────────┐
│                                                                          │
│  Extension Host（Node.js 主进程侧）          Webview（浏览器沙箱）         │
│  ┌────────────────────────────┐            ┌──────────────────────────┐  │
│  │ extension.ts 入口          │            │ Vue 3 Views / Components │  │
│  │  生命周期/命令/依赖注入      │            │  聊天/设置/任务/Diff      │  │
│  ├────────────────────────────┤            ├──────────────────────────┤  │
│  │ services/ 业务服务层        │◄──postMessage──► Pinia Stores          │  │
│  │  Chat/Provider/Task/Plan/  │   消息协议   │  chat/provider/task/     │  │
│  │  Agent/MCP/Skill/Memory    │            │  agent/plan              │  │
│  ├────────────────────────────┤            ├──────────────────────────┤  │
│  │ core/ 核心引擎层            │            │ useVSCode 消息桥接        │  │
│  │  QueryEngine/API/Tools     │            └──────────────────────────┘  │
│  ├────────────────────────────┤                                          │
│  │ adapters/ 适配器层          │                                          │
│  │  文件系统/配置/存储          │                                          │
│  └─────────────┬──────────────┘                                          │
└────────────────┼─────────────────────────────────────────────────────────┘
                 │
      ┌──────────┴──────────┐
      │                     │
 AI Provider(4 种协议)   工作区 / Git / MCP Server
```

### 2.2 Extension Host 四层分层（src/）

| 层级 | 目录 | 职责 |
|---|---|---|
| 入口层 | `src/extension.ts` | 激活流程、命令注册、12 个服务的构造与依赖注入 |
| 业务服务层 | `src/services/` | 聊天编排、Provider、任务、计划、子 Agent、MCP、Skill、记忆、持久化 |
| 核心引擎层 | `src/core/` | `QueryEngine`（Agent 循环）、API 客户端（3 套协议）、26 个内置工具 |
| 适配器层 | `src/adapters/` | 隔离 VS Code 的 Storage/Config/FileSystem API |

### 2.3 依赖注入方式（extension.ts:99-158）

激活时按序构造：`ProviderService` / `TaskManager` / `PlanModeManager` → `createBuiltinToolRegistry()` → `ToolProfileService` → `createBuiltinAgentRegistry()` → `AgentDefinitionStore`（全局 `~/.evancod/agents` + 工作区 `.evancod/agents` 双目录）→ `AgentCoordinator` → `MCPConnectionManager` → `SkillManager` → `MemoryManager` → `ChatService`（聚合注入）→ `WebviewManager`。

两个关键设计：

- **反向注入**：`taskManager.setWebviewManager(webviewManager)` 等（extension.ts:151-154），服务反向持有 UI 通道推送事件；
- **分级启动**：Provider/Task 随激活同步初始化，MCP/Skill/Memory 三项重 IO 放入 `void Promise.resolve().then(...)` 后台初始化，单项失败不影响扩展可用（extension.ts:163-175）。

### 2.4 通信协议

Webview ↔ Extension 使用**类型安全消息协议**（`src/types/messages.ts`）：

- `WebviewToExtensionMessage`（约 30 种）：`chat.send`、`permission.response`、`agent.stop`、`plan.approve`……
- `ExtensionToWebviewMessage`（约 40 种）：`message.delta`、`agent.event`、`permission.request`……
- Extension 内部另有统一的 **`AgentServerEvent` 流式事件协议**（messages.ts:29-117，18 种事件：`content_start/content_delta/tool_use_complete/tool_result/permission_request/thinking/image_generation/message_complete/status/system_notification/bash_output/bash_status` 等），**抹平三家 API 协议与工具系统的差异**，是整个系统的事件主干。

### 2.5 持久化布局

| 路径 | 内容 | 隔离粒度 |
|---|---|---|
| `<globalStorage>/sessions/` | `index.json` + `session-*.json` | 全局（跨工作区） |
| `<globalStorage>/tasks/<sessionId>/` | 任务 `task-*.json` | 按会话 |
| `<globalStorage>/agent-*` | 后台子 Agent 任务/输出/transcript | 按任务 |
| `<workspace>/.evancod/memory/` | 记忆 `*.md` + `MEMORY.md` 索引 | 按工作区 |
| `<workspace>/.evancod/plans/` | 计划 `*.md` | 按工作区 |
| `<workspace>/.evancod/agents/` | 工作区级自定义 Agent | 按工作区 |
| `~/.evancod/` | providers / skills / agents / mcp-servers | 全局 |

---

## 3. 项目整体如何流转（端到端数据流）

### 3.1 一条消息的完整旅程

```
用户在 Webview 输入 → chat.send
  → ChatService.sendMessage()        (ChatService.ts:607)
  → ChatService.runMessage()         (ChatService.ts:645)
      ① memoryManager.initialize()   （首次查询必须等 Memory 就绪）
      ② resolveSlashCommand()        （/clear /new /compact 本地消化，ChatService.ts:1077）
      ③ resolveAttachments()         （图片转 base64；文本附件截断 120,000 字符）
      ④ composeUserPrompt()          （@引用 → <file-ref> 胶囊 + <attachment> 正文，见 §7.2）
      ⑤ createRequestContext() + formatRequestContract() → <request_contract> 需求契约块
      ⑥ session.activeRun = { id, status:'running', phase:'planning' }
      ⑦ 若 provider.apiFormat==='openai_image' → 直接走图像生成通道，不建引擎
  → ChatService.initializeQueryEngine()  (ChatService.ts:1393)
  → QueryEngine.query()              (QueryEngine.ts:662)  ← 进入 Agentic Loop（§4）
  → 循环结束 → onComplete → 结果流式推回 Webview → 会话持久化
```

### 3.2 QueryEngine 的生命周期与引擎失效

- `initializeQueryEngine()` 注入：`sessionId / cwd / provider / model / effortLevel / messages / taskManager / planModeManager / agentCoordinator / mcpManager / skillManager / memoryManager / permissionMode / toolSnapshot`，并注册 4 个回调 `onMessage / onAgentEvent / onComplete / onError`（ChatService.ts:1393+）；
- QueryEngine 构造时固化 **Provider 快照 + messages 数组引用**（`QueryEngine.ts:404-406`），因此任何运行时配置变更（`setCurrentModel` / `setRuntimeOptions` / `resetRuntime`）都会把 `chatService.queryEngine` 置空强制重建——保证"配置变更即刻生效"，代价是重建成本低（消息引用共享，不复制）。

### 3.3 权限交互的往返流程

```
工具需要授权 → QueryEngine.requestPermissionIfNeeded()（QueryEngine.ts:1526）
  → emit permission_request 事件（带 requestId/input/描述）→ Webview 渲染 PermissionRequestBlock
  → 用户点击 允许/拒绝/总是允许 → Webview 发 permission.response
  → QueryEngine.handlePermissionResponse() 唤醒 Promise waiter（先注册 waiter 再通知 UI，防丢响应）
  → 'always' 规则 → toolName 加入 sessionAllowedTools（本会话免确认）
  → 5 分钟超时自动拒绝
```

---

## 4. Agentic Loop：Agent 主循环的完整实现

核心在 `QueryEngine.query()`（`QueryEngine.ts:662-1395`），主结构：

```typescript
while (iteration < MAX_ITERATIONS) {   // DEFAULT_MAX_ITERATIONS = 100（termination.ts:1）
  // ① 取消检查
  throwIfCancelled()                    // cancelled 标志 + abortController.signal

  // ② 上下文体检：自动压缩（见 §5.2）
  // ③ buildRequestMessages()           // 仅当触发 microcompact 时对"副本"瘦身（见 §5.3）
  // ④ 流式调用模型
  const response = await apiClient.sendMessageStream(
    requestMessages, onStream, toolDefinitions,
    { signal, toolChoice, onImageEvent }  // toolChoice:'required' 仅在计划模式强制时使用
  )

  // ⑤ 分支
  if (response.toolCalls.length > 0) {
    push assistant(toolCalls, status:'pending')
    flushPendingDeltas()                // 先冲刷文本流，保证 UI 顺序
    results = await executeToolCalls()  // → ToolOrchestrator.runTools()（见 §4.2）
    push role:'tool' 消息（含 vision contentBlocks）
    断路器检查 → continue
  } else {
    // 无工具调用：任务续跑判定 → 完成复核判定 → 正常结束
  }
}
```

### 4.1 终止与防呆体系（ termination.ts + QueryEngine 内部断路器）

这是该项目**最精细的部分**——一整套"防模型失控"的多层护栏：

| 机制 | 阈值 | 行为 |
|---|---|---|
| 最大迭代 | `DEFAULT_MAX_ITERATIONS = 100` | 循环硬上限，`terminationReason` 记录原因 |
| 输出截断续跑 | `MAX_OUTPUT_CONTINUATIONS = 3` | `response.incomplete` 时注入 `[内部续跑指令]` 续写；超限以 `output_limit` 收尾 |
| 空响应恢复 | `MAX_EMPTY_RESPONSES = 3` | 空响应先注入 `[内部恢复指令]` 重试；>3 次抛错 |
| 任务续跑 | `MAX_TASK_CONTINUATIONS = 8` | 存在 pending/in_progress 任务时注入 `[内部任务续跑指令]` 驱动继续 |
| 探查死循环断路器 | 连续 **2** 轮 `noProgress` | 判定"重复探查"（如反复读同一文件），发通知、`loopBroken=true`、以 `no_progress` 终止 |
| 重复错误断路器 | 相同错误签名连续 **3** 轮 | 判定工具反复失败，break 强制收尾 |
| 计划模式工具强制 | `MAX_PLAN_TOOL_USE_RETRIES = 2` | 计划模式下纯文本回复 → `content_discard` 丢弃 + 注入"必须调用工具"约束；超限抛错 |
| 任务完成复核 | 恰好 1 次 | 全部任务 completed 时注入 `[内部完成复核指令]`（含 `buildTaskReviewContext()`），要求对照用户要求逐项提交证据后才算完成 |
| 权限超时 | 5 分钟 | 未响应自动拒绝 |

内部续跑指令以 `internal: true` 消息写入历史——**持久化以支持崩溃恢复，但 UI 不展示**。

### 4.2 工具执行管线（ToolOrchestrator → ToolExecutor）

```
executeToolCalls() (QueryEngine.ts:1486)
  → ToolOrchestrator.runTools()   （orchestrator.ts，144 行：调度、检查取消标志、组织执行）
  → ToolExecutor.runToolUse()     （executor.ts:38+，单工具执行七步：
     ① 查找工具（找不到 → 错误结果回灌，模型可自我纠正）
     ② JSON Schema 校验入参
     ③ 权限门：ask_user_question 走 requestInteraction，其余走 requestPermission
     ④ resolveExecutionInput()       （权限响应可带 updatedInput 修正入参）
     ⑤ emit tool_use_complete 事件
     ⑥ Promise.race([执行, 取消])    （取消即时短路返回"工具执行已取消"）
     ⑦ 结果双通道处理（见下）
```

**结果双通道**是显著设计：`formatToolResultContent(result, {forWebview: true|false})`（ToolExecutor.ts:110-113）——
- **给 Webview 的**：保留完整 metadata（含图片 base64 预览等 `_webviewOnly` 数据）；
- **回灌给 LLM 的**：剔除 `_webviewOnly` 与图片 base64，再经 `prepareToolResultForContext()` 归档裁剪（见 §5.4）。
这样 UI 富展示与模型上下文成本互不拖累。

**去重**：`ToolCallDeduplicator` 识别模型重复发起的完全相同调用并拦截。

### 4.3 Bash 工具的安全与执行控制（BashTool.ts）

- 超时：`DEFAULT_TIMEOUT` / `MAX_TIMEOUT = 120000ms`（120s 硬顶），超时 `forceFinish('timeout')`；
- 后台执行：`run_in_background: true` 返回 taskId，通过 `bash_output` / `bash_status` 事件持续推送 stdout/stderr；
- **危险命令黑名单**（BashTool.ts:85-92）：`rm -rf /`、`rm -rf ~`、`mkfs`、`dd if=`、fork 炸弹 `:(){:|:&};:`、`chmod -R 777 /`、`chown -R`；
- shell 探测结果缓存，取消时先 `cancelledBeforeStart` 兜底（进程未起时标记，启动即杀）。

---

## 5. 上下文怎么控制

Evancod 构建了一套**四层递进的上下文成本管控**体系，从"注入前控制"到"超限压缩"逐级生效。

### 5.1 Token 计量与窗口模型

**估算**（无真实 tokenizer，`microcompact.ts:31-49`）：

```
tokens = ceil(总字符数 / 4)
字符统计范围：message.content + contentBlocks(text + base64 图片 data 全额)
            + toolCalls 的 JSON.stringify(input).length
```

**上下文窗口**（`modelContextWindows.ts`）：

```
configuredWindow = provider.modelContextWindows?.[model] || provider.autoCompactWindow
total      = configuredWindow > 0 ? configuredWindow : 1_000_000   // 默认 100 万
reserved   = min(20_000, floor(total × 0.1))                       // 预留输出与安全余量
effectiveWindow = total - reserved                                  // 默认配置下 980,000
```

**输出上限**（`modelTokens.ts`，经 `getCanonicalName` 规范化模型名——剥离 Bedrock ARN 前缀、Vertex `@日期`、版本后缀）：按模型家族给 default/upperLimit 两档（如 opus-4-6: 64k/128k，claude-3 系列 4k-8k，未知中转模型默认 128k）。

**运行时取数**：`currentTokens = max(服务端 usage.lastTotalTokens, 本地估算)`（QueryEngine.ts:765-766）。usage 经 `normalizeRequestUsage`（api/shared.ts:72-91）跨协议归一化：Anthropic 的 cache_read/cache_creation 单独成字段，OpenAI 的缓存输入视为 input 子集（`cacheIncludedInInput=true`）。

### 5.2 第一层：注入前控制（源头减量）

| 手段 | 位置 | 说明 |
|---|---|---|
| 附件截断 | `TEXT_ATTACHMENT_LIMIT = 120_000` | 文本附件超限截断并标记 |
| 用户提示词结构化 | UserPromptComposer | 引用只注入 `<file-ref>` 胶囊（含路径），附件正文后置注入，重复引用去重 |
| 记忆上下文限额 | ChatService.buildMemoryContext():1365 | 所有记忆拼接后**截断到 12,000 字符**，包成 `<memory_context>` 标签注入首条消息 |
| Skill 渐进披露 | QueryEngine.buildSkillCatalog() | 系统提示词只放"名称+描述"目录，正文按需经 skill 工具加载（token 随技能数线性但极小） |
| 工具结果瘦身 | ToolExecutor 双通道 | 图片 base64、`_webviewOnly` 数据永不进模型上下文 |

### 5.3 第二层：microcompact（廉价微压缩）

`microcompact(messages, keepRecent = 5)`（microcompact.ts:64+）：

- 针对可压缩工具集合 `COMPACTABLE_TOOLS`（read_file、bash、grep、glob、web_search、web_fetch、edit_file、write_file、list_directory、find、lsp 共 11 种）的**旧工具结果**；
- 保留最近 5 个结果全文，更旧的**头 1000 字符 + 尾 400 字符**替换原文（`OLD_RESULT_HEAD_CHARS=1000` / `OLD_RESULT_TAIL_CHARS=400`）；
- **错误结果永不清理**：`PROTECTED_RESULT_PATTERN` 匹配 `success:false / error / failed / timeout / cancelled / 错误 / 失败 / 超时 / 取消`；
- **有损但只作用于副本**：源码注释明确记录历史教训——"曾从第 2 轮起无条件覆盖真实历史，导致模型反复重读文件（探查死循环）"。现在只对 `buildRequestMessages()` 产出的请求副本瘦身，会话真实历史不动。

### 5.4 第三层：工具结果归档（64KB 阈值）

`prepareToolResultForContext()`（toolResultContext.ts:14+）：

```
结果 > 64KB（MAX_INLINE_RESULT_BYTES）时：
  → 完整原文写入 <cwd>/.tmp/evancod-tool-results/<toolUseId>-<sha256前16位>.txt
  → 模型只收到：头 12,000 字符 + 尾 4,000 字符预览
    + "[结果过长] 完整原文已保存到 xxx（SHA-256: xxx），
       需要中间内容时使用 read_file 按 offset/limit 分段读取该文件，不要重新执行原工具"
  → 归档写盘失败则回退完整回灌（宁可多用 token 也不丢能力）
```

巧妙之处：**不截断信息，而是把信息"换位置"**——从上下文移到磁盘，并明确告诉模型按需取回，避免"上下文膨胀"与"信息丢失"的两难。

### 5.5 第四层：autoCompact 自动压缩（模型摘要）

**触发**：`shouldAutoCompact()`（autoCompact.ts:26-42）——每轮模型调用前检查：

```
currentTokens ≥ effectiveWindow − AUTOCOMPACT_BUFFER_TOKENS(13,000)
即默认窗口下 ≥ 967,000 tokens 触发
断路器：连续 3 次压缩失败（compactFailures ≥ 3）自动停用
```

**执行**（`performAutoCompact()`，QueryEngine.ts:1735+）：

1. 摘要模型 = `provider.models.haiku || 当前模型`，`effortLevel: 'low'`（省成本）；
2. `compactConversation()`（compact.ts）：**先剥离所有图片为 `[image]` 占位** → 历史转为 `User:/Assistant:` 纯文本 → 用 9 段结构化 prompt 生成摘要；
3. **原地替换真实历史**：`this.config.messages = [摘要消息, ...最近 10 条消息]`（`keepRecentCount = 10`）；
4. 失败只计数并通知，**绝不中断工具循环**。

**9 段压缩提示词**（compactPrompt.ts，全文）：

```
1. Primary Request and Intent   — 用户核心请求
2. Key Technical Concepts       — 关键技术概念/架构/设计模式
3. Files and Code Sections      — 文件路径、关键代码、修改内容
4. Errors and fixes             — 错误与修复过程
5. Problem Solving              — 解决思路与有效方案
6. All user messages            — 按时间序的用户消息要点
7. Pending Tasks                — 未完成任务
8. Current Work                 — 压缩前最后进行的工作
9. Optional Next Step           — 建议下一步
结尾指令："Continue the conversation from where it left off without asking the user
any further questions. Resume directly — do not acknowledge the summary…"
```

压缩边界消息带 `compact-boundary-<时间戳>` ID，UI 有 CompactionStatus 组件展示进度。

### 5.6 Thinking 预算控制（thinking.ts）

`effortLevel → thinking budget` 映射（受模型 `upperLimit − 1` 收敛）：

| effortLevel | budget_tokens |
|---|---|
| low | 0（关闭思考） |
| medium | 16,000 |
| high | 32,000 |
| max | 128,000（由模型上限收敛） |

双层判断：用户是否开启（effortLevel）× 模型是否支持（`modelSupportsThinking` / `modelSupportsAdaptiveThinking`），同时满足才附加 thinking 参数；支持 adaptive 的模型发 `{type:'adaptive'}`。

---

## 6. 会话怎么隔离

隔离发生在**四个维度**：多会话之间、会话与工作区之间、主会话与子 Agent 之间、运行时与持久化之间。

### 6.1 会话数据结构（types/index.ts:235-262）

```typescript
Session {
  id: string                  // 时间戳-随机串
  name: string                // 默认"会话 <本地时间>"，首条消息后取前 100 字
  createdAt / updatedAt
  messages: Message[]         // 完整对话历史（Agentic Loop 的上下文来源）
  workDir: string             // ★ 创建时固化的工作目录——会话与工作区绑定的根
  transcript: AgentTranscriptBlock[]   // 结构化事件流水（9 种判别联合）
  agentTaskNotifications               // 子 Agent 完成通知（按 toolUseId 索引）
  runtimeConfig { model, effortLevel, permissionMode }  // ★ 会话级运行时配置
  tokenUsage / compactSummary / attachments / requestContexts / activeRun
}
```

**每个会话独立持有**：消息历史、运行时配置（切换会话即切换模型/权限模式）、任务列表（TaskItem 带 `sessionId` 字段，任务天然隔离到会话）、计划状态（PlanModeManager 内部 `sessions: Map<sessionId, …>`）、子 Agent 通知流。

### 6.2 持久化机制（SessionPersistenceService.ts，553 行）

**双后端**：

1. **文件后端（默认）**：`<globalStorage>/sessions/index.json`（`{version:2, currentSessionId, sessionIds[]}`）+ 每会话一个 `session-<encodeURIComponent(id)>.json`；
2. **globalState 兼容后端**：键 `evancod.sessions` / `evancod.sessions.<id>`，仅用于测试宿主与旧版迁移（`load()` 用 `isSessionIndex()` 判别 v2 并兼容旧单键全量格式）。

**写入策略（三重节流）**：

- **尾随防抖**：`autoSaveDelay = 1000ms`，流式期间检测 `isStreaming` 置 `persistenceDirtyWhileStreaming` 直接跳过，结束后补写（ChatService.ts:207-212）；
- **指纹增量**：`createSessionSnapshot()`（:374）生成每会话指纹（`updatedAt/messageCount/transcriptLength/lastBlockId/lastBlockContentLen/name`），与上次比对，**只序列化变更的会话文件**，无变化跳过；
- **立即通道**：停止生成、权限响应等关键节点 `immediate=true` 绕过防抖。

**崩溃恢复**：`permission_request` / `interaction_request` 事件带 `responseState` 状态机，恢复会话时把遗留 pending 状态标记为 cancelled；`internal` 消息（内部续跑指令等）持久化但 UI 不渲染。图片 base64 只存运行时，持久化只留 `path/mime/name`。

### 6.3 跨会话记忆系统（MemoryManager.ts，744 行）

- **存储**：`<workspace>/.evancod/memory/` 下按主题分 `*.md` 文件 + `MEMORY.md` 索引——按**工作区**隔离，天然跨会话共享；
- **注入**：每次发送消息时 `buildMemoryContext()` 把全部记忆（含 type/name/description 元数据）拼接、截断 12,000 字符、包 `<memory_context>` 标签注入首条用户消息（ChatService.ts:1357-1373）；
- 与会话隔离的关系：**会话内上下文随会话消亡，工作区记忆跨会话长存**——两层记忆互补。

### 6.4 子 Agent 的上下文隔离（AgentCoordinator.ts）

子 Agent 的隔离是**重建一个完整引擎**而非共享上下文：

```typescript
// AgentCoordinator.startAgent() (AgentCoordinator.ts:255-310)
const engine = new QueryEngine({
  messages: [],                          // ★ 全新空历史——与主会话零共享
  cwd: effectiveCwd,                     // 可能是独立 worktree 路径
  systemPrompt: buildSystemPrompt(definition, config.description),  // 独立角色提示词
  permissionMode / readOnly / maxIterations / toolSnapshot: 按 Agent 定义裁剪,
})
```

- **结果摘要返回**：子 Agent 完整输出**不直接**回灌主上下文。超过 1200 字符时用 haiku 模型 + 专用"高保真摘要"提示词（AgentCoordinator.ts:760-810：只依据报告内容、保留结论/根因/文件路径/错误文本、区分已验证事实与推断、摘要必须自包含）压缩成语义摘要，`fullOutput` 单独存档可查。设计注释直言动机："避免为了节省上下文而把关键结论简单截掉，导致主 Agent 重复调查"；
- **事件路由**：子 Agent 事件带 `parentToolUseId` 转发主 UI；子 Agent 的权限请求也弹主界面（描述前缀"子 Agent「xxx」"），权限决策注册到协调器的 map 中按 requestId 路由回对应引擎；
- **双超时保护**：总时长 30 分钟（`AGENT_MAX_RUNTIME_MS`）+ 静默超时 6 分钟（`AGENT_INACTIVITY_TIMEOUT_MS`，每次活动重置），超时自动 cancel 并以失败结果收尾。

### 6.5 Worktree 物理隔离（AgentWorktreeManager）

`isolation: 'worktree'` 时（AgentCoordinator.ts:263-266）：

- 启动前 `worktreeManager.prepare({agentId, cwd})` 为子 Agent 创建**临时 git worktree**，`effectiveCwd` 指向 worktree 路径——子 Agent 的所有文件写操作发生在独立目录，物理上不可能污染工作区；
- 结束（含失败/取消）后 `worktreeManager.cleanup(worktree)` 清理，清理失败仅告警。

### 6.6 适配器层隔离（src/adapters/）

所有 VS Code 环境能力经三个适配器收口：`StorageAdapter`（globalState/secrets）、`ConfigAdapter`（settings 读写）、`FileSystemAdapter`（文件 IO）——核心层只依赖接口，测试与移植只需替换适配器（`__tests__/FileSystemAdapter.test.ts` 即验证此边界）。

---

## 7. 提示词工程

### 7.1 主 Agent 系统提示词（QueryEngine.buildSystemPrompt():476-509）

主提示词原文（含动态插槽）：

```
你是 Evancod，一个在 VS Code 插件中运行的软件工程 Agent。

工作契约：
- 复杂多步骤、todo list 或多项请求使用 task_create；执行前用 task_update 标记 in_progress，
  实际实现和验证完成后才能标记 completed，再用 task_list 检查下一项。计划权限模式是例外。
- 编码前读取、搜索并分析工作区。能从代码、配置、文档、测试或既有模式确认的信息自行确认，
  不询问用户。
- 只有缺少外部信息，或选择会实质影响公开 API、数据、依赖、兼容性、安全、性能、用户体验、
  不可逆操作范围或验收标准时，才调用 ask_user_question 集中询问 1-4 个阻塞问题。
- 对局部、可逆、低风险细节遵循项目既有模式。用户要求冲突或不同理解会产生显著不同结果时，
  不得擅自选择。
- 测试失败、实现不完整、文件缺失或仍有阻塞时，不得声称完成。
- 工具执行结果会作为上下文回灌。根据结果继续下一步，直到无需再调用工具。
- 对复杂、独立或上下文较重的研究任务，可以使用 agent。后台 Agent 启动后不要轮询，
  等待完成通知。
- 用户明确指定某个子 Agent 时，必须把对应定义 ID 传给 subagent_type；该 Agent 失败或
  超时后不得自行替代执行，应说明原因并询问是否重试。
- 需要生成图片时，必须调用 image_gen 工具，不要在文本中描述或伪造图片结果。
```

**动态拼接插槽**（按条件注入）：

| 插槽 | 条件 | 内容 |
|---|---|---|
| `planModeNotice` | `permissionMode === 'plan'` | "当前处于计划权限模式：先调用 enter_plan_mode…完成只读分析后调用 exit_plan_mode 提交完整 tasks/steps/risks，等待用户审批；审批前不要调用 write_file/edit_file，且不要调用任何 task 工具" |
| `buildSkillCatalog()` | 存在已启用 Skill | "可用 Skill 目录（共 N 个）：名称（来源）：描述" + 使用契约（问清单直接答、执行传名称、`{"skill":"list"}` 取全量） |
| `injectedPrompt` | 自定义 Agent / 注入提示词 | "当前角色与附加约束：\n<注入内容>" |

### 7.2 用户提示词的契约化（UserPromptComposer.ts）

用户输入不是原样透传，而是被**结构化重写**：

1. **`@` 引用 → `<file-ref>` 胶囊**：`<file-ref id="ref-3" path="src/app.ts">app.ts</file-ref>` 保留在原句位置（`ref-N` 编号与附件稳定关联）；
2. **附件正文后置**：文本附件包 `<attachment ref="ref-3" path name>` 标签附在指令后，截断时加 `[内容已截断]`；非文本附件列清单（`- [ref-2] 路径 (图片)`）；
3. **Skill 段** → "使用 xxx 技能（描述），"；
4. **请求契约**：`createRequestContext()` 把本次请求登记为 `RequestContext`（含 requirementIds），`formatRequestContract()` 生成：

```
<request_contract>
以下内容来自用户原始请求，不得在任务拆解、实现或总结时弱化：
- [request-xxx-requirement-1] <用户原文>
引用文件：
- [ref-3] app.ts: src/app.ts
</request_contract>
```

**注入时机智能判断**（`shouldIncludeRequestContract()`）：只有满足以下之一才注入——续跑场景、有引用、原文 ≥500 字符、含 ≥2 条列表项、命中"同时/以及/多个/重构/迁移/完整实现"等关键词。**简单请求不加冗余，复杂请求防弱化**——这是按需注入的典型实践。

### 7.3 任务系统的提示词契约

`task_create` / `task_update` 的工具 description 内嵌行为约束（本文档开头的系统提示词即引用了实际注册文本）：

- "创建任务后，开始执行前必须使用 task_update 将任务标记为 in_progress"；
- "只有工作完全完成时才能标记 completed；测试失败、实现不完整、文件缺失或仍有阻塞时不能标记 completed"；
- "标记 completed 必须用 completionEvidence 逐项说明满足方式和证据位置；不得只写'已完成'"——**用数据结构强制"完成证据"**；
- "首次 completed 只提交证据并进入 reviewing；复核通过后才真正完成"。

任务状态机（TaskManager.ts:499-512）与提示词互相印证：

```
pending → in_progress → completed（需复核）
              ↓
           pending（回退）/ deleted
非法迁移直接抛错（validateStatusTransition）
```

### 7.4 内部控制指令（隐形提示词）

Agentic Loop 中的续跑/恢复/复核指令以 `internal: true` 消息注入（持久化但不显示）：

- `[内部续跑指令]`：输出被截断时驱动续写；
- `[内部恢复指令]`：空响应时要求重新输出；
- `[内部任务续跑指令]`：有未完成任务时驱动继续（上限 8 次）；
- `[内部完成复核指令]`：携带 `buildTaskReviewContext()`（当前任务树 + 用户 requirements），要求"逐项提交证据"后才能真正收尾。

### 7.5 子 Agent 提示词体系

**内置三种只读 Agent**（AgentRegistry.ts:160-200，全部 `readOnly: true`、只挂 9 个读类工具、`maxIterations: 30`、前台默认）：

| ID | 定位 | 专属 systemPrompt 要点 |
|---|---|---|
| `explore` | 查找文件、理解代码库结构并总结 | 用 glob/grep/find 搜索、read_file 查看、总结发现 |
| `analyze` | 分析代码结构、依赖、设计模式与潜在问题 | 用 analyze_ast / analyze_dependencies、输出分析报告 |
| `research` | 查找文档与最佳实践并形成可执行建议 | 查文档、理解概念、总结发现 |

**子 Agent 通用外壳**（AgentCoordinator.buildSystemPrompt():725-740，与专属提示词拼接）：

```
你是一个专门的子 Agent，负责执行特定的任务。

任务描述：<description>

执行约束：
- 信息足以回答后立即给出最终结果，不要继续扩大调查范围。
- 工具已完整返回某个文件时，不要为了重新定位内容而分段重复读取该文件。
- 只有工具结果明确标记为截断时，才继续读取缺失部分。
- 遇到模型或工具异常时基于已有证据收尾，不要无限重试。
```

这四条约束分别针对：范围蔓延、重复读取、无谓续读、无限重试——全部来自真实故障模式。

**自定义 Agent**：用户在 `~/.evancod/agents/<id>/`（全局）或 `.evancod/agents/<id>/`（工作区）定义 JSON + `system.md`（AgentDefinitionStore 原子写入/读取），可配置：专属 systemPrompt、`modelTier`（main/sonnet/opus/haiku 逻辑档位）、effortLevel、enabledTools 白名单、readOnly、permissionMode、maxIterations、isolation、defaultMode、启用开关；ID 格式校验（`^[a-z0-9][a-z0-9._-]*$`）、source 优先级（workspace > global > builtin，低优先级不得覆盖高优先级）。

### 7.6 多协议提示词适配

`AnthropicClient` / `OpenAIChatClient` / `OpenAIResponsesClient` 各自把内部消息格式转换为协议格式：systemPrompt 在 Anthropic 走顶层 `system` 字段，在 OpenAI 走首条 `role:'system'` 消息；工具调用/结果消息经 `toolMessageSanitizer` 清洗（修复孤儿 tool_use/tool_result 配对，保证任何协议下消息序列合法）。

---

## 8. 如何精准控制 Agent

控制手段分五类：**权限门禁、模式切换、工具裁剪、任务契约、断路护栏**。

### 8.1 权限门禁（四种模式，QueryEngine.requestPermissionIfNeeded():1526-1640）

```
permissionMode 判定顺序：
① plan + task_* 工具           → 直接拒绝："计划模式完全不使用 Task 工具"
② plan + 非白名单工具           → 拒绝 + 提示语："计划尚未审批，不能调用 xxx。
                                   请不要重试写入或执行操作，继续只读分析并调用
                                   exit_plan_mode 提交计划。"
③ bypassPermissions / 本会话已 always 放行 → 直接通过
④ 按能力标签（capabilities）+ 模式决定是否需要审批：
   - default       ：write | execute | network 任一 → 需审批
   - acceptEdits   ：execute | network | 危险文件工具（delete/move/copy_file）→ 需审批；
                      普通 write_file/edit_file 免审
   - plan          ：不额外要求（由白名单控制）
   - bypassPermissions：全免
```

配套机制：

- **能力标签系统**：每个工具注册时声明 `capabilities`（read/write/execute/network/interactive），权限判定基于标签而非工具名——新工具天然纳入管控；
- **会话级 allowlist**：用户选"总是允许"→ `sessionAllowedTools.add(toolName)`，本会话同类操作免确认（会话结束失效）；
- **确认 UI 往返**：`permission_request` 事件 → Webview `PermissionRequestBlock` → `permission.response` 消息唤醒等待中的 Promise；先注册 waiter 再发事件防竞态；5 分钟超时自动拒绝；
- **入参修正**：审批响应可携带 `updatedInput`（用户可在确认时修改工具参数，如把 `rm -rf` 改成安全路径）。

### 8.2 计划模式（PlanModeManager.ts）

状态机：`inactive → planning → approved / rejected`。

```
① permissionMode='plan' 时：系统提示词注入 planModeNotice；每轮强制 toolChoice='required'
   （requiresPlanToolUse()：未审批前模型必须调工具，纯文本回复被 content_discard 丢弃并注入约束，
    MAX_PLAN_TOOL_USE_RETRIES=2 次后报错）
② 工具白名单 PLAN_MODE_ALLOWED_TOOLS（PlanModeManager.ts:97-118）：
   读类（read_file/glob/grep/find/list_directory/analyze_ast/analyze_dependencies/
   git_status/git_diff/git_log/git_branch）+ 交互（ask_user_question）+ 计划工具本身
③ AI 调用 enter_plan_mode → 创建 Plan（tasks/steps/risks 结构）→ 只读分析
④ AI 调用 exit_plan_mode 提交 → Webview 渲染 PlanApproval（计划/步骤/风险评估）→ 用户审批
⑤ 批准 → state='approved'，解除限制，计划可转入任务执行；拒绝 → 带原因继续规划
⑥ 计划文件持久化到 <workspace>/.evancod/plans/*.md
```

**双重强制**：提示词（告诉模型规则）+ 代码级硬门禁（不守规则也过不去）。

### 8.3 工具集裁剪（ToolProfileService + RuntimeProfileResolver）

- 26 个内置工具统一在 `BuiltinToolRegistry` 注册（id 前缀 `builtin.`，含 capabilities/风险级/inputSchema）；
- `ToolProfileService` 支持 **global / workspace 两级启用禁用偏好**（存储键 `toolProfile.global.v1` / `.workspace.v1`），`resolve()` 产出 `ToolRegistrySnapshot`（有效工具集 + warnings）；
- QueryEngine 与 AgentCoordinator 都从 snapshot 取工具并**裁剪 toolDefinitions**（发给模型的工具清单）与 toolPolicies——禁用的工具模型根本"看不见"；
- 计划模式下额外过滤 `task_*` 工具（QueryEngine.ts:440-447：`planModeDisablesTasks` 从快照直接剔除）；
- MCP 工具经 `MCPTool` 包装注入注册表，与内置工具同权受控。

### 8.4 任务契约与完成复核

- TaskItem 结构（index.ts:292-330）：`blocks/blockedBy` 依赖（`canStart` = pending 且无阻塞）、`requestId/requirementIds`（任务与用户请求的需求 ID 绑定——**可追溯性**）、`completion` 复核状态；
- 需求继承链：用户消息 → `RequestContext.requirements` → task_create 自动把 `activeRequestContext.requirements` 写入任务（TaskManager.ts:211）→ 完成时须逐项提交 evidence；
- 全部任务 completed 时主循环注入 `[内部完成复核指令]`，模型须对照 requirements 复核——**防止"嘴上完成"**；
- `TaskNotificationQueue.enqueue()` 把子 Agent 完成事件转为 `session.messages` 中的**合成消息**（synthetic message），下一轮模型调用自然"看到"后台子 Agent 的结果——后台 Agent 的异步回灌机制。

### 8.5 断路护栏汇总

见 §4.1 表格。此外还有：

- **取消传播**：`cancelled` 标志 + `abortController` 双通道；工具执行用 `Promise.race` 即时短路；Bash 进程强制终止；
- **孤儿修复**：引擎构造时 `closeDanglingToolCalls()` 修复崩溃遗留的未闭合 tool_use（否则下次请求会被 API 拒绝）；
- **AgentTool 的失败约束**：子 Agent 失败时错误信息尾部固定附加："用户明确指定该 Agent 时，不得由主 Agent 自行替代执行；应说明失败原因并询问是否重试"（AgentTool.ts:211-215）——把控制规则写进工具结果本身。

---

## 9. 能力清单：它实现了什么

### 9.1 工具系统（26 个内置工具，注册于 BuiltinToolRegistry.ts）

| 类别 | 工具 | capabilities |
|---|---|---|
| 文件（7） | read_file、write_file、edit_file（精确文本替换）、copy_file、move_file、delete_file、notebook_edit（Jupyter 单元格） | read/write |
| 搜索（4） | glob、grep（文本/正则）、list_directory、find（名称/类型/大小/时间） | read |
| 执行（1） | bash（超时 120s、后台执行、危险命令黑名单） | execute |
| 代码（1） | lsp（符号定义/引用/实现/诊断/类型定义） | read |
| Web（2） | web_search、web_fetch | read+network |
| 图像（1） | image_gen（独立图像服务，生成保存到工作区） | write+network |
| 任务（4） | task_create、task_update（状态机+证据复核）、task_list、task_get | read/write |
| 编排（2） | agent（子 Agent，含 worktree 隔离）、ask_user_question（1-4 个单选/多选问题） | execute+interactive |
| 计划（2） | enter_plan_mode、exit_plan_mode | write |
| MCP（1） | mcp（发现并调用 MCP Server 工具，动态枚举） | execute+network |
| Skill（1） | skill（按名加载或 list 全量） | read |

### 9.2 已实现的功能面

**对话与 UI**

- 流式输出（token 级增量）、Thinking 展示（ThinkingBlock）、Markdown 渲染 + 代码高亮（Shiki）；
- 文件选择/拖拽/粘贴/`@` 引用注入上下文，图片 vision（工具结果含图片时构造 vision block 让模型"看见"）；
- 多会话管理（历史恢复、跨会话记忆、会话级模型/权限配置）；
- 子 Agent 卡片（前台/后台状态、transcript 回放）、权限确认卡片、计划审批卡片、问答回答卡片、Diff 查看器、任务面板、上下文占用显示（CompactionStatus）、终端输出流。

**引擎与协议**

- Agentic Loop（100 轮上限 + 8 类断路护栏）、三协议适配（Anthropic Messages / OpenAI Chat Completions / OpenAI Responses）+ 独立图像协议；
- usage 归一化（含缓存 token）、模型名规范化、输出上限按模型家族适配、thinking 自适应；
- new-api 中转同步（OAuth2 授权流程拉取服务配置，NewApiSyncService）。

**编排与扩展**

- 计划模式全流程（Enter/Exit/审批/转执行）、任务系统（依赖/状态机/证据复核/需求继承）；
- 子 Agent（3 内置 + 自定义、前台/后台、worktree 隔离、30min/6min 双超时、语义摘要回传）；
- Skill（全局/工作区 Markdown 指令包，YAML frontmatter，渐进披露）、MCP（动态发现/调用）、自定义 Agent（JSON+system.md，全局/工作区两级，逻辑模型档位）、工具偏好（全局/工作区启停）。

**可靠性与安全**

- 四级上下文管控（§5）、会话防抖持久化 + 崩溃恢复 + 指纹增量写入；
- 四模式权限 + 能力标签 + 会话 allowlist + 危险命令黑名单 + 权限超时 + 入参修正；
- 性能日志（performanceLogger 事件埋点：启动分阶段计时、工具耗时、权限响应延迟）。

### 9.3 明确不做的（边界）

- 不做真实 tokenizer（字符/4 估算）；
- 无持久化 prompt cache_control 标记（未利用 Anthropic 缓存省钱，仅做 usage 归一化）；
- OpenAI 官方 OAuth provider 明确不支持直连（QueryEngine.ts:562 抛错）；
- 压缩摘要模型依赖 provider.models.haiku 配置，未配置时回退当前模型。

---

## 10. 设计亮点与可借鉴模式

1. **单一事件协议抹平异构**：`AgentServerEvent` 让 UI 与引擎解耦于三家 API 协议——换 Provider 不动上层。
2. **四层上下文管控递进设计**：注入前减量 → microcompact（副本、保错误）→ 64KB 归档换位（"不截断信息而是换位置，并告诉模型怎么取回"）→ autoCompact（9 段结构化摘要 + keepRecent 10）。每层有明确触发阈值与失败降级。
3. **断路护栏工程化**：8 类终止/防呆机制全部带常量阈值与 terminationReason，把"模型失控"从玄学变成可观测的工程问题；源码注释保留历史教训（覆盖真实历史导致探查死循环）。
4. **双重强制控制**：提示词约束（软）+ 代码级硬门禁（硬）并行——计划模式既改提示词又拦截工具，模型"不听话"也执行不了。
5. **完成证据制度**：任务 completed 必须 requirementId + summary + refs 逐项举证，先 reviewing 后完成——对抗 LLM"口头完成"倾向的机制化方案。
6. **双通道工具结果**：Webview 富展示与模型上下文成本分离，`_webviewOnly` 数据只进 UI 不进模型。
7. **子 Agent 语义摘要**：不用"截断"而用 haiku 二次提炼（保留结论/根因/证据/阻塞点），完整输出另存可查——上下文效率与信息保真的平衡。
8. **渐进披露**：Skill 只注入目录（名称+描述），正文按需加载；权限先注册 waiter 再通知 UI 防竞态；先读配置再建引擎，配置变更即失效重建。
9. **契约化用户输入**：`<request_contract>` 把用户需求固化为可追溯的 requirementIds，贯穿 RequestContext → 任务 → 完成复核全链路。
10. **适配器层隔离**：VS Code API 全部收口到 3 个 adapter，核心可脱离 VS Code 测试。

---

*报告完。所有引用行号基于当前工作区源码（v1.0.3），如代码迭代请以最新实现为准。*
