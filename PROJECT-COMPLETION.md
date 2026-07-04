# 项目完成状态修正版

> 项目名称: vscode-evancod  
> 原完成时间: 2026-06-27  
> 修正时间: 2026-06-28  
> 当前状态: 基础 AI 编程助手能力完成；完整 Agent 能力待 Phase 6/7 补完

---

## 一、修正说明

此前文档中“项目完成”“核心功能 100% 完成”的表述容易误解为完整 Evancod / Claude Code 级别 Agent 系统已经完成。

经重新核对设计文档和阶段总结后，当前真实状态应修正为：

- **已完成**：基础 AI 对话、流式响应、工具调用循环、Provider 管理、new-api 同步、文件/代码/Git 工具、斜杠命令、Markdown 渲染、会话持久化、图片上传。
- **未完成**：AgentTool、MCP、Skill、Plan Mode、Task 规划、AskUserQuestion、Memory、Notebook/LSP/Web 高级工具。

因此，当前项目不是“完整 Agent 产品 100% 完成”，而是：

```text
基础 AI 编程助手能力: 100% 完成
完整 Agent 产品能力: 约 70% 完成
```

---

## 二、当前已完成范围

### Phase 1：项目骨架

- Extension Host 基础
- Webview 应用框架
- 适配器层
- 消息通信机制
- 状态栏入口

### Phase 2：核心引擎与基础工具

- QueryEngine 核心引擎
- 真实 AI 对话
- 流式响应
- 多轮上下文
- 基础工具调用循环
- FileReadTool
- FileEditTool
- FileWriteTool
- GlobTool
- GrepTool
- BashTool

### Phase 3：Provider 与 new-api

- Provider CRUD
- Provider 激活切换
- Provider 测试连接
- new-api 同步
- 模型映射
- Provider 管理 UI

### Phase 4：文件、代码、Git 工具集

**高级文件操作：**

- ListDirectoryTool
- FindTool
- CopyFileTool
- MoveFileTool
- DeleteFileTool

**代码分析：**

- ASTAnalyzerTool
- DependencyAnalyzerTool

**Git 操作：**

- GitStatusTool
- GitDiffTool
- GitLogTool
- GitBranchTool

### Phase 5：UI 与体验增强

- 简单斜杠命令系统
- `/help`
- `/clear`
- `/new`
- `/commit`
- `/history`
- Markdown 渲染
- 代码语法高亮
- 代码块复制
- 会话持久化
- 图片上传

---

## 三、当前缺失能力

### P0：Agent 核心能力缺失

| 能力 | 状态 | 影响 |
|------|------|------|
| AgentTool | 未完成 | 不能启动子 Agent 做独立研究或并行任务 |
| AskUserQuestionTool | 未完成 | AI 不能以结构化方式向用户询问选择 |
| Task 工具 | 未完成 | 不能维护任务列表、状态、依赖和进度 |
| Plan Mode | 未完成 | 复杂实现前缺少计划文件和用户审批流 |
| SkillTool | 未完成 | 当前 slash command 只是硬编码命令，不是可加载 Skill 系统 |
| MCPTool | 未完成 | 无法接入外部 MCP server、tools、resources |
| Memory 系统 | 未完成 | 没有持久化用户偏好、项目背景、反馈记忆 |

### P1：高级工具缺失

| 能力 | 状态 | 影响 |
|------|------|------|
| NotebookEditTool | 未完成 | 不能编辑 Jupyter Notebook 单元 |
| WebFetchTool | 未完成 | 不能抓取网页内容辅助分析 |
| WebSearchTool | 未完成 | 不能进行联网搜索 |
| LSPTool | 未完成 | 不能调用 VSCode 原生跳转、引用、诊断等能力 |

### P2：产品化缺口

| 能力 | 状态 | 影响 |
|------|------|------|
| 完整测试覆盖 | 不完整 | 缺少端到端质量保障 |
| 性能基准 | 不完整 | 无法证明启动、渲染、工具调用性能达标 |
| Marketplace 发布流程 | 未完成 | 尚未达到正式发布闭环 |

---

## 四、修正后的进度

```text
Phase 1: 项目骨架              ████████████████████ 100% ✅
Phase 2: 核心引擎与基础工具     ████████████████████ 100% ✅
Phase 3: Provider 与 new-api    ████████████████████ 100% ✅
Phase 4: 文件/代码/Git 工具集   ████████████████████ 100% ✅
Phase 5: UI 与体验增强          ████████████████████ 100% ✅
Phase 6: Agent 核心能力补完     ░░░░░░░░░░░░░░░░░░░░   0% ⏳
Phase 7: MCP/Skill/Memory/发布  ░░░░░░░░░░░░░░░░░░░░   0% ⏳

基础助手能力完成度: 100%
完整 Agent 产品完成度: 约 70%
```

---

## 五、Phase 6：Agent 核心能力补完实施方案

### 目标

让项目从“可以调用工具的聊天助手”升级为“可规划、可询问、可追踪、可分派的 Agent”。

### Week 1：Task 系统

#### 后端模块

- 新增 `src/core/tools/task/TaskCreateTool.ts`
- 新增 `src/core/tools/task/TaskUpdateTool.ts`
- 新增 `src/core/tools/task/TaskListTool.ts`
- 新增 `src/core/tools/task/TaskGetTool.ts`
- 新增 `src/services/task/TaskManager.ts`
- 新增任务持久化文件 `.evancod/tasks.json`

