# VSCode Evancod 当前真实进度与补完实施方案

> 最后更新: 2026-06-28  
> 当前状态: 基础 AI 编程助手能力已完成；Agent 核心能力尚未补完  
> 目标: 统一当前真实进度、明确缺失能力，并规划 Phase 6/7 补完路线

---

## 一、当前真实进度

当前项目已经完成的是一个可运行的 **VSCode AI 编程助手基础版本**，具备对话、Provider 管理、文件操作、代码分析、Git 操作、斜杠命令、Markdown 渲染、会话持久化和图片上传等能力。

但它还不是完整的 Evancod / Claude Code 级别 Agent 系统。以下能力尚未完成：

- 子 Agent 调度
- MCP 集成
- Skill 加载与执行
- Plan Mode
- Task 规划与任务状态管理
- AskUserQuestion 交互工具
- Memory 系统
- Notebook / LSP / Web 工具体系

---

## 二、整体进度口径

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

说明：之前文档中“核心功能 100% 完成”指的是 **基础 AI 编程助手核心功能**，不是完整 Agent 能力。后续统一使用“基础助手能力”和“完整 Agent 产品能力”两个口径，避免混淆。

---

## 三、已完成能力清单

### 1. Extension Host 基础

- 插件激活入口
- 命令注册
- Webview 生命周期管理
- StatusBar 集成
- Extension ↔ Webview 通信
- 配置与存储适配器

### 2. Webview 基础 UI

- Vue 3 应用框架
- 聊天界面
- Provider 管理界面
- 基础组件
- VSCode 主题适配
- Markdown 渲染
- 代码语法高亮
- 代码块复制

### 3. AI 对话能力

- QueryEngine 核心引擎
- 真实 API 对话
- 流式响应
- 多轮上下文
- 工具调用循环

### 4. Provider 系统

- Provider CRUD
- Provider 激活切换
- Provider 连接测试
- new-api 同步
- 模型映射

### 5. 已有工具系统

**文件与搜索工具：**

1. FileReadTool
2. FileEditTool
3. FileWriteTool
4. GlobTool
5. GrepTool
6. ListDirectoryTool
7. FindTool
8. CopyFileTool
9. MoveFileTool
10. DeleteFileTool

**执行工具：**

11. BashTool

**代码分析工具：**

12. ASTAnalyzerTool
13. DependencyAnalyzerTool

**Git 工具：**

14. GitStatusTool
15. GitDiffTool
16. GitLogTool
17. GitBranchTool

### 6. 命令与体验能力

- `/help`
- `/clear`
- `/new`
- `/commit`
- `/history`
- 会话自动保存
- 会话导入导出
- 图片上传与 Base64 编码

---

## 四、缺失能力清单

### P0：完整 Agent 系统必需

| 能力 | 当前状态 | 说明 |
|------|----------|------|
| AgentTool | 未完成 | 缺少子 Agent 创建、调度、隔离执行与结果汇总 |
| AskUserQuestionTool | 未完成 | 缺少 AI 主动向用户询问偏好/选择的工具协议和 UI |
| Task 工具 | 未完成 | 缺少 TaskCreate、TaskUpdate、TaskList、TaskGet 等任务状态管理 |
| Plan Mode | 未完成 | 缺少 EnterPlanMode、ExitPlanMode、计划文件、用户审批流 |
| SkillTool | 未完成 | 当前只有简单 slash command，缺少真正 Skill 加载、展开和执行机制 |
| MCPTool | 未完成 | 缺少 MCP Client、连接管理、工具发现、资源调用 |
| Memory 系统 | 未完成 | 缺少 MEMORY.md 索引、记忆文件管理、自动提取与检索 |

### P1：增强型 Agent 能力

| 能力 | 当前状态 | 说明 |
|------|----------|------|
| NotebookEditTool | 未完成 | 需要适配 VSCode Notebook API |
| WebFetchTool / WebSearchTool | 未完成 | 需要网络访问、代理、安全限制与结果归纳 |
| LSPTool | 未完成 | 需要接入 VSCode Definition、References、Diagnostics 等能力 |
| 多 Agent 并行 | 未完成 | 需要任务隔离、并发执行、结果回收 |
| 权限审批体系 | 部分完成 | Bash/File 等工具需要更清晰的风险分级和用户确认 |

