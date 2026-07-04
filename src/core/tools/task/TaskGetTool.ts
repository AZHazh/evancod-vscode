/**
 * TaskGetTool - 获取任务详情工具
 *
 * 职责：
 * AI Agent 调用此工具来查看单个任务的完整详细信息
 *
 * 使用场景：
 * - 查看任务的完整描述和上下文
 * - 了解任务的依赖关系
 * - 检查任务的元数据
 * - 在开始执行任务前获取详细信息
 *
 * 示例：
 * task_get({ taskId: "task-123" })
 *
 * 参数：
 * - taskId: 任务 ID（必需）
 */

import { Tool, ToolDefinition, ToolResult } from '../base/Tool'
import type { TaskManager } from '../../../services/task/TaskManager'

export class TaskGetTool extends Tool {
  readonly name = 'task_get'
  readonly description =
    '获取单个任务的完整详细信息，包括描述、依赖关系、元数据等。用于在执行任务前了解完整上下文。'

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
          taskId: {
            type: 'string',
            description: '要查看的任务 ID'
          }
        },
        required: ['taskId']
      }
    }
  }

  /**
   * 执行工具 - 获取任务详情
   *
   * @param args - 工具参数
   * @returns 执行结果
   */
  async execute(args: { taskId: string }): Promise<ToolResult> {
    try {
      // 参数验证
      if (!args.taskId || args.taskId.trim().length === 0) {
        return this.createErrorResult('taskId 不能为空')
      }

      // 获取任务
      const task = this.taskManager.getTask(args.taskId)
      if (!task) {
        return this.createErrorResult(`任务不存在: ${args.taskId}`)
      }

      // 获取依赖任务的信息
      const blockedByInfo = this.formatDependencies(
        task.blockedBy,
        '此任务依赖以下任务（必须先完成这些任务）:'
      )

      const blocksInfo = this.formatDependencies(
        task.blocks,
        '以下任务依赖此任务（完成后才能开始）:'
      )

      // 计算任务是否可以开始
      const canStart =
        task.status === 'pending' &&
        task.blockedBy.length === 0 &&
        task.blockedBy.every((id) => {
          const dep = this.taskManager.getTask(id)
          return dep && dep.status === 'completed'
        })

      const canStartText = canStart
        ? '\n✨ 此任务可以立即开始执行'
        : task.blockedBy.length > 0
          ? '\n🔒 此任务被依赖阻塞，需要等待依赖任务完成'
          : task.status === 'in_progress'
            ? '\n🔄 此任务正在进行中'
            : task.status === 'completed'
              ? '\n✅ 此任务已完成'
              : ''

      // 格式化元数据
      const metadataText = task.metadata
        ? `\n\n元数据:\n${JSON.stringify(task.metadata, null, 2)}`
        : ''

      const content = `📄 任务详情

任务 ID: ${task.id}
标题: ${task.subject}
状态: ${this.formatStatus(task.status)}${canStartText}

负责人: ${task.owner || '未分配'}
创建时间: ${task.createdAt}
更新时间: ${task.updatedAt}

描述:
${task.description}

${blockedByInfo}

${blocksInfo}${metadataText}

提示: 使用 task_update 更新任务状态或添加依赖关系。`

      return this.createSuccessResult(content, {
        task: {
          id: task.id,
          subject: task.subject,
          description: task.description,
          status: task.status,
          owner: task.owner,
          blockedBy: task.blockedBy,
          blocks: task.blocks,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          metadata: task.metadata
        },
        canStart
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 格式化依赖关系
   *
   * @param taskIds - 任务 ID 列表
   * @param title - 标题
   * @returns 格式化的文本
   */
  private formatDependencies(taskIds: string[], title: string): string {
    if (taskIds.length === 0) {
      return '无依赖关系'
    }

    const lines = [title]

    for (const taskId of taskIds) {
      const depTask = this.taskManager.getTask(taskId)
      if (depTask) {
        const statusIcon = this.getStatusIcon(depTask.status)
        lines.push(`  ${statusIcon} ${depTask.subject} (${taskId})`)
      } else {
        lines.push(`  ❓ 未找到任务 (${taskId})`)
      }
    }

    return lines.join('\n')
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
      pending: '⏳ 待开始',
      in_progress: '🔄 进行中',
      completed: '✅ 已完成',
      deleted: '🗑️ 已删除'
    }
    return statusMap[status] || status
  }
}
