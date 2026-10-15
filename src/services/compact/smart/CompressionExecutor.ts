/**
 * 压缩执行器
 *
 * 执行具体的压缩操作
 */

import type { Message } from '../../../types'
import type { CompressionAction, CompressionResult, MessageImportance } from './types'
import { MessageImportanceAnalyzer } from './ImportanceAnalyzer'
import { compactConversation } from '../compact'

export class CompressionExecutor {
  constructor(
    private importanceAnalyzer: MessageImportanceAnalyzer,
    private apiClient?: any // 用于生成摘要
  ) {}

  /**
   * 执行压缩
   */
  async execute(
    messages: Message[],
    action: CompressionAction
  ): Promise<CompressionResult> {
    const originalCount = messages.length

    if (action.action === 'none') {
      return {
        messages,
        originalCount,
        compressedCount: originalCount,
        compressionRatio: 0,
        strategy: 'none',
        qualityReport: {
          score: 100,
          passed: true,
          issues: [],
          recommendations: [],
          compressionRatio: 0,
          criticalInfoRetained: 1.0,
        },
      }
    }

    let compressedMessages: Message[]
    let summary: string | undefined
    let strategy: string

    if (action.action === 'microcompact') {
      compressedMessages = await this.executeMicrocompact(messages, action)
      strategy = `microcompact_${action.strategy}`
    } else if (action.action === 'smart_compact') {
      const result = await this.executeSmartCompact(messages, action)
      compressedMessages = result.messages
      summary = result.summary
      strategy = `smart_${action.strategy}`
    } else {
      // deep_compact
      const result = await this.executeDeepCompact(messages, action)
      compressedMessages = result.messages
      summary = result.summary
      strategy = `deep_${action.strategy}`
    }

    const compressionRatio = 1 - compressedMessages.length / originalCount

    return {
      messages: compressedMessages,
      summary,
      originalCount,
      compressedCount: compressedMessages.length,
      compressionRatio,
      strategy,
      qualityReport: {
        score: 85, // 暂时固定，后续实现质量检查
        passed: true,
        issues: [],
        recommendations: [],
        compressionRatio,
        criticalInfoRetained: 0.9,
      },
    }
  }

  /**
   * 执行微压缩
   */
  private async executeMicrocompact(
    messages: Message[],
    action: Extract<CompressionAction, { action: 'microcompact' }>
  ): Promise<Message[]> {
    const keepRecentCount = action.keepRecent

    // 保护最近的消息
    const recentMessages = messages.slice(-keepRecentCount)
    const oldMessages = messages.slice(0, -keepRecentCount)

    // 清理旧消息中的大型工具结果
    const cleaned = oldMessages.map(msg => {
      // 保护关键消息
      if (this.isCriticalMessage(msg)) {
        return msg
      }

      // 只清理工具结果
      if (msg.role !== 'tool') {
        return msg
      }

      const content = msg.content || ''
      const size = content.length

      // 小结果不处理
      if (size < 2000) {
        return msg
      }

      // 截断大结果
      const head = content.slice(0, 500)
      const tail = content.slice(-300)
      const truncated = `${head}\n\n... [微压缩：已省略 ${size - 800} 字符] ...\n\n${tail}`

      return {
        ...msg,
        content: truncated,
        contentBlocks: undefined, // 清理 blocks
      }
    })

    return [...cleaned, ...recentMessages]
  }

  /**
   * 执行智能压缩
   */
  private async executeSmartCompact(
    messages: Message[],
    action: Extract<CompressionAction, { action: 'smart_compact' }>
  ): Promise<{ messages: Message[]; summary?: string }> {
    // 分析消息重要性
    const importanceList = this.importanceAnalyzer.analyzeAll(messages)
    const importanceMap = new Map(importanceList.map(i => [i.messageId, i]))

    // 分组
    const groups = this.importanceAnalyzer.groupByCategory(importanceList)

    // 保留策略
    const toKeep: Message[] = []

    // 1. 完整保留最近N条
    const recentMessages = messages.slice(-action.keepRecent)
    toKeep.push(...recentMessages)

    // 2. 保留所有 critical 消息
    for (const item of groups.critical) {
      const msg = messages.find(m => m.id === item.messageId)
      if (msg && !toKeep.includes(msg)) {
        toKeep.push(msg)
      }
    }

    // 3. 保留部分 important 消息（根据策略）
    const importantRetentionRatio = this.getRetentionRatio(action.strategy, 'important')
    const importantToKeep = Math.ceil(groups.important.length * importantRetentionRatio)
    for (let i = 0; i < importantToKeep; i++) {
      const item = groups.important[i]
      const msg = messages.find(m => m.id === item.messageId)
      if (msg && !toKeep.includes(msg)) {
        toKeep.push(msg)
      }
    }

    // 4. 稀疏采样 normal 消息
    const normalRetentionRatio = this.getRetentionRatio(action.strategy, 'normal')
    const normalToKeep = Math.ceil(groups.normal.length * normalRetentionRatio)
    const normalStep = Math.max(1, Math.floor(groups.normal.length / normalToKeep))
    for (let i = 0; i < groups.normal.length; i += normalStep) {
      const item = groups.normal[i]
      const msg = messages.find(m => m.id === item.messageId)
      if (msg && !toKeep.includes(msg)) {
        toKeep.push(msg)
      }
    }

    // 5. 生成摘要（如果需要）
    let summary: string | undefined
    if (action.generateLightSummary && this.apiClient) {
      const toSummarize = messages.filter(m => !toKeep.includes(m))
      if (toSummarize.length > 10) {
        summary = await this.generateLightSummary(toSummarize)
      }
    }

    // 按原始顺序排序
    const kept = toKeep.sort((a, b) => {
      const indexA = messages.findIndex(m => m.id === a.id)
      const indexB = messages.findIndex(m => m.id === b.id)
      return indexA - indexB
    })

    // 如果有摘要，插入到开头
    if (summary) {
      const summaryMessage: Message = {
        id: `summary-${Date.now()}`,
        role: 'user',
        content: `[上下文智能压缩摘要]\n\n${summary}\n\n[以上是被压缩部分的摘要，下面继续保留的消息]`,
        timestamp: Date.now(),
        internal: true,
      }
      return { messages: [summaryMessage, ...kept], summary }
    }

    return { messages: kept }
  }

