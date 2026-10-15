/**
 * 智能压缩系统 - 类型定义
 */

import type { Message } from '../../../types'

/**
 * 健康度指标
 */
export interface HealthMetrics {
  // 上下文健康度
  currentUsage: number // 当前使用率 (0-1)
  currentTokens: number // 当前 token 数
  effectiveWindow: number // 有效上下文窗口
  growthRate: number[] // 最近5轮的增长速率
  volatility: number // 增长波动性

  // 消息质量指标
  messageCount: number
  avgMessageSize: number
  toolResultRatio: number
  imageCount: number
  codeBlockRatio: number

  // API 行为指标
  serverUsageAccuracy: number // 服务端 usage 准确度 (0-1)
  estimateErrorRate: number // 估算误差率
  hasServerUsage: boolean // 是否有服务端 usage

  // 任务特征
  taskComplexity: number // 任务复杂度 (0-1)
  contextDependency: number // 上下文依赖度 (0-1)

  // 历史表现
  compactSuccessRate: number // 压缩成功率
  userRetryRate: number // 用户重试率
}

/**
 * 压缩动作
 */
export type CompressionAction =
  | { action: 'none' }
  | {
      action: 'microcompact'
      strategy: 'light_cleanup'
      keepRecent: number
      cleanupRatio: number
    }
  | {
      action: 'smart_compact'
      strategy:
        | 'aggressive_tool_cleanup'
        | 'preserve_decisions'
        | 'preserve_error_path'
        | 'balanced'
        | 'aggressive'
      keepRecent: number
      priorityTypes?: string[]
      toolResultRetention?: number
      errorRetention?: number
      layeredSampling?: boolean
      generateLightSummary?: boolean
      targetUsage?: number
    }
  | {
      action: 'deep_compact'
      strategy: 'emergency' | 'maximum'
      generateSummary: boolean
      summaryModel?: string
      keepRecent: number
      keepCritical: boolean
      aggressiveToolCleanup?: boolean
      targetUsage: number
    }

/**
 * 对话类型
 */
export type ConversationType =
  | 'search_heavy' // 搜索密集
  | 'code_generation' // 代码生成
  | 'debugging' // 调试
  | 'automation' // 自动化
  | 'general' // 通用

/**
 * 消息重要性得分
 */
export interface MessageImportance {
  messageId: string
  score: number // 0-100
  reasons: string[] // 评分原因
  category: 'critical' | 'important' | 'normal' | 'low' | 'redundant'
}

/**
 * 压缩质量报告
 */
export interface QualityReport {
  score: number // 0-100
  passed: boolean
  issues: QualityIssue[]
  recommendations: string[]
  compressionRatio: number
  criticalInfoRetained: number
}

export interface QualityIssue {
  severity: 'high' | 'medium' | 'low'
  message: string
  details?: unknown
}

/**
 * 压缩结果
 */
export interface CompressionResult {
  messages: Message[]
  summary?: string
  originalCount: number
  compressedCount: number
  compressionRatio: number
  strategy: string
  qualityReport: QualityReport
}

/**
 * 工具使用统计
 */
export interface ToolUsageStats {
  grep: number
  glob: number
  find: number
  read_file: number
  write_file: number
  edit_file: number
  bash: number
  task_create: number
  task_update: number
  ask_user_question: number
  total: number
}
