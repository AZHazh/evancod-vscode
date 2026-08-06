# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Evancod 是一个基于 Claude 的 VSCode AI 编程助手扩展。采用双应用架构：Extension Host（TypeScript）+ Vue 3 Webview UI。支持多 AI 提供商、MCP 协议、50+ 内置工具、跨会话记忆系统。

## 开发工作流

### 启动开发环境

开发需要同时运行三个部分：

**终端 1 - 编译 Extension：**
```bash
npm run watch
```

**终端 2 - 启动 Webview 开发服务器：**
```bash
npm run dev:webview
```

**终端 3 - 运行扩展：**
按 `F5` 在 VSCode 中启动 Extension Development Host

### 构建和打包

```bash
# 构建 webview（会自动安装依赖）
npm run build:webview

# 编译 extension
npm run compile

# 打包为 .vsix
npm run package

# 完整构建（在发布前运行）
npm run vscode:prepublish
```

### 代码检查和测试

```bash
# ESLint 检查
npm run lint

# 运行测试
npm test
```

## 架构要点

### 核心服务层（src/services/）

Extension 使用依赖注入模式，在 `src/extension.ts` 中初始化以下核心服务：

- **ChatService** - 会话和消息管理，调用 QueryEngine 与 AI 交互
- **ProviderService** - AI 提供商管理（Anthropic、AWS Bedrock、Google Vertex AI、Azure OpenAI、自定义端点）
- **TaskManager** - 任务生命周期管理
- **PlanModeManager** - 计划模式协调
- **AgentCoordinator** - 子 Agent 编排和 worktree 管理
- **MCPConnectionManager** - MCP (Model Context Protocol) 连接管理
- **SkillManager** - Skill（斜杠命令）管理
- **MemoryManager** - 跨会话记忆系统
- **WebviewManager** - Webview 生命周期和消息通信

服务间使用双向依赖注入：部分服务在构造时注入，WebviewManager 通过 `setWebviewManager()` 反向注入。

### QueryEngine（src/core/engine/）

AI 交互的核心引擎，负责：
- 构建和发送 AI 请求
- 流式响应处理
- 工具调用协调
- 上下文管理和压缩

### 工具系统（src/core/tools/）

50+ 内置工具按功能分类：

- **file/** - 文件操作（Read、Write、Edit、Copy、Delete、Move）
- **search/** - 搜索工具（Glob、Grep、Find、ListDirectory）
- **execution/** - 命令执行（Bash、ToolOrchestrator、ToolExecutor）
- **git/** - Git 操作（Status、Diff、Log、Branch）
- **task/** - 任务管理（TaskCreate、TaskGet、TaskList、TaskUpdate）
- **agent/** - Agent 协调（AgentTool、AskUserQuestionTool）
- **advanced/** - 高级功能（EnterPlanMode、ExitPlanMode）
- **mcp/** - MCP 工具调用
- **skill/** - Skill 执行
- **web/** - Web 工具（WebSearch、WebFetch）
- **lsp/** - LSP 集成
- **image/** - 图像生成和处理
- **notebook/** - Jupyter Notebook 编辑
- **code/** - 代码分析（AST、依赖分析）

每个工具继承 `src/core/tools/base/Tool.ts` 基类。

### Webview UI（webview/src/）

Vue 3 + Vite + Pinia 架构：

- **stores/** - Pinia 状态管理（chat、provider、task、plan、agent）
- **components/** - Vue 组件（按功能分目录：chat、input、provider、task、plan 等）
- **views/** - 页面视图（ChatView、ProviderSettings）
- **composables/** - 可复用组合式函数
- **styles/** - SCSS 全局样式

Webview 通过 VSCode Webview API 与 Extension 通信，消息协议定义在 `src/types/messages.ts`。

### Extension ↔ Webview 通信

使用类型安全的消息协议：
- `ExtensionToWebviewMessage` - Extension → Webview
- `WebviewToExtensionMessage` - Webview → Extension

消息通过 `WebviewManager.postMessage()` 和 `webview.onDidReceiveMessage()` 传递。

## 关键配置和存储

- **Provider 配置**：`~/.claude/cc-evancod/providers.json`（与桌面版共享）
- **会话持久化**：`~/.claude/projects/<workspace>/sessions/`
- **记忆系统**：`~/.claude/projects/<workspace>/memory/`
- **VSCode 配置**：
  - `evancod.model` - 默认模型
  - `evancod.effortLevel` - 推理程度（low/medium/high/max）
  - `evancod.permissionMode` - 权限模式（default/acceptEdits/plan/bypassPermissions）
  - `evancod.newApiSiteUrl` - new-api 同步站点

## 代码风格

- TypeScript strict mode，使用路径别名 `@/*`
- 2 空格缩进，单引号，无分号，trailing commas，100 列宽
- 类、组件、导出类型使用 PascalCase
- 函数、变量、composables、stores 使用 camelCase
- 工具实现按功能分组在 `src/core/tools/<area>/`

## 提交规范

使用 Conventional Commits 格式，中文提交信息：
- `feat:` - 新功能
- `fix:` - 错误修复
- `refactor:` - 代码重构
- `docs:` - 文档更新

示例：`feat: 新增生图功能`

## 特殊功能说明

### new-api Token 同步

通过 `NewApiSyncService` 从配置的站点同步 token，使用 OAuth2 流程。命令：`evancod.syncNewApi`

### MCP (Model Context Protocol)

通过 `MCPConnectionManager` 连接 MCP 服务器，动态加载工具。MCP 工具通过 `MCPTool` 包装后注入到 QueryEngine。

### 计划模式（Plan Mode）

用户可进入计划模式让 AI 先规划再执行。由 `PlanModeManager` 协调，通过 `EnterPlanModeTool` 和 `ExitPlanModeTool` 控制。

### Agent 协调系统

通过 `AgentCoordinator` 管理子 Agent 任务，支持 worktree 隔离。子 Agent 可以并行运行，结果通过 `TaskNotificationQueue` 异步通知。

### 上下文压缩

当对话上下文过长时，`compactConversation` 自动压缩历史消息，保留关键信息。压缩逻辑在 `src/services/compact/` 中。

## 调试和故障排查

- Extension 日志：VSCode 输出面板 "Extension Host"
- Webview 控制台：运行命令 "Developer: Open Webview Developer Tools"
- 开发时 Webview 运行在 `http://localhost:5173`，生产构建嵌入 extension
- 如果 Webview 未加载，检查 `webview/dist/` 是否存在构建产物
