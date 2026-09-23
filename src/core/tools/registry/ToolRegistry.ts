import type { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import type { AgentCoordinator } from '../../../services/agent/AgentCoordinator'
import type { MCPConnectionManager } from '../../../services/mcp/MCPConnectionManager'
import type { PlanModeManager } from '../../../services/plan/PlanModeManager'
import type { SkillManager } from '../../../services/skill/SkillManager'
import type { TaskManager } from '../../../services/task/TaskManager'
import type { Provider } from '../../../types'
import type { Tool } from '../base/Tool'
import type { ToolDefinition } from '../base/Tool'

export type ToolCapability = 'read' | 'write' | 'execute' | 'network' | 'interactive'
export type ToolSource = 'builtin' | 'mcp' | 'plugin'

export interface ToolContext {
  sessionId?: string
  cwd: string
  provider: Provider
  model: string
  fileSystem: IFileSystemAdapter
  imageProvider?: Provider
  taskManager?: TaskManager
  planModeManager?: PlanModeManager
  agentCoordinator?: AgentCoordinator
  mcpManager?: MCPConnectionManager
  skillManager?: SkillManager
}

export interface ToolRegistration {
  id: string
  name: string
  description: string
  source: ToolSource
  category: string
  capabilities: readonly ToolCapability[]
  inputSchema?: ToolDefinition['input_schema']
  aliases?: readonly string[]
  create: (context: ToolContext) => Tool | undefined
  defaultEnabled: boolean
}

export interface ToolInstantiationResult {
  tools: Tool[]
  warnings: string[]
}

function cloneRegistration(registration: ToolRegistration): Readonly<ToolRegistration> {
  return Object.freeze({
    ...registration,
    capabilities: Object.freeze([...registration.capabilities]),
    aliases: Object.freeze([...(registration.aliases || [])]),
    inputSchema: registration.inputSchema
      ? {
          ...registration.inputSchema,
          properties: { ...registration.inputSchema.properties },
          required: [...registration.inputSchema.required],
        }
      : undefined,
  })
}

export class ToolRegistrySnapshot {
  private readonly registrations: readonly Readonly<ToolRegistration>[]

  constructor(registrations: readonly ToolRegistration[]) {
    this.registrations = Object.freeze(registrations.map(cloneRegistration))
  }

  list(): readonly Readonly<ToolRegistration>[] {
    return this.registrations
  }

  has(id: string): boolean {
    return this.registrations.some(registration => registration.id === id)
  }

  instantiate(context: ToolContext): ToolInstantiationResult {
    const tools: Tool[] = []
    const warnings: string[] = []

    for (const registration of this.registrations) {
      const tool = registration.create(context)
      if (!tool) {
        warnings.push(`工具 ${registration.id} 缺少运行时依赖，已跳过`)
        continue
      }
      if (tool.name !== registration.name) {
        throw new Error(
          `工具 ${registration.id} 注册名称 ${registration.name} 与实例名称 ${tool.name} 不一致`
        )
      }
      tools.push(tool)
    }

    return { tools, warnings }
  }
}

export class ToolRegistry {
  private readonly registrations = new Map<string, Readonly<ToolRegistration>>()
  private readonly aliases = new Map<string, string>()

  register(registration: ToolRegistration): void {
    this.validateRegistration(registration)
    if (this.registrations.has(registration.id)) {
      throw new Error(`工具 ID 已注册: ${registration.id}`)
    }

    const names = new Set([registration.name, ...(registration.aliases || [])])
    for (const name of names) {
      const existingId = this.aliases.get(name)
      if (existingId) {
        throw new Error(`工具名称或别名已由 ${existingId} 注册: ${name}`)
      }
    }

    const frozen = cloneRegistration(registration)
    this.registrations.set(frozen.id, frozen)
    for (const name of names) this.aliases.set(name, frozen.id)
  }

  get(idOrAlias: string): Readonly<ToolRegistration> | undefined {
    const id = this.resolveId(idOrAlias)
    return id ? this.registrations.get(id) : undefined
  }

  unregister(id: string): boolean {
    const registration = this.registrations.get(id)
    if (!registration) return false
    this.registrations.delete(id)
    for (const [alias, registeredId] of this.aliases) {
      if (registeredId === id) this.aliases.delete(alias)
    }
    return true
  }

  resolveId(idOrAlias: string): string | undefined {
    if (this.registrations.has(idOrAlias)) return idOrAlias
    return this.aliases.get(idOrAlias)
  }

  list(): readonly Readonly<ToolRegistration>[] {
    return Object.freeze([...this.registrations.values()])
  }

  createSnapshot(ids?: readonly string[]): ToolRegistrySnapshot {
    if (!ids) return new ToolRegistrySnapshot(this.list())

    const registrations = ids.map(id => {
      const registration = this.get(id)
      if (!registration) throw new Error(`工具未注册: ${id}`)
      return registration
    })
    return new ToolRegistrySnapshot(registrations)
  }

  private validateRegistration(registration: ToolRegistration): void {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(registration.id)) {
      throw new Error(`无效的工具 ID: ${registration.id}`)
    }
    if (!registration.name.trim()) throw new Error('工具名称不能为空')
    if (!registration.description.trim()) throw new Error(`工具 ${registration.id} 缺少描述`)
    if (!registration.category.trim()) throw new Error(`工具 ${registration.id} 缺少分类`)
    if (registration.capabilities.length === 0) {
      throw new Error(`工具 ${registration.id} 至少需要一个 capability`)
    }
  }
}
