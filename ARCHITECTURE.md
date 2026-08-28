# Evancod 架构文档

> 基于实际代码逆向分析，版本 0.1.27

---

## 一、项目概述

**Evancod** 是一个 VSCode 插件形式的 AI 编程 Agent，运行在 VSCode Extension Host 进程中。它让用户可以在 VSCode 侧边栏中与 AI 对话，AI 可以调用 50+ 种内置工具来操作文件、执行命令、搜索代码、管理 Git、生成图片等。

### 1.1 核心能力

| 能力 | 说明 |
|------|------|
| 对话交互 | 流式文本响应、思考模式（Thinking）、多模态（图片输入） |
| 工具系统 | 50+ 内置工具，覆盖文件操作、搜索、执行、Git、LSP、Web 等 |
| 多 Provider | Anthropic、AWS Bedrock、Google Vertex AI、Azure OpenAI、自定义兼容端点 |
| MCP 协议 | 连接外部 MCP Server，动态扩展工具 |
| 任务管理 | 子任务拆解、依赖关系、状态追踪 |
| 子 Agent 编排 | 创建独立子 Agent 执行研究/分析任务，支持 worktree 隔离 |
| 计划模式 | 先规划后执行，用户审批流程 |
| 跨会话记忆 | 持久化记忆系统，跨会话保留关键信息 |
| Skill 系统 | 文件驱动（Markdown + YAML frontmatter），支持全局/工作区两级 |
| 上下文压缩 | 自动检测 context 超限，通过摘要压缩保持对话连续性 |
| new-api 同步 | 通过 OAuth2 流程从第三方站点同步 API Token |
| 图片生成 | 独立生图通道，支持图片展示和持久化 |

### 1.2 技术栈

| 层 | 技术 |
|----|------|
| Extension Host | TypeScript 5.x, Node.js 18+ |
| 前端 (Webview) | Vue 3.4+, Pinia 2.x, Vite 5.x, SCSS, Shiki (代码高亮), Marked (Markdown) |
| AI SDK | @anthropic-ai/sdk 0.30, @aws-sdk/client-bedrock-runtime |
| MCP | @modelcontextprotocol/sdk 1.29 |
| 数据校验 | Zod 4.x |
| 构建 | tsc 编译, vsce 打包 .vsix |

---

## 二、整体架构：双应用 + 分层

Evancod 由两个独立的 TypeScript 应用组成，运行在 VSCode 的不同进程中：

```
┌─────────────────────────────────────────────────────────────────┐
│                    VSCode Workbench                             │
│                                                                 │
│  ┌────────────────────────────┐  ┌──────────────────────────┐  │
│  │   Extension Host (Node)    │  │   Webview (浏览器沙箱)    │  │
│  │                            │  │                          │  │
│  │  extension.ts (入口)       │  │  Vue 3 App               │  │
│  │       ↓                    │  │       ↓                  │  │
│  │  Services (业务服务层)     │  │  Pinia Stores            │  │
│  │       ↓                    │  │       ↓                  │  │
│  │  Core (引擎 + 工具 + API)  │  │  Components (UI 组件)    │  │
│  │       ↓                    │  │                          │  │
│  │  Adapters (VSCode 适配)    │  │                          │  │
│  └──────────┬─────────────────┘  └──────────┬───────────────┘  │
│             │                               │                  │
│             └── postMessage ────────────────┘                  │
│               (类型安全的消息协议)                               │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Extension Host 内部分层

Extension Host 内部按职责分为 4 层：

```
extension.ts           ← 入口：依赖注入、生命周期、命令注册
    ↓
src/services/          ← 业务服务层：ChatService、WebviewManager、ProviderService...
    ↓
src/core/              ← 核心引擎层：QueryEngine、Tool 系统、API 客户端
    ↓