  /**
   * 执行深度压缩
   */
  private async executeDeepCompact(
    messages: Message[],
    action: Extract<CompressionAction, { action: 'deep_compact' }>
  ): Promise<{ messages: Message[]; summary: string }> {
    // 分析消息重要性
    const importanceList = this.importanceAnalyzer.analyzeAll(messages)
    const groups = this.importanceAnalyzer.groupByCategory(importanceList)

    // 保留最近N条
    const recentMessages = messages.slice(-action.keepRecent)

    // 保留所有 critical 消息
    const criticalMessages: Message[] = []
    for (const item of groups.critical) {
      const msg = messages.find(m => m.id === item.messageId)
      if (msg && !recentMessages.includes(msg)) {
        criticalMessages.push(msg)
      }
    }

    // 生成摘要
    const toSummarize = messages.slice(0, -action.keepRecent)
    const summary = this.apiClient
      ? await this.generateDeepSummary(toSummarize, action.summaryModel)
      : this.generateFallbackSummary(toSummarize)

    // 构造摘要消息
    const summaryMessage: Message = {
      id: `deep-summary-${Date.now()}`,
      role: 'user',
      content: `[深度压缩摘要 - 覆盖前 ${toSummarize.length} 条消息]\n\n${summary}\n\n[以下是保留的关键消息和最近消息]`,
      timestamp: Date.now(),
      internal: true,
    }

    // 按顺序组合：摘要 + 关键消息 + 最近消息
    const sortedCritical = criticalMessages.sort((a, b) => {
      const indexA = messages.findIndex(m => m.id === a.id)
      const indexB = messages.findIndex(m => m.id === b.id)
      return indexA - indexB
    })

    return {
      messages: [summaryMessage, ...sortedCritical, ...recentMessages],
      summary,
    }
  }

  /**
   * 判断是否是关键消息
   */
  private isCriticalMessage(msg: Message): boolean {
    const content = msg.content?.toLowerCase() || ''

    // 错误消息
    if (content.includes('error') || content.includes('exception')) {
      return true
    }

    // Task 消息
    if (msg.toolName?.startsWith('task_')) {
      return true
    }

    // 用户问答
    if (msg.toolName === 'ask_user_question') {
      return true
    }

    return false
  }

  /**
   * 获取保留比例
   */
  private getRetentionRatio(strategy: string, category: string): number {
    const ratios: Record<string, Record<string, number>> = {
      aggressive_tool_cleanup: {
        important: 0.3,
        normal: 0.1,
      },
      preserve_decisions: {
        important: 0.6,
        normal: 0.3,
      },
      preserve_error_path: {
        important: 0.7,
        normal: 0.2,
      },
      balanced: {
        important: 0.5,
        normal: 0.2,
      },
      aggressive: {
        important: 0.4,
        normal: 0.15,
      },
    }

    return ratios[strategy]?.[category] || 0.5
  }

  /**
   * 生成轻量级摘要
   */
  private async generateLightSummary(messages: Message[]): Promise<string> {
    if (!this.apiClient) {
      return this.generateFallbackSummary(messages)
    }

    try {
      const { summaryMessage } = await compactConversation(messages, this.apiClient, 'haiku')
      return summaryMessage.content
    } catch (error) {
      console.error('[SmartCompression] Failed to generate light summary:', error)
      return this.generateFallbackSummary(messages)
    }
  }

  /**
   * 生成深度摘要
   */
  private async generateDeepSummary(
    messages: Message[],
    model?: string
  ): Promise<string> {
    if (!this.apiClient) {
      return this.generateFallbackSummary(messages)
    }

    try {
      const { summaryMessage } = await compactConversation(
        messages,
        this.apiClient,
        model || 'haiku'
      )
      return summaryMessage.content
    } catch (error) {
      console.error('[SmartCompression] Failed to generate deep summary:', error)
      return this.generateFallbackSummary(messages)
    }
  }

  /**
   * 生成降级摘要（无API时）
   */
  private generateFallbackSummary(messages: Message[]): string {
    const userMessages = messages.filter(m => m.role === 'user')
    const toolCalls = messages.filter(m => m.toolCalls && m.toolCalls.length > 0)
    const errors = messages.filter(m => m.content?.toLowerCase().includes('error'))

    return `[自动生成摘要]

共 ${messages.length} 条消息被压缩：
- 用户消息: ${userMessages.length} 条
- 工具调用: ${toolCalls.length} 次
- 错误信息: ${errors.length} 条

关键文件: ${this.extractKeyFiles(messages).slice(0, 5).join(', ')}
`
  }

  /**
   * 提取关键文件
   */
  private extractKeyFiles(messages: Message[]): string[] {
    const files = new Set<string>()

    for (const msg of messages) {
      const content = msg.content || ''
      const matches = content.match(/[\w/\\.-]+\.(ts|js|json|md|py|java|go|rs|tsx|jsx)/gi)
      if (matches) {
        matches.forEach(f => files.add(f))
      }
    }

    return Array.from(files)
  }
}
