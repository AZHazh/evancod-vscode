# 可配置 Agent、工具偏好与标准 MCP 实施计划

> 状态：Phase 0-4 已完成，Phase 5 回归中
>
> 目标：在不破坏现有聊天、内置工具、Skill、MCP、子 Agent 和会话恢复能力的前提下，增加可视化创建自定义子 Agent、工具偏好配置和标准 MCP 支持。

## 1. 需求范围

### 1.1 用户需求

1. 提供引导式自定义子 Agent 创建流程。
   - 设置入口打开。
   - Slash Command 支持 /create-agent。
   - 兼容 /creat agent 和 /create agent。
   - 分步骤询问目标、职责、工具、约束、模型和执行方式。
   - 根据回答生成草稿，用户确认后才保存并启用。

2. 提供工具使用偏好界面。
   - 展示内置工具和已发现的 MCP 工具。
   - 按分类分组并支持搜索。
   - 使用复选框启用/禁用。
   - 鼠标悬停显示工具说明、参数和风险级别。
   - 默认启用全部当前可用工具。
   - 保存后不需要每次重新选择。

3. 完善 MCP。
   - 使用官方 @modelcontextprotocol/sdk，当前项目依赖版本为 1.29.0。
   - 遵循 MCP 官方协议和能力协商。
   - 第一阶段支持标准 stdio，第二阶段设计 Streamable HTTP。
   - 自动发现工具、资源和能力。
   - 支持状态、错误、重连、工具 Schema 和权限标记。

4. 将现有服务商按钮升级为设置入口集合。
   - 服务商
   - 创建 Agent
   - Agent 管理
   - 工具偏好
   - MCP 管理
   - 保留现有服务商功能和入口兼容性。

5. 所有改造不得破坏现有功能。
   - 默认配置必须等价于当前行为。
   - 任何影响权限、数据格式、协议兼容性或已有用户数据的疑问，必须暂停并先提问。

### 1.2 非目标

- 第一阶段不从配置文件直接加载任意 JavaScript/TypeScript 到 Extension Host。
- 第一阶段不做插件市场、在线安装、签名和自动升级。
- 自定义 Agent 仍由当前 QueryEngine 执行，不做独立模型服务。
- MCP Sampling、Elicitation、Experimental Tasks 只保留扩展点，未确认交互前不强行开放。

## 2. 当前架构基线

### 2.1 可复用能力

- src/core/tools/base/Tool.ts：工具名称、描述、输入 Schema 和执行结果。
- src/core/tools/execution/ToolExecutor.ts：查找、参数校验、权限、取消、结果事件。
- src/core/engine/QueryEngine.ts：工具初始化和工具定义生成。
- src/services/agent/AgentCoordinator.ts：前台/后台子 Agent、持久化、取消、worktree 和 UI 事件。
- src/services/skill/SkillManager.ts：全局/工作区 Skill、启停和热加载。
- src/services/mcp/MCPConnectionManager.ts：Server 配置、连接、发现和调用。
- webview/src/views/ProviderSettings.vue：设置类页面和 Webview 消息模式。

### 2.2 当前限制

- QueryEngine 的 initializeTools 直接实例化全部工具，无法按 Profile 过滤。
- AgentType 和 AgentTool 的枚举固定为 explore、analyze、research。
- Agent 系统提示词写在 AgentCoordinator 中，没有 Agent Registry。
- 子 Agent 固定 readOnly，工具范围固定。
- MCP 客户端是手写 JSON-RPC stdio 实现，没有完整使用官方 SDK。
- MCP 工具当前通过一个 mcp 元工具调用，未作为独立工具 Schema 暴露。
- 权限主要依据工具名称判断，对自定义工具和 MCP 副作用识别不足。
- Webview 没有 Agent 创建向导、工具偏好页和 MCP 管理页。

## 3. 目标架构

    设置入口 / Slash Command
              |
       +------+------+
       |             |
    Agent 向导     工具偏好       MCP 管理
       |             |             |
    AgentRegistry ToolRegistry MCPConnectionManager
       +-------------+-------------+
                     |
          RuntimeProfileResolver
                     |
                 QueryEngine