src/adapters/          ← 适配器层：FileSystemAdapter、ConfigAdapter、StorageAdapter
```

每一层只依赖其下层，上层通过接口与下层交互。

---

## 三、入口与依赖注入（extension.ts）

`src/extension.ts` 是插件的唯一入口，VSCode 在激活插件时调用 `activate()`。

### 3.1 初始化顺序

```
activate()
  ├─ 注册 4 个 VSCode 命令（openChat, newSession, syncNewApi, pickFiles）
  ├─ 创建 ProviderService → 加载 providers.json
  ├─ 创建 TaskManager → 加载持久化任务
  ├─ 创建 PlanModeManager、AgentCoordinator、MCPConnectionManager
  ├─ 创建 SkillManager、MemoryManager
  ├─ 创建 ChatService（注入以上所有服务）
  ├─ 创建 WebviewManager（注入 ChatService、ProviderService 等）
  ├─ 反向注入：将 WebviewManager 注入到 TaskManager、PlanModeManager、AgentCoordinator
  ├─ 创建 StatusBarService
  └─ 后台异步初始化 MCP、Skill、Memory（不阻塞 activate 返回）
```

### 3.2 设计模式

- **依赖注入 + 服务定位器**：模块级变量保存服务单例，构造时注入依赖
- **反向注入**：`WebviewManager` 通过 `setWebviewManager()` 回注到需要它的服务中
- **渐进式初始化**：关键路径（Provider、Chat、Webview）同步初始化，重量级服务（MCP、Skill、Memory）后台异步初始化

---

## 四、核心引擎：QueryEngine

`src/core/engine/QueryEngine.ts`（55KB）是整个系统的"大脑"。

### 4.1 职责

1. 管理 AI 对话的完整生命周期
2. 构建 API 请求（系统提示词、工具定义、消息历史）
3. 处理流式响应（文本 delta、thinking、tool_use）
4. 工具调用循环：AI 决定调用工具 → 执行 → 把结果送回 AI → 继续对话
5. 上下文管理（Token 估算、自动压缩触发）
6. 权限控制（permission mode 决定是否拦截工具调用）

### 4.2 工具调用循环

```
用户输入
  → QueryEngine.query()
  → 构建消息列表（含 system prompt + 工具定义）
  → 调用 API 客户端流式请求
  → 流式响应解析：
      ├─ content_block_start → 新文本块或工具调用
      ├─ content_block_delta → 增量文本/tool input JSON
      ├─ content_block_stop  → 块结束
      └─ message_stop        → 本轮结束
  → 如果 AI 返回 tool_use：
      ├─ 检查权限（permission mode）
      ├─ 执行工具（Tool.execute）
      ├─ 将 tool_result 回填到消息列表
      └─ 再次调用 API（循环）
  → 如果 AI 返回纯文本：
      └─ 通知 Webview 展示
