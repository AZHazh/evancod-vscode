# 项目最终状态修正版

> 项目名称: **vscode-evancod**  
> 原完成时间: **2026-06-27**  
> 修正时间: **2026-06-28**  
> 当前状态: **基础 AI 编程助手可用，完整 Agent 能力待补完**

---

## 一、为什么修正

原文档把 Phase 1-5 完成后描述为“项目功能 100% 完成”。这个说法不够准确。

当前项目确实已经完成一个可用的 VSCode AI 编程助手基础版本，但还没有完成架构设计中规划的完整 Agent 核心能力，包括：

- AgentTool
- MCP
- Skill
- Plan Mode
- Task 规划
- AskUserQuestion
- Memory
- Notebook / LSP / Web 高级工具

因此，最终状态应修正为：

```text
基础 AI 编程助手能力: 已完成，可使用
完整 Agent 产品能力: 未完成，需要 Phase 6/7 补完
```

---

## 二、当前真实完成情况

### 已完成：基础 AI 编程助手能力

当前已经完成以下能力：

1. VSCode 插件基础架构
2. Vue 3 Webview 聊天界面
3. Extension ↔ Webview 通信
4. QueryEngine 核心对话引擎
5. 真实 AI API 调用
6. 流式响应
7. 多轮对话上下文
8. 基础工具调用循环
9. Provider 管理
10. new-api 同步
11. 文件读写编辑工具
12. 搜索工具
13. Bash 执行工具
14. 高级文件操作工具
15. AST 代码分析
16. 依赖分析
17. Git 状态、diff、log、branch 工具
18. 简单 slash command
19. Markdown 渲染
20. 代码高亮
21. 会话持久化
22. 图片上传

---

## 三、当前未完成能力

### 1. Agent 编排能力未完成

| 能力 | 状态 |
|------|------|
| AgentTool | 未完成 |
| 子 Agent 调度 | 未完成 |
| 多 Agent 并行 | 未完成 |
| 子任务隔离执行 | 未完成 |
| Agent 结果汇总 | 未完成 |

### 2. 计划与任务能力未完成

| 能力 | 状态 |
|------|------|
| TaskCreateTool | 未完成 |
| TaskUpdateTool | 未完成 |
| TaskListTool | 未完成 |
| TaskGetTool | 未完成 |
| 任务依赖关系 | 未完成 |
| 任务持久化 | 未完成 |
| EnterPlanModeTool | 未完成 |
| ExitPlanModeTool | 未完成 |
| 计划审批流 | 未完成 |

### 3. 用户交互工具未完成

| 能力 | 状态 |
|------|------|
| AskUserQuestionTool | 未完成 |
| 单选问题 | 未完成 |
| 多选问题 | 未完成 |
| 用户自定义输入 | 未完成 |
| Webview 选择卡片 | 未完成 |

### 4. 扩展生态未完成

| 能力 | 状态 |
|------|------|
| MCPConnectionManager | 未完成 |
| MCPClient | 未完成 |
| MCPTool | 未完成 |
| MCP server 配置 UI | 未完成 |
| SkillManager | 未完成 |
| SkillTool | 未完成 |
| 本地 Skill 加载 | 未完成 |
| slash command → Skill 映射 | 未完成 |

### 5. Memory 未完成

| 能力 | 状态 |
|------|------|
| MemoryManager | 未完成 |
| MemoryRetriever | 未完成 |
| MemoryExtractor | 未完成 |
| MEMORY.md 索引 | 未完成 |
| remember / forget | 未完成 |
| 记忆查看 UI | 未完成 |

### 6. 高级工具未完成

| 能力 | 状态 |
|------|------|
| NotebookEditTool | 未完成 |
| WebFetchTool | 未完成 |
| WebSearchTool | 未完成 |
| LSPTool | 未完成 |

---

## 四、修正后的进度状态

```text
Phase 1: 项目骨架              100% ✅
Phase 2: 核心引擎与基础工具     100% ✅
Phase 3: Provider 与 new-api    100% ✅
Phase 4: 文件/代码/Git 工具集   100% ✅
Phase 5: UI 与体验增强          100% ✅
Phase 6: Agent 核心能力补完       0% ⏳
Phase 7: MCP/Skill/Memory/发布    0% ⏳

基础助手能力完成度: 100%
完整 Agent 产品完成度: 约 70%
```

---

## 五、Phase 6 补完方案：Agent 核心能力

### 目标

补齐完整 Agent 必备的规划、提问、任务管理和子 Agent 调度能力。

---

### Week 1：Task 系统

#### 要实现的模块

```text
src/services/task/
├── TaskManager.ts
└── TaskStore.ts

src/core/tools/task/
├── TaskCreateTool.ts
├── TaskUpdateTool.ts
├── TaskListTool.ts
└── TaskGetTool.ts

webview/src/components/task/
├── TaskPanel.vue
├── TaskItem.vue
└── TaskDetail.vue
```

#### 功能

- 创建任务
- 更新任务状态
- 查看任务列表
- 查看任务详情
- 支持任务依赖
- 支持任务持久化
- 聊天中展示任务状态变化

#### 验收标准

