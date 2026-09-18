import type { AgentDefinition } from '../../services/agent/AgentRegistry'
import {
  ToolRegistry,
  type ToolCapability,
  type ToolRegistrySnapshot,
} from '../tools/registry/ToolRegistry'

export interface RuntimeProfileOptions {
  enabledTools?: readonly string[]
  agent?: Readonly<AgentDefinition>
  readOnly?: boolean
}

export interface RuntimeProfile {
  toolSnapshot: ToolRegistrySnapshot
  enabledToolIds: readonly string[]
  warnings: readonly string[]
}

const readOnlyBlockedCapabilities = new Set<ToolCapability>(['write', 'execute'])

export class RuntimeProfileResolver {
  constructor(private readonly toolRegistry: ToolRegistry) {}

  resolve(options: RuntimeProfileOptions = {}): RuntimeProfile {
    const warnings: string[] = []
    const configuredIds = this.resolveRequestedIds(options.enabledTools, '工具偏好', warnings)
    const agentIds = this.resolveRequestedIds(options.agent?.enabledTools, 'Agent', warnings)
    const configuredSet = configuredIds && new Set(configuredIds)
    const agentSet = agentIds && new Set(agentIds)
    const readOnly = options.readOnly ?? options.agent?.readOnly ?? false

    const enabledToolIds = this.toolRegistry
      .list()
      .filter(registration => {
        if (!registration.defaultEnabled && !configuredSet?.has(registration.id)) return false
        if (configuredSet && !configuredSet.has(registration.id)) return false
        if (agentSet && !agentSet.has(registration.id)) return false
        if (
          readOnly &&
          registration.capabilities.some(capability => readOnlyBlockedCapabilities.has(capability))
        ) {
          return false
        }
        return true
      })
      .map(registration => registration.id)

    return Object.freeze({
      toolSnapshot: this.toolRegistry.createSnapshot(enabledToolIds),
      enabledToolIds: Object.freeze(enabledToolIds),
      warnings: Object.freeze(warnings),
    })
  }

  private resolveRequestedIds(
    requested: readonly string[] | undefined,
    source: string,
    warnings: string[]
  ): string[] | undefined {
    if (!requested) return undefined

    const resolved: string[] = []
    for (const idOrAlias of requested) {
      const id = this.toolRegistry.resolveId(idOrAlias)
      if (!id) {
        warnings.push(`${source}引用了不存在的工具: ${idOrAlias}`)
        continue
      }
      if (!resolved.includes(id)) resolved.push(id)
    }
    return resolved
  }
}
