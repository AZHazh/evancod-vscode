/**
 * 智能压缩系统 - 主入口
 *
 * 零配置，全自动，自适应的上下文压缩系统
 */

import type { Message, TokenUsage, Provider } from '../../../types'
import type { CompressionResult } from './types'
import { ContextHealthMonitor } from './HealthMonitor'
import { MessageImportanceAnalyzer } from './ImportanceAnalyzer'
import { SmartCompressionDecider } from './CompressionDecider'
import { CompressionExecutor } from './CompressionExecutor'
import { createApiClient } from '../../../core/services/api'

export interface SmartCompressionConfig {
  provider?: Provider
  model?: string
  verbose?: boolean
}

export class SmartCompressionSystem {
  private monitor: ContextHealthMonitor
  private analyzer: MessageImportanceAnalyzer
  private decider: SmartCompressionDecider
  private executor: CompressionExecutor

  private lastCheckUsage: number = 0
  private compressionCount: number = 0

  constructor(private config: SmartCompressionConfig = {}) {
    this.monitor = new ContextHealthMonitor()
    this.analyzer = new MessageImportanceAnalyzer()
    this.decider = new SmartCompressionDecider(this.monitor)

    // 创建 API 客户端用于生成摘要
    const apiClient = this.config.provider
      ? createApiClient({
          provider: this.config.provider,
          model: this.config.provider.models.haiku || this.config.model || 'claude-3-haiku-20240307',
          effortLevel: 'low',
        })
      : undefined

    this.executor = new CompressionExecutor(this.analyzer, apiClient)
  }

  /**
   * 检查并压缩（主入口）
   *
   * 每轮调用此方法，系统自动决定是否需要压缩
   */
  async checkAndCompress(
    messages: Message[],
    tokenUsage: TokenUsage | undefined,
    effectiveWindow: number
  ): Promise<CompressionResult | null> {
    // 更新健康度指标
    this.monitor.update(messages, tokenUsage, effectiveWindow)

    const metrics = this.monitor.getMetrics()

    // 决定是否需要压缩
    const action = await this.decider.decide(messages)

    if (action.action === 'none') {
      // 日志记录（verbose 模式）
      if (this.config.verbose && Math.abs(metrics.currentUsage - this.lastCheckUsage) > 0.05) {
        console.log('[SmartCompression] 健康检查:', {
          usage: (metrics.currentUsage * 100).toFixed(1) + '%',
          tokens: metrics.currentTokens,
          messages: metrics.messageCount,
          decision: '无需压缩',
        })
        this.lastCheckUsage = metrics.currentUsage
      }
      return null
    }

    // 执行压缩
    console.log('[SmartCompression] 开始压缩:', {
      usage: (metrics.currentUsage * 100).toFixed(1) + '%',
      action: action.action,
      strategy: 'strategy' in action ? action.strategy : undefined,
      explanation: this.decider.getDecisionExplanation(action, metrics),
    })

    try {
      const result = await this.executor.execute(messages, action)

      this.compressionCount++
      this.monitor.recordCompaction(result.qualityReport.passed)

      console.log('[SmartCompression] 压缩完成:', {
        original: result.originalCount,
        compressed: result.compressedCount,
        ratio: (result.compressionRatio * 100).toFixed(1) + '%',
        quality: result.qualityReport.score,
        strategy: result.strategy,
      })

      return result
    } catch (error) {
      console.error('[SmartCompression] 压缩失败:', error)
      this.monitor.recordCompaction(false)
      return null
    }
  }

  /**
   * 强制压缩（手动触发）
   */
  async forceCompress(
    messages: Message[],
    tokenUsage: TokenUsage | undefined,
    effectiveWindow: number,
    strategy: 'light' | 'balanced' | 'aggressive' = 'balanced'
  ): Promise<CompressionResult> {
    // 更新健康度
    this.monitor.update(messages, tokenUsage, effectiveWindow)

    // 根据策略构造动作
    let action
    if (strategy === 'light') {
      action = {
        action: 'smart_compact' as const,
        strategy: 'balanced' as const,
        keepRecent: 40,
        layeredSampling: true,
      }
    } else if (strategy === 'aggressive') {
      action = {
        action: 'deep_compact' as const,
        strategy: 'maximum' as const,
        generateSummary: true,
        keepRecent: 20,
        keepCritical: true,
        targetUsage: 0.40,
      }
    } else {
      action = {
        action: 'smart_compact' as const,
        strategy: 'balanced' as const,
        keepRecent: 30,
        generateLightSummary: true,
        layeredSampling: true,
      }
    }

    const result = await this.executor.execute(messages, action)
    this.monitor.recordCompaction(result.qualityReport.passed)

    return result
  }

  /**
   * 获取压缩统计
   */
  getStats() {
    return {
      compressionCount: this.compressionCount,
      metrics: this.monitor.getMetrics(),
    }
  }

  /**
   * 重置统计
   */
  reset(): void {
    this.compressionCount = 0
    this.lastCheckUsage = 0
  }
}
