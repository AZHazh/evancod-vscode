import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { normalizeOpenAIUsage } from '../core/services/api/shared'
import { OpenAIResponsesClient } from '../core/services/api/OpenAIResponsesClient'
import { prepareToolResultForContext } from '../core/tools/execution/toolResultContext'
import { ToolOrchestrator } from '../core/tools/execution/ToolOrchestrator'
import { microcompact } from '../services/compact/microcompact'
import {
  composeUserPrompt,
  createRequestContext,
  shouldIncludeRequestContract,
} from '../services/chat/UserPromptComposer'
import {
  DEFAULT_MAX_ITERATIONS,
  isSuccessfulTermination,
} from '../core/engine/termination'
import { PermissionResponseCache } from '../services/webview/PermissionResponseCache'
import { Tool, type ToolDefinition, type ToolResult } from '../core/tools/base/Tool'
import { ToolRegistry } from '../core/tools/registry/ToolRegistry'
import { AgentTool } from '../core/tools/agent/AgentTool'
import { RuntimeProfileResolver } from '../core/engine/RuntimeProfileResolver'
import {
  AgentRegistry,
  resolveAgentModel,
  type AgentDefinition,
} from '../services/agent/AgentRegistry'
import { MockStorageAdapter } from '../adapters/StorageAdapter'
import { ToolProfileService } from '../services/tools/ToolProfileService'
import { AgentDefinitionStore } from '../services/agent/AgentDefinitionStore'
import { MCPClient } from '../services/mcp/MCPClient'
import { normalizeMcpInputSchema } from '../core/tools/mcp/MCPRemoteTool'
import type { Message, Provider } from '../types'

const originalFetch = globalThis.fetch
const temporaryDirectories: string[] = []

class RegistryTestTool extends Tool {
  readonly description = 'Registry test tool'

  constructor(readonly name: string) {
    super()
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      input_schema: { type: 'object', properties: {}, required: [] },
    }
  }

  async execute(): Promise<ToolResult> {
    return { success: true, content: this.name }
  }
}

function createAgentDefinition(
  source: AgentDefinition['source'],
  name: string = source
): AgentDefinition {
  return {
    id: 'reviewer',
    name,
    description: 'Reviews code',
    systemPrompt: 'Review the requested code.',
    enabledTools: ['builtin.read'],
    readOnly: true,
    permissionMode: 'default',
    maxIterations: 10,
    isolation: 'none',
    enabled: true,
    source,
  }
}

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      fs.rm(directory, { recursive: true, force: true })
    )
  )
})

