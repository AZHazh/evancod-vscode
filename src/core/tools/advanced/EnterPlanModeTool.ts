/**
 * EnterPlanModeTool - 进入计划模式工具
 *
 * 职责：
 * AI Agent 调用此工具进入计划模式，开始制定执行计划
 *
 * 使用场景：
 * - 用户请求复杂功能实现
 * - AI 需要先分析代码结构
 * - AI 需要制定详细的执行计划
 * - 防止 AI 直接执行破坏性操作
 *
 * 计划模式特点：
 * - 只能使用读取和分析工具
 * - 不能修改文件、执行命令
 * - 需要用户审批后才能执行
 *
 * 示例：
 * 用户："实现用户认证功能"
 * AI 调用：
 * enter_plan_mode({
 *   title: "实现用户认证功能",
 *   description: "包括注册、登录、密码重置、JWT 验证等功能"
 * })
 *
 * 参数：
 * - title: 计划标题（简洁明了）
 * - description: 计划描述（包含目标、范围、约束）
 */

import { Tool, ToolDefinition, ToolResult } from '../base/Tool'
import type { PlanModeManager } from '../../../services/plan/PlanModeManager'

export class EnterPlanModeTool extends Tool {
  readonly name = 'enter_plan_mode'
  readonly description =
    '进入计划模式。用于复杂任务执行前制定详细计划。在计划模式下只能使用读取和分析工具，不能修改文件。计划完成后需要调用 exit_plan_mode 提交计划并等待用户审批。'

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
          title: {
            type: 'string',
            description:
              '计划标题，简洁明了地描述要完成的任务，例如 "实现用户认证功能"、"重构数据库层"、"添加单元测试"'
          },
          description: {
            type: 'string',
            description:
              '计划描述，详细说明任务目标、范围、约束条件等。应包括：需要实现哪些功能、不包括哪些功能、有哪些技术约束、需要注意什么。'
          }
        },
        required: ['title', 'description']
      }
    }
  }

  /**
   * 执行工具 - 进入计划模式
   *
   * @param args - 工具参数
   * @returns 执行结果
   */
  async execute(args: { title: string; description: string }): Promise<ToolResult> {
    try {
      // 参数验证
      if (!args.title || args.title.trim().length === 0) {
        return this.createErrorResult('title 不能为空')
      }

      if (!args.description || args.description.trim().length === 0) {
        return this.createErrorResult('description 不能为空')
      }

      // 进入计划模式
      const plan = await this.planModeManager.enterPlanMode(
        args.title.trim(),
        args.description.trim()
      )

      const content = `✅ 已进入计划模式

计划 ID: ${plan.id}
标题: ${plan.title}
状态: 🔄 规划中

描述:
${plan.description}

---

📋 计划模式说明：

1. **只能使用读取工具**
   - ✅ 允许: read_file, glob, grep, find, list_directory
   - ✅ 允许: analyze_ast, analyze_dependencies
   - ✅ 允许: git_status, git_diff, git_log, git_branch
   - ✅ 允许: task_list, task_get
   - ❌ 禁止: edit_file, write_file, delete_file, bash 等修改操作

2. **制定计划**
   - 分析现有代码结构
   - 拆解任务为多个步骤
   - 评估风险和影响
   - 准备详细的执行方案

3. **提交计划**
   - 使用 exit_plan_mode 提交计划
   - 等待用户审批
   - 批准后才能开始执行

提示: 现在可以使用读取工具分析代码，制定详细的执行计划。完成后调用 exit_plan_mode 提交计划。`

      return this.createSuccessResult(content, {
        planId: plan.id,
        state: plan.state,
        allowedTools: [
          'read_file',
          'glob',
          'grep',
          'find',
          'list_directory',
          'analyze_ast',
          'analyze_dependencies',
          'git_status',
          'git_diff',
          'git_log',
          'git_branch',
          'task_list',
          'task_get',
          'enter_plan_mode',
          'exit_plan_mode'
        ]
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }
}
