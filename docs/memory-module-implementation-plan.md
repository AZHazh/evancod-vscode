# Evancod 记忆模块编码计划

## 1. 文档目的

本文档用于指导 Evancod 记忆模块的后续开发。目标是让 Agent 能够在多个会话之间可靠地记住用户明确表达的偏好、项目规范、技术决策和经过验证的项目事实，并能自动维护记忆文件。

本计划只讨论长期记忆系统，不包含需求文档、接口文档、代码知识库或向量检索系统。

## 2. 当前实现与问题

当前实现主要位于 `src/services/memory/MemoryManager.ts`：

- 记忆类型为 `user`、`feedback`、`project`、`reference`。
- 工作区记忆存储在 `<workspace>/.evancod/memory/`。
- 通过 `MEMORY.md` 生成索引。
- 启动时将所有 Markdown 记忆加载到内存 `Map`。
- `/init` 创建项目架构、开发命令和项目规范的基础快照。
- 支持 `.claude/memory` 到 `.evancod/memory` 的迁移和文件监听。

当前限制：

1. 没有完整的“对话 -> 候选记忆 -> 确认/保存”流程。
2. `saveMemory()` 只支持直接写入一条记忆，缺少查重、合并和冲突处理。
3. 记忆元数据缺少作用域、来源、置信度、确认状态和过期状态。
4. `ChatService.buildMemoryContext()` 会把所有记忆拼接后注入模型，并截断到固定长度。
5. 记忆文件以名称作为主要身份，容易出现重复文件和同主题多版本。
6. 目前只使用第一个工作区目录，不支持多根工作区的明确隔离。

## 3. 建设目标

### 3.1 必须实现

- 支持全局用户、工作区、模块、任务、会话五类作用域。
- 支持用户偏好、项目规范、项目事实、技术决策、反馈和临时事件六类记忆。
- 从用户明确指令、用户纠正、任务决策和项目配置中提取候选记忆。
- 对候选记忆执行安全策略，决定自动保存、请求确认或仅保留在会话中。
- 对同主题记忆执行查重、合并、替代和冲突标记。
- 根据当前请求选择相关记忆，而不是每次注入全部记忆。
- 保留记忆来源和变更历史，支持用户查看、编辑、确认、拒绝和删除。
- 对旧版 `.evancod/memory/*.md` 和 `.claude/memory/*.md` 保持兼容。
- 记忆文件发生外部修改时，能够重新加载并重建索引。

### 3.2 明确不做

- 不保存密码、Token、Cookie、私钥和其他密钥材料。
- 不将每轮聊天全文保存为长期记忆。
- 不根据一次代码风格观察直接推断用户个人偏好。
- 不让模型直接重写 `MEMORY.md`。
- 不在本阶段引入文档 RAG、向量数据库或外部知识库。

## 4. 设计原则

1. **文件是可审计的事实来源**：当前有效记忆使用 Markdown 保存，索引由程序生成。
2. **候选与正式记忆分离**：模型提取结果先进入候选区，经过规则或用户确认后再成为正式记忆。
3. **有证据才能提高置信度**：配置文件、用户明确表达和用户确认的证据优先级最高。
4. **更新优先于追加**：同一主题优先合并现有记录，不能不断创建相似文件。
5. **冲突必须显式处理**：无法判断新旧规则关系时标记冲突，不允许静默覆盖。
6. **按需注入上下文**：只将当前任务相关、高优先级、未过期的记忆交给模型。
7. **默认保护用户隐私**：候选记忆写入前必须经过敏感信息检查。
8. **后台维护不能阻塞对话**：提取、合并、索引和清理任务异步执行，失败不影响主流程。

## 5. 目标记忆模型

建议新增统一的逻辑模型。具体字段可以根据现有 TypeScript 风格调整，但不能丢失以下语义。

