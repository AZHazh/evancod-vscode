/**
 * TaskUpdateTool - 更新任务工具
 *
 * 职责：
 * AI Agent 调用此工具来更新任务状态、内容、依赖关系
 *
 * 使用场景：
 * - 开始执行任务时，将状态从 pending 改为 in_progress
 * - 完成任务时，将状态改为 completed
 * - 修改任务描述或标题
 * - 添加新的任务依赖关系
 *
 * 示例：
 * task_update({ taskId: "task-123", status: "in_progress" })
 * task_update({ taskId: "task-123", status: "completed" })
 * task_update({ taskId: "task-456", addBlockedBy: ["task-789"] })
 *
 * 参数：
 * - taskId: 要更新的任务 ID（必需）
 * - status: 新状态（可选）
 * - subject: 新标题（可选）
 * - description: 新描述（可选）
 * - activeForm: 新的进行中描述（可选）
 * - addBlocks: 添加被此任务阻塞的任务 ID（可选）
 * - addBlockedBy: 添加阻塞此任务的任务 ID（可选）
 * - metadata: 更新元数据（可选）
 */

import { Tool, ToolDefinition, ToolResult } from '../base/Tool'
import type { TaskManager } from '../../../services/task/TaskManager'
import type { TaskStatus } from '../../../types'

