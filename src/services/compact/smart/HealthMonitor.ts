/**
 * 上下文健康度监控器
 *
 * 持续监控系统指标，自动计算安全边界
 */

import type { Message, TokenUsage } from '../../../types'
import type { HealthMetrics, ToolUsageStats } from './types'
import { estimateMessagesTokens } from '../microcompact'

export class ContextHealthMonitor {
  private metrics: HealthMetrics = {
    currentUsage: 0,
    currentTokens: 0,
    effectiveWindow: 1_000_000,
    growthRate: [],
    volatility: 0,
    messageCount: 0,
    avgMessageSize: 0,
    toolResultRatio: 0,
    imageCount: 0,
    codeBlockRatio: 0,
    serverUsageAccuracy: 0.5,
    estimateErrorRate: 0.2,
    hasServerUsage: false,
    taskComplexity: 0.5,
    contextDependency: 0.5,
    compactSuccessRate: 0.8,
    userRetryRate: 0.1,
  }

  private previousTokens: number = 0
  private compactHistory: Array<{ success: boolean; timestamp: number }> = []

  /**
   * 更新健康度指标
   */
  update(
    messages: Message[],
    tokenUsage: TokenUsage | undefined,
    effectiveWindow: number
  ): void {
    this.metrics.messageCount = messages.length
    this.metrics.effectiveWindow = effectiveWindow

    // 计算 token 使用
    const estimatedTokens = estimateMessagesTokens(messages)
    const serverTokens = tokenUsage?.lastTotalTokens || 0

    this.metrics.hasServerUsage = serverTokens > 0
    this.metrics.currentTokens = Math.max(serverTokens, estimatedTokens)
    this.metrics.currentUsage = this.metrics.currentTokens / effectiveWindow

    // 计算服务端准确度
    if (serverTokens > 0 && estimatedTokens > 0) {
      const error = Math.abs(serverTokens - estimatedTokens) / Math.max(serverTokens, estimatedTokens)
      this.metrics.estimateErrorRate = error
      this.metrics.serverUsageAccuracy = 1 - error
    } else if (serverTokens === 0) {
      this.metrics.serverUsageAccuracy = 0
      this.metrics.hasServerUsage = false
    }

    // 记录增长率
    if (this.previousTokens > 0) {
      const growth = this.metrics.currentTokens - this.previousTokens
      this.metrics.growthRate.push(growth)
      if (this.metrics.growthRate.length > 5) {
        this.metrics.growthRate.shift()
      }

      // 计算波动性
      if (this.metrics.growthRate.length >= 3) {
        this.metrics.volatility = this.calculateVolatility(this.metrics.growthRate)
      }
    }
    this.previousTokens = this.metrics.currentTokens

    // 分析消息特征
    this.analyzeMessages(messages)
  }

  /**
   * 分析消息特征
   */
  private analyzeMessages(messages: Message[]): void {
    let totalSize = 0
    let toolResultCount = 0
    let imageCount = 0
    let codeBlockCount = 0

    for (const msg of messages) {
      const contentLength = msg.content?.length || 0
      totalSize += contentLength

      // 统计工具结果
      if (msg.role === 'tool') {
        toolResultCount++
      }

      // 统计图片
      if (msg.contentBlocks) {
        for (const block of msg.contentBlocks) {
          if (block.type === 'image' || block.source?.data) {
            imageCount++
          }
        }
      }

      // 统计代码块
      if (msg.content?.includes('```')) {
        codeBlockCount++
      }
    }

    this.metrics.avgMessageSize = messages.length > 0 ? totalSize / messages.length : 0
    this.metrics.toolResultRatio = messages.length > 0 ? toolResultCount / messages.length : 0
    this.metrics.imageCount = imageCount
    this.metrics.codeBlockRatio = messages.length > 0 ? codeBlockCount / messages.length : 0

    // 评估任务复杂度
    this.metrics.taskComplexity = this.assessComplexity(messages)
    this.metrics.contextDependency = this.assessDependency(messages)
  }

  /**
   * 评估任务复杂度
   */
  private assessComplexity(messages: Message[]): number {
    let score = 0.3 // 基础分

    // 消息数量
    if (messages.length > 100) score += 0.2
    else if (messages.length > 50) score += 0.1

    // 工具调用多样性
    const toolTypes = new Set(
      messages.filter(m => m.toolName).map(m => m.toolName)
    )
    score += Math.min(0.3, toolTypes.size * 0.05)

    // 错误数量
    const errorCount = messages.filter(
      m => m.content?.toLowerCase().includes('error')
    ).length
    score += Math.min(0.2, errorCount * 0.02)

    return Math.min(1, score)
  }

