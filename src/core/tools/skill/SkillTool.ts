/**
 * Skill Tool - Skill 执行工具
 *
 * 职责：
 * 1. 执行指定的 Skill
 * 2. 将 Skill 内容作为提示词注入到对话中
 * 3. 支持通过 Skill 名称或触发命令调用
 *
 * 使用场景：
 * - 用户输入 /commit，自动执行 commit Skill
 * - AI 主动调用 Skill 完成特定任务
 * - 扩展 AI 能力而无需修改代码
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { SkillManager } from '../../../services/skill/SkillManager'

interface SkillToolParams {
  /** Skill 名称或触发命令 */
  skill: string

  /** 额外参数（可选） */
  args?: string
}

export class SkillTool extends Tool {
  constructor(private skillManager: SkillManager) {
    super()
  }

  get name(): string {
    return 'skill'
  }

  get description(): string {
    return `执行预定义的 Skill（技能）。

Skill 是预定义的提示词模板，用于完成特定任务。

使用示例：
{
  "skill": "commit",
  "args": "Fix user authentication bug"
}

可用的 Skills 可以通过列出 Skills 目录查看。`
  }

  get inputSchema(): any {
    return {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'Skill 名称或触发命令（如 commit 或 /commit）'
        },
        args: {
          type: 'string',
          description: '额外参数（可选）'
        }
      },
      required: ['skill']
    }
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.inputSchema,
    }
  }

  async execute(params: SkillToolParams): Promise<ToolResult> {
    try {
      // 获取 Skill
      let skill = this.skillManager.getSkill(params.skill)

      // 如果找不到，尝试通过触发命令查找
      if (!skill && params.skill.startsWith('/')) {
        skill = this.skillManager.getSkillByTrigger(params.skill)
      }

      if (!skill) {
        const availableSkills = this.skillManager
          .listEnabledSkills()
          .map((s) => `- ${s.metadata.name}: ${s.metadata.description}`)
          .join('\n')

        return this.createSuccessResult(`Skill "${params.skill}" 未找到。

可用的 Skills：
${availableSkills || '无'}`)
      }

      // 检查是否已启用
      if (skill.metadata.enabled === false) {
        return this.createSuccessResult(`Skill "${skill.metadata.name}" 已禁用`)
      }

      // 构建返回内容
      let content = `已加载 Skill: ${skill.metadata.name}\n\n`
      content += `描述: ${skill.metadata.description}\n\n`
      content += `---\n\n${skill.content}`

      if (params.args) {
        content += `\n\n额外参数: ${params.args}`
      }

      return this.createSuccessResult(content)
    } catch (error) {
      return this.createErrorResult(error)
    }
  }
}
