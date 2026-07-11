# 上下文压缩植入实施计划

## 当前状态总结

### 已调研完成
1. **压缩文档**：完整读取 `docs/上下文压缩实现文档.md`
2. **当前架构**：
   - QueryEngine：工具循环主逻辑 (src/core/engine/QueryEngine.ts)
   - ChatService：会话管理、消息构建 (src/services/chat/ChatService.ts)
   - AnthropicClient：API 调用、usage 归一化 (src/core/services/api/AnthropicClient.ts)
   - TokenUsage 类型：已有字段但未充分利用 (src/types/index.ts)
   - modelTokens 工具：只有输出 token，无上下文窗口 (src/utils/model/modelTokens.ts)

### 核心问题
1. **UI 显示 100% 问题**：
   - `inputTokens` 是多轮工具循环的累计消耗，不是当前上下文占用
   - ChatInput.vue:92 用 `inputTokens + outputTokens` 计算百分比，导致虚高
   - 缺少 `contextWindow` 和真实的当前 prompt token 统计

2. **压缩无效问题**：
   - `/compact` 只生成确定性摘要 (ChatService.ts:1077-1084)，不调用模型
   - `compactSummary` 作为 system 消息注入 (ChatService.ts:1088-1099)
   - Anthropic 转换器丢弃所有 system 消息 (AnthropicClient.ts:595-597)
   - 原始历史完整发送，无裁剪

3. **无自动压缩**：
   - `Provider.autoCompactWindow` 字段存在但未接入
   - 没有阈值检查、没有触发逻辑

## 实施方案

### 阶段 1：最小可用压缩（优先级最高）

#### 1.1 修复 token 统计口径
**目标**：让 UI 显示准确的上下文占用百分比

**修改点**：
- `src/types/index.ts` - 扩展 TokenUsage：
  ```ts
  export interface TokenUsage {
    // 现有字段（工具循环累计消耗）
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    
    // 新增：当前上下文窗口相关
    contextWindow?: number           // 模型上下文窗口大小
    lastPromptTokens?: number        // 最后一次请求的实际 input tokens
    estimatedCurrentTokens?: number  // 当前上下文估算（最后 API usage + 新消息估算）
    percentUsed?: number             // 百分比（后端计算好）
    
    [key: string]: unknown
  }
  ```

- `src/utils/model/modelContextWindows.ts` - 新建文件：
  ```ts
  export function getContextWindowForModel(model: string): number {
    const canonical = getCanonicalName(model)
    if (canonical.includes('opus-4') || canonical.includes('sonnet-4') || canonical.includes('haiku-4')) {
      return 200_000
    }
    if (canonical.includes('claude-3')) {
      return 200_000
    }
    return 200_000 // 保守默认
  }
  
  export function getEffectiveContextWindow(model: string): number {
    const total = getContextWindowForModel(model)
    const reserved = Math.min(getModelMaxOutputTokens(model).upperLimit, 20_000)
    return total - reserved
  }
  ```

- `src/core/engine/QueryEngine.ts` - 修改 mergeUsage：
  ```ts
  function mergeUsage(current: TokenUsage | undefined, next: unknown): TokenUsage | undefined {
    // 现有累计逻辑保持
    // ...
    
    // 新增：记录最后一次 API 的 inputTokens
    if (incoming.inputTokens) {
      merged.lastPromptTokens = incoming.inputTokens
    }
    
    return merged
  }
  ```

- `src/core/engine/QueryEngine.ts:647-655` - 发送 message_complete 事件时计算百分比：
  ```ts
  const contextWindow = getContextWindowForModel(this.config.model)
  const effectiveWindow = getEffectiveContextWindow(this.config.model)
  
  if (totalUsage) {
    totalUsage.contextWindow = contextWindow
    // 用最后一次 prompt token，不是累计
    const currentTokens = totalUsage.lastPromptTokens || totalUsage.inputTokens || 0
    totalUsage.estimatedCurrentTokens = currentTokens
    totalUsage.percentUsed = Math.min(
      Math.round((currentTokens / effectiveWindow) * 100),
      100
    )
  }
  
  this.onAgentEventCallback?.({ type: 'message_complete', usage: totalUsage })
  ```