```

### 4.3 配置项

`QueryEngineConfig` 包含：
- `cwd`：工作目录
- `provider` + `model`：AI 提供商和模型
- `messages`：消息历史
- `taskManager`、`planModeManager`、`agentCoordinator`、`mcpManager`、`skillManager`、`memoryManager`：注入的服务
- `permissionMode`：权限模式（default/acceptEdits/plan/bypassPermissions）
- `onTaskListChange`：任务列表变更回调

---

## 五、API 客户端层

`src/core/services/api/` 是模型调用的抽象层，支持三种协议。

### 5.1 工厂模式

`createApiClient(config)` 根据 Provider 的 `apiFormat` 选择对应客户端：

| apiFormat | 客户端类 | 用途 |
|-----------|---------|------|
| `anthropic` | `AnthropicClient` | Anthropic Messages API |
| `openai_chat` | `OpenAIChatClient` | OpenAI Chat Completions API |
| `openai_responses` | `OpenAIResponsesClient` | OpenAI Responses API（含原生图片生成） |

### 5.2 共享层（shared.ts）

- **`ApiClient` 接口**：定义统一的 `sendMessage`、`sendMessageStream`、`testConnection`
- **流式重试**（`withStreamRetry`）：自动重试 3 次，指数退避（1s/2s/4s），仅重试网络错误/429/5xx，不重试用户取消和鉴权错误
- **URL/Header 构建**：`buildUrl`、`buildOpenAIHeaders`
- **错误构造**：`createFetchError`，从 response body 提取错误详情

### 5.3 工具消息清理器（toolMessageSanitizer.ts）

- **问题**：工具调用（tool_use）与工具结果（tool_result）必须严格配对，否则 API 返回 400
- **孤儿来源**：用户中断、网络错误、上下文压缩截断
- **`sanitizeToolMessageSequence`**：为未配对的 tool_use 补合成占位结果，为孤儿 tool_result 移除
- **`closeDanglingToolCalls`**：就地修复会话真实历史，确保下次请求合法

---

## 六、工具系统

`src/core/tools/` 是所有工具的目录。工具按功能分组，每个工具继承 `Tool` 抽象基类。

### 6.1 Tool 基类

```typescript
abstract class Tool {
  abstract name: string;           // 工具名称（如 "read_file"）
  abstract description: string;    // 工具描述（AI 据此选择）
  abstract getDefinition(): ToolDefinition;  // 返回 Anthropic 格式的 JSON Schema
  abstract execute(args, context?): Promise<ToolResult>;  // 执行逻辑
}
```

`ToolDefinition` 包含 `name`、`description`、`input_schema`（JSON Schema），直接传给 Anthropic API 的 `tools` 参数。

`ToolResult` 包含 `success`、`content`、`error`、`metadata`。

### 6.2 工具清单（按分类）

| 分类 | 目录 | 工具 | 说明 |
|------|------|------|------|
| **文件操作** | `file/` | FileReadTool, FileEditTool, FileWriteTool, CopyFileTool, MoveFileTool, DeleteFileTool | 文件 CRUD |
| **搜索** | `search/` | GlobTool, GrepTool, FindTool, ListDirectoryTool | 文件和内容搜索 |
| **命令执行** | `execution/` | BashTool, ToolOrchestrator, ToolExecutor, ToolCallDeduplicator | Shell 命令执行与编排 |
| **Git** | `git/` | GitStatusTool, GitDiffTool, GitLogTool, GitBranchTool | Git 操作 |
| **任务管理** | `task/` | TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool | AI 拆分和追踪任务 |
| **Agent** | `agent/` | AgentTool, AskUserQuestionTool | 创建子 Agent、向用户提问 |
| **Web** | `web/` | WebFetchTool, WebSearchTool | 网页抓取和搜索 |
| **图片** | `image/` | ImageGenTool | AI 图片生成 |
| **LSP** | `lsp/` | LSPTool | 语言服务器协议集成（定义跳转、引用查找等） |
| **MCP** | `mcp/` | MCPTool | 动态调用外部 MCP Server 提供的工具 |
| **Skill** | `skill/` | SkillTool | 执行用户定义的 Skill |
| **Notebook** | `notebook/` | NotebookEditTool | 编辑 Jupyter Notebook |
| **代码分析** | `code/` | ASTAnalyzerTool, DependencyAnalyzerTool | AST 分析和依赖分析 |
| **高级** | `advanced/` | EnterPlanModeTool, ExitPlanModeTool | 计划模式控制 |

### 6.3 工具执行流程

```
QueryEngine
  → 收到 AI 的 tool_use 决策
  → ToolOrchestrator 路由到对应 Tool
  → ToolExecutor 执行（处理并发、去重、超时）
  → ToolCallDeduplicator 去重（防止 AI 重复调用相同工具）
  → 返回 ToolResult 给 QueryEngine
  → 回填到 API 请求的工具结果中