describe('Agent runtime regression invariants', () => {
  it('keeps tool snapshots isolated from later registrations', () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'builtin.read',
      name: 'read',
      description: 'Read data',
      source: 'builtin',
      category: 'test',
      capabilities: ['read'],
      aliases: ['legacy_read'],
      defaultEnabled: true,
      create: () => new RegistryTestTool('read'),
    })
    const snapshot = registry.createSnapshot()

    registry.register({
      id: 'builtin.write',
      name: 'write',
      description: 'Write data',
      source: 'builtin',
      category: 'test',
      capabilities: ['write'],
      defaultEnabled: true,
      create: () => new RegistryTestTool('write'),
    })

    assert.deepEqual(snapshot.list().map(tool => tool.id), ['builtin.read'])
    assert.equal(registry.resolveId('legacy_read'), 'builtin.read')
    assert.throws(
      () =>
        registry.register({
          id: 'builtin.read',
          name: 'other',
          description: 'Duplicate',
          source: 'builtin',
          category: 'test',
          capabilities: ['read'],
          defaultEnabled: true,
          create: () => new RegistryTestTool('other'),
        }),
      /工具 ID 已注册/
    )
  })

  it('intersects tool preferences with agent tools and read-only capabilities', () => {
    const registry = new ToolRegistry()
    for (const [id, capability] of [
      ['read', 'read'],
      ['write', 'write'],
      ['shell', 'execute'],
      ['web', 'network'],
    ] as const) {
      registry.register({
        id: `builtin.${id}`,
        name: id,
        description: `${id} tool`,
        source: 'builtin',
        category: 'test',
        capabilities: [capability],
        defaultEnabled: true,
        create: () => new RegistryTestTool(id),
      })
    }

    const agent = {
      ...createAgentDefinition('builtin'),
      enabledTools: ['read', 'write', 'web', 'missing'],
    }
    const profile = new RuntimeProfileResolver(registry).resolve({
      enabledTools: ['builtin.read', 'builtin.write', 'builtin.shell', 'builtin.web'],
      agent,
      readOnly: true,
    })

    assert.deepEqual(profile.enabledToolIds, ['builtin.read', 'builtin.web'])
    assert.deepEqual(profile.warnings, ['Agent引用了不存在的工具: missing'])
  })

  it('applies Agent definition source precedence', () => {
    const registry = new AgentRegistry()
    registry.register(createAgentDefinition('builtin'))
    registry.register(createAgentDefinition('global'))
    registry.register(createAgentDefinition('workspace'))

    assert.equal(registry.get('reviewer')?.name, 'workspace')
    assert.throws(
      () => registry.register(createAgentDefinition('global', 'lower priority')),
      /不能覆盖/
    )
  })

  it('resolves an Agent model tier against the active Provider', () => {
    const definition = {
      ...createAgentDefinition('workspace'),
      modelTier: 'sonnet' as const,
    }
    const createProvider = (id: string, sonnet: string): Provider => ({
      id,
      name: id,
      type: 'custom',
      apiFormat: 'anthropic',
      apiKey: 'test',
      models: {
        main: `${id}-main`,
        sonnet,
        opus: `${id}-opus`,
        haiku: `${id}-haiku`,
      },
      createdAt: new Date(0).toISOString(),
    })

    assert.equal(resolveAgentModel(definition, createProvider('first', 'first-sonnet'), 'fallback'), 'first-sonnet')
    assert.equal(resolveAgentModel(definition, createProvider('second', 'second-sonnet'), 'fallback'), 'second-sonnet')
    assert.equal(
      resolveAgentModel({ model: 'legacy-model' }, createProvider('first', 'first-sonnet'), 'fallback'),
      'legacy-model'
    )
    assert.equal(resolveAgentModel({}, createProvider('first', 'first-sonnet'), 'fallback'), 'fallback')
  })

  it('merges workspace tool preferences over global differences', async () => {
    const registry = new ToolRegistry()
    for (const name of ['read', 'write', 'new_tool']) {
      registry.register({
        id: `builtin.${name}`,
        name,
        description: `${name} tool`,
        source: 'builtin',
        category: 'test',
        capabilities: [name === 'write' ? 'write' : 'read'],
        defaultEnabled: true,
        create: () => new RegistryTestTool(name),
      })
    }
    const storage = new MockStorageAdapter()
    const service = new ToolProfileService(storage, registry)

    await service.save('global', ['builtin.read', 'builtin.new_tool'])
    assert.deepEqual(service.getState('workspace').enabledTools, [
      'builtin.read',
      'builtin.new_tool',
    ])

    await service.save('workspace', ['builtin.write', 'builtin.new_tool'])
    assert.deepEqual(service.resolve().enabledTools, [
      'builtin.write',
      'builtin.new_tool',
    ])

    await service.reset('workspace')
    assert.deepEqual(service.resolve().enabledTools, ['builtin.read', 'builtin.new_tool'])
  })

  it('falls back to default-enabled tools when a stored profile is corrupted', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'builtin.read',
      name: 'read',
      description: 'Read tool',
      source: 'builtin',
      category: 'test',
      capabilities: ['read'],
      defaultEnabled: true,
      create: () => new RegistryTestTool('read'),
    })
    const storage = new MockStorageAdapter()
    await storage.setGlobal('toolProfile.global.v1', {
      scope: 'global',
      enabledTools: 'not-an-array',
    })

    const state = new ToolProfileService(storage, registry).getState('global')
    assert.deepEqual(state.enabledTools, ['builtin.read'])
    assert.match(state.warnings[0], /配置损坏/)
  })

  it('loads workspace Agent definitions over global definitions and restores fallback on delete', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'evancod-agents-'))
    temporaryDirectories.push(root)
    const registry = new AgentRegistry()
    const store = new AgentDefinitionStore(
      registry,
      path.join(root, 'global'),
      path.join(root, 'workspace')
    )
    const base = {
      id: 'reviewer',
      name: 'Global reviewer',
      description: 'Reviews code',
      systemPrompt: 'Review code carefully.',
      modelTier: 'sonnet' as const,
      enabledTools: ['builtin.read'],
      readOnly: true,
      permissionMode: 'default' as const,
      maxIterations: 20,
      isolation: 'none' as const,
      enabled: true,
    }

    await store.save(base, 'global')
    assert.equal(registry.get('reviewer')?.modelTier, 'sonnet')
    await store.save({ ...base, name: 'Workspace reviewer' }, 'workspace')
    assert.equal(registry.get('reviewer')?.name, 'Workspace reviewer')
    assert.equal(registry.get('reviewer')?.source, 'workspace')

    await store.save({ ...base, name: 'Updated global reviewer' }, 'global')
    assert.equal(registry.get('reviewer')?.name, 'Workspace reviewer')

    await store.delete('reviewer', 'workspace')
    assert.equal(registry.get('reviewer')?.name, 'Updated global reviewer')
    assert.equal(registry.get('reviewer')?.source, 'global')
  })

  it('returns a failed tool result when a foreground Agent fails', async () => {
    const definition = {
      ...createAgentDefinition('builtin'),
      id: 'reviewer',
      defaultMode: 'foreground' as const,
    }
    const coordinator = {
      listAgentDefinitions: () => [definition],
      getAgentDefinition: () => definition,
      startAgent: async () => ({
        id: 'agent-test',
        success: false,
        summary: 'Agent 执行超时',
        error: 'Agent inactivity timeout',
        duration: 1,
      }),
    }
    const tool = new AgentTool(
      coordinator as any,
      process.cwd(),
      { models: { main: 'test-model' } } as Provider,
      'test-model'
    )

    const result = await tool.execute({
      subagent_type: 'reviewer',
      description: 'Review code',
      prompt: 'Review the requested file',
    })

    assert.equal(result.success, false)
    assert.match(result.error || '', /不得由主 Agent 自行替代执行/)
  })

  it('rejects unsafe Agent IDs and bypass permission definitions', () => {
    const registry = new AgentRegistry()
    const store = new AgentDefinitionStore(registry, 'global')
    const invalid = store.validate({
      id: '../escape',
      name: 'Unsafe',
      description: 'Unsafe definition',
      systemPrompt: 'Do anything.',
      enabledTools: [],
      readOnly: false,
      permissionMode: 'bypassPermissions',
      maxIterations: 10,
      isolation: 'none',
      enabled: true,
    })

    assert.equal(invalid.valid, false)
    assert.ok(invalid.errors.some(error => error.includes('permissionMode')))
  })

  it('negotiates, discovers and calls an official MCP stdio example server', async () => {
    const serverScript = path.resolve(
      process.cwd(),
      'node_modules/@modelcontextprotocol/sdk/dist/cjs/examples/server/progressExample.js'
    )
    const client = new MCPClient({
      name: 'official-example',
      command: process.execPath,
      args: [serverScript],
    })

    try {
      await client.connect()
      assert.equal(client.getState(), 'connected')
      const tools = await client.listTools()
      assert.ok(tools.some(tool => tool.name === 'count'))
      const result = (await client.callTool('count', { n: 1 })) as any
      assert.equal(result.content[0].text, 'Counted to 1')
      assert.ok(client.getCapabilities().tools)
    } finally {
      client.disconnect()
    }
  })

  it('normalizes MCP JSON Schema for the project tool protocol', () => {
    assert.deepEqual(
      normalizeMcpInputSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'integer' },
        },
        required: ['query'],
      }),
      {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: '' },
        },
        required: ['query'],
      }
    )
  })

  it('reads Responses cached tokens from the official plural field', () => {
    const usage = normalizeOpenAIUsage({
      input_tokens: 4096,
      output_tokens: 128,
      input_tokens_details: { cached_tokens: 3072, cache_write_tokens: 512 },
    })

    assert.equal(usage?.cacheReadTokens, 3072)
    assert.equal(usage?.cacheWriteTokens, 512)
    assert.equal(usage?.lastPromptTokens, 4096)
  })

  it('streams reasoning summaries and falls back when a gateway rejects summary', async () => {
    const requestBodies: any[] = []
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body || '{}'))
      requestBodies.push(body)
      if (requestBodies.length === 1) {
        return new Response(
          JSON.stringify({ error: { message: 'Unknown parameter: reasoning.summary' } }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
      }

      const events = [
        { type: 'response.reasoning_summary_text.delta', delta: '正在检查' },
        { type: 'response.output_text.delta', delta: '完成' },
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            usage: {
              input_tokens: 100,
              output_tokens: 10,
              input_tokens_details: { cached_tokens: 80 },
            },
          },
        },
      ]
      const sse = `${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }

    const provider: Provider = {
      id: 'test',
      name: 'test',
      type: 'custom',
      apiFormat: 'openai_responses',
      baseUrl: 'https://example.test',
      apiKey: 'test',
      models: { main: 'gpt-5', sonnet: '', opus: '', haiku: '' },
      createdAt: new Date(0).toISOString(),
    }
    const client = new OpenAIResponsesClient({
      provider,
      model: 'gpt-5',
      effortLevel: 'medium',
    })
    const streamed: Array<{ text: string; type: string }> = []
    const response = await client.sendMessageStream([], (text, type) => {
      if (text) streamed.push({ text, type })
    })

    assert.equal(requestBodies.length, 2)
    assert.equal(requestBodies[0].reasoning.summary, 'auto')
    assert.equal(requestBodies[1].reasoning.summary, undefined)
    assert.deepEqual(streamed, [
      { text: '正在检查', type: 'thinking' },
      { text: '完成', type: 'delta' },
    ])
    assert.equal(response.usage?.cacheReadTokens, 80)
    assert.equal(response.incomplete, false)
  })

  it('aborts an in-flight model request without waiting for another stream event', async () => {
    globalThis.fetch = async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) {
          reject(new DOMException('The operation was aborted', 'AbortError'))
          return
        }
        signal?.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted', 'AbortError')),
          { once: true }
        )
      })

    const provider: Provider = {
      id: 'abort-test',
      name: 'abort-test',
      type: 'custom',
      apiFormat: 'openai_responses',
      baseUrl: 'https://example.test',
      apiKey: 'test',
      models: { main: 'gpt-5', sonnet: '', opus: '', haiku: '' },
      createdAt: new Date(0).toISOString(),
    }
    const client = new OpenAIResponsesClient({ provider, model: 'gpt-5' })
    const controller = new AbortController()
    const request = client.sendMessageStream([], () => undefined, [], {
      signal: controller.signal,
    })

    controller.abort()

    await assert.rejects(request, error => {
      assert.ok(error instanceof Error)
      return error.name === 'AbortError'
    })
  })

  it('aborts immediately while a failed stream is waiting to retry', async () => {
    let markFetchStarted: (() => void) | undefined
    const fetchStarted = new Promise<void>(resolve => {
      markFetchStarted = resolve
    })
    globalThis.fetch = async () => {
      markFetchStarted?.()
      throw new TypeError('fetch failed')
    }

    const provider: Provider = {
      id: 'retry-abort-test',
      name: 'retry-abort-test',
      type: 'custom',
      apiFormat: 'openai_responses',
      baseUrl: 'https://example.test',
      apiKey: 'test',
      models: { main: 'gpt-5', sonnet: '', opus: '', haiku: '' },
      createdAt: new Date(0).toISOString(),
    }
    const client = new OpenAIResponsesClient({ provider, model: 'gpt-5' })
    const controller = new AbortController()
    const request = client.sendMessageStream([], () => undefined, [], {
      signal: controller.signal,
    })

    await fetchStarted
    await new Promise<void>(resolve => setImmediate(resolve))
    controller.abort()

    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        assert.rejects(request, /Query cancelled/),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('取消未立即打断流重试等待')), 250)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  })

  it('does not start another tool after the run is cancelled', async () => {
    let executionCount = 0
    const tool = { name: 'read_file', isConcurrencySafe: true }
    const executor = {
      runToolUse: async () => {
        executionCount++
        throw new Error('should not execute')
      },
    }
    const orchestrator = new ToolOrchestrator(
      [tool] as any,
      executor as any,
      () => true
    )

    await assert.rejects(
      orchestrator.runTools([{ id: 'call-1', name: 'read_file', input: { path: 'x' } }]),
      /Query cancelled/
    )
    assert.equal(executionCount, 0)
  })

  it('archives oversized tool results and keeps an exact recovery copy', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'evancod-result-'))
    temporaryDirectories.push(cwd)
    const original = `start\n${'0123456789'.repeat(9000)}\nend`
    const prepared = await prepareToolResultForContext(cwd, 'call:1', 'bash', original)

    assert.ok(prepared.archivedPath)
    assert.ok(prepared.content.length < original.length)
    assert.match(prepared.content, /read_file/)
    const archived = await fs.readFile(path.join(cwd, prepared.archivedPath!), 'utf8')
    assert.equal(archived, original)
  })

  it('keeps failed and recent tool results while summarizing older successes', () => {
    const messages: Message[] = Array.from({ length: 8 }, (_, index) => ({
      id: `tool-${index}`,
      role: 'tool' as const,
      toolName: 'bash',
      toolCallId: `call-${index}`,
      content:
        index === 1
          ? 'Error: test failed'
          : `result-${index}\n${'x'.repeat(2500)}\nend-${index}`,
      timestamp: index,
    }))

    const compacted = microcompact(messages, 5)
    assert.match(compacted[0].content, /旧结果已因上下文接近上限而压缩/)
    assert.equal(compacted[1].content, messages[1].content)
    assert.equal(compacted[7].content, messages[7].content)
  })

  it('only repeats a request contract when structure or recovery needs it', () => {
    const simple = composeUserPrompt('解释这个函数', [], [])
    const simpleContext = createRequestContext('r1', 'm1', '解释这个函数', simple)
    assert.equal(shouldIncludeRequestContract(simpleContext), false)

    const complex = composeUserPrompt('1. 修改协议\n2. 补充测试', [], [])
    const complexContext = createRequestContext('r2', 'm2', complex.instruction, complex)
    assert.equal(shouldIncludeRequestContract(complexContext), true)
    assert.equal(shouldIncludeRequestContract(simpleContext, { continuation: true }), true)
  })

  it('does not classify guardrail exits as successful completion', () => {
    assert.equal(DEFAULT_MAX_ITERATIONS, 100)
    assert.equal(isSuccessfulTermination('model_completed'), true)
    assert.equal(isSuccessfulTermination('tasks_completed'), true)
    assert.equal(isSuccessfulTermination('max_iterations'), false)
    assert.equal(isSuccessfulTermination('no_progress'), false)
    assert.equal(isSuccessfulTermination('task_incomplete'), false)
  })

  it('replays an acknowledged permission response until the retry window expires', () => {
    let now = 1000
    const cache = new PermissionResponseCache(5000, () => now)
    const response = { requestId: 'permission-1', approved: true }

    cache.set(response)
    assert.deepEqual(cache.get(response.requestId), response)

    now += 5000
    assert.equal(cache.get(response.requestId), undefined)
  })
})
