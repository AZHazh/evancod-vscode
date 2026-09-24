# Evancod

Evancod 是一款运行在 Visual Studio Code 中的 AI 编程 Agent。它不只回答代码问题，还能在授权范围内读取和修改项目文件、检索代码、执行命令，并通过计划、任务和子 Agent 协作完成较复杂的开发工作。

所有交互都集中在 VS Code 侧边栏中，开发者无需离开编辑器即可完成从理解需求、制定方案到修改与验证代码的完整流程。

## 核心功能

### AI 对话与代码理解

- 支持流式输出、Thinking 内容展示和 Markdown/代码高亮
- 可通过文件选择、拖拽、粘贴以及 `@` 引用向会话添加文件和图片
- 自动保存会话，并支持历史会话恢复与跨会话记忆
- 上下文接近模型限制时自动压缩，尽可能保持长任务连续性

### 代码操作与工程工具

Evancod 当前内置 26 个工具，覆盖常见开发场景：

| 类别       | 能力                                                              |
| ---------- | ----------------------------------------------------------------- |
| 文件       | 读取、创建、精确编辑、复制、移动、删除文件，编辑 Jupyter Notebook |
| 搜索       | Glob 文件匹配、文本与正则检索、目录浏览、按条件查找文件           |
| 执行       | 在当前工作区运行 Shell 命令                                       |
| 代码       | 通过 LSP 查询符号、引用和诊断信息                                 |
| Web        | 搜索互联网、读取网页内容                                          |
| 图像       | 接收图片上下文，调用独立图像服务生成并保存图片                    |
| 编排与扩展 | 管理任务与计划、调用子 Agent、向用户提问、加载 Skill 和 MCP 工具  |

> 实际可用工具会根据当前模式、工具偏好、Provider 能力和外部服务配置动态调整。

### 复杂任务编排

- **计划模式**：先分析和输出实施计划，经确认后再开始修改
- **任务管理**：拆分任务、声明依赖并追踪每项任务状态
- **子 Agent**：把研究或实现工作交给独立 Agent，并可通过 Git worktree 隔离工作目录
- **自定义 Agent**：配置目标、职责、工具、权限和模型，支持全局与工作区定义
- **Skills**：从全局或工作区加载 Markdown 指令，为特定工作流补充专业能力
- **MCP**：连接 Model Context Protocol Server，动态发现和调用外部工具

### Provider 与安全控制

- 支持 Anthropic Messages、OpenAI Chat Completions、OpenAI Responses 和 OpenAI Image 兼容协议
- 可添加 Anthropic 官方服务或自定义兼容端点，并在界面中测试、切换和排序
- 支持通过 new-api 授权流程同步服务配置
- 提供默认、自动接受编辑、计划和免确认四种权限模式
- 文件写入、命令执行等操作按权限模式确认；Provider 配置保存在本地

## 快速开始

1. 安装并启用 Evancod。
2. 点击 VS Code 辅助侧边栏中的 Evancod 图标，或从命令面板执行 `Evancod: 打开聊天`。
3. 打开设置页添加 Provider，填写 API 地址、密钥和模型名称，然后测试连接。
4. 选择模型与执行权限，在输入框中描述任务；需要时可添加文件、图片或使用 `@` 引用上下文。

### 常用命令

| 命令                | 说明                      |
| ------------------- | ------------------------- |
| `Evancod: 打开聊天` | 打开并聚焦 Evancod 侧边栏 |
| `Evancod: 新建会话` | 创建一个空白会话          |
| `Evancod: 同步中转` | 启动 new-api 服务配置同步 |

### 长期记忆

无需使用命令：发送“以后都使用单引号”“我习惯先运行测试”，或在开发请求中说“记住这个项目，所有函数都要加 JSDoc 注释”等明确长期规则后，系统会在后台自动记录。自动保存的规则可用 `/memory list` 查看；`/memory pending` 只显示需要确认的候选。模型回答中明确归纳出的项目决策仅成为待确认候选，不会直接当作事实保存。普通对话、一次性任务以及包含凭据的消息不会自动进入长期记忆。`/remember <内容>` 仍可用于手动明确记录。工作区记忆保存在 `<workspace>/.evancod/memory/entries/`，跨项目用户偏好保存在扩展的全局存储目录，不写入项目仓库。旧版 `.evancod/memory/*.md` 和 `.claude/memory/*.md` 会保留原件并安全迁移。

| 聊天命令 | 作用 |
| ------- | ---- |
| `/memory list`、`/memory pending` | 查看有效记忆和待确认候选 |
| `/memory show <id>` | 查看内容、来源、置信度和更新时间 |
| `/memory confirm <id>`、`/memory reject <id>` | 处理待确认或冲突的候选 |
| `/memory edit <id> <内容>`、`/memory forget <id>` | 修改或停用记忆 |
| `/memory restore <id>`、`/memory refresh` | 恢复上一历史版本或重建索引 |

包含密钥或凭据的内容不会由记忆系统保存；`MEMORY.md` 是程序生成的索引，不要手动维护。

### VS Code 配置

| 配置项                   | 说明                                        | 默认值                      |
| ------------------------ | ------------------------------------------- | --------------------------- |
| `evancod.model`          | 默认模型名称                                | `claude-opus-4-8`           |
| `evancod.effortLevel`    | 推理强度：`low` / `medium` / `high` / `max` | `medium`                    |
| `evancod.permissionMode` | 工具执行权限模式                            | `default`                   |
| `evancod.newApiSiteUrl`  | new-api 同步授权站点                        | `https://www.tiandouai.com` |

Provider 配置保存在 `~/.evancod/providers.json`。

## 项目架构