```

---

## 七、业务服务层

`src/services/` 中的每个子目录是一个独立的服务模块。

### 7.1 ChatService（55KB）

**最核心的业务服务**，负责会话生命周期管理。

- **会话管理**：创建、切换、删除会话
- **消息收发**：接收用户输入 → 调用 QueryEngine → 流式输出到 Webview
- **运行时状态**：当前模型、effort level、permission mode
- **上下文压缩触发**：检测 Token 超限 → 触发 compact
- **持久化调度**：调用 SessionPersistenceService 保存/加载会话

### 7.2 WebviewManager（35KB）

**Extension ↔ Webview 通信的唯一桥梁**。

- 创建和管理 VSCode Webview Panel
- 加载 HTML（开发模式连 localhost:5173，生产模式读 `webview/dist/`）
- 消息收发：`postMessage()` 发送，`onDidReceiveMessage()` 接收
- 消息路由：将 Webview 消息分发到对应的 Handler
- 处理文件选择、new-api 同步等特殊交互

### 7.3 ProviderService（9KB）

**AI 提供商配置管理**。

- **存储**：`~/.evancod/providers.json`（兼容旧 `~/.claude/cc-evancod/providers.json`）
- **CRUD**：增删改查 Provider
- **激活**：切换当前使用的 Provider
- **数据规范化**：兼容旧字段名（`openai` → `openai_chat`）、补全缺失字段
- **Provider 类型**：anthropic / bedrock / vertex / azure / custom
- **API 格式**：anthropic / openai_chat / openai_responses / openai_image
- **认证策略**：api_key / auth_token / auth_token_empty_api_key / dual_same_token / dual_dummy

### 7.4 AgentCoordinator（20KB）

**子 Agent 编排引擎**。

- **三种 Agent 类型**：explore（探索）、analyze（分析）、research（研究）
- **两种执行模式**：foreground（阻塞等待）、background（后台运行）
- **隔离机制**：支持 `worktree` 模式（Git worktree 隔离文件系统）
- **生命周期**：创建 → 执行 → 收集结果 → 清理
- **权限转发**：子 Agent 的 permission_request 和 interaction_request 转发到主 UI
- **持久化**：通过 LocalAgentTaskStore 持久化任务状态和输出
- **通知**：通过 TaskNotificationQueue 构建通知，Webview 展示

### 7.5 TaskManager（14KB）

**任务列表管理**。

- 按会话隔离任务（`TaskStore` 以 sessionId 为 key）
- 支持 CRUD 和依赖关系（blockedBy / blocks）
- 任务状态：pending → in_progress → completed / deleted
- 通过 WebviewManager 推送变更到 UI

### 7.6 PlanModeManager（13KB）

**计划模式**：AI 先输出执行计划，用户审批后再执行。

- 进入计划模式 → AI 生成计划（含任务列表、风险评估）
- 计划提交到 Webview → 用户审批（批准/拒绝）
- 批准后恢复执行，拒绝后返回修改

### 7.7 MCPConnectionManager（10KB）

**MCP (Model Context Protocol) 连接管理**。

- **配置文件**：`~/.evancod/mcp-servers.json`（兼容旧路径）
- **子进程管理**：每个 MCP Server 是一个独立子进程，通过 stdio 通信
- **工具发现**：连接后自动 listTools，注入到 QueryEngine
- **资源发现**：连接后自动 listResources
- **错误隔离**：单个 Server 失败不影响其他 Server
- **延迟连接**：启动后 1 秒延迟连接，不阻塞激活

### 7.8 SkillManager（15KB）

**Skill（斜杠命令）系统**。

- **双目录结构**：
  - 全局：`~/.evancod/skills/`（所有项目共享）
  - 工作区：`<workspace>/.evancod/skills/`（随项目走）
- **加载顺序**：全局 → 工作区，同名由工作区覆盖
- **两种布局**：
  - 扁平：`skills/commit.md`
  - 目录式：`skills/imagegen/SKILL.md`（可携带 scripts/references 等资源）
- **文件格式**：Markdown + YAML frontmatter（name, description, trigger）
- **热重载**：通过 FileSystemWatcher 监听变化，自动重新加载
- **并发加载**：4 个 worker 并行解析 Skill 文件

### 7.9 MemoryManager（21KB）

**跨会话记忆系统**。

- 持久化到 `~/.claude/projects/<workspace>/memory/`
- 支持记忆的提取、存储、检索
- 跨会话保留关键上下文

### 7.10 SessionPersistenceService（17KB）

**会话持久化**。

- 存储路径：`~/.claude/projects/<workspace>/sessions/`
- 格式：JSONL（每行一条消息记录）
- 支持 transcript 格式（AgentTranscriptBlock 联合类型）
- 包含图片引用（仅存 path/mime，不存 base64）

### 7.11 NewApiSyncService（12KB）

**第三方 API Token 同步**。

- **OAuth2 流程**：启动本地 HTTP Server → 打开浏览器授权 → 回调获取 code → exchange 获取 Token
- **轮询模式**（备选）：打开授权页 → 轮询 `/api/desktop-sync/sessions/{state}` → 获取 code
- **智能模型映射**：自动识别 Sonnet/Opus/Haiku 模型
- **Provider 导入**：将获取的 Token 自动创建为 Provider

### 7.12 上下文压缩（compact/）

- **autoCompact.ts**：检测 Token 阈值，触发压缩
- **compact.ts**：调用模型生成会话摘要，剥离图片（用 `[image]` 占位），生成 `compact-boundary` 消息
- **compactPrompt.ts**：摘要提示词模板
- **microcompact.ts**：轻量压缩策略

### 7.13 其他服务

| 服务 | 文件 | 说明 |
|------|------|------|
| CommandManager | 9KB | 命令注册和管理 |
| StatusBarService | 2KB | VSCode 状态栏集成 |
| ImageUploadService | 5KB | 图片上传和处理 |
| ProviderMessageHandler | 6KB | Provider 相关的 Webview 消息处理 |
| NewApiMessageHandler | 10KB | new-api 同步相关的消息处理 |

---

## 八、适配器层

`src/adapters/` 封装了 VSCode 特有 API，提供可测试的接口。

### 8.1 FileSystemAdapter（14KB）

**接口 `IFileSystemAdapter`**，实现 `VSCodeFileSystemAdapter` 和 `MockFileSystemAdapter`。

- **读操作走 Node 原生 fs**：避免 VSCode workspace.fs 的跨进程 IPC 开销，grep/find 等遍历场景性能关键
- **写操作走 VSCode API**：维持与编辑器状态、文件事件、回收站的集成
- **支持按范围读取**（`readFileRange`）：大文件分段读取，避免全量加载
- **`readDirectoryWithTypes`**：一次调用同时返回文件名和类型，消除 O(N) 次 stat 探测

### 8.2 ConfigAdapter（4KB）

**接口 `IConfigAdapter`**，封装 `vscode.workspace.getConfiguration`。

- 读取/写入：model、effortLevel、permissionMode
- 配置层级：默认 → 用户全局 → 工作区
- 提供 `MockConfigAdapter` 用于测试

### 8.3 StorageAdapter（5KB）

**接口 `IStorageAdapter`**，封装 `context.globalState` 和 `context.workspaceState`。

- 全局存储（跨工作区）和工作区存储（仅当前工作区）
- 提供 `MockStorageAdapter` 用于测试

---

## 九、Webview 前端架构

`webview/` 是一个独立的 Vue 3 应用，通过 Vite 构建。

### 9.1 入口与初始化

```
index.html
  → main.ts
      ├─ createApp(App.vue)
      ├─ createPinia() → 安装 Pinia
      ├─ mount('#app')
      └─ window.addEventListener('message', ...) → 全局消息监听
