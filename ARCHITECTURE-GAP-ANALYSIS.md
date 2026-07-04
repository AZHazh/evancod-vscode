# 架构设计与现有代码差异分析

> 分析时间: 2026-06-28  
> 目的: 找出缺失的组件、服务和功能，规划补充方案

---

## 一、目录结构差异

### 1.1 Extension Host 层（src/）

#### ❌ 需要调整的结构

**1. core/ 目录调整：**
```
❌ 当前: src/core/QueryEngine.ts
✅ 应该: src/core/engine/QueryEngine.ts

❌ 当前: src/core/api/
✅ 应该: src/core/services/api/

❌ 当前: tools/ 工具未按功能分组
✅ 应该: 
   - tools/file/ (FileRead, FileEdit, FileWrite, Copy, Move, Delete)
   - tools/search/ (Glob, Grep, Find, ListDirectory)
   - tools/execution/ (Bash)
   - tools/code/ (ASTAnalyzer, DependencyAnalyzer)
   - tools/git/ (GitStatus, GitDiff, GitLog, GitBranch)
```

**2. 缺失的核心服务：**
```
❌ src/core/services/mcp/（MCP 完全未实现）
❌ src/core/services/memory/（Memory 完全未实现）
❌ src/core/services/compact/ContextCompactor.ts
❌ src/adapters/terminal/（终端适配器）
❌ src/adapters/editor/（编辑器适配器）
❌ src/adapters/oauth/（OAuth 回调处理）
```

---

### 1.2 Webview 层（webview/src/）

#### ❌ 缺失的组件（P0 优先级）

**Phase 6/6.5 后端已实现，但 UI 完全缺失：**

1. **Task 面板 UI（100% 缺失）**
```
❌ components/task/TaskPanel.vue
❌ components/task/TaskList.vue
❌ components/task/TaskItem.vue
❌ components/task/TaskDependencyGraph.vue
❌ stores/task.ts
```

2. **Plan Mode UI（100% 缺失）**
```
❌ components/plan/PlanPreview.vue
❌ components/plan/PlanApproval.vue
❌ components/plan/TaskListView.vue
❌ components/plan/RiskAssessment.vue
❌ stores/plan.ts
```

3. **AskUserQuestion UI（100% 缺失）**
```
❌ components/agent/QuestionCard.vue
❌ components/agent/OptionSelector.vue
❌ components/agent/CustomInput.vue
```

4. **Agent 状态 UI（100% 缺失）**
```
❌ components/agent/AgentStatus.vue
❌ components/agent/AgentList.vue
❌ stores/agent.ts
```

#### ❌ 缺失的组件（P1 优先级）

5. **Common 组件库**
```
❌ components/common/Button.vue
❌ components/common/Input.vue
❌ components/common/Select.vue
❌ components/common/Modal.vue
❌ components/common/Loading.vue
```

6. **Sidebar 组件**
```
❌ components/sidebar/SessionList.vue
❌ components/sidebar/ProviderList.vue
```

7. **Diff 查看器**
```
❌ components/diff/DiffViewer.vue
```

8. **Chat 增强**
```
❌ components/chat/ToolCallCard.vue（工具调用卡片）
❌ components/chat/ModelSelector.vue（模型选择）
```

---

## 二、功能模块差异

### 2.1 ✅ 已完成（100%）

- 基础对话（QueryEngine、ChatService）
- 29 个工具（文件、搜索、Git、LSP、Web、Notebook）
- Provider 管理（ProviderService、new-api 同步）
- Task 系统后端（TaskManager + 4 工具）
- Plan Mode 后端（PlanModeManager + 2 工具）
- Agent 协作后端（AgentCoordinator + 2 工具）

### 2.2 ❌ 缺失（0%）

- **Task UI**（100% 缺失）
- **Plan Mode UI**（100% 缺失）
- **AskUserQuestion UI**（100% 缺失）
- **Agent UI**（100% 缺失）
- **MCP 系统**（100% 缺失）
- **Skill 系统**（100% 缺失）
- **Memory 系统**（100% 缺失）
- **上下文压缩**（100% 缺失）
- **Diff 查看器**（100% 缺失）

---

## 三、补充方案

### 阶段 1：目录结构调整（1 天）

**调整 Extension Host 结构：**
```bash
# 1. 调整 core/
mkdir -p src/core/engine
mv src/core/QueryEngine.ts src/core/engine/

mkdir -p src/core/services/api
mv src/core/api/* src/core/services/api/

# 2. 调整 tools/（按功能分组）
mkdir -p src/core/tools/{file,search,execution,code,git}
# 移动对应文件...

# 3. 更新所有 import 路径
```

**创建 Webview 目录：**
```bash
mkdir -p webview/src/components/{task,plan,agent,common,sidebar,diff}
```

### 阶段 2：补充核心 UI（6 天）

**Day 1-2: Task 面板 UI**
- TaskPanel.vue（容器）
- TaskList.vue（列表）
- TaskItem.vue（单项）
- TaskDependencyGraph.vue（依赖图）
- stores/task.ts（状态管理）
- 消息通信：task.created, task.updated, task.list

**Day 3-4: Plan Mode UI**
- PlanPreview.vue（预览）
- PlanApproval.vue（审批）
- TaskListView.vue（任务列表）
- RiskAssessment.vue（风险评估）
- stores/plan.ts（状态管理）
- 消息通信：plan.submitted, plan.approve, plan.reject

**Day 5: AskUserQuestion UI**
- QuestionCard.vue（问题卡片）
- OptionSelector.vue（选项选择：单选/多选）
- CustomInput.vue（自定义输入）
- 消息通信：question.ask, question.answer

**Day 6: Agent 状态 UI**
- AgentStatus.vue（状态卡片）
- AgentList.vue（Agent 列表）
- stores/agent.ts（状态管理）
- 消息通信：agent.started, agent.completed

### 阶段 3：补充基础组件（1-2 天）

**Common 组件库：**
- Button.vue
- Input.vue
- Select.vue
- Modal.vue
- Loading.vue

**ToolCallCard 增强：**
- 展开/折叠功能
- 执行状态指示
- 结果高亮

---

## 四、工作量评估

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| 1 | 目录结构调整 | 1 天 |
| 2 | 核心 UI（P0） | 6 天 |
| 3 | 基础组件（P1） | 1-2 天 |
| **总计** | **P0 + P1** | **8-9 天** |

---

## 五、推荐执行顺序

1. ✅ **先补充 UI**（6 天）- 让用户能体验 Phase 6/6.5 功能
2. 🔧 **再调整目录**（1 天）- 确保架构清晰
3. 📦 **补充基础组件**（1-2 天）- 提升体验

理由：UI 缺失导致用户无法体验已实现的强大后端功能，应该优先补充。

---

## 六、总结

### 核心问题

Phase 6/6.5 实现了完整的后端能力（Task、Plan、Agent、高级工具），但 **UI 层 100% 缺失**，导致用户无法使用这些功能。

### 当前状态

```text
后端: ████████████████████ 100% ✅
UI层: ░░░░░░░░░░░░░░░░░░░░  0% ❌
```

### 建议

**立即开始：补充 Webview UI（阶段 2）**

这将让 29 个工具和 Agent 核心能力真正可用！
