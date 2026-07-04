/**
 * TaskListTool - 列出任务工具
 *
 * 职责：
 * AI Agent 调用此工具来查看所有任务、按状态过滤任务、或查看可执行的任务
 *
 * 使用场景：
 * - 查看当前所有任务的概览
 * - 筛选特定状态的任务（如只看待开始的任务）
 * - 查看哪些任务可以立即开始执行（没有依赖阻塞）
 * - 检查任务完成进度
 *
 * 示例：
 * task_list() // 列出所有任务
 * task_list({ status: "pending" }) // 只列出待开始的任务
 * task_list({ status: "in_progress" }) // 只列出进行中的任务
 * task_list({ availableOnly: true }) // 只列出可执行的任务（无依赖阻塞）
 *
 * 参数：
 * - status: 按状态过滤（可选）
 * - availableOnly: 只显示可执行的任务（可选）
 */

import { Tool, ToolDefinition, ToolResult } from '../base/Tool'
import type { TaskManager } from '../../../services/task/TaskManager'
import type { TaskStatus, TaskItem } from '../../../types'

export class TaskListTool extends Tool {
  readonly name = 'task_list'
  readonly description =
    '列出任务。可以查看所有任务、按状态筛选、或只查看可立即执行的任务（无依赖阻塞）。用于了解任务进度和下一步工作。'

  /**
   * 构造函数
   *
   * @param taskManager - 任务管理服务
   */
  constructor(private taskManager: TaskManager) {
    super()
  }

  /**
   * 获取工具定义
   *
   * @returns Anthropic 工具定义
   */
  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description:
              '按状态过滤任务。可选值：pending（待开始）、in_progress（进行中）、completed（已完成）。不提供则返回所有任务。',
            enum: ['pending', 'in_progress', 'completed']
          },
          availableOnly: {
            type: 'boolean',
            description:
              '是否只显示可立即执行的任务（状态为 pending 且没有依赖阻塞）。设置为 true 可以快速找到下一步可以开始的任务。'
          }
        },
        required: []
      }
    }
  }

  /**
   * 执行工具 - 列出任务
   *
   * @param args - 工具参数
   * @returns 执行结果
   */
  async execute(args: {
    status?: TaskStatus
    availableOnly?: boolean
  }): Promise<ToolResult> {
    try {
      // 获取任务列表
      let tasks: TaskItem[]

      if (args.availableOnly) {
        // 只获取可执行的任务
        tasks = this.taskManager.listAvailableTasks()
      } else if (args.status) {
        // 按状态过滤
        const validStatuses: TaskStatus[] = ['pending', 'in_progress', 'completed', 'deleted']
        if (!validStatuses.includes(args.status)) {
          return this.createErrorResult(`无效的状态: ${args.status}`)
        }
        tasks = this.taskManager.listTasksByStatus(args.status)
      } else {
        // 获取所有任务（排除已删除）
        tasks = this.taskManager.listTasks().filter((task) => task.status !== 'deleted')
      }

      // 如果没有任务
      if (tasks.length === 0) {
        const filterText = args.availableOnly
          ? '可执行'
          : args.status
            ? `状态为 ${this.formatStatus(args.status)}`
            : ''
        return this.createSuccessResult(
          `当前没有${filterText}任务。\n\n提示: 使用 task_create 创建新任务。`,
          {
            totalCount: 0,
            tasks: []
          }
        )
      }

      // 按状态分组统计
      const stats = this.calculateStats(this.taskManager.listTasks())

      // 格式化任务列表
      const taskLines = tasks.map((task, index) => {
        const statusIcon = this.getStatusIcon(task.status)
        const blockedInfo =
          task.blockedBy.length > 0
            ? ` 🔒 (依赖 ${task.blockedBy.length} 个任务)`
            : task.status === 'pending'
              ? ' ✨ (可开始)'
              : ''

        return `${index + 1}. ${statusIcon} ${task.subject}${blockedInfo}
   ID: ${task.id}
   描述: ${this.truncateText(task.description, 100)}
   创建时间: ${task.createdAt}`
      })

      const filterText = args.availableOnly
        ? '可立即执行的任务'
        : args.status
          ? `状态为 ${this.formatStatus(args.status)} 的任务`
          : '所有任务'

      const content = `📋 任务列表 (${filterText})

找到 ${tasks.length} 个任务:

${taskLines.join('\n\n')}

---
任务统计:
- ⏳ 待开始: ${stats.pending} 个 (其中 ${stats.available} 个可立即执行)
- 🔄 进行中: ${stats.inProgress} 个
- ✅ 已完成: ${stats.completed} 个
- 总计: ${stats.total} 个

提示: 使用 task_get 查看任务详情，使用 task_update 更新任务状态。`

      return this.createSuccessResult(content, {
        totalCount: tasks.length,
        tasks: tasks.map((task) => ({
          id: task.id,
          subject: task.subject,
          status: task.status,
          blockedBy: task.blockedBy,
          blocks: task.blocks
        })),
        stats
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 计算任务统计信息
   *
   * @param tasks - 任务列表
   * @returns 统计信息
   */
  private calculateStats(tasks: TaskItem[]): {
    total: number
    pending: number
    inProgress: number
    completed: number
    available: number
  } {
    const activeTasks = tasks.filter((task) => task.status !== 'deleted')

    return {
      total: activeTasks.length,
      pending: activeTasks.filter((task) => task.status === 'pending').length,
      inProgress: activeTasks.filter((task) => task.status === 'in_progress').length,
      completed: activeTasks.filter((task) => task.status === 'completed').length,
      available: activeTasks.filter(
        (task) => task.status === 'pending' && task.blockedBy.length === 0
      ).length
    }
  }

  /**
   * 获取状态图标
   *
   * @param status - 任务状态
   * @returns 图标
   */
  private getStatusIcon(status: string): string {
    const iconMap: Record<string, string> = {
      pending: '⏳',
      in_progress: '🔄',
      completed: '✅',
      deleted: '🗑️'
    }
    return iconMap[status] || '❓'
  }

  /**
   * 格式化任务状态
   *
   * @param status - 任务状态
   * @returns 友好的状态描述
   */
  private formatStatus(status: string): string {
    const statusMap: Record<string, string> = {
      pending: '待开始',
      in_progress: '进行中',
      completed: '已完成',
      deleted: '已删除'
    }
    return statusMap[status] || status
  }

  /**
   * 截断文本
   *
   * @param text - 原文本
   * @param maxLength - 最大长度
   * @returns 截断后的文本
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text
    }
    return text.substring(0, maxLength) + '...'
  }
}