```

`App.vue` 挂载后发送 `{ type: 'ready' }` 通知 Extension 可开始通信。

### 9.2 组件树

```
App.vue
  └─ ChatView.vue
       ├─ TopBar (header/)
       ├─ MessageList (chat/)
       │    ├─ MessageItem.vue
       │    │    ├─ ThinkingBlock.vue
       │    │    ├─ MarkdownRenderer.vue (markdown/)
       │    │    ├─ ToolCallBlock.vue (chat/) — 36KB，最复杂的组件
       │    │    │    ├─ DiffViewer.vue (diff/)
       │    │    │    └─ TerminalChrome.vue (terminal/)
       │    │    ├─ ToolResultBlock.vue (chat/)
       │    │    ├─ AgentCard.vue (chat/)
       │    │    ├─ GeneratedImageBlock.vue (chat/)
       │    │    ├─ PermissionRequestBlock.vue (chat/)
       │    │    ├─ UserQuestionBlock.vue (chat/)
       │    │    └─ CompactionStatus.vue (chat/)
       │    └─ PlanApproval.vue (plan/)
       ├─ ChatInput.vue (input/) — 32KB
       │    ├─ AttachmentGallery.vue
       │    ├─ FileSearchMenu.vue
       │    ├─ SkillListMenu.vue
       │    └─ SlashCommandMenu.vue
       ├─ TaskPanel.vue (task/)
       ├─ AgentList.vue (agent/)
       ├─ QuestionCard.vue (agent/)
       ├─ AddProviderModal.vue (provider/)
       └─ NewApiSyncModal.vue (provider/)