  /**
   * 评估上下文依赖度
   */
  private assessDependency(messages: Message[]): number {
    // 检查最近消息是否频繁引用历史
    const recentMessages = messages.slice(-20)
    let referenceCount = 0

    for (const msg of recentMessages) {
      const content = msg.content?.toLowerCase() || ''
      // 检查引用词汇
      if (
        content.includes('之前') ||
        content.includes('前面') ||
        content.includes('earlier') ||
        content.includes('previous')
      ) {
        referenceCount++
      }
    }

    return Math.min(1, referenceCount / 10)
  }

  /**
   * 计算波动性
   */
  private calculateVolatility(values: number[]): number {
    if (values.length < 2) return 0

    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length

    const stdDev = Math.sqrt(variance)
    return mean > 0 ? stdDev / mean : 0
  }

  /**
   * 计算安全边界
   */
  calculateSafeThreshold(): number {
    const base = 0.85 // 基础：不超过85%

    let adjustment = 0

    // 如果 API 的 usage 不准确，留更多余地
    if (this.metrics.serverUsageAccuracy < 0.5) {
      adjustment -= 0.15 // 降到70%
    } else if (this.metrics.serverUsageAccuracy < 0.8) {
      adjustment -= 0.08 // 降到77%
    }

    // 如果最近增长很快，提前刹车
    const avgGrowth = this.getAverageGrowth()
    if (avgGrowth > 50000) {
      adjustment -= 0.1
    } else if (avgGrowth > 30000) {
      adjustment -= 0.05
    }

    // 如果包含大量图片/代码，更保守
    if (this.metrics.imageCount > 5 || this.metrics.codeBlockRatio > 0.4) {
      adjustment -= 0.05
    }

    // 如果历史压缩效果好，可以更激进
    if (this.metrics.compactSuccessRate > 0.9) {
      adjustment += 0.05
    }

    // 如果增长波动大，更保守
    if (this.metrics.volatility > 0.5) {
      adjustment -= 0.05
    }

    return Math.max(0.65, Math.min(0.90, base + adjustment))
  }

  /**
   * 预测未来使用率
   */
  predictFutureUsage(rounds: number): number {
    if (this.metrics.growthRate.length < 2) {
      return this.metrics.currentUsage
    }

    const avgGrowth = this.getAverageGrowth()
    const safetyFactor = 1 + this.metrics.volatility // 波动大的留更多余地

    const projectedTokens =
      this.metrics.currentTokens + avgGrowth * rounds * safetyFactor

    return projectedTokens / this.metrics.effectiveWindow
  }

  /**
   * 获取平均增长率
   */
  getAverageGrowth(): number {
    if (this.metrics.growthRate.length === 0) return 0
    return (
      this.metrics.growthRate.reduce((a, b) => a + b, 0) / this.metrics.growthRate.length
    )
  }

  /**
   * 记录压缩结果
   */
  recordCompaction(success: boolean): void {
    this.compactHistory.push({
      success,
      timestamp: Date.now(),
    })

    // 只保留最近10次
    if (this.compactHistory.length > 10) {
      this.compactHistory.shift()
    }

    // 更新成功率
    const successCount = this.compactHistory.filter(h => h.success).length
    this.metrics.compactSuccessRate = successCount / this.compactHistory.length
  }

  /**
   * 获取当前指标
   */
  getMetrics(): HealthMetrics {
    return { ...this.metrics }
  }

  /**
   * 提取工具使用统计
   */
  extractToolUsage(messages: Message[]): ToolUsageStats {
    const stats: ToolUsageStats = {
      grep: 0,
      glob: 0,
      find: 0,
      read_file: 0,
      write_file: 0,
      edit_file: 0,
      bash: 0,
      task_create: 0,
      task_update: 0,
      ask_user_question: 0,
      total: 0,
    }

    for (const msg of messages) {
      if (msg.toolName) {
        const tool = msg.toolName as keyof ToolUsageStats
        if (tool in stats) {
          stats[tool]++
        }
        stats.total++
      }
    }

    return stats
  }
}
