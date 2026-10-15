/**
 * 智能压缩决策器
 *
 * 根据上下文健康度自动决定压缩策略
 */

import type { Message } from '../../../types'
import type { CompressionAction, ConversationType, HealthMetrics, ToolUsageStats } from './types'
import { ContextHealthMonitor } from './HealthMonitor'

export class SmartCompressionDecider {
  constructor(private monitor: ContextHealthMonitor) {}

  /**
   * 决定压缩动作
   */
  async decide(messages: Message[]): Promise<CompressionAction> {
    const health = this.monitor.getMetrics()
    const usage = health.currentUsage

    // ════════════════════════════════════════════
    // 阶段 0：健康状态，无需干预
    // ════════════════════════════════════════════
    if (usage < 0.30) {
      return { action: 'none' }
    }

    // ════════════════════════════════════════════
    // 阶段 1：预防性维护（30-50%）
    // ════════════════════════════════════════════
    if (usage >= 0.30 && usage < 0.50) {
      return {
        action: 'microcompact',
        strategy: 'light_cleanup',
        keepRecent: 50,
        cleanupRatio: 0.2,
      }
    }

    // ════════════════════════════════════════════
    // 阶段 2：主动优化（50-70%）
    // ════════════════════════════════════════════
    if (usage >= 0.50 && usage < 0.70) {
      const conversationType = this.analyzeConversationType(messages)

      if (conversationType === 'search_heavy') {
        return {
          action: 'smart_compact',
          strategy: 'aggressive_tool_cleanup',
          keepRecent: 25,
          priorityTypes: ['error', 'task', 'user_question'],
          toolResultRetention: 0.1,
        }
      }

      if (conversationType === 'code_generation') {
        return {
          action: 'smart_compact',
          strategy: 'preserve_decisions',
          keepRecent: 35,
          priorityTypes: ['code_change', 'decision', 'error', 'task'],
          toolResultRetention: 0.3,
        }
      }

      if (conversationType === 'debugging') {
        return {
          action: 'smart_compact',
          strategy: 'preserve_error_path',
          keepRecent: 30,
          priorityTypes: ['error', 'fix_attempt', 'success'],
          errorRetention: 1.0,
        }
      }

      // 默认：平衡策略
      return {
        action: 'smart_compact',
        strategy: 'balanced',
        keepRecent: 30,
        layeredSampling: true,
      }
    }

    // ════════════════════════════════════════════
    // 阶段 3：紧急干预（70-85%）
    // ════════════════════════════════════════════
    if (usage >= 0.70 && usage < 0.85) {
      // 预测性检查：未来2-3轮会不会爆
      const projected = this.monitor.predictFutureUsage(3)

      if (projected > 0.90) {
        // 危险！立即深度压缩
        return {
          action: 'deep_compact',
          strategy: 'emergency',
          generateSummary: true,
          keepRecent: 20,
          keepCritical: true,
          targetUsage: 0.45,
        }
      } else {
        // 还有时间，温和处理
        return {
          action: 'smart_compact',
          strategy: 'aggressive',
          generateLightSummary: true,
          keepRecent: 25,
          targetUsage: 0.55,
        }
      }
    }

    // ════════════════════════════════════════════
    // 阶段 4：危机处理（85%+）
    // ════════════════════════════════════════════
    if (usage >= 0.85) {
      console.warn('[SmartCompression] Emergency: usage at', (usage * 100).toFixed(1) + '%')

      return {
        action: 'deep_compact',
        strategy: 'maximum',
        generateSummary: true,
        summaryModel: 'sonnet',
        keepRecent: 15,
        keepCritical: true,
        aggressiveToolCleanup: true,
        targetUsage: 0.40,
      }
    }

    return { action: 'none' }
  }

  /**
   * 分析对话类型
   */
  private analyzeConversationType(messages: Message[]): ConversationType {
    const tools = this.monitor.extractToolUsage(messages)

    if (tools.total === 0) {
      return 'general'
    }

    const ratios = {
      search: (tools.grep + tools.glob + tools.find + tools.read_file) / tools.total,
      code: (tools.write_file + tools.edit_file) / tools.total,
      execution: tools.bash / tools.total,
      error:
        messages.filter(
          m =>
            m.content?.toLowerCase().includes('error') ||
            m.content?.toLowerCase().includes('failed')
        ).length / messages.length,
    }

    if (ratios.search > 0.5) return 'search_heavy'
    if (ratios.code > 0.4) return 'code_generation'
    if (ratios.error > 0.3) return 'debugging'
    if (ratios.execution > 0.4) return 'automation'

    return 'general'
  }

  /**
   * 获取决策说明（用于日志）
   */
  getDecisionExplanation(action: CompressionAction, health: HealthMetrics): string {
    const usage = (health.currentUsage * 100).toFixed(1) + '%'

    if (action.action === 'none') {
      return `上下文健康 (${usage})，无需压缩`
    }

    if (action.action === 'microcompact') {
      return `轻量清理 (${usage})，保留最近 ${action.keepRecent} 条消息`
    }

    if (action.action === 'smart_compact') {
      return `智能压缩 (${usage})，策略: ${action.strategy}，保留 ${action.keepRecent} 条`
    }

    if (action.action === 'deep_compact') {
      return `深度压缩 (${usage})，策略: ${action.strategy}，目标: ${(action.targetUsage * 100).toFixed(0)}%`
    }

    return '未知动作'
  }
}