```ts
export type MemoryScope = 'global' | 'workspace' | 'module' | 'task' | 'session'

export type MemoryKind =
  | 'preference'
  | 'convention'
  | 'fact'
  | 'decision'
  | 'feedback'
  | 'episode'

export type MemoryStatus = 'active' | 'candidate' | 'superseded' | 'disputed' | 'expired'

export interface MemorySource {
  type: 'user' | 'conversation' | 'file' | 'tool' | 'system'
  ref?: string
  quote?: string
  capturedAt: string
}

export interface MemoryRecord {
  id: string
  scope: MemoryScope
  scopePath?: string
  kind: MemoryKind
  subject: string
  content: string
  description: string
  status: MemoryStatus
  confidence: number
  confirmed: boolean
  sources: MemorySource[]
  tags: string[]
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  lastVerifiedAt?: string
  expiresAt?: string
  supersedes?: string[]
  relatedIds?: string[]
}
```

### 5.1 作用域规则

| 作用域 | 存储范围 | 示例 |
| --- | --- | --- |
| `global` | 用户级，跨工作区 | 用户喜欢先看影响范围再改代码 |
| `workspace` | 当前工作区 | 项目使用单引号、不使用分号 |
| `module` | 工作区中的目录或包 | `src/services` 不直接访问 Webview API |
| `task` | 当前需求或任务 | 本次功能选择轮询方案 |
| `session` | 当前会话 | 当前测试仍有两个失败 |

作用域冲突时按以下优先级处理：

```text
当前用户明确要求 > 当前任务决策 > 模块规则 > 工作区规则 > 全局用户偏好 > 历史推测
```

### 5.2 置信度规则

- `1.0`：用户明确确认，或配置文件明确证明。
- `0.8 - 0.99`：用户明确表达但尚未二次确认，或多个可靠来源一致。
- `0.5 - 0.79`：从多次行为或代码模式中推断。
- `< 0.5`：只作为候选，不进入正式长期记忆。

## 6. 文件和目录布局

### 6.1 工作区记忆

```text
<workspace>/.evancod/memory/
  MEMORY.md                 # 程序生成的索引，不允许模型直接维护
  entries/                  # 新格式正式记忆
    workspace-code-style.md
    module-services-boundary.md
  candidates/               # 待确认候选，建议使用 JSON
    candidate-<id>.json
  history/                  # 记忆变更历史，追加写入 JSONL
    workspace-code-style.jsonl
  manifest.json             # 版本、迁移状态和索引信息
```

### 6.2 全局记忆

全局用户记忆不应写入项目仓库，建议放在 VS Code `globalStorageUri` 下：

```text
<globalStorage>/memory/
  entries/
  candidates/
  history/
```

### 6.3 Markdown 文件格式

```markdown
---
id: workspace.code-style
scope: workspace
kind: convention
subject: code-style
status: active
confidence: 1
confirmed: true
createdAt: 2026-09-23T00:00:00.000Z
updatedAt: 2026-09-23T00:00:00.000Z
lastVerifiedAt: 2026-09-23T00:00:00.000Z
tags: typescript, formatting
---

项目使用单引号，不使用分号。

## 来源

- `.prettierrc.json`

## 证据

- `singleQuote: true`
- `semi: false`
```

`MEMORY.md` 只负责列出当前有效记忆的摘要、作用域和状态，由 `MemoryStore` 自动生成。

## 7. 目标模块职责

建议以现有 `src/services/memory/MemoryManager.ts` 为入口，逐步拆分职责。

### 7.1 MemoryStore

职责：

- 读写 Markdown、候选 JSON 和历史 JSONL；
- 生成稳定路径和安全文件名；
- 原子写入和并发保护；
- 迁移旧版文件；
- 监听外部文件变化；
- 重建 `MEMORY.md`。

建议位置：`src/services/memory/MemoryStore.ts`。

### 7.2 MemoryExtractor

职责：

- 从用户消息中识别“记住、以后、统一、不要再”等明确表达；
- 从用户纠正中识别反馈记忆；
- 从 `/init` 和配置扫描结果中识别项目事实和规范；
- 从完成的技术任务中提取已确认的决策；
- 输出结构化 `MemoryCandidate`，不直接写文件。

