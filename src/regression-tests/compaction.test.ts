import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import Module from 'node:module'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { compactConversation } from '../services/compact/compact'
import {
  compactWithBudget, conversationDigest, replayCompaction, restoreCompactedMessages, selectRetainedMessages,
  type BudgetCompactionOptions,
} from '../services/compact/budgetCompaction'
import type { ApiClient, ApiClientResponse } from '../core/services/api/shared'
import type { CompactionRecord, Message, Session } from '../types'
import type { SessionPersistenceService } from '../services/persistence/SessionPersistenceService'
import { ContextBudgetManager, getEffectiveInputWindow } from '../services/context/ContextBudgetManager'
import { prepareSessionForWebview } from '../services/persistence/sessionSerialization'

function message(id: string, role: Message['role'], content: string): Message {
  return { id, role, content, timestamp: 1 }
}

function options(overrides: Partial<BudgetCompactionOptions> = {}): BudgetCompactionOptions {
  return {
    messages: [message('goal', 'user', 'Keep the database schema unchanged.'),
      message('old', 'assistant', '历史证据'.repeat(15_000)),
      ...Array.from({ length: 30 }, (_, index) => message(`recent-${index}`, 'assistant', 'progress'))],
    apiClient: { sendMessageStream: async () => ({ content: 'Checkpoint: continue verification.' }) },
    providerId: 'test', model: 'summary-model', trigger: 'automatic', contextWindow: 100_000,
    systemPrompt: 'Current project instructions', tools: [], ...overrides,
  }
}

function toolExchange(): Message[] {
  return [
    { ...message('calls', 'assistant', ''), toolCalls: [
      { id: 'a', name: 'read_file', input: { path: 'src/auth.ts' } },
      { id: 'b', name: 'bash', input: { command: 'npm test' } },
    ] },
    { ...message('result-a', 'tool', 'export const valid = true'), toolCallId: 'a', toolName: 'read_file' },
    { ...message('result-b', 'tool', 'Error: verification failed'), toolCallId: 'b', toolName: 'bash' },
  ]
}

