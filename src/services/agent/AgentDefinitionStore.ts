import * as fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { AgentRegistry, type AgentDefinition, type AgentSource } from './AgentRegistry'

export type AgentDefinitionScope = 'global' | 'workspace'

const definitionSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  modelTier: z.enum(['main', 'sonnet', 'opus', 'haiku']).optional(),
  model: z.string().trim().min(1).optional(),
  effortLevel: z.enum(['low', 'medium', 'high', 'max']).optional(),
  enabledTools: z.array(z.string()).default([]),
  enabledSkills: z.array(z.string()).optional(),
  readOnly: z.boolean().default(true),
  permissionMode: z.enum(['default', 'acceptEdits', 'plan']).default('default'),
  maxIterations: z.number().int().min(1).max(500).default(30),
  isolation: z.enum(['none', 'worktree']).default('none'),
  defaultMode: z.enum(['foreground', 'background']).default('foreground'),
  enabled: z.boolean().default(true),
})

export type AgentDefinitionInput = z.input<typeof definitionSchema> & { systemPrompt: string }

export interface AgentValidationResult {
  valid: boolean
  errors: string[]
  definition?: AgentDefinition
}

export class AgentDefinitionStore {
  private warnings: string[] = []

  constructor(
    private readonly registry: AgentRegistry,
    private readonly globalDir: string,
    private readonly workspaceDir?: string
  ) {}

  async initialize(): Promise<string[]> {
    return this.reload()
  }

  list(): readonly Readonly<AgentDefinition>[] {
    return this.registry.list({ includeDisabled: true })
  }

  getWarnings(): readonly string[] {
    return this.warnings
  }

  validate(
    input: unknown,
    source: AgentSource = 'global'
  ): AgentValidationResult {
    const parsed = definitionSchema.safeParse(input)
    const errors = parsed.success
      ? []
      : parsed.error.issues.map(issue => `${issue.path.join('.') || 'definition'}: ${issue.message}`)
    const systemPrompt =
      input && typeof input === 'object' && typeof (input as { systemPrompt?: unknown }).systemPrompt === 'string'
        ? (input as { systemPrompt: string }).systemPrompt.trim()
        : ''
    if (!systemPrompt) errors.push('systemPrompt: 系统提示词不能为空')
    if (errors.length > 0 || !parsed.success) return { valid: false, errors }

    return {
      valid: true,
      errors: [],
      definition: {
        ...parsed.data,
        systemPrompt,
        source,
      },
    }
  }

  async save(
    input: AgentDefinitionInput,
    scope: AgentDefinitionScope
  ): Promise<Readonly<AgentDefinition>> {
    const source: AgentSource = scope
    const result = this.validate(input, source)
    if (!result.valid || !result.definition) {
      throw new Error(result.errors.join('\n'))
    }
    const root = this.getRoot(scope)
    const agentDir = this.safeAgentDir(root, result.definition.id)
    await fs.mkdir(agentDir, { recursive: true })

    const json: Record<string, unknown> = { ...result.definition }
    delete json.systemPrompt
    delete json.source
    await this.atomicWrite(
      path.join(agentDir, 'agent.json'),
      JSON.stringify({ schemaVersion: 1, ...json }, null, 2)
    )
    await this.atomicWrite(path.join(agentDir, 'system.md'), `${result.definition.systemPrompt}\n`)

    const activeDefinition = this.registry.get(result.definition.id)
    if (scope === 'workspace' || activeDefinition?.source !== 'workspace') {
      this.registry.register(result.definition)
    }
    return result.definition
  }

  async delete(id: string, scope: AgentDefinitionScope): Promise<void> {
    const root = this.getRoot(scope)
    const agentDir = this.safeAgentDir(root, id)
    await fs.rm(agentDir, { recursive: true, force: true })
    await this.reload()
  }

  private async reload(): Promise<string[]> {
    this.registry.clearCustom()
    const warnings: string[] = []
    await this.loadDirectory(this.globalDir, 'global', warnings)
    if (this.workspaceDir) await this.loadDirectory(this.workspaceDir, 'workspace', warnings)
    this.warnings = warnings
    return warnings
  }

  private async loadDirectory(
    root: string,
    source: AgentSource,
    warnings: string[]
  ): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      warnings.push(`${source} Agent 目录读取失败: ${String(error)}`)
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const agentDir = this.safeAgentDir(root, entry.name)
        const [jsonText, systemPrompt] = await Promise.all([
          fs.readFile(path.join(agentDir, 'agent.json'), 'utf8'),
          fs.readFile(path.join(agentDir, 'system.md'), 'utf8'),
        ])
        const raw = JSON.parse(jsonText) as AgentDefinitionInput
        if (raw.id !== entry.name) throw new Error('目录名必须与 Agent ID 一致')
        const result = this.validate({ ...raw, systemPrompt }, source)
        if (!result.valid || !result.definition) throw new Error(result.errors.join('; '))
        this.registry.register(result.definition)
      } catch (error) {
        warnings.push(`${source} Agent ${entry.name} 加载失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private getRoot(scope: AgentDefinitionScope): string {
    if (scope === 'global') return this.globalDir
    if (!this.workspaceDir) throw new Error('当前没有可用的工作区')
    return this.workspaceDir
  }

  private safeAgentDir(root: string, id: string): string {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error(`无效的 Agent ID: ${id}`)
    const resolvedRoot = path.resolve(root)
    const resolved = path.resolve(root, id)
    if (path.dirname(resolved) !== resolvedRoot) throw new Error('Agent 路径越界')
    return resolved
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(temporaryPath, content, 'utf8')
    await fs.rename(temporaryPath, filePath).catch(async error => {
      if (!['EEXIST', 'EPERM'].includes((error as NodeJS.ErrnoException).code || '')) throw error
      await fs.rm(filePath, { force: true })
      await fs.rename(temporaryPath, filePath)
    })
  }
}