建议位置：`src/services/memory/MemoryExtractor.ts`。

### 7.3 MemoryPolicy

职责：

- 判断候选是否包含密钥或敏感内容；
- 判断是否允许自动保存；
- 判断是否必须询问用户；
- 设置初始置信度、作用域和过期策略。

建议位置：`src/services/memory/MemoryPolicy.ts`。

### 7.4 MemoryReconciler

职责：

- 根据 `scope + kind + subject` 查找相似记录；
- 判断新增、补充、修正、替代和冲突；
- 合并来源和证据；
- 标记 `superseded`、`disputed` 和 `expired`；
- 写入变更历史。

建议位置：`src/services/memory/MemoryReconciler.ts`。

### 7.5 MemoryRetriever

职责：

- 根据当前用户请求、工作目录和活动任务筛选记忆；
- 按作用域、状态、置信度、更新时间和关键词排序；
- 返回有限数量的 `MemoryContextItem`；
- 提供记忆使用记录，更新 `lastUsedAt`。

建议位置：`src/services/memory/MemoryRetriever.ts`。

### 7.6 MemoryMaintenance

职责：

- 定期检查过期和低置信度候选；
- 合并重复记录；
- 重新验证有来源的项目规范；
- 清理无效临时记忆；
- 修复索引和孤儿历史；
- 输出维护报告。

建议位置：`src/services/memory/MemoryMaintenance.ts`。

## 8. 记忆生命周期

### 8.1 候选产生

候选记忆只允许来自以下入口：

1. 用户明确请求记住某项内容；
2. 用户纠正 Agent 的实现或行为；
3. 用户确认某个技术决策；
4. `/init` 发现有明确文件证据的项目事实或规范；
5. 任务完成时，提取用户确认过的长期决策。

一次性任务状态、临时错误和模型猜测不得直接进入长期记忆。

### 8.2 自动保存策略

| 候选来源 | 默认处理 |
| --- | --- |
| 用户明确说“记住/以后都这样” | 自动保存为已确认或高置信度 |
| 用户明确纠正 Agent | 保存为反馈记忆，合并前检查重复 |
| 配置文件明确声明 | 自动保存为项目规范，并记录文件来源 |
| 多次行为中推测出的偏好 | 保存为候选，询问用户确认 |
| 单次行为推测 | 仅保留在会话 |
| 包含密钥或敏感信息 | 拒绝保存并记录原因 |

### 8.3 合并和冲突

对每个候选按以下顺序处理：

1. 使用稳定主题查找同作用域记录；
2. 判断是否为已有记忆的补充；
3. 判断是否替代已有记忆；
4. 判断是否存在不可自动解决的冲突；
5. 自动合并时保留全部来源；
6. 无法判断时建立 `disputed` 记录并请求用户确认。

禁止使用“删除旧文件后写入新文件”的无历史更新方式。

### 8.4 过期和再验证

- `session` 和 `task` 记忆在会话或任务结束后归档。
- `episode` 记忆默认不进入长期上下文，超过设定时间后过期。
- 项目事实和规范需要保留 `lastVerifiedAt`。
- 来源文件被删除或内容发生明显变化时，标记为 `disputed` 或 `expired`，不要直接删除。
- 用户偏好默认不自动过期，但用户可以手动删除或停用。

## 9. 建议的服务接口

以下接口是编码阶段的目标，不要求一次性全部实现。

```ts
interface MemoryService {
  initialize(): Promise<void>
  propose(candidate: MemoryCandidate): Promise<MemoryProposal>
  confirm(proposalId: string): Promise<MemoryRecord>
  reject(proposalId: string, reason?: string): Promise<void>
  retrieve(request: MemoryRetrievalRequest): Promise<MemoryContextItem[]>
  update(id: string, patch: MemoryPatch): Promise<MemoryRecord>
  delete(id: string, reason?: string): Promise<void>
  list(filter?: MemoryFilter): Promise<MemoryRecord[]>
  maintain(options?: MaintenanceOptions): Promise<MaintenanceReport>
}
```

