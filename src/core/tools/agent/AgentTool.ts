/**
 * AgentTool - 子 Agent 调用工具
 *
 * 职责：
 * AI Agent 调用此工具创建子 Agent 执行独立的研究或分析任务
 *
 * 使用场景：
 * - 需要深入研究代码库的某个部分
 * - 需要并行执行多个独立任务
 * - 需要隔离执行上下文，避免污染主对话
 * - 需要专注于某个特定问题的分析
 *
 * 子 Agent 类型：
 * - explore: 探索型，用于查找文件、理解代码结构
 * - analyze: 分析型，用于深入分析代码、依赖关系
 * - research: 研究型，用于查找文档、最佳实践
 *
 * 执行模式：
 * - foreground: 前台执行，阻塞等待结果（默认）
 * - background: 后台执行，立即返回 Agent ID，稍后查询结果
 *
 * 示例：
 * 用户："分析用户认证模块的实现"
 * AI 调用：
 * agent({
 *   type: "analyze",
 *   description: "分析用户认证模块的实现，包括登录、注册、权限验证",
 *   prompt: "分析 src/auth/ 目录下的所有文件，理解认证流程和实现方式",
 *   mode: "foreground"
 * })
 *
 * 参数：
 * - type: Agent 类型（explore | analyze | research）
 * - description: Agent 任务描述
 * - prompt: 具体的任务提示词
 * - mode: 执行模式（foreground | background）
 */

import { Tool, ToolDefinition, ToolResult } from '../base/Tool'
import type { AgentCoordinator, AgentType, ExecutionMode } from '../../../services/agent/AgentCoordinator'
import type { Provider } from '../../../types'

export class AgentTool extends Tool {
  readonly name = 'agent'
  readonly description =
    '创建子 Agent 执行独立的研究或分析任务。子 Agent 有独立的上下文，结果摘要会返回给主 Agent。支持前台（阻塞）和后台（非阻塞）执行。'