### 3.1 ToolRegistry

新增 src/core/tools/registry/ToolRegistry.ts，统一管理内置工具、MCP 工具和未来插件工具。

    interface ToolRegistration {
      id: string
      name: string
      description: string
      source: 'builtin' | 'mcp' | 'plugin'
      capabilities: Array<'read' | 'write' | 'execute' | 'network' | 'interactive'>
      create: (context: ToolContext) => Tool
      defaultEnabled: boolean
    }

要求：

- 工具 ID 全局唯一；MCP 工具使用 mcp.<server>.<tool> 命名。
- 保留现有工具名称作为兼容别名。
- 注册表负责发现、实例化和过滤，不改变 Tool 执行协议。
- QueryEngine 接收工具快照，不再自行决定全部工具。
- 所有工具必须有描述、来源、能力和风险元数据。

### 3.2 AgentRegistry

新增 src/services/agent/AgentRegistry.ts，内置 Agent 也通过同一套定义注册。

    interface AgentDefinition {
      id: string
      name: string
      description: string
      systemPrompt: string
      model?: string
      effortLevel?: 'low' | 'medium' | 'high' | 'max'
      enabledTools: string[]
      enabledSkills?: string[]
      readOnly: boolean
      permissionMode: PermissionMode
      maxIterations: number
      isolation: 'none' | 'worktree'
      enabled: boolean
      source: 'builtin' | 'global' | 'workspace'
    }

建议布局：

    ~/.evancod/agents/<id>/agent.json
    ~/.evancod/agents/<id>/system.md
    <workspace>/.evancod/agents/<id>/agent.json
    <workspace>/.evancod/agents/<id>/system.md

加载顺序：内置 -> 全局 -> 工作区。同 ID 后者覆盖前者，但必须通过 Schema 和路径安全校验。

### 3.3 RuntimeProfileResolver

新增运行时解析层：

- 合并全局、工作区、会话和 Agent 配置。
- 计算实际工具集合：Agent.enabledTools 与 ToolProfile.enabledTools 的交集。
- 对只读 Agent 过滤写入、执行和删除能力。
- 工具缺失时给出可见警告。
- 创建 QueryEngine 时生成不可变快照，运行中不因热更新改变工具集合。

## 4. 自定义 Agent 创建向导

### 4.1 入口

- 设置 -> 创建 Agent。
- /create-agent。
- 兼容 /creat agent、/create agent。
- 命令匹配成功后不把原文本发送给模型。

### 4.2 引导步骤

1. 目标和名称：名称、描述、服务对象、使用场景。
2. 职责和流程：输入、输出、步骤、计划、验证和总结要求。
3. 工具偏好：继承用户工具偏好，或为该 Agent 单独覆盖。
4. 约束和权限：只读、编辑、命令、网络、子 Agent、worktree、权限模式。
5. 模型和运行参数：继承或指定模型、effort、最大轮次、前台/后台。
6. 生成草稿：由当前模型整理结构化定义，本地 Schema 校验。
7. 确认保存：允许返回修改，确认后写入文件，可选择立即使用。

### 4.3 UI 组件建议

    webview/src/components/settings/SettingsMenu.vue
    webview/src/components/agent/AgentCreationWizard.vue
    webview/src/components/agent/AgentDraftPreview.vue
    webview/src/components/agent/AgentList.vue
    webview/src/components/tools/ToolPreferences.vue
    webview/src/components/mcp/McpSettings.vue

后端消息类型建议：

    agent.registry.list.request / response
    agent.draft.generate.request / response
    agent.definition.validate.request / response
    agent.definition.save.request / response
    agent.definition.delete.request / response
    tools.registry.list.request / response
    tool-preferences.load.request / response
    tool-preferences.save.request / response
    mcp.servers.list.request / response
    mcp.server.refresh.request / response

## 5. 工具偏好配置

### 5.1 配置模型

    interface ToolProfile {
      enabledTools: string[]
      disabledTools?: string[]
      scope: 'global' | 'workspace'
      updatedAt: string
    }

默认策略：没有配置、配置损坏或工具未出现在配置中时，使用全部内置工具。只有显式禁用才禁用，确保现有行为不变。

