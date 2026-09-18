import type { AgentDefinition } from '@/types'

export function toPlainAgentDefinition(definition: AgentDefinition): AgentDefinition {
  return {
    ...definition,
    enabledTools: [...definition.enabledTools],
    enabledSkills: definition.enabledSkills ? [...definition.enabledSkills] : undefined,
  }
}