### P2：产品化补强

| 能力 | 当前状态 | 说明 |
|------|----------|------|
| 完整测试覆盖 | 不完整 | 缺少 Agent/MCP/Skill/Plan/Task 的单元与集成测试 |
| 性能基准 | 不完整 | 缺少启动、工具执行、Webview 渲染指标 |
| 发布流程 | 未完成 | 缺少 Marketplace 发布准备、CHANGELOG、vsix 验证 |

---

## 五、Phase 6：Agent 核心能力补完

### 目标

补齐完整 Agent 产品的核心交互和规划能力，让 AI 不只是“调用工具”，而是可以：

- 拆解任务
- 维护任务状态
- 进入计划模式
- 请求用户决策
- 调用子 Agent
- 以可审计方式执行复杂任务

### Week 1：Task 系统

#### Extension Host

- [ ] 新增 `TaskManager`
- [ ] 新增 `TaskCreateTool`
- [ ] 新增 `TaskUpdateTool`
- [ ] 新增 `TaskListTool`
- [ ] 新增 `TaskGetTool`
- [ ] 设计任务状态：`pending | in_progress | completed | deleted`
- [ ] 支持 `blockedBy` / `blocks` 依赖关系
- [ ] 持久化到工作区 `.evancod/tasks.json`

#### Webview

- [ ] 新增任务面板
- [ ] 展示任务状态、依赖、当前进行项
- [ ] 支持从聊天消息跳转到任务详情

#### 验收标准

- AI 可以创建任务列表
- AI 可以在执行过程中更新任务状态
- 用户可以在 UI 中看到任务进度
- 任务在重启 VSCode 后仍可恢复

---

### Week 2：Plan Mode

#### Extension Host

- [ ] 新增 `EnterPlanModeTool`
- [ ] 新增 `ExitPlanModeTool`
- [ ] 新增 `PlanModeManager`
- [ ] 创建计划文件存储路径
- [ ] 限制 Plan Mode 下的可执行工具范围
- [ ] 实现用户批准后才进入执行阶段

#### Webview

- [ ] 新增计划预览界面
- [ ] 支持批准 / 退回修改
- [ ] 显示允许执行的工具类别

#### 验收标准

- 用户请求复杂实现时，AI 先进入 Plan Mode
- AI 产出结构化实施计划
- 用户批准前不修改代码
- 批准后继续执行计划

---

### Week 3：AskUserQuestion 与 AgentTool

#### AskUserQuestion

- [ ] 新增 `AskUserQuestionTool`
- [ ] 支持单选、多选、用户自定义输入
- [ ] Webview 展示选择卡片
- [ ] 将用户选择回传 QueryEngine

#### AgentTool

- [ ] 新增 `AgentTool`
- [ ] 新增 `AgentCoordinator`
- [ ] 支持子 Agent 类型注册
- [ ] 支持前台 / 后台执行
- [ ] 支持结果摘要回收
- [ ] 避免子 Agent 修改主上下文无法审计

#### 验收标准

- AI 可以在需求不明确时主动提问
- AI 可以为独立研究任务调用子 Agent
- 子 Agent 结果能回到主会话
- 主 Agent 保持最终决策权

---

## 六、Phase 7：MCP / Skill / Memory / 发布补完

### 目标

把项目从“具备 Agent 核心交互”推进到“可扩展的完整 AI Agent 平台”。

---

### Week 1：MCP 集成

#### Extension Host

- [ ] 新增 `MCPConnectionManager`
- [ ] 新增 `MCPClient`
- [ ] 新增 `MCPTool`
- [ ] 读取 `mcp-servers.json`
- [ ] 支持 stdio MCP server
- [ ] 支持工具发现和调用
- [ ] 支持连接状态管理

#### Webview

- [ ] 新增 MCP 服务器配置界面
- [ ] 展示连接状态
- [ ] 展示可用 MCP tools / resources
- [ ] 支持测试连接

#### 验收标准

- 可以配置 MCP server
- 可以发现 MCP tools
- AI 可以调用 MCP tools
- 调用结果进入工具调用循环

---

### Week 2：Skill 系统

#### Extension Host