建议位置：

    用户级：VS Code globalState 或 ~/.evancod/config.json
    工作区级：<workspace>/.evancod/config.json

### 5.2 界面要求

- 分类：文件、搜索、命令、代码分析、Git、Web、任务、Agent、MCP、Skill、图像。
- 搜索、全选、取消全选、恢复默认。
- 显示名称、ID、描述、来源和能力标签。
- 悬停显示完整参数 Schema 和风险提示。
- 写入、删除、命令执行、网络访问显示风险标识。
- 明确保存范围为全局或当前工作区。
- 运行中的会话不强制热切换，提示下一请求或新会话生效。

### 5.3 权限改造

权限从工具名称升级为 capability：

    read          普通读取
    write         编辑、写入、删除
    execute       Shell、脚本和外部进程
    network       网络访问和外部服务
    interactive   向用户提问

MCP 必须按具体 Server 和工具授权，不能因为外层名称是 mcp 就放行所有内部操作。

这里的“系统权限”指 Evancod 当前会话的 permissionMode、用户确认和工具能力策略，不等同于操作系统账户权限。权限继承建议采用“系统权限为上限，Agent/MCP 只能收紧”的模型：

1. 主 Agent 继续遵循现有 permissionMode 和用户确认流程，这是最终权限上限。
2. 子 Agent 默认继承主 Agent 当前权限，不默认获得更高权限。
3. AgentDefinition 可以声明更严格的限制，例如只读、禁止 Bash、禁止网络，但不能声明绕过主 Agent 权限。
4. MCP Server 和 MCP 工具也继承当前会话权限，并额外受 Server/Tool capability 和用户授权限制。
5. 子 Agent 的权限请求显示“主 Agent/子 Agent/具体工具”上下文，用户可以单独批准一次或始终批准。
6. bypassPermissions 只有用户明确选择时才生效，不能由 Agent 配置、Skill 或 MCP Server 自己开启。
7. readOnly 不是唯一安全条件；write、execute、network 等 capability 必须分别判断。

MCP 还存在独立的操作系统权限边界：MCP Server 是由 Extension Host 启动的外部进程，它实际能访问的文件、网络和环境变量取决于进程账户、工作目录、容器或沙箱。Evancod 必须控制工具调用和敏感信息注入，但不能宣称仅靠 Agent 配置就能限制一个不受信任 MCP Server 的全部操作。因此未知 MCP Server 必须经过用户确认，生产部署应使用最小权限账户或隔离环境。

最终有效权限可以抽象为：

    effectivePermission = systemPermission
      ∩ sessionPermission
      ∩ agentRestriction
      ∩ toolCapabilityPolicy
      ∩ userApproval

其中 AgentRestriction 和 ToolCapabilityPolicy 只能减少权限，不能扩大权限。

## 6. MCP 标准化改造

### 6.1 客户端

保留 MCPConnectionManager 上层职责，替换 MCPClient 的手写协议实现：

    import { Client } from '@modelcontextprotocol/sdk/client/index.js'
    import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

必须由 SDK 处理：

- 初始化和协议版本协商。
- Client/Server capability 协商。
- initialized 生命周期通知。
- JSON-RPC framing、错误、取消和关闭。
- tools/list、tools/call、资源和 Prompt API。
- Server 列表变更和重新发现。

### 6.2 Transport

- 第一阶段：标准 stdio，兼容本地 Node、Python、Go MCP Server。
- 第二阶段：Streamable HTTP，支持远程 Server、鉴权和多用户部署。
- 旧 SSE 只作为兼容层，不作为新实现首选。

### 6.3 工具暴露

- 保留 mcp 元工具作为迁移兼容入口。
- 将发现的 MCP 工具注册为 mcp.<server>.<tool>。
- 将 MCP inputSchema 转换为项目 ToolDefinition。
- 调用结果转换为统一 ToolResult，保留结构化内容、图片和错误。
- 增加 Server/Tool 级启停和权限控制。

### 6.4 安全和配置