- AI 能在复杂任务开始时创建任务列表
- AI 能在每一步完成后更新状态
- 用户能在 UI 中查看任务进度
- 重启后任务仍存在

---

### Week 2：Plan Mode

#### 要实现的模块

```text
src/services/plan/
├── PlanModeManager.ts
└── PlanStore.ts

src/core/tools/advanced/
├── EnterPlanModeTool.ts
└── ExitPlanModeTool.ts

webview/src/components/plan/
├── PlanPreview.vue
└── PlanApproval.vue
```

#### 功能

- 进入计划模式
- 生成结构化计划
- 写入计划文件
- 用户审批计划
- 审批前禁止执行修改类工具
- 审批后进入执行阶段

#### 验收标准

- 复杂代码任务先计划后执行
- 用户未批准前不会修改文件
- 计划可追踪、可回看

---

### Week 3：AskUserQuestion + AgentTool

#### AskUserQuestion 模块

```text
src/core/tools/agent/AskUserQuestionTool.ts
webview/src/components/agent/QuestionCard.vue
```

功能：

- 单选
- 多选
- 选项说明
- 自定义输入
- 回传用户选择

#### AgentTool 模块

```text
src/services/agent/
├── AgentCoordinator.ts
├── AgentRunner.ts
└── AgentRegistry.ts

src/core/tools/agent/
└── AgentTool.ts
```

功能：

- 子 Agent 创建
- 子 Agent 类型注册
- 前台执行
- 后台执行
- 结果汇总
- 上下文隔离

#### 验收标准

- AI 能主动向用户询问选择
- AI 能启动子 Agent 做独立研究
- 子 Agent 结果能回到主会话
- 主 Agent 仍负责最终判断

---

## 六、Phase 7 补完方案：MCP / Skill / Memory / 发布

### Week 1：MCP

#### 要实现的模块

```text
src/services/mcp/
├── MCPConnectionManager.ts
├── MCPClient.ts
├── MCPServerConfig.ts
└── MCPAuth.ts

src/core/tools/mcp/
└── MCPTool.ts

webview/src/components/mcp/
├── MCPServerList.vue
├── MCPServerForm.vue
└── MCPToolList.vue
```

#### 功能

- MCP server 配置
- stdio server 启动
- 工具发现
- 工具调用
- 资源读取
- 连接状态展示

#### 验收标准

- 用户能添加 MCP server
- 系统能发现 MCP tools
- AI 能调用 MCP tools
- 调用结果进入 QueryEngine 工具循环

---

### Week 2：Skill

#### 要实现的模块

```text
src/services/skill/
├── SkillManager.ts
├── SkillLoader.ts
└── SkillRegistry.ts

src/core/tools/advanced/
└── SkillTool.ts

webview/src/components/skill/
├── SkillList.vue
└── SkillDetail.vue
```

#### 功能

- 加载本地 Skill
- 解析 Skill metadata
- slash command 触发 Skill
- Skill 展开为完整 prompt 或执行流程
- 启用 / 禁用 Skill

#### 验收标准

- `/commit` 可迁移为 Skill
- 用户可新增本地 Skill
- AI 可识别并执行 Skill

---

### Week 3：Memory

#### 要实现的模块

```text
src/services/memory/
├── MemoryManager.ts
├── MemoryRetriever.ts
├── MemoryExtractor.ts
└── MemoryStore.ts

webview/src/components/memory/
├── MemoryList.vue
└── MemoryDetail.vue
```

#### 功能

- `MEMORY.md` 索引
- user / feedback / project / reference 四类记忆
- 显式 remember
- 显式 forget
- 会话启动时检索相关记忆
- Memory UI 查看与删除

#### 验收标准

- 用户要求记住时能保存
- 后续会话能读取相关记忆
- 用户能删除错误记忆

---

### Week 4：测试、性能、发布

#### 测试补齐

- Task 工具测试
- Plan Mode 测试
- AskUserQuestion 测试
- AgentTool 测试
- MCP mock server 测试
- Skill 加载测试
- Memory 读写测试

#### 性能补齐

- 插件启动时间
- Webview 首屏时间
- 工具调用耗时
- 长会话渲染性能
- MCP 连接耗时

#### 发布补齐

- README 更新
- CHANGELOG 更新
- `.vsix` 打包
- 本地安装验证
- Marketplace 发布准备

---

## 七、补完后的最终定义

只有完成 Phase 6/7 后，项目才能称为完整 Agent 产品。

完整 Agent 产品应具备：

1. 对话能力
2. 工具调用能力
3. 任务规划能力
4. 计划审批能力
5. 用户澄清能力
6. 子 Agent 调度能力
7. MCP 扩展能力
8. Skill 扩展能力
9. Memory 持久记忆能力
10. 测试与发布闭环

---

## 八、当前结论

当前项目不是失败，也不是没完成，而是完成了第一层产品：

> 一个可用的 VSCode AI 编程助手基础版本。

下一阶段要做的是第二层产品：

> 一个完整的、可扩展的 Agent 编程平台。

建议立即进入 Phase 6，先补 Task、Plan、AskUserQuestion、AgentTool，再进入 Phase 7 补 MCP、Skill、Memory 和发布质量。