- [ ] 新增 `SkillManager`
- [ ] 新增 `SkillTool`
- [ ] 支持从本地 skills 目录加载技能
- [ ] 支持 slash command 触发 skill
- [ ] 支持 skill frontmatter / metadata
- [ ] 支持 skill 展开为完整提示词或执行流程

#### Webview

- [ ] 新增 Skills 管理界面
- [ ] 展示可用技能
- [ ] 支持启用 / 禁用技能

#### 验收标准

- `/commit` 等命令从硬编码命令升级为 Skill 驱动
- 用户可以新增本地 Skill
- AI 可以识别并调用 Skill

---

### Week 3：Memory 系统

#### Extension Host

- [ ] 新增 `MemoryManager`
- [ ] 新增 `MemoryRetriever`
- [ ] 新增 `MemoryExtractor`
- [ ] 支持 `MEMORY.md` 记忆索引
- [ ] 支持 user / feedback / project / reference 四类记忆
- [ ] 支持显式 remember / forget
- [ ] 支持会话开始时读取相关记忆

#### Webview

- [ ] 新增 Memory 查看界面
- [ ] 支持手动删除记忆
- [ ] 支持记忆来源展示

#### 验收标准

- 用户要求“记住”时可以写入记忆
- 后续会话可以读取相关记忆
- 用户可以删除错误或过期记忆

---

### Week 4：测试、性能与发布

#### 测试

- [ ] Task 工具单元测试
- [ ] Plan Mode 集成测试
- [ ] AskUserQuestion UI 测试
- [ ] AgentTool 调度测试
- [ ] MCP mock server 测试
- [ ] Skill 加载测试
- [ ] Memory 读写测试

#### 性能

- [ ] 插件启动时间基准
- [ ] Webview 渲染性能
- [ ] 工具调用耗时统计
- [ ] MCP 连接耗时统计

#### 发布

- [ ] 更新 README
- [ ] 更新 CHANGELOG
- [ ] 生成 `.vsix`
- [ ] 验证安装包
- [ ] 准备 VSCode Marketplace 发布材料

#### 验收标准

- 完整测试通过
- 核心 Agent 流程端到端可用
- 插件可以打包安装
- 文档与实际能力一致

---

## 七、补完后的目标能力矩阵

| 能力域 | Phase 5 当前状态 | Phase 6 后 | Phase 7 后 |
|--------|------------------|------------|------------|
| AI 对话 | 完成 | 完成 | 完成 |
| 基础工具调用 | 完成 | 完成 | 完成 |
| 文件/代码/Git 工具 | 完成 | 完成 | 完成 |
| Task 规划 | 缺失 | 完成 | 完成 |
| Plan Mode | 缺失 | 完成 | 完成 |
| AskUserQuestion | 缺失 | 完成 | 完成 |
| 子 Agent | 缺失 | 完成 | 完成 |
| MCP | 缺失 | 缺失 | 完成 |
| Skill | 简单命令 | 部分可接入 | 完成 |
| Memory | 会话上下文 | 缺失 | 完成 |
| 发布质量 | 不完整 | 改善 | 完成 |

---

## 八、文档口径修正说明

需要同步修正的旧说法：

1. “项目功能 100% 完成”应改为“基础助手能力完成，完整 Agent 能力待补完”。
2. “核心功能 100% 完成”应明确限定为“基础 AI 对话 + 基础工具调用”。
3. “Phase 5 高级功能”实际完成的是 UI/体验增强，不包含 MCP、Memory、Skills。
4. MCP、Skill、Memory、Plan、Task、AgentTool 不应再写成已完成或隐含已完成。
5. 后续统一将这些能力纳入 Phase 6/7。

---

## 九、下一步建议

优先启动 Phase 6，顺序建议如下：

1. 先做 Task 系统，因为它是复杂任务可视化和执行状态管理的基础。
2. 再做 Plan Mode，因为它依赖任务拆解和用户审批流。
3. 再做 AskUserQuestion，因为它补齐需求澄清能力。
4. 最后做 AgentTool，因为子 Agent 需要基于前面三者形成可控执行闭环。

Phase 7 再补 MCP、Skill、Memory 和发布质量，这样风险更低，也更容易验收。