约束：

- `propose()` 不得直接写入正式记忆；
- `confirm()`、明确的自动保存策略或人工编辑才能改变正式记忆；
- `retrieve()` 只返回 `active` 状态且适用于当前作用域的记忆；
- `delete()` 默认采用软删除或历史记录，不直接丢弃审计信息。

## 10. 与现有代码的集成点

### 10.1 ChatService

需要调整的逻辑：

- `runMessage()` 开始前等待记忆初始化；
- 创建 QueryEngine 前调用 `MemoryRetriever`，替换全量 `listMemories()` 注入；
- 一次请求完成后异步触发 `MemoryExtractor`；
- 用户纠正、任务完成和明确确认事件进入候选记忆流程；
- 不让记忆维护任务阻塞当前回答。

### 10.2 QueryEngine

QueryEngine 只接收已经筛选好的记忆上下文，不负责保存记忆。需要保持以下边界：

```text
ChatService / MemoryService：提取、检索、维护
QueryEngine：消费上下文并执行 Agent 循环
```

### 10.3 /init

保留现有基础快照能力，但改为：

- 生成带来源和证据的正式项目记忆；
- 读取已有记忆并合并，不覆盖用户内容；
- 只创建缺失主题；
- 对变更的配置记录 `lastVerifiedAt`；
- 不让模型直接修改 `MEMORY.md`。

### 10.4 用户控制入口

建议增加以下命令或等价 UI 操作：

```text
/memory list              查看当前记忆
/memory pending           查看待确认候选
/memory show <id>         查看记忆和来源
/memory confirm <id>      确认候选
/memory reject <id>       拒绝候选
/memory forget <id>       停用或删除记忆
/memory refresh           重建索引并执行维护
/remember <内容>          明确创建一条用户记忆
```

用户必须能够看到“记住了什么、为什么记住、来自哪里、何时更新”。

## 11. 分阶段编码计划

### 阶段 0：基线和契约

任务：

- 固化现有记忆行为和旧文件格式；
- 添加当前 `MemoryManager` 的单元测试；
- 确认全局记忆和工作区记忆的存储位置；
- 确认多根工作区的处理策略；
- 定义敏感信息拒绝规则。

完成标准：旧有记忆可以读取、保存、删除和迁移，且有回归测试。

### 阶段 1：结构化存储和迁移

任务：

- 引入 `MemoryRecord` 和 `MemorySource`；
- 新增 `entries/`、`candidates/`、`history/` 目录；
- 支持旧根目录 Markdown 的读取；
- 将旧字段映射为默认 `scope/kind/status/confidence`；
- 生成新的 `MEMORY.md`；
- 增加原子写入和文件名安全校验。

完成标准：旧文件不丢失；迁移后新旧格式可以同时读取；重复迁移不会产生重复记录。

### 阶段 2：候选记忆和安全策略

任务：

- 实现 `MemoryCandidate`；
- 从明确用户指令和反馈中提取候选；
- 增加敏感信息过滤；
- 实现自动保存、等待确认、拒绝保存三种策略；
- 增加候选查看和确认接口。

完成标准：模型不能绕过候选流程直接创建长期记忆；用户可以确认或拒绝候选。

### 阶段 3：合并、冲突和历史

任务：

- 实现主题查找和相似记忆判断；
- 支持补充、修正、替代和冲突；
- 增加 `superseded`、`disputed`、`expired` 状态；
- 写入 JSONL 变更历史；
- 提供冲突提示。

完成标准：同主题重复记忆不会无限增长；旧内容可追溯；冲突不会被静默覆盖。

### 阶段 4：相关记忆读取

任务：

- 实现基于作用域、类型、主题和关键词的检索；
- 按优先级、置信度、更新时间排序；
- 替换 `buildMemoryContext()` 的全量拼接逻辑；
- 设置最大条数和最大字符预算；
- 记录 `lastUsedAt`。

完成标准：普通请求只注入相关记忆；无关记忆不会因为总长度截断而占用上下文。