export class TaskUpdateTool extends Tool {
  readonly name = 'task_update'
  readonly description =
    `更新任务的状态、内容或依赖关系。用于标记任务进度、修改任务信息、添加任务依赖。

使用契约：
- 开始执行任务前，必须将对应任务标记为 in_progress。
- 只有工作完全完成时才能标记 completed；测试失败、实现不完整、文件缺失或仍有阻塞时不能标记 completed。
- 标记 completed 后，必须调用 task_list 查找下一项可执行任务或新解锁任务。`

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
            description: '要更新的任务 ID'
          },
          status: {
            type: 'string',
            description:
              '新的任务状态。可选值：pending（待开始）、in_progress（进行中）、completed（已完成）、deleted（已删除）',
            enum: ['pending', 'in_progress', 'completed', 'deleted']
          },
          subject: {
            type: 'string',
            description: '新的任务标题（如果需要修改标题）'
          },
          description: {
            type: 'string',
            description: '新的任务描述（如果需要修改描述）'
          },
          activeForm: {
            type: 'string',
            description: '新的进行中描述（如果需要修改）'
          },
          addBlocks: {
            type: 'array',
            description: '添加被此任务阻塞的任务 ID 列表。这些任务会等待当前任务完成后才能开始。',
            items: {
              type: 'string',
              description: '任务 ID'
            }
          },
          addBlockedBy: {
            type: 'array',
            description: '添加阻塞此任务的任务 ID 列表。当前任务需要等待这些任务完成后才能开始。',
            items: {
              type: 'string',
              description: '任务 ID'
            }
          },
          metadata: {
            type: 'object',
            description: '更新元数据（会与现有元数据合并）'
          }
        },
        required: ['taskId']
      }
    }
  }

  /**
   * 执行工具 - 更新任务
   *
   * @param args - 工具参数
   * @returns 执行结果
   */
  async execute(args: {
    taskId: string
    status?: TaskStatus
    subject?: string
    description?: string
    activeForm?: string
    addBlocks?: string[]
    addBlockedBy?: string[]
    metadata?: Record<string, any>
  }): Promise<ToolResult> {
    try {
      // 参数验证
      if (!args.taskId || args.taskId.trim().length === 0) {
        return this.createErrorResult('taskId 不能为空')
      }

      // 检查任务是否存在
      const existingTask = this.taskManager.getTask(args.taskId)
      if (!existingTask) {
        return this.createErrorResult(`任务不存在: ${args.taskId}`)
      }

      // 验证状态转换
      if (args.status) {
        const validStatuses: TaskStatus[] = ['pending', 'in_progress', 'completed', 'deleted']
        if (!validStatuses.includes(args.status)) {
          return this.createErrorResult(`无效的状态: ${args.status}`)
        }
      }

      // 删除语义：status=deleted 走真正的删除路径（移除任务并发送 task.deleted），
      // 而不是把任务保留为 deleted 状态，避免任务列表累加已删除任务
      if (args.status === 'deleted') {
        await this.taskManager.deleteTask(args.taskId)
        return this.createSuccessResult(
          `🗑️ 任务已删除\n\n任务 ID: ${existingTask.id}\n标题: ${existingTask.subject}`,
          {
            taskId: existingTask.id,
            status: 'deleted'
          }
        )
      }

      // 验证 addBlocks 任务是否存在
      if (args.addBlocks && args.addBlocks.length > 0) {
        for (const taskId of args.addBlocks) {
          const task = this.taskManager.getTask(taskId)
          if (!task) {
            return this.createErrorResult(`要阻塞的任务不存在: ${taskId}`)
          }
        }
      }

      // 验证 addBlockedBy 任务是否存在
      if (args.addBlockedBy && args.addBlockedBy.length > 0) {
        for (const taskId of args.addBlockedBy) {
          const task = this.taskManager.getTask(taskId)
          if (!task) {
            return this.createErrorResult(`依赖的任务不存在: ${taskId}`)
          }
        }
      }

      // 更新任务
      const updatedTask = await this.taskManager.updateTask(args.taskId, {
        status: args.status,
        subject: args.subject?.trim(),
        description: args.description?.trim(),
        activeForm: args.activeForm?.trim(),
        addBlocks: args.addBlocks,
        addBlockedBy: args.addBlockedBy,
        metadata: args.metadata
      })

      // 格式化返回结果
      const changes: string[] = []

      if (args.status && args.status !== existingTask.status) {
        changes.push(
          `状态: ${this.formatStatus(existingTask.status)} → ${this.formatStatus(args.status)}`
        )
      }

      if (args.subject && args.subject !== existingTask.subject) {
        changes.push(`标题已更新`)
      }

      if (args.description && args.description !== existingTask.description) {
        changes.push(`描述已更新`)
      }

      if (args.addBlocks && args.addBlocks.length > 0) {
        changes.push(`添加了 ${args.addBlocks.length} 个被阻塞任务`)
      }

      if (args.addBlockedBy && args.addBlockedBy.length > 0) {
        changes.push(`添加了 ${args.addBlockedBy.length} 个依赖任务`)
      }

      if (args.metadata) {
        changes.push(`元数据已更新`)
      }

      const changesText = changes.length > 0 ? changes.join('\n- ') : '无变更'

      const blockedByInfo =
        updatedTask.blockedBy.length > 0
          ? `\n依赖任务: ${updatedTask.blockedBy.join(', ')}`
          : '\n无依赖任务'

      const blocksInfo =
        updatedTask.blocks.length > 0
          ? `\n阻塞任务: ${updatedTask.blocks.join(', ')}`
          : '\n不阻塞其他任务'

      let content = `✅ 任务已更新

任务 ID: ${updatedTask.id}
标题: ${updatedTask.subject}
当前状态: ${this.formatStatus(updatedTask.status)}
更新时间: ${updatedTask.updatedAt}${blockedByInfo}${blocksInfo}

变更内容:
- ${changesText}

提示: 使用 task_list 查看所有任务，使用 task_get 查看任务详情。`

      if (args.status === 'completed') {
        content += '\n\nTask completed. Call task_list now to find your next available task or see if your work unblocked others.'
      }

      return this.createSuccessResult(content, {
        taskId: updatedTask.id,
        status: updatedTask.status,
        blockedBy: updatedTask.blockedBy,
        blocks: updatedTask.blocks,
        canStart: updatedTask.blockedBy.length === 0 && updatedTask.status === 'pending'
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
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