```

### 9.3 Pinia 状态管理（5 个 Store）

| Store | 文件 | 大小 | 职责 |
|-------|------|------|------|
| **chat** | `chat.ts` | 42KB | 消息列表、会话状态、流式处理、transcript 管理 |
| **provider** | `provider.ts` | 5KB | Provider 列表、激活状态 |
| **task** | `task.ts` | 4KB | 任务列表、增删改 |
| **plan** | `plan.ts` | 3KB | 计划状态、审批流程 |
| **agent** | `agent.ts` | 4KB | 子 Agent 运行状态列表 |

### 9.4 消息监听（main.ts）

Webview 通过 `window.addEventListener('message')` 全局监听 Extension 发来的消息，直接路由到对应 Store：

- `task.created/updated/list/deleted` → taskStore
- `plan.submitted/approved/rejected` → planStore + chatStore
- `agent.started/completed` → agentStore

---

## 十、通信协议

### 10.1 MessageBridge 抽象

`src/types/messages.ts` 定义了 `MessageBridge` 抽象类，提供类型安全的消息发布/订阅：

```typescript
abstract class MessageBridge {
  send(message): void;           // 发送消息
  on(type, handler): () => void; // 注册处理器，返回取消函数
  off(type): void;               // 移除处理器
  clear(): void;                 // 移除所有处理器
}
```

### 10.2 消息类型

**Extension → Webview**（14 种）：
- 会话：`session.restored`、`session.created`、`session.updated`
- 聊天：`chat.messages.update`、`chat.message.stream`、`chat.message.complete`
- Agent 事件：`agent.event`（携带 `AgentServerEvent` 联合类型）
- Provider：`provider.list`、`provider.created`、`provider.activated`
- new-api：`newapi.sync.preview`、`newapi.sync.complete`
- Task：`task.created`、`task.updated`、`task.list`、`task.deleted`
- 错误：`error`

**Webview → Extension**（16 种）：
- 初始化：`ready`
- 会话：`session.new`、`session.load`、`session.delete`
- 聊天：`chat.send`、`chat.stop`、`chat.retry`、`bash.cancel`、`interaction_response`
- Provider：`provider.list.request`、`provider.create`、`provider.update`、`provider.delete`、`provider.activate`、`provider.test`
- new-api：`newapi.sync.start`、`newapi.sync.import`
- Task：`task.list.request`、`task.get`

### 10.3 AgentServerEvent（流式事件）

这是 AI 响应的实时事件流，经 `agent.event` 消息推送到 Webview：

| 事件 | 说明 |
|------|------|
| `content_start` | 文本块或工具调用开始 |
| `content_delta` | 增量文本/tool input JSON |
| `tool_use_complete` | 工具调用参数完整接收 |
| `tool_result` | 工具执行结果 |
| `permission_request` | 需要用户确认的工具调用 |
| `interaction_request` | 需要用户输入的问题 |
| `thinking` | AI 思考过程文本 |
| `image_generation` | 图片生成事件（start/complete） |
| `message_complete` | 本轮消息完成 |
| `status` | 状态更新 |
| `system_notification` | 系统通知（任务开始/进度/完成、压缩状态） |
| `bash_output` | Bash 实时输出（stdout/stderr） |
| `bash_status` | Bash 执行状态 |

---

## 十一、数据模型

### 11.1 核心类型（`src/types/index.ts`）

| 类型 | 说明 |
|------|------|
| `Session` | 会话：id, name, messages, transcript, tokenUsage, workDir |
| `Message` | 消息：id, role, content, toolCalls, contentBlocks, attachments |
| `Provider` | AI 提供商：id, name, type, apiFormat, baseUrl, apiKey, models, authStrategy |
| `TaskItem` | 任务项：id, subject, description, status, blockedBy, blocks |
| `AgentTranscriptBlock` | 消息展示块（联合类型）：user_text, assistant_text, thinking, tool_use, tool_result, permission_request, interaction_request, image_generation |
| `TokenUsage` | Token 用量：inputTokens, outputTokens, cacheReadTokens, contextWindow, percentUsed |
| `ContentBlock` | 内容块：text 或 image（base64） |
| `AttachmentContext` | 附件：文件或图片的上下文信息 |

### 11.2 持久化结构

```
~/.evancod/
  ├─ providers.json           # Provider 配置（与 Desktop 版共享格式）
  ├─ mcp-servers.json         # MCP Server 配置
  └─ skills/                  # 全局 Skill 文件