- 继续兼容 ~/.evancod/mcp-servers.json。
- 工作区配置启动本地进程前，必须确认产品策略。
- API Token 和 OAuth Token 使用 VS Code SecretStorage。
- 环境变量注入使用白名单，避免泄露 Extension Host 全部环境。
- 展示 Server 来源、命令、参数、目录和权限范围。
- 未知 Server 第一次启用时提供确认和禁用入口。
- Server stdout 只能输出 MCP 协议，日志使用 stderr。

## 7. 设置入口和 Slash Command

设置入口：

    设置
      ├── 服务商
      ├── 创建 Agent
      ├── Agent 管理
      ├── 工具偏好
      └── MCP Server

要求：

- 保留 Provider 管理原有页面和消息协议。
- /create-agent 打开 AgentCreationWizard。
- 两个兼容别名打开同一向导。
- 取消不产生空消息和半成品 Agent。
- 确认后可选择立即使用或仅保存。

## 8. 分阶段实施

### Phase 0：评审和基线

- [x] 确认全局/工作区配置优先级。
- [x] 确认自定义 Agent 是否允许写文件、命令和网络。
- [x] 确认 MCP 远程鉴权方式和管理 UI 范围。
- [x] 记录现有测试和手工回归路径。
- [x] 影响权限、数据格式或兼容性的决策必须先提问。

已确认决策（2026-09-18）：

- 工作区显式配置覆盖全局配置，未提及项继承全局或默认值。
- 自定义 Agent 可由用户显式选择写入、命令和网络能力，但始终受系统与当前会话权限上限约束，Agent 定义不得启用 `bypassPermissions`。
- MCP 第一阶段优先标准 stdio 和最小权限管理；Streamable HTTP 后续使用 SecretStorage 保存 Bearer/API Token，OAuth 在授权、刷新和撤销流程明确后再开放。
- 基线验证命令为 `npm run compile`、`npm run test:unit`、`npm run lint`、`webview/npm run build`；手工回归通过 VS Code `F5` Development Host 执行聊天、工具权限、子 Agent、Provider 和会话恢复路径。

### Phase 1：注册表和运行时快照

- [x] 实现 ToolRegistry。
- [x] 迁移内置工具。
- [x] 实现 AgentRegistry 和内置 Agent 定义。
- [x] QueryEngine 支持工具快照和系统提示词注入。
- [x] 默认行为与当前工具集合一致。
- [x] 增加注册表和配置合并测试。

### Phase 2：工具偏好

- [x] 实现 ToolProfile 持久化和合并。
- [x] 实现工具列表、搜索、分类、详情、全选和默认恢复。
- [x] QueryEngine 创建时应用 Profile。
- [x] 验证会话、子 Agent 和 readOnly 过滤不回归。

### Phase 3：Agent 配置和向导

- [x] 实现 Agent 文件格式、加载器和 Schema。
- [x] 实现列表、启停、编辑、删除。
- [x] 实现七步创建向导。
- [x] 实现草稿生成、预览、确认和保存。
- [x] AgentTool 动态读取 Registry。
- [x] AgentCoordinator 使用 AgentDefinition。
- [x] 增加 Slash Command 和兼容别名。

### Phase 4：MCP 标准化

- [x] 使用官方 SDK 重写 MCP Client 适配层。
- [x] 完成 stdio 生命周期和 capability 协商。
- [x] 完成工具发现、Schema 转换和独立 Wrapper。
- [x] 保留旧 mcp 元工具。
- [x] 增加 MCP Server 管理、刷新、重连和禁用。
- [x] 增加 capability 权限和 Server/Tool 授权。
- [x] 使用官方示例 Server 做互操作测试。

### Phase 5：设置整合和发布保护

- [x] 完成设置入口集合。
- [x] 完成配置迁移、错误提示和恢复默认。
- [x] 更新 MCP、Agent、工具配置文档。
- [ ] 完成单元、回归和 Development Host 手工验证。
- [ ] 所有回归通过后再启用默认功能。

## 9. 兼容性和回滚

