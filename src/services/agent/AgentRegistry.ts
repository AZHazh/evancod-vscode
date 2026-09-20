import type { PermissionMode, Provider } from '../../types'

export type AgentSource = 'builtin' | 'global' | 'workspace'
export type AgentEffortLevel = 'low' | 'medium' | 'high' | 'max'
export type AgentModelTier = 'main' | 'sonnet' | 'opus' | 'haiku'

export interface AgentDefinition {
  id: string
  name: string
  description: string
  systemPrompt: string
  /** 当前 Provider 中要使用的逻辑模型等级。 */
  modelTier?: AgentModelTier
  /** 兼容旧版 Agent 定义中的具体模型覆盖。 */
  model?: string
  effortLevel?: AgentEffortLevel
  enabledTools: readonly string[]
  enabledSkills?: readonly string[]
  readOnly: boolean
  permissionMode: PermissionMode
  maxIterations: number
  isolation: 'none' | 'worktree'
  defaultMode?: 'foreground' | 'background'
  enabled: boolean
  source: AgentSource
}

export function resolveAgentModel(
  definition: Pick<AgentDefinition, 'modelTier' | 'model'>,
  provider: Provider,
  fallbackModel: string
): string {
  if (definition.modelTier) {
    return (
      provider.models[definition.modelTier]?.trim() || provider.models.main.trim() || fallbackModel
    )
  }
  return definition.model?.trim() || fallbackModel
}

const sourcePriority: Record<AgentSource, number> = {
  builtin: 0,
  global: 1,
  workspace: 2,
}

function cloneDefinition(definition: AgentDefinition): Readonly<AgentDefinition> {
  return Object.freeze({
    ...definition,
    enabledTools: Object.freeze([...definition.enabledTools]),
    enabledSkills: definition.enabledSkills
      ? Object.freeze([...definition.enabledSkills])
      : undefined,
  })
}

export class AgentRegistry {
  private readonly definitions = new Map<string, Readonly<AgentDefinition>>()

  register(definition: AgentDefinition): void {
    this.validate(definition)
    const existing = this.definitions.get(definition.id)
    if (existing && sourcePriority[definition.source] < sourcePriority[existing.source]) {
      throw new Error(
        `Agent ${definition.id} 的 ${definition.source} 定义不能覆盖 ${existing.source} 定义`
      )
    }
    this.definitions.set(definition.id, cloneDefinition(definition))
  }

  get(id: string): Readonly<AgentDefinition> | undefined {
    return this.definitions.get(id)
  }

  list(options?: { includeDisabled?: boolean }): readonly Readonly<AgentDefinition>[] {
    const definitions = [...this.definitions.values()]
    return Object.freeze(
      options?.includeDisabled ? definitions : definitions.filter(definition => definition.enabled)
    )
  }

  clearCustom(): void {
    for (const [id, definition] of this.definitions) {
      if (definition.source !== 'builtin') this.definitions.delete(id)
    }
  }

  private validate(definition: AgentDefinition): void {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(definition.id)) {
      throw new Error(`无效的 Agent ID: ${definition.id}`)
    }
    if (!definition.name.trim()) throw new Error(`Agent ${definition.id} 缺少名称`)
    if (!definition.description.trim()) throw new Error(`Agent ${definition.id} 缺少描述`)
    if (!definition.systemPrompt.trim()) throw new Error(`Agent ${definition.id} 缺少系统提示词`)
    if (!Number.isInteger(definition.maxIterations) || definition.maxIterations <= 0) {
      throw new Error(`Agent ${definition.id} 的 maxIterations 必须是正整数`)
    }
  }
}

const readonlyBuiltinTools = [
  'builtin.read_file',
  'builtin.glob',
  'builtin.grep',
  'builtin.list_directory',
  'builtin.find',
  'builtin.lsp',
  'builtin.web_fetch',
  'builtin.web_search',
  'builtin.skill',
]

export function createBuiltinAgentRegistry(): AgentRegistry {
  const registry = new AgentRegistry()
  const common = {
    enabledTools: readonlyBuiltinTools,
    readOnly: true,
    permissionMode: 'default' as const,
    maxIterations: 30,
    isolation: 'none' as const,
    defaultMode: 'foreground' as const,
    enabled: true,
    source: 'builtin' as const,
  }

  registry.register({
    ...common,
    id: 'explore',
    name: '探索型 Agent',
    description: '查找文件、理解代码库结构并总结关键发现。',
    systemPrompt: `你的角色是探索型 Agent。
- 使用文件搜索工具（glob、grep、find）查找相关文件
- 使用文件读取工具（read_file）查看文件内容
- 分析代码库结构和组织方式
- 找出关键文件和模块
- 总结发现的内容`,
  })
  registry.register({
    ...common,
    id: 'analyze',
    name: '分析型 Agent',
    description: '分析代码结构、依赖关系、设计模式和潜在问题。',
    systemPrompt: `你的角色是分析型 Agent。
- 使用代码分析工具（analyze_ast、analyze_dependencies）分析代码
- 理解代码结构、依赖关系、设计模式
- 识别潜在问题和改进点
- 提供分析报告`,
  })
  registry.register({
    ...common,
    id: 'research',
    name: '研究型 Agent',
    description: '查找文档与最佳实践并形成可执行建议。',
    systemPrompt: `你的角色是研究型 Agent。
- 查找相关文档和最佳实践
- 理解技术概念和实现方式
- 提供建议和指导
- 总结研究发现`,
  })

  return registry
}
