/**
 * TaskCreateTool - 创建任务工具
 *
 * 职责：
 * AI Agent 调用此工具来创建新任务，拆解复杂任务为子任务
 *
 * 使用场景：
 * - 用户请求复杂功能实现时，AI 可以创建任务列表
 * - 将大任务拆解为多个小任务
 * - 设置任务依赖关系
 *
 * 示例：
 * 用户："实现用户认证功能"
 * AI 调用：
 * task_create({ subject: "创建 User 模型", description: "..." })
 * task_create({ subject: "实现登录 API", description: "...", blockedBy: ["task-1"] })
 * task_create({ subject: "添加认证中间件", description: "...", blockedBy: ["task-2"] })
 *
 * 参数：
 * - subject: 任务标题（祈使句，简洁明了）
 * - description: 任务详细描述（包含需求、技术要点、验收标准）
 * - activeForm: 进行中时的现在进行时描述（可选）
 * - blockedBy: 依赖的任务 ID 列表（可选）
 */

import { Tool, ToolDefinition, ToolResult } from '../base/Tool'
import type { TaskManager } from '../../../services/task/TaskManager'

export class TaskCreateTool extends Tool {
  readonly name = 'task_create'
  readonly description =
    `创建新任务。用于将复杂任务拆解为多个子任务，并追踪执行进度。可以设置任务依赖关系（blockedBy）。

使用契约：
- 复杂、多步骤任务、用户明确要求 todo list、或用户一次给出多个任务时，应主动使用此工具创建结构化任务。
- 创建任务后，开始执行前必须使用 task_update 将任务标记为 in_progress。
- 简单单步任务不要创建任务，避免无意义的任务列表噪音。`

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
          subject: {
            type: 'string',
            description:
              '任务简短标题，使用祈使句形式，例如 "创建用户认证模块"、"实现登录 API"、"编写单元测试"'
          },
          description: {
            type: 'string',
            description:
              '任务详细描述，包括：需求说明、技术要点、文件路径、验收标准等。要足够详细以便后续执行。'
          },
          activeForm: {
            type: 'string',
            description:
              '任务进行中时的现在进行时描述，用于 UI 展示，例如 "正在创建用户认证模块"。如果不提供，UI 会使用 subject 字段。'
          },
          blockedBy: {
            type: 'array',
            description:
              '此任务依赖的其他任务 ID 列表。只有当所有依赖任务完成后，此任务才能开始执行。用于表示任务之间的先后顺序。',
            items: {
              type: 'string',
              description: '任务 ID'
            }
          },
          metadata: {
            type: 'object',
            description: '任意元数据，用于扩展任务信息，例如优先级、标签、预估时间等'
          }
        },
        required: ['subject', 'description']
      }
    }
  }

  /**
   * 执行工具 - 创建任务
   *
   * @param args - 工具参数
   * @returns 执行结果
   */
  async execute(args: {
    subject: string
    description: string
    activeForm?: string
    blockedBy?: string[]
    metadata?: Record<string, any>
  }): Promise<ToolResult> {
    try {
      // 参数验证
      if (!args.subject || args.subject.trim().length === 0) {
        return this.createErrorResult('subject 不能为空')
      }

      if (!args.description || args.description.trim().length === 0) {
        return this.createErrorResult('description 不能为空')
      }

      // 验证 blockedBy 任务是否存在
      if (args.blockedBy && args.blockedBy.length > 0) {
        for (const taskId of args.blockedBy) {
          const task = this.taskManager.getTask(taskId)
          if (!task) {
            return this.createErrorResult(`依赖的任务不存在: ${taskId}`)
          }
        }
      }

      // 创建任务
      const task = await this.taskManager.createTask({
        subject: args.subject.trim(),
        description: args.description.trim(),
        activeForm: args.activeForm?.trim(),
        blockedBy: args.blockedBy || [],
        metadata: args.metadata
      })

      // 格式化返回结果
      const blockedByInfo =
        task.blockedBy.length > 0
          ? `\n依赖任务: ${task.blockedBy.join(', ')}`
          : '\n无依赖任务，可以立即开始'

      const content = `✅ 任务已创建

任务 ID: ${task.id}
标题: ${task.subject}
状态: ${this.formatStatus(task.status)}
创建时间: ${task.createdAt}${blockedByInfo}

描述:
${task.description}

提示: 使用 task_update 更新任务状态，使用 task_list 查看所有任务。`

      return this.createSuccessResult(content, {
        taskId: task.id,
        status: task.status,
        blockedBy: task.blockedBy,
        canStart: task.blockedBy.length === 0
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