- `webview/src/components/input/ChatInput.vue:82-98` - 修改前端计算：
  ```ts
  const contextWindow = computed(
    () => usage.value?.contextWindow || 200000
  )
  const currentTokens = computed(
    () => usage.value?.estimatedCurrentTokens || usage.value?.lastPromptTokens || 0
  )
  const contextPercent = computed(
    () => usage.value?.percentUsed ?? 
         (contextWindow.value ? Math.min(Math.round((currentTokens.value / contextWindow.value) * 100), 100) : 0)
  )
  ```

#### 1.2 实现 Microcompact（删旧工具结果）
**目标**：便宜的预压缩，避免触发昂贵的模型摘要

**修改点**：
- `src/services/compact/microCompact.ts` - 新建文件：
  ```ts
  const COMPACTABLE_TOOLS = new Set([
    'read_file', 'bash', 'grep', 'glob', 'web_search', 'web_fetch',
    'edit_file', 'write_file', 'list_directory', 'find'
  ])
  
  export function microcompact(messages: Message[], keepRecent = 5): Message[] {
    // 找出所有可压缩工具结果
    const toolResults: Array<{ index: number; message: Message }> = []
    
    messages.forEach((msg, index) => {
      if (msg.role === 'tool' && msg.toolName && COMPACTABLE_TOOLS.has(msg.toolName)) {
        toolResults.push({ index, message: msg })
      }
    })
    
    // 保留最近 N 个，其余内容替换
    const toCompact = toolResults.slice(0, -keepRecent)
    const compacted = [...messages]
    
    for (const { index } of toCompact) {
      compacted[index] = {
        ...compacted[index],
        content: '[Old tool result content cleared by microcompact]'
      }
    }
    
    return compacted
  }
  ```

- `src/core/engine/QueryEngine.ts:514-523` - 在工具循环前调用：
  ```ts
  while (iteration < MAX_ITERATIONS) {
    this.throwIfCancelled()
    iteration++
    
    // 新增：每轮前微压缩
    if (iteration > 1) {
      this.config.messages = microcompact(this.config.messages, 5)
    }
    
    const toolDefinitions = this.tools.map(tool => tool.getDefinition())
    // ...
  ```

#### 1.3 修复 compact 摘要注入
**目标**：让 `/compact` 生成的摘要真正进入 Anthropic 请求

**问题根因**：
- `convertAnthropicMessages` 跳过所有 `role: 'system'` 消息
- `compactSummary` 作为 system 消息注入，被丢弃

**修复方案**：
- `src/services/chat/ChatService.ts:1086-1102` - 改为 user 消息：
  ```ts
  private buildRuntimeMessages(session: Session): Message[] {
    const messages = [...session.messages]
    
    // 如果有压缩摘要或记忆，作为 user 消息注入到最前面
    const contextParts = []
    
    if (session.compactSummary) {
      contextParts.push(`<compact_summary>\n${session.compactSummary}\n</compact_summary>`)
    }
    
    const memoryContext = this.buildMemoryContext()
    if (memoryContext) {
      contextParts.push(memoryContext)
    }
    
    if (contextParts.length > 0) {
      messages.unshift({
        id: 'runtime-context',
        role: 'user',  // 改为 user，不是 system
        content: `以下是会话的上下文信息，请参考：\n\n${contextParts.join('\n\n')}`,
        timestamp: Date.now(),
      })
    }
    
    return messages
  }
  ```

### 阶段 2：自动压缩（第二优先级）

