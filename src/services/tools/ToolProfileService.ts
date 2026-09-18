import type { IStorageAdapter } from '../../adapters/StorageAdapter'
import type { AgentDefinition } from '../agent/AgentRegistry'
import { RuntimeProfileResolver } from '../../core/engine/RuntimeProfileResolver'
import type {
  ToolCapability,
  ToolRegistry,
  ToolRegistrySnapshot,
} from '../../core/tools/registry/ToolRegistry'

export type ToolProfileScope = 'global' | 'workspace'

export interface ToolProfile {
  enabledTools: string[]
  disabledTools: string[]
  scope: ToolProfileScope
  updatedAt: string
}

export interface ToolCatalogEntry {
  id: string
  name: string
  description: string
  source: 'builtin' | 'mcp' | 'plugin'
  category: string
  capabilities: readonly ToolCapability[]
  inputSchema?: unknown
  risk: 'low' | 'medium' | 'high'
}

export interface ToolProfileState {
  scope: ToolProfileScope
  profile?: ToolProfile
  enabledTools: readonly string[]
  catalog: readonly ToolCatalogEntry[]
  warnings: readonly string[]
}

export interface EffectiveToolProfile {
  enabledTools: readonly string[]
  toolSnapshot: ToolRegistrySnapshot
  warnings: readonly string[]
}

const GLOBAL_KEY = 'toolProfile.global.v1'
const WORKSPACE_KEY = 'toolProfile.workspace.v1'

export class ToolProfileService {
  constructor(
    private readonly storage: IStorageAdapter,
    private readonly registry: ToolRegistry
  ) {}

  getState(scope: ToolProfileScope): ToolProfileState {
    const warnings: string[] = []
    const profile = this.readProfile(scope, warnings)
    const effective = this.resolveEnabledTools(scope, warnings)

    return {
      scope,
      profile,
      enabledTools: Object.freeze(effective),
      catalog: this.getCatalog(),
      warnings: Object.freeze(warnings),
    }
  }

  resolve(agent?: Readonly<AgentDefinition>): EffectiveToolProfile {
    const warnings: string[] = []
    const enabledTools = this.resolveEnabledTools('workspace', warnings)
    const runtime = new RuntimeProfileResolver(this.registry).resolve({
      enabledTools,
      agent,
    })

    return {
      enabledTools: runtime.enabledToolIds,
      toolSnapshot: runtime.toolSnapshot,
      warnings: Object.freeze([...warnings, ...runtime.warnings]),
    }
  }

  async save(scope: ToolProfileScope, enabledTools: readonly string[]): Promise<ToolProfileState> {
    const selected = new Set(
      enabledTools
        .map(id => this.registry.resolveId(id))
        .filter((id): id is string => Boolean(id))
    )
    const baseline = new Set(
      scope === 'global'
        ? this.getDefaultEnabledTools()
        : this.resolveEnabledTools('global', [])
    )
    const allIds = this.registry.list().map(tool => tool.id)
    const profile: ToolProfile = {
      enabledTools: allIds.filter(id => selected.has(id) && !baseline.has(id)),
      disabledTools: allIds.filter(id => !selected.has(id) && baseline.has(id)),
      scope,
      updatedAt: new Date().toISOString(),
    }

    await this.writeProfile(profile)
    return this.getState(scope)
  }

  async reset(scope: ToolProfileScope): Promise<ToolProfileState> {
    if (scope === 'global') await this.storage.deleteGlobal(GLOBAL_KEY)
    else await this.storage.deleteWorkspace(WORKSPACE_KEY)
    return this.getState(scope)
  }

  private getCatalog(): readonly ToolCatalogEntry[] {
    return Object.freeze(
      this.registry.list().map(registration => ({
        id: registration.id,
        name: registration.name,
        description: registration.description,
        source: registration.source,
        category: registration.category,
        capabilities: registration.capabilities,
        inputSchema: registration.inputSchema,
        risk: this.getRisk(registration.capabilities),
      }))
    )
  }

  private resolveEnabledTools(scope: ToolProfileScope, warnings: string[]): string[] {
    const enabled = new Set(this.getDefaultEnabledTools())
    const globalProfile = this.readProfile('global', warnings)
    if (globalProfile) this.applyProfile(enabled, globalProfile, warnings)

    if (scope === 'workspace') {
      const workspaceProfile = this.readProfile('workspace', warnings)
      if (workspaceProfile) this.applyProfile(enabled, workspaceProfile, warnings)
    }

    return this.registry
      .list()
      .map(tool => tool.id)
      .filter(id => enabled.has(id))
  }

  private getDefaultEnabledTools(): string[] {
    return this.registry
      .list()
      .filter(tool => tool.defaultEnabled)
      .map(tool => tool.id)
  }

  private applyProfile(enabled: Set<string>, profile: ToolProfile, warnings: string[]): void {
    for (const idOrAlias of profile.enabledTools) {
      const id = this.registry.resolveId(idOrAlias)
      if (id) enabled.add(id)
      else warnings.push(`${profile.scope} 配置引用了不存在的工具: ${idOrAlias}`)
    }
    for (const idOrAlias of profile.disabledTools) {
      const id = this.registry.resolveId(idOrAlias)
      if (id) enabled.delete(id)
      else warnings.push(`${profile.scope} 配置引用了不存在的工具: ${idOrAlias}`)
    }
  }

  private readProfile(scope: ToolProfileScope, warnings: string[]): ToolProfile | undefined {
    const raw =
      scope === 'global'
        ? this.storage.getGlobal<unknown>(GLOBAL_KEY)
        : this.storage.getWorkspace<unknown>(WORKSPACE_KEY)
    if (raw === undefined) return undefined

    if (!this.isProfile(raw, scope)) {
      warnings.push(`${scope} 工具偏好配置损坏，已使用安全默认值`)
      return undefined
    }
    return {
      enabledTools: [...raw.enabledTools],
      disabledTools: [...raw.disabledTools],
      scope,
      updatedAt: raw.updatedAt,
    }
  }

  private isProfile(value: unknown, scope: ToolProfileScope): value is ToolProfile {
    if (!value || typeof value !== 'object') return false
    const profile = value as Partial<ToolProfile>
    return (
      profile.scope === scope &&
      typeof profile.updatedAt === 'string' &&
      Array.isArray(profile.enabledTools) &&
      profile.enabledTools.every(id => typeof id === 'string') &&
      Array.isArray(profile.disabledTools) &&
      profile.disabledTools.every(id => typeof id === 'string')
    )
  }

  private async writeProfile(profile: ToolProfile): Promise<void> {
    if (profile.scope === 'global') await this.storage.setGlobal(GLOBAL_KEY, profile)
    else await this.storage.setWorkspace(WORKSPACE_KEY, profile)
  }

  private getRisk(capabilities: readonly ToolCapability[]): 'low' | 'medium' | 'high' {
    if (capabilities.includes('write') || capabilities.includes('execute')) return 'high'
    if (capabilities.includes('network') || capabilities.includes('interactive')) return 'medium'
    return 'low'
  }
}
