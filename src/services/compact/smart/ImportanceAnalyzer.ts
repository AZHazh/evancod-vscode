/**
 * 消息重要性分析器
 *
 * 自动给每条消息打分，识别关键信息
 */

import type { Message } from '../../../types'
import type { MessageImportance } from './types'

export class MessageImportanceAnalyzer {
  /**
   * 计算消息重要性
   */
  calculateImportance(message: Message, allMessages: Message[]): MessageImportance {
    let score = 50 // 基础分
    const reasons: string[] = []

    // ════════════════════════════════════════
    // 规则 1：消息类型
    // ════════════════════════════════════════
    if (message.role === 'user') {
      score += 20
      reasons.push('用户消息')
    }

    const content = message.content?.toLowerCase() || ''

    // ════════════════════════════════════════
    // 规则 2：内容特征
    // ════════════════════════════════════════

    // 错误信息：非常重要
    if (
      content.includes('error') ||
      content.includes('exception') ||
      content.includes('failed') ||
      content.includes('错误') ||
      content.includes('失败')
    ) {
      score += 30
      reasons.push('包含错误信息')
    }

    // 成功信息：记录里程碑
    if (
      content.includes('success') ||
      content.includes('completed') ||
      content.includes('成功') ||
      content.includes('完成')
    ) {
      score += 15
      reasons.push('标记成功/完成')
    }

    // 决策点
    if (content.match(/决定|选择|采用|使用.*方案|decided|chose|using/i)) {
      score += 20
      reasons.push('包含决策点')
    }

    // 用户简短确认（不太重要）
    if (
      message.role === 'user' &&
      content.length < 20 &&
      content.match(/^(好|对|是|继续|ok|yes|y|👍)/i)
    ) {
      score -= 20
      reasons.push('简短确认')
    }

    // ════════════════════════════════════════
    // 规则 3：工具调用类型
    // ════════════════════════════════════════
    if (message.toolName) {
      const toolScores: Record<string, number> = {
        // 高价值工具
        task_create: 25,
        task_update: 20,
        ask_user_question: 30,
        write_file: 15,
        edit_file: 15,
        agent: 20,
        skill: 15,

        // 中价值工具
        bash: 5,
        git: 10,
        image_gen: 10,

        // 低价值工具（可重新执行）
        read_file: -10,
        grep: -15,
        glob: -15,
        find: -15,
        list_directory: -20,
        web_search: -10,
        web_fetch: -10,
      }

      const toolScore = toolScores[message.toolName] || 0
      if (toolScore !== 0) {
        score += toolScore
        reasons.push(`工具: ${message.toolName} (${toolScore > 0 ? '+' : ''}${toolScore})`)
      }
    }

    // ════════════════════════════════════════
    // 规则 4：工具结果大小
    // ════════════════════════════════════════
    if (message.role === 'tool') {
      const size = message.content?.length || 0

      if (size > 10000) {
        score -= 20
        reasons.push('超大结果（可重新获取）')
      } else if (size > 5000) {
        score -= 10
        reasons.push('大结果')
      }

      // 但如果包含错误，重要性提升
      if (content.includes('error') || content.includes('failed')) {
        score += 25 // 抵消大小的负分
        reasons.push('工具结果包含错误（重要）')
      }
    }

    // ════════════════════════════════════════
    // 规则 5：时间衰减
    // ════════════════════════════════════════
    const age = this.getMessageAge(message, allMessages)
    const recencyBonus = Math.max(0, 20 - age * 2) // 越新越重要
    if (recencyBonus > 0) {
      score += recencyBonus
      reasons.push(`最近第 ${age} 条 (+${recencyBonus.toFixed(0)})`)
    }

    // ════════════════════════════════════════
    // 规则 6：引用次数
    // ════════════════════════════════════════
    const referenceCount = this.countReferences(message, allMessages)
    if (referenceCount > 0) {
      const bonus = Math.min(20, referenceCount * 5)
      score += bonus
      reasons.push(`被引用 ${referenceCount} 次 (+${bonus})`)
    }

    // ════════════════════════════════════════
    // 规则 7：上下文锚点
    // ════════════════════════════════════════
    if (this.isContextAnchor(message, allMessages)) {
      score += 15
      reasons.push('上下文锚点')
    }

    // ════════════════════════════════════════
    // 规则 8：唯一性
    // ════════════════════════════════════════
    if (this.isDuplicate(message, allMessages)) {
      score -= 15
      reasons.push('重复/冗余')
    }

    // ════════════════════════════════════════
    // 规则 9：Task 相关
    // ════════════════════════════════════════
    if (message.toolName?.startsWith('task_')) {
      score += 15
      reasons.push('Task 管理')
    }

    // 最终分数
    const finalScore = Math.max(0, Math.min(100, score))

    // 分类
    let category: MessageImportance['category']
    if (finalScore >= 80) category = 'critical'
    else if (finalScore >= 60) category = 'important'
    else if (finalScore >= 40) category = 'normal'
    else if (finalScore >= 20) category = 'low'
    else category = 'redundant'

    return {
      messageId: message.id,
      score: finalScore,
      reasons,
      category,
    }
  }