#### 数据模型

```typescript
type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

interface TaskItem {
  id: string
  subject: string
  description: string
  status: TaskStatus
  activeForm?: string
  owner?: string
  blocks: string[]
  blockedBy: string[]
  createdAt: string
  updatedAt: string
}
```

#### UI

- 新增任务列表面板
- 展示 pending / in_progress / completed
- 展示任务依赖
- 聊天消息中展示任务状态变化

#### 验收标准

- AI 可以创建任务
- AI 可以更新任务状态
- 用户可以看到当前任务进度
- VSCode 重启后任务仍保留

---

### Week 2：Plan Mode

#### 后端模块

- 新增 `src/core/tools/advanced/EnterPlanModeTool.ts`
- 新增 `src/core/tools/advanced/ExitPlanModeTool.ts`
- 新增 `src/services/plan/PlanModeManager.ts`
- 支持计划文件写入
- 支持计划审批状态
- 限制 Plan Mode 下的可用工具

#### UI

- 新增计划预览界面
- 支持“批准执行”和“要求修改”
- 展示计划允许使用的工具类别

#### 验收标准

- 复杂任务先进入计划模式
- 用户批准前不修改代码
- 批准后进入执行阶段
- 计划内容可追踪、可回看

---

### Week 3：AskUserQuestion 与 AgentTool

#### AskUserQuestionTool

- 支持单选
- 支持多选
- 支持用户自定义输入
- 支持选项说明和 preview
- Webview 展示结构化选择卡片

#### AgentTool

- 新增 `src/core/tools/agent/AgentTool.ts`
- 新增 `src/services/agent/AgentCoordinator.ts`
- 支持子 Agent 类型注册
- 支持前台执行
- 支持后台执行
- 支持结果摘要回传
- 支持任务隔离和上下文边界

#### 验收标准

- AI 可以主动向用户提问
- AI 可以调用子 Agent 做独立调研
- 子 Agent 结果能回到主会话
- 主 Agent 负责最终决策和执行

---

## 六、Phase 7：MCP / Skill / Memory / 发布实施方案

### Week 1：MCP

#### 后端模块

- 新增 `src/services/mcp/MCPConnectionManager.ts`
- 新增 `src/services/mcp/MCPClient.ts`
- 新增 `src/core/tools/mcp/MCPTool.ts`
- 支持读取 `~/.claude/cc-evancod/mcp-servers.json`
- 支持 stdio MCP server
- 支持工具发现、工具调用、资源读取

#### UI

- MCP server 配置页面
- 连接状态展示
- tools/resources 列表
- 测试连接按钮

#### 验收标准

- 可以添加 MCP server
- 可以发现 MCP tools
- AI 可以调用 MCP tools
- MCP 结果进入工具调用循环

---

### Week 2：Skill

#### 后端模块

- 新增 `src/services/skill/SkillManager.ts`
- 新增 `src/core/tools/advanced/SkillTool.ts`
- 支持从本地 skills 目录加载
- 支持 skill frontmatter
- 支持 slash command 映射到 skill
- 将现有 `/commit` 等硬编码命令逐步迁移为 Skill

#### UI

- Skills 管理页面
- 展示可用 Skill
- 启用 / 禁用 Skill
- 查看 Skill 描述和触发方式

#### 验收标准

- 可以加载本地 Skill
- 可以通过 `/skill-name` 触发
- AI 可以执行 Skill 展开的流程
- 现有 slash command 能平滑迁移

---

### Week 3：Memory

#### 后端模块

- 新增 `src/services/memory/MemoryManager.ts`
- 新增 `src/services/memory/MemoryRetriever.ts`
- 新增 `src/services/memory/MemoryExtractor.ts`
- 支持 `MEMORY.md` 索引
- 支持 user / feedback / project / reference 四类记忆
- 支持 remember / forget
- 支持会话启动时读取相关记忆

#### UI

- Memory 查看页面
- 支持删除记忆
- 支持查看记忆类型和来源

#### 验收标准

- 用户要求记住时写入记忆
- 新会话能读取相关记忆
- 用户能删除过期或错误记忆

---

### Week 4：测试、性能与发布

#### 测试

- Task 工具测试
- Plan Mode 端到端测试
- AskUserQuestion UI 测试
- AgentTool 调度测试
- MCP mock server 测试
- Skill 加载测试
- Memory 读写测试

#### 性能

- 插件启动时间
- Webview 首屏时间
- 工具调用耗时
- MCP 连接耗时
- 长会话渲染性能

#### 发布

- 更新 README
- 更新 CHANGELOG
- 打包 `.vsix`
- 本地安装验证
- 准备 VSCode Marketplace 信息

---

## 七、补完后的最终目标

完成 Phase 6/7 后，项目才可以称为完整 Agent 产品：

- 有任务规划能力
- 有计划审批能力
- 有用户澄清能力
- 有子 Agent 调度能力
- 有 MCP 扩展能力
- 有 Skill 扩展能力
- 有 Memory 持久记忆能力
- 有完整测试与发布闭环

---

## 八、当前推荐下一步

立即启动 Phase 6，优先级如下：

1. Task 系统
2. Plan Mode
3. AskUserQuestion
4. AgentTool
5. MCP
6. Skill
7. Memory
8. 测试与发布

这样可以先补齐 Agent 的执行闭环，再补扩展生态。