#### 2.1 阈值判定与触发
**修改点**：
- `src/services/compact/autoCompact.ts` - 新建文件：
  ```ts
  const AUTOCOMPACT_BUFFER_TOKENS = 13_000
  
  export function getAutoCompactThreshold(model: string): number {
    const effective = getEffectiveContextWindow(model)
    return effective - AUTOCOMPACT_BUFFER_TOKENS
  }
  
  export function shouldAutoCompact(
    currentTokens: number,
    model: string,
    compactFailures: number
  ): boolean {
    // 断路器：3 次失败后停止
    if (compactFailures >= 3) return false
    
    const threshold = getAutoCompactThreshold(model)
    return currentTokens >= threshold
  }
  ```

- `src/core/engine/QueryEngine.ts` - 新增字段：
  ```ts
  private consecutiveCompactFailures = 0
  ```

- `src/core/engine/QueryEngine.ts:514` - 工具循环前检查：
  ```ts
  while (iteration < MAX_ITERATIONS) {
    this.throwIfCancelled()
    iteration++
    
    // 微压缩
    if (iteration > 1) {
      this.config.messages = microcompact(this.config.messages, 5)
    }
    
    // 检查是否需要自动压缩
    const currentTokens = this.estimateCurrentContextTokens()
    if (shouldAutoCompact(currentTokens, this.config.model, this.consecutiveCompactFailures)) {
      try {
        await this.performAutoCompact()
        this.consecutiveCompactFailures = 0
      } catch (error) {
        this.consecutiveCompactFailures++
        console.error('Auto-compact failed:', error)
        // 继续执行，不中断工具循环
      }
    }
    
    // 继续工具循环
    const toolDefinitions = ...
  ```

#### 2.2 模型摘要实现
**修改点**：
- `src/services/compact/compactPrompt.ts` - 新建文件，照抄文档 §2.4 的 9 段结构提示词

- `src/services/compact/compact.ts` - 新建文件：
  ```ts
  export async function compactConversation(
    messages: Message[],
    apiClient: ReturnType<typeof createApiClient>,
    model: string
  ): Promise<{ summaryMessage: Message; boundaryId: string }> {
    // 1. 构造摘要请求
    const summaryPrompt = getCompactPrompt()
    
    // 2. 剥离图片（用 [image] 替换）
    const stripped = stripImagesFromMessages(messages)
    
    // 3. 调用模型生成摘要（无工具、thinking disabled）
    const summaryResponse = await apiClient.sendMessageStream(
      [{ role: 'user', content: summaryPrompt, timestamp: Date.now(), id: 'compact-request' }],
      () => {}, // 无需流式回调
      [], // 无工具
      { thinkingDisabled: true }
    )
    
    // 4. 格式化摘要
    const formattedSummary = formatCompactSummary(summaryResponse.content)
    
    // 5. 创建摘要消息
    const boundaryId = `compact-boundary-${Date.now()}`
    const summaryMessage: Message = {
      id: boundaryId,
      role: 'user',
      content: `This session is being continued from a previous conversation that ran out of context.
The summary below covers the earlier portion of the conversation.

${formattedSummary}

Continue the conversation from where it left off without asking the user any further questions.
Resume directly — do not acknowledge the summary.`,
      timestamp: Date.now(),
    }
    
    return { summaryMessage, boundaryId }
  }
  ```

- `src/core/engine/QueryEngine.ts` - 实现 performAutoCompact：
  ```ts
  private async performAutoCompact() {
    if (!this.apiClient) throw new Error('API client not initialized')
    
    // 生成摘要
    const { summaryMessage, boundaryId } = await compactConversation(
      this.config.messages,
      this.apiClient,
      this.config.model
    )
    
    // 替换消息数组：只保留摘要 + 最近几轮（可选）
    const keepRecentCount = 10 // 保留最近 10 条消息
    const recentMessages = this.config.messages.slice(-keepRecentCount)
    
    this.config.messages = [summaryMessage, ...recentMessages]
    
    // 发出压缩完成事件
    this.onAgentEventCallback?.({
      type: 'system_notification',
      subtype: 'compact_complete',
      data: { boundaryId }
    })
  }
  ```