- 无 ToolProfile 时启用全部内置工具。
- 无 AgentRegistry 配置时注册原有三个内置 Agent。
- 继续读取旧 MCP 配置路径，迁移前不删除原文件。
- SDK 迁移失败时保留临时兼容开关，但不得默认降级到不安全行为。
- 配置解析失败时保留原文件，使用安全默认配置并显示错误。
- QueryEngine 创建失败时不替换当前有效会话。
- 新 Webview 页面失败时 Provider 和聊天主流程仍可用。
- JSON 使用临时文件和原子替换，避免产生半文件。

## 10. 测试计划

### 单元测试

- ToolRegistry 注册、重复 ID、过滤和实例化。
- AgentRegistry 加载、覆盖、启停、Schema 和路径安全。
- ToolProfile 全局/工作区合并和默认全开。
- AgentDefinition 到 QueryEngineConfig 的解析。
- MCP Schema、错误和结果转换。
- capability 权限和 readOnly 过滤。

### 集成测试

- 标准 MCP stdio Server 初始化、发现、调用、关闭和重连。
- MCP 工具失败不影响主 Agent 后续请求。
- 自定义 Agent 前台、后台、取消、worktree 和任务恢复。
- Slash Command 打开、取消、确认和重复打开。
- 配置变更后新会话生效，旧会话不崩溃。

### 手工回归

- 普通聊天、流式输出、文件工具和 Bash 权限。
- Plan Mode、Task、Skill、图片生成和 Provider 管理。
- 历史会话加载和 VS Code 重载后的任务恢复。
- 无配置、配置损坏、MCP 离线和权限拒绝。

## 11. 验收标准

- [ ] 可从设置入口创建并保存自定义 Agent。
- [ ] 可通过 /create-agent 及兼容别名打开向导。
- [ ] 确认前可预览和修改完整 Agent 草稿。
- [ ] Agent 可配置系统提示词、工具、模型和权限。
- [ ] 工具默认全部开启，保存后无需重复选择。
- [ ] 工具有描述、分类、来源和风险提示。
- [ ] 内置工具、内置 Agent、Skill、Provider 和历史会话保持兼容。
- [ ] MCP 使用官方 SDK 完成标准初始化、发现和调用。
- [ ] MCP 工具可以独立展示、启停和授权。
- [ ] 配置或协议错误不能静默放行。
- [ ] npm run compile、npm run lint、npm run test:unit 通过，并完成 Development Host 回归。

## 12. 需求澄清门槛

本节的含义是：实施过程中只有在需求存在多种合理解释，且不同选择会导致不同产品行为、权限边界、数据格式或兼容性结果时，才暂停并向产品负责人提问。普通的实现细节、代码组织、测试补充和可以依据现有项目模式推断的内容，不需要停下来询问。

必须先确认的情况：

- 用户对 Agent 的目标、输出或约束描述不足，无法生成可靠的 Agent 草稿。
- 需要决定自定义 Agent 是否允许写文件、执行命令或访问网络，而“跟随系统权限”不能覆盖该具体选择。
- 全局配置和工作区配置冲突，且现有优先级无法安全解决。
- MCP 需要 OAuth、Cookie 或其他敏感凭据，但存储、授权和撤销方式未确认。
- 标准 MCP Server 与当前客户端不兼容，修复会影响旧 MCP 配置或已有会话。
- 需要修改历史会话、Provider、权限模式或持久化格式，可能影响已有用户数据。
- 同一个 Agent、工具或 MCP Server 的命名/覆盖规则存在多种合理方案。
- 测试失败无法证明是测试本身问题，或可能代表现有功能行为发生变化。

默认处理原则：如果只是低风险、可逆、符合现有代码模式的实现选择，直接按本计划和现有项目约定执行；如果会改变用户可见行为或安全边界，先提问再继续。

## 13. 交付物

- ToolRegistry、AgentRegistry、RuntimeProfileResolver 及测试。
- Agent 配置格式、示例 Agent 和迁移说明。
- Agent 创建向导、Agent 管理页、工具偏好页、MCP 管理页。
- 官方 MCP SDK Client 适配和互操作测试。
- 设置入口和 Slash Command 文档。
- 更新后的 docs/MCP-SETUP.md、用户配置说明和回归清单。
- 本计划全部验收项的执行记录。
