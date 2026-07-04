# 添加统一日志功能

**状态**: 🔄 规划中
**创建时间**: 2026-07-01T14:13:03.272Z

## 描述

为当前项目添加统一日志功能。计划范围包括：调研现有项目结构与技术栈、确认是否已有日志方案、设计统一 logger 封装、配置日志级别与格式、接入请求日志、错误日志、业务关键日志、Trace ID、敏感字段脱敏、日志输出策略以及测试和文档。不直接修改代码，先制定可执行计划供用户审批。

## 任务列表

### 1. 梳理现有日志调用

检查并记录当前日志分布，确认主要 console.* 出现位置和优先替换模块。验收标准：列出需要替换的核心文件和替换顺序。
- 预估时间: 10 分钟
- 风险:
  - 遗漏部分动态日志调用

### 2. 实现统一 Logger 模块

创建统一日志模块，提供日志级别、模块命名、格式化、Error 处理、OutputChannel 输出和延迟初始化能力。验收标准：业务代码可通过 logger.info/debug/warn/error 或 createLogger('Module') 调用。
- 预估时间: 30 分钟
- 风险:
  - 初始化顺序处理不当导致早期日志丢失

### 3. 实现日志脱敏工具

实现敏感字段脱敏逻辑，覆盖 token、apiKey、authorization、password、secret、cookie 等字段，并处理嵌套对象。验收标准：日志上下文输出前会统一脱敏。
- 预估时间: 20 分钟
- 风险:
  - 过度脱敏影响排查，或漏脱敏导致泄露

### 4. 添加日志级别配置

在 package.json 中添加 evancod.logLevel 配置，并让 logger 读取 VSCode 配置动态决定输出级别。验收标准：修改 VSCode 设置后可控制 debug/info/warn/error/off 输出。
- 预估时间: 15 分钟
- 风险:
  - 配置读取时机与 VSCode API 生命周期耦合

### 5. 接入扩展生命周期日志

在 src/extension.ts 中初始化 OutputChannel 和 logger，替换生命周期相关 console 输出。验收标准：扩展启动、初始化成功/失败、停用日志出现在 Evancod OutputChannel。
- 预估时间: 20 分钟
- 风险:
  - 扩展激活失败时日志不可见

### 6. 替换核心服务日志调用

分批替换核心服务中的 console 输出，包括 QueryEngine、ChatService、WebviewManager、MCPClient、MCPConnectionManager、ProviderService、NewApiMessageHandler 等。验收标准：核心路径不再直接使用 console.*，并保持原有信息完整。
- 预估时间: 60 分钟
- 风险:
  - 批量替换引入导入路径错误或改变日志级别

### 7. 补充业务关键日志

在关键业务流程补充结构化日志上下文，例如工具调用、会话消息、MCP 连接、Provider 加载、NewApi 导入、任务/计划操作。验收标准：排查问题时能通过模块名和上下文定位关键流程。
- 预估时间: 40 分钟
- 风险:
  - 日志上下文包含敏感数据或体积过大

### 8. 验证日志功能

添加或补充测试，至少覆盖日志级别过滤、Error 格式化和敏感字段脱敏，并运行 TypeScript 编译。验收标准：npm run compile 通过，相关测试通过或提供手动验证结果。
- 预估时间: 30 分钟
- 风险:
  - 现有测试环境可能不完整

### 9. 编写日志使用说明

更新项目文档，说明日志级别配置、OutputChannel 查看方式、模块内推荐使用方式和敏感信息注意事项。验收标准：开发者能按文档在新代码中正确添加日志。
- 预估时间: 15 分钟
- 风险:
  - 文档与实现不同步

## 执行步骤

1. 1. 确认项目为 VSCode 扩展 TypeScript 项目，主入口为 src/extension.ts，当前未发现统一 logger，主要使用 console.* 输出。
2. 2. 新增轻量日志模块，建议路径为 src/services/logging/Logger.ts 或 src/utils/logger.ts，提供 debug/info/warn/error 方法。
3. 3. 使用 VSCode window.createOutputChannel 创建 Evancod 专用 OutputChannel，日志统一输出到该面板；错误日志保留 error stack。
4. 4. 在 package.json 的 contributes.configuration 中新增日志配置项，例如 evancod.logLevel，枚举 debug/info/warn/error/off，默认 info。
5. 5. 实现日志格式化：包含时间戳、级别、模块名、消息、上下文对象；Error 对象转换为 message/name/stack。
6. 6. 实现敏感信息脱敏工具：对 token、apiKey、authorization、password、secret、cookie 等字段做遮蔽；对字符串中的 Bearer token 可做基础掩码。
7. 7. 在 src/extension.ts 激活流程中初始化 logger，并记录扩展启动、服务初始化成功/失败、停用等生命周期日志。
8. 8. 优先替换核心模块中的 console 输出：QueryEngine、ChatService、WebviewManager、MCPClient、MCPConnectionManager、ProviderService、NewApiMessageHandler 等。
9. 9. 对业务关键流程补充结构化上下文日志：会话创建、消息发送、工具调用、MCP 连接、Provider 加载/NewApi 导入、计划/任务操作等。
10. 10. 对异常处理位置统一使用 logger.error，并传入 Error 对象与必要上下文，避免只输出字符串。
11. 11. 增加基础测试或最小验证：脱敏函数、日志级别过滤、Error 格式化；若现有测试体系不足，至少通过 npm run compile 验证类型正确。
12. 12. 更新文档或 README 中的日志说明：如何设置 logLevel、如何打开 Output 面板、业务代码如何使用 logger。

## 风险评估

### 🟡 MEDIUM - 当前代码中存在大量 console.log/console.warn/console.error，批量替换可能引入导入路径错误或破坏原有调试输出语义。

**缓解措施**: 分阶段替换：先新增 logger 模块，再优先替换核心入口和高频服务；每批替换后运行 TypeScript 编译检查。

### 🟡 MEDIUM - VSCode 扩展环境不适合引入过重日志依赖，额外依赖可能增加扩展体积或兼容性风险。

**缓解措施**: 优先使用 VSCode 原生 OutputChannel + TypeScript 自实现轻量 logger，不新增第三方日志库；如确需文件日志再另行评估。

### 🔴 HIGH - 日志中可能包含 token、API key、用户输入、请求参数等敏感信息。

**缓解措施**: 在 logger 层统一实现敏感字段脱敏，并在替换 NewApi、Provider、MCP 等模块日志时重点审查。

### 🟡 MEDIUM - 日志过多可能影响扩展性能或污染 Output 面板。

**缓解措施**: 支持日志级别配置，默认 info；debug 日志仅在开发或用户显式开启时输出。

### 🟢 LOW - 如果在 extension 激活早期使用 logger，而 logger 尚未初始化，可能导致日志丢失或运行错误。

**缓解措施**: logger 设计为可延迟初始化；未绑定 OutputChannel 时回退到 console 或内存缓冲，激活后统一绑定。