  /**
   * 批量分析消息重要性
   */
  analyzeAll(messages: Message[]): MessageImportance[] {
    return messages.map(msg => this.calculateImportance(msg, messages))
  }

  /**
   * 获取消息年龄（从最新算起）
   */
  private getMessageAge(message: Message, allMessages: Message[]): number {
    const index = allMessages.findIndex(m => m.id === message.id)
    if (index === -1) return 999
    return allMessages.length - index - 1
  }

  /**
   * 计算被引用次数
   */
  private countReferences(message: Message, allMessages: Message[]): number {
    const keyTerms = this.extractKeyTerms(message)
    if (keyTerms.length === 0) return 0

    const messageIndex = allMessages.findIndex(m => m.id === message.id)
    if (messageIndex === -1) return 0

    const laterMessages = allMessages.slice(messageIndex + 1)

    return laterMessages.filter(m =>
      keyTerms.some(term => m.content?.toLowerCase().includes(term.toLowerCase()))
    ).length
  }

  /**
   * 提取关键词
   */
  private extractKeyTerms(message: Message): string[] {
    const content = message.content || ''
    const terms: string[] = []

    // 提取文件路径
    const pathMatches = content.match(/[\w/\\.-]+\.(ts|js|json|md|py|java|go|rs|tsx|jsx)/gi)
    if (pathMatches) {
      terms.push(...pathMatches.map(p => p.toLowerCase()))
    }

    // 提取函数名（简单模式）
    const funcMatches = content.match(/\b([a-z_][a-z0-9_]{2,})\s*\(/gi)
    if (funcMatches) {
      terms.push(...funcMatches.map(f => f.replace(/\s*\(/g, '').toLowerCase()))
    }

    // 提取错误类型
    const errorMatches = content.match(/\b([A-Z][a-zA-Z]*Error|Exception)\b/g)
    if (errorMatches) {
      terms.push(...errorMatches.map(e => e.toLowerCase()))
    }

    return [...new Set(terms)] // 去重
  }

  /**
   * 判断是否是上下文锚点
   */
  private isContextAnchor(message: Message, allMessages: Message[]): boolean {
    const referenceCount = this.countReferences(message, allMessages)
    return referenceCount >= 3 // 被引用3次以上
  }

  /**
   * 判断是否重复
   */
  private isDuplicate(message: Message, allMessages: Message[]): boolean {
    const content = message.content || ''
    if (content.length < 20) return false // 太短的不判断

    const similar = allMessages.filter(m => {
      if (m.id === message.id) return false
      if (!m.content) return false

      // 简单相似度：计算相同词的比例
      const words1 = new Set(content.toLowerCase().split(/\s+/))
      const words2 = new Set(m.content.toLowerCase().split(/\s+/))

      const intersection = new Set([...words1].filter(w => words2.has(w)))
      const union = new Set([...words1, ...words2])

      const similarity = intersection.size / union.size
      return similarity > 0.7
    })

    return similar.length > 0
  }

  /**
   * 根据重要性排序消息
   */
  sortByImportance(
    messages: Message[],
    importanceMap: Map<string, MessageImportance>
  ): Message[] {
    return [...messages].sort((a, b) => {
      const scoreA = importanceMap.get(a.id)?.score || 0
      const scoreB = importanceMap.get(b.id)?.score || 0
      return scoreB - scoreA // 降序
    })
  }

  /**
   * 按类别分组
   */
  groupByCategory(importanceList: MessageImportance[]): Record<string, MessageImportance[]> {
    const groups: Record<string, MessageImportance[]> = {
      critical: [],
      important: [],
      normal: [],
      low: [],
      redundant: [],
    }

    for (const item of importanceList) {
      groups[item.category].push(item)
    }

    return groups
  }
}