  /**
   * 构造函数
   *
   * @param coordinator - Agent 协调器
   * @param cwd - 工作目录
   * @param provider - Provider 配置
   * @param model - 模型
   */
  constructor(
    private coordinator: AgentCoordinator,
    private cwd: string,
    private provider: Provider,
    private model: string
  ) {
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
          description: {
            type: 'string',
            description:
              'Agent 任务描述，简洁明了地说明 Agent 要做什么，例如 "分析用户认证模块的实现"、"查找所有测试文件"'
          },
          prompt: {
            type: 'string',
            description:
              '具体的任务提示词，详细说明 Agent 应该执行什么操作、关注什么内容、输出什么格式。应该包含具体的文件路径、关键词、分析维度等。'
          },
          subagent_type: {
            type: 'string',
            description: `子 Agent 类型：
- explore: 探索型 Agent，用于查找文件、理解代码库结构。
- analyze: 分析型 Agent，用于深入分析代码、依赖关系。
- research: 研究型 Agent，用于查找文档、最佳实践。`,
            enum: ['explore', 'analyze', 'research']
          },
          type: {
            type: 'string',
            description: '兼容旧字段。等同于 subagent_type。',
            enum: ['explore', 'analyze', 'research']
          },
          model: {
            type: 'string',
            description: '可选模型覆盖。未提供时使用当前主 Agent 模型。'
          },
          run_in_background: {
            type: 'boolean',
            description: '是否后台运行。true 时立即返回 Agent ID，完成后通过 task_notification 通知。'
          },
          mode: {
            type: 'string',
            description: '兼容旧字段。foreground 阻塞等待；background 后台运行。',
            enum: ['foreground', 'background']
          },
          name: {
            type: 'string',
            description: '可选 Agent 名称，用于 UI 和调试标识。'
          },
          team_name: {
            type: 'string',
            description: '可选团队名称，用于并发 Agent 分组。'
          },
          isolation: {
            type: 'string',
            description: '可选隔离模式。none 使用当前工作目录；worktree 会创建临时 git worktree 隔离执行，要求 cwd 位于 git 仓库内。',
            enum: ['none', 'worktree']
          },
          cwd: {
            type: 'string',
            description: '可选工作目录覆盖。未提供时使用当前工作区。'
          }
        },
        required: ['description', 'prompt']
      }
    }
  }

  /**
   * 执行工具 - 创建子 Agent
   *
   * @param args - 工具参数
   * @returns 执行结果
   */
  async execute(args: {
    type?: AgentType
    subagent_type?: AgentType
    description: string
    prompt: string
    mode?: ExecutionMode
    run_in_background?: boolean
    model?: string
    name?: string
    team_name?: string
    isolation?: 'none' | 'worktree'
    cwd?: string
  }, context?: { toolUseId?: string }): Promise<ToolResult> {
    try {
      const agentType = args.subagent_type || args.type || 'explore'

      const validTypes: AgentType[] = ['explore', 'analyze', 'research']
      if (!validTypes.includes(agentType)) {
        return this.createErrorResult(`无效的 subagent_type: ${agentType}，必须是 explore, analyze 或 research`)
      }

      if (!args.description || args.description.trim().length === 0) {
        return this.createErrorResult('description 不能为空')
      }

      if (!args.prompt || args.prompt.trim().length === 0) {
        return this.createErrorResult('prompt 不能为空')
      }

      const mode: ExecutionMode = args.run_in_background ? 'background' : args.mode || 'foreground'
      const isolation = args.isolation || 'none'
      const validModes: ExecutionMode[] = ['foreground', 'background']
      if (!validModes.includes(mode)) {
        return this.createErrorResult(`无效的 mode: ${mode}，必须是 foreground 或 background`)
      }

      // 生成 Agent ID
      const agentId = this.generateAgentId()

      // 启动子 Agent
      const result = await this.coordinator.startAgent({
        id: agentId,
        type: agentType,
        description: args.description.trim(),
        prompt: args.prompt.trim(),
        mode,
        cwd: args.cwd?.trim() || this.cwd,
        provider: this.provider,
        model: args.model?.trim() || this.model,
        verbose: false,
        toolUseId: context?.toolUseId,
        name: args.name?.trim(),
        teamName: args.team_name?.trim(),
        isolation,
      })

      // 根据模式返回不同的结果
      if (mode === 'foreground') {
        // 前台模式：返回完整结果
        if (typeof result === 'string') {
          return this.createErrorResult('意外错误：前台模式应该返回结果对象')
        }

        const typeIcon = this.getTypeIcon(agentType)
        const successIcon = result.success ? '✅' : '❌'

        const content = `${successIcon} 子 Agent 执行${result.success ? '完成' : '失败'}

Agent ID: ${result.id}
类型: ${typeIcon} ${agentType}
隔离: ${isolation}
任务: ${args.description}
执行时间: ${result.duration}ms

${result.success ? '结果摘要:' : '错误信息:'}
${result.success ? result.summary : result.error}

${result.fullOutput && result.fullOutput.length > 500 ? '提示: 完整输出已截断，摘要中包含关键信息。' : ''}`

        return this.createSuccessResult(content, {
          agentId: result.id,
          type: agentType,
          mode: 'foreground',
          isolation,
          success: result.success,
          summary: result.summary,
          duration: result.duration
        })
      } else {
        // 后台模式：返回 Agent ID
        if (typeof result !== 'string') {
          return this.createErrorResult('意外错误：后台模式应该返回 Agent ID')
        }

        const typeIcon = this.getTypeIcon(agentType)

        const content = `✅ 子 Agent 已启动（后台执行）

Agent ID: ${result}
类型: ${typeIcon} ${agentType}
隔离: ${isolation}
任务: ${args.description}

⏳ Agent 正在后台执行...

提示: 继续其他工作，稍后可以查询此 Agent 的结果。`

        return this.createSuccessResult(content, {
          agentId: result,
          type: agentType,
          mode: 'background',
          isolation,
          status: 'running'
        })
      }
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 获取类型图标
   *
   * @param type - Agent 类型
   * @returns 图标
   */
  private getTypeIcon(type: AgentType): string {
    const icons: Record<AgentType, string> = {
      explore: '🔍',
      analyze: '🔬',
      research: '📚'
    }
    return icons[type] || '🤖'
  }

  /**
   * 生成 Agent ID
   *
   * @returns Agent ID
   */
  private generateAgentId(): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 9)
    return `agent-${timestamp}-${random}`
  }
}