Evancod 由两个独立的 TypeScript 应用组成：Extension Host 负责模型请求、工具执行和本地资源访问；Webview 负责界面渲染与用户交互。两端通过 VS Code Webview 消息协议通信。

```text
┌────────────────────────────── Visual Studio Code ──────────────────────────────┐
│                                                                                │
│  Extension Host（Node.js）                  Webview（浏览器沙箱）               │
│  ┌──────────────────────────────┐          ┌──────────────────────────────┐    │
│  │ extension.ts                 │          │ Vue 3 Views / Components     │    │
│  │   生命周期、命令、依赖注入    │          │   聊天、设置、任务、Diff      │    │
│  ├──────────────────────────────┤          ├──────────────────────────────┤    │
│  │ services/                    │          │ Pinia Stores                 │    │
│  │   Chat / Agent / Task / MCP  │◄────────►│   chat / provider / task     │    │
│  │   Skill / Memory / Provider  │ postMessage│ agent / plan               │    │
│  ├──────────────────────────────┤          ├──────────────────────────────┤    │
│  │ core/                        │          │ useVSCode 消息桥接            │    │
│  │   QueryEngine / API / Tools  │          └──────────────────────────────┘    │
│  ├──────────────────────────────┤                                               │
│  │ adapters/                    │                                               │
│  │   文件系统 / 配置 / 存储      │                                               │
│  └──────────────┬───────────────┘                                               │
│                 │                                                              │
└─────────────────┼──────────────────────────────────────────────────────────────┘
                  │
       ┌──────────┴──────────┐
       │                     │
  AI Provider          工作区 / Git / MCP
```

### 核心调用链

```text
用户输入
  → Webview 发送消息
  → WebviewManager 分发请求
  → ChatService 组装会话与运行配置
  → QueryEngine 请求模型并消费流式响应
  → 模型发起工具调用
  → ToolOrchestrator 执行权限检查与工具调用
  → 工具结果回填给模型，继续循环
  → 最终响应流式推送至 Webview
```

### Extension Host 分层

| 层级       | 目录               | 职责                                                                |
| ---------- | ------------------ | ------------------------------------------------------------------- |
| 入口层     | `src/extension.ts` | 扩展生命周期、命令注册、服务初始化与依赖注入                        |
| 业务服务层 | `src/services/`    | 编排聊天、Provider、任务、计划、Agent、MCP、Skill、记忆和会话持久化 |
| 核心层     | `src/core/`        | 模型查询循环、API 客户端、工具注册与执行                            |
| 适配器层   | `src/adapters/`    | 隔离 VS Code 存储、配置与文件系统能力                               |
| 共享类型   | `src/types/`       | Extension Host 与 Webview 使用的消息和领域类型                      |

### Webview 前端

| 目录                       | 职责                                                |
| -------------------------- | --------------------------------------------------- |
| `webview/src/views/`       | 聊天和 Provider 设置等页面级视图                    |
| `webview/src/components/`  | 聊天消息、输入框、任务、Agent、计划、Diff 等组件    |
| `webview/src/stores/`      | 基于 Pinia 的聊天、Provider、任务、Agent 和计划状态 |
| `webview/src/composables/` | VS Code 消息通信等可复用逻辑                        |
| `webview/src/styles/`      | Webview 全局样式与主题适配                          |

### 目录结构

```text
evancod-vscode/
├─ src/                         # Extension Host
│  ├─ extension.ts              # 扩展入口
│  ├─ core/
│  │  ├─ engine/                # QueryEngine 与运行时配置
│  │  ├─ services/api/          # Anthropic / OpenAI 协议客户端
│  │  └─ tools/                 # 内置工具、注册表与执行器
│  ├─ services/                 # 业务服务与功能编排
│  ├─ adapters/                 # VS Code 与本地环境适配器
│  ├─ tasks/                    # Agent 本地任务模型
│  ├─ types/                    # 共享类型定义
│  └─ utils/                    # 模型、并发和性能工具
├─ webview/                     # Vue 3 + Vite 前端应用
│  └─ src/
│     ├─ views/                 # 页面视图
│     ├─ components/            # UI 组件
│     ├─ stores/                # Pinia 状态
│     ├─ composables/           # 组合式逻辑
│     └─ styles/                # SCSS 样式
├─ resources/                   # 扩展图标与静态资源
├─ docs/ 与 src/docs/           # 设计和实现文档
├─ out/                         # Extension 编译产物
└─ webview/dist/                # Webview 构建产物
```

仓库中的 `ARCHITECTURE.md` 还提供了更完整的模块职责、通信协议和业务流程说明。

## 本地开发

### 环境要求

- Node.js 18+
- Visual Studio Code 1.80.0+

### 安装依赖

```bash
npm install
npm run install:webview
```

### 启动开发环境

在两个终端中分别运行：

```bash
npm run watch
```

```bash
npm run dev:webview
```

然后在 VS Code 中按 `F5` 启动 Extension Development Host。

### 构建与验证

```bash
npm run compile
npm run build:webview
npm run lint
npm test
```

打包扩展：

```bash
npm run package
```

## 技术栈

- Extension Host：TypeScript、Node.js、VS Code Extension API
- Webview：Vue 3、Pinia、Vite、SCSS、Marked、Shiki
- 模型与扩展协议：Anthropic SDK、OpenAI 兼容 API、Model Context Protocol
- 数据与校验：VS Code Storage、JSON、Zod

## 安全提示

- 不要把 API Key、Provider Token 或本地 `.evancod` 配置提交到代码仓库。
- 使用“免确认”权限模式前，请确认当前工作区和任务内容可信。
- MCP Server 和自定义 API 端点由用户自行配置，启用前应确认其来源与权限范围。

## License

MIT