#### 2.3 手动 /compact 复用
**修改点**：
- `src/services/chat/ChatService.ts:586-590` - 改为调用真实压缩：
  ```ts
  if (result.metadata?.action === 'compact') {
    if (!this.queryEngine?.apiClient) {
      result.message = '压缩失败：API 客户端未初始化'
    } else {
      try {
        // 调用真实的模型摘要压缩
        const { summaryMessage } = await compactConversation(
          session.messages,
          this.queryEngine.apiClient,
          this.getCurrentModel()
        )
        
        // 保存摘要到 session（用于 UI 显示）
        session.compactSummary = summaryMessage.content
        session.updatedAt = Date.now()
        
        // 重建 QueryEngine 以应用压缩后的消息
        this.queryEngine = undefined
        
        result.message = '已使用模型生成会话摘要并压缩上下文'
      } catch (error) {
        result.message = `压缩失败：${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }
  ```

### 阶段 3：完整体验（可选增强）

#### 3.1 压缩进度事件
- 发送 `compact_start` / `compact_end` 事件
- UI 显示 "正在压缩上下文..." loading 状态

#### 3.2 压缩后附件重注入
- 最近读过的文件重新读取并注入
- 避免模型重复 Read

#### 3.3 Provider 配置接入
- 读取 `provider.autoCompactWindow` 作为自定义阈值
- 读取 `provider.modelContextWindows[model]` 作为自定义窗口大小

## 不实施的部分

按文档建议，以下特性**不纳入本轮实施**：
- Snip（裁剪尾部）：实验特性
- Context Collapse（分段折叠）：实验特性
- 部分压缩（用户选点压缩）：复杂 UI
- Session Memory Compaction（会话记忆压缩）：实验特性
- Prompt-Too-Long 重试：需要先实现基础压缩
- Cache Editing（缓存微压缩）：Anthropic 特有能力
- Tool-Result Budget（单条结果预算）：优先级较低

## 实施顺序

1. **立即实施（核心修复）**：
   - [ ] 修复 token 统计口径（阶段 1.1）
   - [ ] 实现 microcompact（阶段 1.2）
   - [ ] 修复 compact 摘要注入（阶段 1.3）
   - [ ] 修复点击空白关闭弹层（Task #20）

2. **第二批（自动压缩）**：
   - [ ] 阈值判定与触发（阶段 2.1）
   - [ ] 模型摘要实现（阶段 2.2）
   - [ ] 手动 /compact 复用（阶段 2.3）

3. **第三批（体验优化）**：
   - [ ] 压缩进度事件（阶段 3.1）
   - [ ] 压缩后附件重注入（阶段 3.2）
   - [ ] Provider 配置接入（阶段 3.3）

## 风险与注意事项

1. **消息类型兼容性**：
   - 当前 Message 类型可能需要扩展 `boundaryId` 字段
   - 压缩边界标记需要持久化到 session

2. **OpenAI 路径兼容**：
   - 当前方案主要针对 Anthropic
   - OpenAI Chat / Responses 路径需要单独适配

3. **会话持久化**：
   - 压缩后的消息数组需要正确保存
   - UI 需要能识别和展示压缩边界

4. **测试验证**：
   - 需要构造大上下文场景测试阈值触发
   - 需要验证压缩后模型能否正确理解摘要
   - 需要验证 microcompact 不影响工具循环

## 预期效果

实施阶段 1 后：
- ✅ UI 显示准确的上下文百分比，不再虚高到 100%
- ✅ `/compact` 真正压缩上下文，不是只生成占位摘要
- ✅ 旧工具结果自动清理，减少 token 消耗

实施阶段 2 后：
- ✅ 接近上下文窗口时自动触发压缩
- ✅ 使用模型生成高质量结构化摘要
- ✅ 连续失败 3 次后断路器保护

实施阶段 3 后：
- ✅ UI 显示压缩进度，用户体验更好
- ✅ 压缩后重注入文件，减少重复读取
- ✅ 支持用户自定义压缩阈值