~/.claude/projects/<workspace-hash>/
  ├─ sessions/
  │   └─ <session-id>.jsonl   # 会话消息（JSONL 格式）
  └─ memory/
      └─ MEMORY.md            # 跨会话记忆

<workspace>/.evancod/
  └─ skills/                  # 工作区 Skill 文件

VSCode globalStorage/
  └─ agent-tasks/             # 子 Agent 任务状态
  └─ agent-output/            # 子 Agent 输出
  └─ agent-transcripts/       # 子 Agent 事件记录
  └─ tasks/<sessionId>/       # 任务列表持久化
```

---

## 十二、关键业务流程

### 12.1 用户发送消息

```
Webview: ChatInput.vue
  → chatStore.sendMessage(content)
  → vscode.postMessage({ type: 'chat.send', data: { content } })
  → Extension: WebviewManager 收到消息
  → ChatService.sendMessage()
  → QueryEngine.query()
  → 构建 system prompt（含工具定义、memory、skill 列表）
  → createApiClient(provider).sendMessageStream()
  → 流式返回：
      ├─ AgentServerEvent → WebviewManager.sendAgentEvent()
      ├─ 文本 delta → Webview 增量渲染
      ├─ tool_use → 执行工具 → 结果回填 → 继续调用 API
      └─ message_stop → 持久化会话
```

### 12.2 子 Agent 执行

```
主 Agent 调用 AgentTool
  → AgentCoordinator.startAgent(config)
  → 创建新的 QueryEngine 实例（独立上下文）
  → 可选 worktree 隔离（创建 Git worktree）
  → 发送 agent.started 到 Webview
  → 后台/前台执行
  → 子 Agent 的 permission_request 转发到主 UI
  → 执行完成 → 收集结果
  → 持久化到 LocalAgentTaskStore
  → 发送 agent.completed 和 system_notification 到 Webview
  → 清理 worktree（如有）
```

### 12.3 上下文压缩

```
QueryEngine 检测 Token 超限
  → 触发 autoCompact
  → 调用 compactConversation()
  → 剥离图片（替换为 [image]）
  → 用 haiku 模型生成摘要
  → 创建 compact-boundary 消息
  → 替换旧消息历史
  → 发送 system_notification(subtype: 'compact_complete') 到 Webview
```

### 12.4 new-api 同步

```
Webview: 用户点击同步
  → NewApiSyncService.startSync()
  → 启动本地 HTTP Server（随机端口，127.0.0.1）
  → 打开浏览器 → new-api 授权页
  → 用户授权 → 浏览器回调 localhost/callback?code=xxx
  → 用 code 调用 exchange 接口
  → 获取 Token 列表 + 模型映射
  → 推送到 Webview 预览（脱敏展示）
  → 用户勾选 → 导入为 Provider
  → 写入 providers.json
