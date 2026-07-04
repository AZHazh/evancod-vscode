/**
 * ExitPlanModeTool - 退出计划模式工具
 *
 * 职责：
 * AI Agent 调用此工具提交完整的执行计划，并等待用户审批
 *
 * 使用场景：
 * - AI 完成代码分析和计划制定
 * - AI 提交详细的任务列表、执行步骤、风险评估
 * - 等待用户审批计划
 * - 用户批准后开始执行
 *
 * 计划内容应包含：
 * - 任务列表：拆解为多个子任务
 * - 执行步骤：详细的操作步骤
 * - 风险评估：可能的风险和缓解措施
 *
 * 示例：
 * exit_plan_mode({
 *   tasks: [
 *     {
 *       subject: "创建 User 模型",
 *       description: "定义 User Schema...",
 *       estimatedTime: "15 分钟"
 *     },
 *     ...
 *   ],
 *   steps: [
 *     "1. 创建 models/User.ts 文件",
 *     "2. 定义 User 接口...",
 *     ...
 *   ],
 *   risks: [
 *     {
 *       level: "medium",
 *       description: "可能与现有代码冲突",
 *       mitigation: "先备份现有文件"
 *     }
 *   ]
 * })
 *
 * 参数：
 * - tasks: 任务列表（必需）
 * - steps: 执行步骤（必需）
 * - risks: 风险评估（可选）
 */

import { Tool, ToolDefinition, ToolResult } from '../base/Tool'
import type { PlanModeManager, Plan } from '../../../services/plan/PlanModeManager'

export class ExitPlanModeTool extends Tool {
  readonly name = 'exit_plan_mode'
  readonly description =
    '退出计划模式并提交执行计划。提交完整的任务列表、执行步骤和风险评估。计划提交后会等待用户审批，批准后才能开始执行。'

  /**
   * 构造函数
   *
   * @param planModeManager - 计划模式管理服务
   */
  constructor(private planModeManager: PlanModeManager) {
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
          tasks: {
            type: 'array',
            description:
              '任务列表。将整个计划拆解为多个可执行的子任务。每个任务应该独立、清晰、可验收。',
            items: {
              type: 'object',
              description: '单个任务',
              properties: {
                subject: {
                  type: 'string',
                  description: '任务标题，简洁明了，例如 "创建 User 模型"'
                },
                description: {
                  type: 'string',
                  description:
                    '任务详细描述，包括：要创建/修改哪些文件、具体要做什么、如何验收'
                },
                estimatedTime: {
                  type: 'string',
                  description: '预估完成时间，例如 "10 分钟"、"30 分钟"'
                },
                risks: {
                  type: 'array',
                  description: '此任务的特定风险',
                  items: {
                    type: 'string',
                    description: '风险描述'
                  }
                }
              }
            }
          },
          steps: {
            type: 'array',
            description:
              '详细的执行步骤。按顺序列出每一步操作，包括创建文件、修改代码、运行测试等。应该足够详细，让用户理解整个执行过程。',
            items: {
              type: 'string',
              description: '单个执行步骤，例如 "1. 创建 models/User.ts 文件"'
            }
          },
          risks: {
            type: 'array',
            description:
              '风险评估。列出执行此计划可能遇到的风险、影响和缓解措施。帮助用户做出明智的决策。',
            items: {
              type: 'object',
              description: '单个风险项',
              properties: {
                level: {
                  type: 'string',
                  description: '风险级别',
                  enum: ['low', 'medium', 'high']
                },
                description: {
                  type: 'string',
                  description: '风险描述，例如 "可能与现有代码冲突"'
                },
                mitigation: {
                  type: 'string',
                  description: '缓解措施，例如 "先备份现有文件"、"创建新分支"'
                }
              }
            }
          }
        },
        required: ['tasks', 'steps']
      }
    }
  }

  /**
   * 执行工具 - 退出计划模式
   *
   * @param args - 工具参数
   * @returns 执行结果
   */
  async execute(args: {
    tasks: Array<{
      subject: string
      description: string
      estimatedTime?: string
      risks?: string[]
    }>
    steps: string[]
    risks?: Array<{
      level: 'low' | 'medium' | 'high'
      description: string
      mitigation: string
    }>
  }): Promise<ToolResult> {
    try {
      // 参数验证
      if (!args.tasks || args.tasks.length === 0) {
        return this.createErrorResult('tasks 不能为空，至少需要一个任务')
      }

      if (!args.steps || args.steps.length === 0) {
        return this.createErrorResult('steps 不能为空，至少需要一个执行步骤')
      }

      // 验证每个任务
      for (let i = 0; i < args.tasks.length; i++) {
        const task = args.tasks[i]
        if (!task.subject || task.subject.trim().length === 0) {
          return this.createErrorResult(`任务 ${i + 1} 的 subject 不能为空`)
        }
        if (!task.description || task.description.trim().length === 0) {
          return this.createErrorResult(`任务 ${i + 1} 的 description 不能为空`)
        }
      }

      // 提交计划
      const plan = await this.planModeManager.exitPlanMode({
        tasks: args.tasks.map((task) => ({
          id: this.generateTaskId(),
          subject: task.subject.trim(),
          description: task.description.trim(),
          estimatedTime: task.estimatedTime?.trim(),
          risks: task.risks
        })),
        steps: args.steps.map((step) => step.trim()),
        risks: args.risks || []
      })

      const approval = await this.planModeManager.waitForApproval()
      if (!approval.approved) {
        return this.createErrorResult(approval.reason || '用户拒绝了计划')
      }

      // 格式化任务列表
      const tasksText = plan.tasks
        .map((task, index) => {
          const riskText =
            task.risks && task.risks.length > 0
              ? `\n   风险: ${task.risks.join(', ')}`
              : ''
          const timeText = task.estimatedTime ? `\n   预估: ${task.estimatedTime}` : ''
          return `${index + 1}. ${task.subject}${timeText}${riskText}\n   ${task.description}`
        })
        .join('\n\n')

      // 格式化执行步骤
      const stepsText = plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')

      // 格式化风险评估
      const risksText =
        plan.risks && plan.risks.length > 0
          ? '\n\n风险评估:\n' +
            plan.risks
              .map((risk) => {
                const levelIcon =
                  risk.level === 'high' ? '🔴' : risk.level === 'medium' ? '🟡' : '🟢'
                return `${levelIcon} ${risk.level.toUpperCase()}: ${risk.description}\n   缓解: ${risk.mitigation}`
              })
              .join('\n')
          : ''

      const content = `✅ 计划已提交，等待用户审批

计划 ID: ${plan.id}
标题: ${plan.title}
状态: ⏳ 等待审批

---

📋 任务列表 (共 ${plan.tasks.length} 个):

${tasksText}

---

🔧 执行步骤 (共 ${plan.steps.length} 步):

${stepsText}${risksText}

---

⏳ 等待用户审批...

用户可以在 Webview 中查看完整计划并决定：
- ✅ 批准：开始执行计划
- ❌ 拒绝：返回修改计划

提示: 计划已保存到 ${plan.filePath || '.evancod/plans/'} 目录。`

      return this.createSuccessResult(content, {
        planId: plan.id,
        state: plan.state,
        tasksCount: plan.tasks.length,
        stepsCount: plan.steps.length,
        risksCount: plan.risks.length,
        filePath: plan.filePath,
        awaitingApproval: true
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 生成任务 ID
   *
   * @returns 任务 ID
   */
  private generateTaskId(): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 9)
    return `task-${timestamp}-${random}`
  }
}