describe('budgeted compaction', () => {
  it('sends native roles, tool arguments and linked results without image payloads', async () => {
    const source = [message('goal', 'user', 'Inspect login'), ...toolExchange(), {
      ...message('image', 'user', 'Screenshot'),
      contentBlocks: [{ type: 'image' as const, source: {
        type: 'base64' as const, media_type: 'image/png', data: 'original-pixels',
      } }],
    }]
    const original = structuredClone(source)
    const tools = [{ name: 'read_file', input_schema: { type: 'object' } }]
    const client: Pick<ApiClient, 'sendMessageStream'> = {
      sendMessageStream: async (messages, _stream, schemas) => {
        assert.equal(messages[1].role, 'assistant')
        assert.deepEqual(messages[1].toolCalls?.[0].input, { path: 'src/auth.ts' })
        assert.equal(messages[2].role, 'tool')
        assert.equal(messages[2].toolCallId, 'a')
        assert.equal(messages[3].toolCallId, 'b')
        assert.deepEqual(schemas, tools)
        assert.doesNotMatch(JSON.stringify(messages), /original-pixels/)
        assert.match(messages.at(-1)!.content, /Do not continue the task or call tools/)
        return { content: 'The login source was inspected; verification failed.' }
      },
    }
    await compactConversation(source, client, 'test', { tools })
    assert.deepEqual(source, original)
  })

  it('retains a token-sized tail and never splits parallel tool exchanges', () => {
    const short = Array.from({ length: 30 }, (_, index) => message(`m-${index}`, 'assistant', 'ok'))
    assert.equal(selectRetainedMessages(short, 500, 0).messages.length, 30)
    const long = short.map(item => ({ ...item, content: '中'.repeat(1_000) }))
    assert.equal(selectRetainedMessages(long, 500, 0).messages.length, 1)
    const source = [message('goal', 'user', 'Do not change the schema.'), ...long, ...toolExchange()]
    const retained = selectRetainedMessages(source, 1, 100)
    assert.deepEqual(retained.messages.map(item => item.id), ['goal', 'calls', 'result-a', 'result-b'])
    assert.deepEqual(retained.protectedUserMessageIds, ['goal'])
  })

  it('keeps recent user corrections verbatim outside the model summary', async () => {
    const config = options()
    config.messages.push(message('correction', 'user', 'Use PostgreSQL, not SQLite.'))
    const record = await compactWithBudget(config)
    assert.ok(record.afterTokens < record.beforeTokens * 0.9)
    assert.equal(record.replacementMessages.find(item => item.id === 'goal')?.content, config.messages[0].content)
    assert.equal(record.replacementMessages.find(item => item.id === 'correction')?.content, 'Use PostgreSQL, not SQLite.')
    assert.ok(record.protectedUserMessageIds.includes('correction'))
    assert.equal(config.messages[1].id, 'old')
  })

  it('fits the target using server-calibrated estimates after an overflow', async () => {
    const meter = new ContextBudgetManager()
    for (let index = 0; index < 5; index++) meter.recordContextLimitFailure()
    const config = options({ messages: [
      message('goal', 'user', '要求'.repeat(3_000)),
      message('old', 'assistant', '旧证据'.repeat(20_000)),
      ...Array.from({ length: 40 }, (_, index) => message(`recent-${index}`, 'assistant', '中'.repeat(500))),
    ] })
    config.estimateRequest = messages => meter.estimateTokens({
      messages, systemPrompt: config.systemPrompt, tools: config.tools,
    })
    const record = await compactWithBudget(config)
    assert.ok(record.afterTokens <= getEffectiveInputWindow(config.contextWindow) * 0.55)
    assert.equal(record.afterTokens, config.estimateRequest(record.replacementMessages))
    assert.ok(record.retainTokens < getEffectiveInputWindow(config.contextWindow) * 0.16)
    assert.equal(record.replacementMessages.find(item => item.id === 'goal')?.content, config.messages[0].content)
  })

  it('rebuilds current runtime state after the summary completes', async () => {
    let state = 'in_progress'
    const config = options({
      buildRuntimeMessages: () => [{ ...message('runtime-context', 'user', state), internal: true }],
      apiClient: { sendMessageStream: async () => { state = 'completed'; return { content: 'An outdated task description.' } } },
    })
    const record = await compactWithBudget(config)
    assert.equal(record.replacementMessages[0].content, 'completed')
    assert.equal(record.replacementMessages.filter(item => item.id === 'runtime-context').length, 1)
  })

  it('rejects incomplete, empty, tool-only and ineffective summaries without changing history', async () => {
    const responses: ApiClientResponse[] = [
      { content: 'partial', incomplete: true }, { content: 'partial', stopReason: 'max_tokens' },
      { content: '' }, { content: 'tool', toolCalls: [{ name: 'bash' }] },
      { content: '中'.repeat(100_000) },
    ]
    for (const response of responses) {
      const config = options({ apiClient: { sendMessageStream: async () => response } })
      const before = structuredClone(config.messages)
      await assert.rejects(compactWithBudget(config))
      assert.deepEqual(config.messages, before)
    }
  })

  it('refuses to discard an oversized latest user request to meet a token target', async () => {
    const config = options()
    config.messages.push(message('latest', 'user', '要求'.repeat(40_000)))
    const before = structuredClone(config.messages)
    await assert.rejects(compactWithBudget(config), /original history retained/)
    assert.deepEqual(config.messages, before)
  })

  it('honors cancellation and rejects history changes during summarization', async () => {
    const controller = new AbortController()
    const config = options({ signal: controller.signal,
      apiClient: { sendMessageStream: async () => { controller.abort(); return { content: 'summary' } } },
    })
    const before = structuredClone(config.messages)
    await assert.rejects(compactWithBudget(config), { name: 'AbortError' })
    assert.deepEqual(config.messages, before)
    const changed = options()
    changed.apiClient = { sendMessageStream: async () => {
      changed.messages.push(message('new', 'user', 'New instruction'))
      return { content: 'summary' }
    } }
    await assert.rejects(compactWithBudget(changed), /Conversation changed/)
    assert.equal(changed.messages.at(-1)?.id, 'new')
  })

  it('replays consecutive checkpoints, preserves suffixes and detects corrupt records', async () => {
    const first = await compactWithBudget(options())
    const between = [message('more-evidence', 'assistant', '新证据'.repeat(20_000)), message('new-goal', 'user', 'Finish verification')]
    const second = await compactWithBudget(options({ messages: [...replayCompaction(first), ...between] }))
    const suffix = message('after', 'assistant', 'continued')
    const records = JSON.parse(JSON.stringify([first, second])) as CompactionRecord[]
    const replayed = restoreCompactedMessages([...first.sourceMessages, ...between, suffix], records)
    assert.deepEqual(replayed, [...second.replacementMessages, suffix])
    assert.equal(replayed.filter(item => item.id.startsWith('compact-boundary-')).length, 1)
    const corrupt = structuredClone(first)
    corrupt.replacementMessages[0].content = 'corrupted'
    assert.throws(() => replayCompaction(corrupt), /Invalid compaction/)
    assert.equal(conversationDigest(first.sourceMessages), first.sourceDigest)
  })
})

describe('compaction persistence', () => {
  it('checkpoints to disk, restores replacement history and reports failed writes', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'evancod-compact-'))
    const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown }
    const originalLoad = loader._load
    const requireModule = Module.createRequire(__filename)
    const stub = mock.method(loader, '_load', function (this: typeof loader, id: string, ...args: unknown[]) {
      return id === 'vscode' ? {} : originalLoad.call(this, id, ...args)
    })
    let Constructor: typeof SessionPersistenceService
    try { Constructor = requireModule('../services/persistence/SessionPersistenceService').SessionPersistenceService }
    finally { stub.mock.restore() }
    const context = { globalStorageUri: { fsPath: directory }, globalState: {
      get: () => undefined, keys: () => [], update: async () => undefined,
    } }
    const store = new Constructor(context as any)
    const restoredStore = new Constructor(context as any)
    try {
      const record = await compactWithBudget(options())
      const session: Session = {
        id: 'session', name: 'Test', createdAt: Date.now(), updatedAt: Date.now(), workDir: directory,
        messages: record.sourceMessages, compactions: [record],
      }
      const data = { sessions: { session }, currentSessionId: session.id }
      const view = prepareSessionForWebview(session)
      assert.equal(view.compactions, undefined)
      assert.equal(session.compactions?.length, 1)
      await store.checkpoint(data, session.id)
      const loaded = await restoredStore.load()
      assert.deepEqual(loaded.sessions.session.messages, record.replacementMessages)
      assert.deepEqual(replayCompaction(loaded.sessions.session.compactions![0]), record.replacementMessages)
      session.compactions = [...session.compactions!, { ...record, id: 'next-checkpoint' }]
      const rename = mock.method(fs, 'rename', async () => { throw new Error('disk unavailable') })
      const logging = mock.method(console, 'error', () => undefined)
      try { await assert.rejects(store.checkpoint(data, session.id), /could not be persisted/) }
      finally { rename.mock.restore(); logging.mock.restore() }
    } finally {
      store.dispose()
      restoredStore.dispose()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