### 阶段 5：后台维护和用户体验

任务：

- 实现过期检查、索引修复和重复合并；
- 增加 `/memory` 和 `/remember` 命令或 Webview 面板；
- 展示来源、置信度、确认状态和更新时间；
- 支持编辑、停用、删除和恢复历史版本；
- 维护任务异步执行并记录耗时和失败原因。

完成标准：用户无需手动编辑内部索引文件，也能完整管理自己的记忆。

## 12. 测试计划

### 12.1 单元测试

建议目录：`src/services/memory/__tests__/`。

至少覆盖：

- Frontmatter 解析和序列化；
- 旧格式迁移；
- 稳定 ID 和文件名生成；
- 候选分类和置信度计算；
- 敏感信息拒绝；
- 同主题合并；
- 新旧记忆替代；
- 冲突标记；
- 过期判断；
- 检索排序和作用域过滤；
- 索引重建；
- 外部文件修改后的重新加载；
- 原子写入失败恢复。

### 12.2 集成测试

至少验证以下流程：

1. 用户明确说“以后都使用单引号”，生成候选并确认后，下一会话可以读取。
2. 用户拒绝候选后，后续请求不会再次注入该候选。
3. 项目配置变更后，旧规范被标记为待验证或冲突。
4. 同主题记忆合并后只保留一条 active 记录。
5. 模块级规则只在对应模块任务中生效。
6. 多会话共享 workspace 记忆，但 session 记忆互不污染。
7. 重启 VS Code 后记忆、候选、索引和历史均可恢复。
8. 包含 Token 的消息不会写入任何记忆文件。

### 12.3 回归检查

每次修改记忆注入逻辑后，至少检查：

- 普通对话没有额外的大段无关上下文；
- 记忆初始化失败不会阻塞聊天；
- 记忆文件被手动编辑后可以重新加载；
- 旧 `.claude/memory` 内容不会被意外覆盖；
- QueryEngine 的正常工具循环和上下文压缩不受影响。

## 13. 性能、可靠性和安全要求

- 初始化只加载元数据和必要内容，避免启动时读取大量文件。
- 记忆检索设置固定数量和字符预算。
- 后台维护使用防抖和串行队列，避免多个文件监听事件并发写索引。
- 写文件采用临时文件加替换方式，避免进程中断导致内容损坏。
- 所有外部路径必须限制在记忆目录或已确认的全局存储目录内。
- 对候选和正式记忆执行 Token、密码、私钥、Cookie、Authorization Header 等敏感模式检查。
- 维护失败不能覆盖上一次有效记忆。
- 记录维护耗时、候选数量、自动保存数量、拒绝数量和冲突数量，但不要记录敏感正文。

## 14. 验收标准

完成记忆模块后，应满足以下条件：

1. 用户明确表达的编码偏好可以跨会话生效。
2. 项目规范和用户偏好不会混为一谈。
3. Agent 不会因为一次偶然行为就永久修改用户记忆。
4. 记忆文件具备来源、置信度、作用域和更新时间。
5. 同主题记忆会被更新或合并，而不是不断新建文件。
6. 新旧规则冲突时，系统会标记并请求确认。
7. 当前请求只注入相关记忆，不再全量注入所有内容。
8. 用户能够查看、确认、拒绝、编辑、停用和删除记忆。
9. 记忆维护失败、文件损坏或模型不可用时，不影响基本聊天和代码工具功能。
10. 旧版 `.evancod/memory` 和 `.claude/memory` 内容可以安全迁移。

## 15. 推荐开发顺序

实际开发时严格按以下顺序推进：

```text
数据模型和测试基线
  -> 存储布局与迁移
  -> 候选记忆和安全策略
  -> 合并、冲突和历史
  -> 相关记忆读取
  -> 用户管理入口
  -> 后台维护和性能优化
```

不建议先开发自动提取或 UI。没有稳定的数据模型、候选流程和合并规则，自动提取只会快速制造大量重复和错误记忆。