```

---

## 十三、Thinking 模式

`src/utils/thinking.ts` 实现了两层判断：

1. **用户层面**：`effortLevel` 决定是否开启（low=关闭，medium/high/max=开启）
2. **模型层面**：`modelSupportsThinking` / `modelSupportsAdaptiveThinking` 判断模型能力

**三种模式**：
- `adaptive`：模型自动决定何时思考（仅支持的模型）
- `enabled` + `budget_tokens`：固定 Token 预算思考
- `disabled`：显式关闭（某些代理端点需要）

**Budget 映射**：medium=16000, high=32000, max=128000（受模型上限约束）

---

## 十四、性能与工具函数

### 14.1 并发控制（concurrency.ts）

`mapLimit<T, R>(items, limit, worker)`：以受限并发对数组执行异步任务，保持结果顺序。用于 grep/find 等遍历工具，避免串行延迟和 EMFILE 错误。

### 14.2 性能日志（performanceLogger.ts）

- `performanceLog(event, data)`：记录结构化性能日志到 `.evancod/performance.log`
- `performanceMeasure(event, action, data)`：测量异步操作耗时，自动记录 CPU 和内存快照
- `eventLoop.lag`：每秒检测事件循环延迟（≥50ms 时记录）

### 14.3 模型能力（utils/model/）

- `modelCapabilities.ts`：模型能力矩阵（thinking、adaptive_thinking 等）
- `modelTokens.ts`：模型 Token 上限映射
- `modelContextWindows.ts`：上下文窗口大小
- `modelStrings.ts`：模型名称字符串工具

---

## 十五、安全设计

1. **API Key 安全**：存储在 `providers.json`（Extension Host 内部），Webview 只展示脱敏版本
2. **OAuth Token**：本地回调仅监听 127.0.0.1，随机端口，code 一次性使用
3. **文件访问**：读操作走 Node fs（直接系统调用），写操作通过 VSCode API（维持编辑器集成）
4. **权限模式**：`bypassPermissions` 跳过所有确认，`default` 需要确认高风险操作，`plan` 先规划后执行

---

## 十六、测试策略

- **单元测试**：`src/adapters/__tests__/`，使用 Mock 适配器（MockFileSystemAdapter、MockConfigAdapter、MockStorageAdapter）
- 每个适配器接口都有对应的 Mock 实现，可直接注入到服务中进行测试
- 测试文件命名：`*.test.ts`

---

## 十七、关键文件索引

| 文件 | 大小 | 说明 |
|------|------|------|
| `src/extension.ts` | 8KB | 入口、依赖注入、生命周期 |
| `src/core/engine/QueryEngine.ts` | 55KB | AI 对话引擎 |
| `src/services/chat/ChatService.ts` | 55KB | 会话管理核心 |
| `src/services/webview/WebviewManager.ts` | 35KB | 前后端通信桥 |
| `src/services/agent/AgentCoordinator.ts` | 20KB | 子 Agent 编排 |
| `src/services/memory/MemoryManager.ts` | 21KB | 记忆系统 |
| `src/services/persistence/SessionPersistenceService.ts` | 17KB | 会话持久化 |
| `src/services/skill/SkillManager.ts` | 15KB | Skill 系统 |
| `src/services/task/TaskManager.ts` | 14KB | 任务管理 |
| `src/services/plan/PlanModeManager.ts` | 13KB | 计划模式 |
| `src/services/newapi/NewApiSyncService.ts` | 12KB | API 同步 |
| `src/services/mcp/MCPConnectionManager.ts` | 10KB | MCP 管理 |
| `src/adapters/FileSystemAdapter.ts` | 14KB | 文件系统适配 |
| `src/types/index.ts` | 8KB | 核心类型定义 |
| `src/types/messages.ts` | 9KB | 通信协议定义 |
| `webview/src/stores/chat.ts` | 42KB | 前端核心状态 |
| `webview/src/components/chat/ToolCallBlock.vue` | 36KB | 工具调用 UI |
| `webview/src/components/input/ChatInput.vue` | 32KB | 输入框组件 |