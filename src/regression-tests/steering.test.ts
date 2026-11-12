import assert from 'node:assert/strict'
import Module from 'node:module'
import { mock, test } from 'node:test'
import { ContextBudgetManager } from '../services/context/ContextBudgetManager'
import type { Message } from '../types'
import type { AgentServerEvent } from '../types/messages'

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
const requireModule = Module.createRequire(__filename)
const mockedLoad = mock.method(loader, '_load', function (this: typeof loader, id: string, ...args: unknown[]) {
  return id === 'vscode' ? {} : originalLoad.call(this, id, ...args)
})
const { QueryEngine, QueryCancelledError } = requireModule('../core/engine/QueryEngine')
const { ChatService } = requireModule('../services/chat/ChatService')
mockedLoad.mock.restore()

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const user = (id: string, content = id): Message => ({ id, role: 'user', content, timestamp: Date.now() })

function fixture(sendMessageStream: (...args: any[]) => Promise<any>, maxIterations = 5) {
  const events: AgentServerEvent[] = []
  let id = 0
  const engine: any = Object.assign(Object.create(QueryEngine.prototype), {
    config: { messages: [], provider: { models: {} }, model: 'test', maxIterations, maxExecutionSegments: 1 },
    tools: [], apiClient: { sendMessageStream }, pendingDeltas: [],
    pendingUserInputs: [], contextBudget: new ContextBudgetManager(),
    abortController: new AbortController(), toolUseNames: new Map(),
    visualContextBuilder: { buildPending: async () => ({ contexts: [] }) },
    toolOrchestrator: { resetDedup: mock.fn() },
    bashTool: { cancelAll: mock.fn() }, permissionWaiters: new Map(), interactionWaiters: new Map(),
    permissionTimeouts: new Map(), permissionRequestTools: new Map(), permissionStartedAt: new Map(),
    onAgentEventCallback: (event: AgentServerEvent) => events.push(event),
    generateId: () => `generated-${++id}`,
    buildRequestMessages: () => structuredClone(engine.config.messages),
    assessRequestBudget: () => ({ estimatedTokens: 10, effectiveWindow: 100_000, usageRatio: 0.001, shouldCompact: false }),
    getConfiguredContextWindow: () => 100_000,
    emitContextUsage: () => undefined,
  })
  return { engine, events }
}

test('steers a running stream with FIFO inputs, preserving partial text and the original task', async () => {
  const started = deferred()
  const preparation = deferred<Message>()
  const requests: Message[][] = []
  let firstSignal!: AbortSignal
  const { engine, events } = fixture(async (messages, delta, _tools, options) => {
    requests.push(messages)
    if (requests.length === 1) {
      firstSignal = options.signal
      delta('', 'start')
      delta('已有进展', 'delta')
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        started.resolve()
      })
    }
    delta('', 'start')
    delta('完成追加要求', 'delta')
    return { content: '完成追加要求' }
  })
  const query = engine.query('原始任务', undefined, 'original')
  await started.promise
  const first = engine.enqueueUserInput(() => preparation.promise)
  const second = engine.enqueueUserInput(async () => user('second', '同一条补充'))
  assert.ok(first)
  assert.ok(second)
  assert.equal(firstSignal.aborted, true)
  assert.equal(engine.abortController.signal.aborted, false)
  preparation.resolve(user('first', '同一条补充'))
  await Promise.all([first, second, query])
  assert.deepEqual(requests[1].map(message => message.content), ['原始任务', '已有进展', '同一条补充', '同一条补充'])
  assert.deepEqual(events.filter(event => event.type === 'user_input').map((event: any) => event.message.id), ['first', 'second'])
  assert.equal(events.filter(event => event.type === 'message_complete').length, 1)
  assert.equal(engine.bashTool.cancelAll.mock.callCount(), 0)
  assert.equal(engine.enqueueUserInput(async () => user('too-late')), undefined)
})

test('waits for tool results before inserting new input, including at the execution budget', async () => {
  const toolStarted = deferred()
  const toolFinished = deferred()
  const requests: Message[][] = []
  const { engine } = fixture(async (messages) => {
    requests.push(messages)
    return requests.length === 1
      ? { content: '检查文件', toolCalls: [{ id: 'read', name: 'read_file', input: {} }] }
      : { content: '检查完成' }
  }, 1)
  engine.executeToolCalls = async () => {
    toolStarted.resolve()
    await toolFinished.promise
    return { results: [{ toolCallId: 'read', toolName: 'read_file', content: '文件正文' }], noProgress: true }
  }
  const query = engine.query('检查')
  await toolStarted.promise
  const input = engine.enqueueUserInput(async () => user('followup'))
  assert.equal(engine.abortController.signal.aborted, false)
  toolFinished.resolve()
  await Promise.all([input, query])
  assert.deepEqual(requests[1].map(message => message.role), ['user', 'assistant', 'tool', 'user'])
  assert.equal(requests[1][2].toolCallId, 'read')
  assert.equal(requests[1][3].id, 'followup')
  assert.equal(engine.bashTool.cancelAll.mock.callCount(), 0)
})

test('a failed attachment does not terminate the task or discard later inputs', async () => {
  const visual = deferred<{ contexts: [] }>()
  const requests: Message[][] = []
  const { engine } = fixture(async messages => { requests.push(messages); return { content: '完成' } })
  engine.visualContextBuilder.buildPending = () => visual.promise
  const query = engine.query('原始任务')
  const failed = engine.enqueueUserInput(async () => { throw new Error('附件不存在') })
  const rejection = assert.rejects(failed, /附件不存在/)
  const accepted = engine.enqueueUserInput(async () => user('valid'))
  visual.resolve({ contexts: [] })
  await Promise.all([query, accepted, rejection])
  assert.deepEqual(requests[0].filter(message => message.role === 'user').map(message => message.content), ['原始任务', 'valid'])
})

test('stop rejects queued messages even when a tool has not returned yet', async () => {
  const toolStarted = deferred()
  const toolFinished = deferred()
  const { engine } = fixture(async () => ({
    content: '', toolCalls: [{ id: 'read', name: 'read_file', input: {} }],
  }))
  engine.executeToolCalls = async () => {
    toolStarted.resolve()
    await toolFinished.promise
    return { results: [] }
  }
  const query = engine.query('原始任务')
  const cancelledQuery = assert.rejects(query, QueryCancelledError)
  await toolStarted.promise
  const input = engine.enqueueUserInput(async () => user('never-consumed'))
  const cancelledInput = assert.rejects(input, QueryCancelledError)
  engine.cancel('用户停止生成')
  await cancelledInput
  toolFinished.resolve()
  await cancelledQuery
})

test('stop cancels pending preparation immediately and rejects queued inputs', async () => {
  const preparing = deferred()
  const never = deferred<Message>()
  const visual = deferred<{ contexts: [] }>()
  const { engine } = fixture(async () => ({ content: '不可到达' }))
  engine.visualContextBuilder.buildPending = () => visual.promise
  const query = engine.query('原始任务')
  const first = engine.enqueueUserInput(() => { preparing.resolve(); return never.promise })
  const second = engine.enqueueUserInput(async () => user('second'))
  const failures = [assert.rejects(query, QueryCancelledError), assert.rejects(first, QueryCancelledError), assert.rejects(second, QueryCancelledError)]
  visual.resolve({ contexts: [] })
  await preparing.promise
  engine.cancel('用户停止生成')
  await Promise.all(failures)
  never.resolve(user('late'))
  assert.equal(engine.config.messages.some((message: Message) => message.id === 'late'), false)
})

test('routes steering by explicit session and falls back to a new turn once the engine closes', async () => {
  const accepted = deferred()
  let prepared: (() => Promise<Message>) | undefined
  let queuedSession: string | undefined
  const runtime = {
    activeRequest: Promise.resolve(), requestQueue: Promise.resolve(), isStreaming: true,
    engine: { enqueueUserInput: (prepare: () => Promise<Message>) => { prepared = prepare; return accepted.promise } },
  }
  const service: any = Object.assign(Object.create(ChatService.prototype), {
    currentSessionId: 'other', sessions: [{ id: 'one' }, { id: 'other' }],
    sessionRuntimes: new Map([['one', runtime]]),
    providerService: { getActiveProvider: () => ({ apiFormat: 'openai_chat' }) },
    prepareSteeringMessage: async (sessionId: string) => user(sessionId),
    taskManager: { runInSession: async (sessionId: string, operation: () => Promise<void>) => { queuedSession = sessionId; await operation() } },
    runMessage: async () => undefined,
  })
  const send = service.sendMessage('追加', [], [], 'client-id', 'one')
  assert.equal((await prepared!()).id, 'one')
  accepted.resolve()
  await send
  assert.equal(queuedSession, undefined)
  runtime.engine.enqueueUserInput = () => undefined as any
  await service.sendMessage('新一轮', [], [], 'next', 'one')
  assert.equal(queuedSession, 'one')
})

test('accepts messages during initial preparation and persists their text, attachments and requirements in one run', async () => {
  const memoryReady = deferred()
  const modelStarted = deferred()
  const finishModel = deferred()
  const requests: Message[][] = []
  const { engine } = fixture(async messages => {
    requests.push(messages)
    modelStarted.resolve()
    await finishModel.promise
    return { content: '全部完成' }
  })
  const session: any = { id: 'one', workDir: '/workspace', messages: [], transcript: [], createdAt: 1, updatedAt: 1 }
  const events: AgentServerEvent[] = []
  const service: any = Object.assign(Object.create(ChatService.prototype), {
    sessions: [session], currentSessionId: 'one', sessionRuntimes: new Map(),
    transcriptDeltaBuffers: new Map(), transcriptDeltaFlushAt: new Map(),
    activeThinkingBlockIds: new Map(), activeAssistantBlockIds: new Map(),
    providerService: { getActiveProvider: () => ({ apiFormat: 'openai_chat' }) },
    memoryManager: {
      initialize: () => memoryReady.promise,
      captureUserMessage: async () => undefined,
      archiveScope: async () => undefined,
      captureAssistantReply: async () => undefined,
    },
    taskManager: {
      runInSession: async (_sessionId: string, operation: () => Promise<void>) => operation(),
      setActiveRequestContext: () => undefined,
      listTasks: () => [],
    },
    resolveSlashCommand: async (content: string) => ({ handled: false, content }),
    resolveAttachments: async (attachments: unknown[]) => attachments,
    initializeQueryEngine: async (_session: unknown, runtime: any) => {
      runtime.engine = engine
      engine.onAgentEvent((event: AgentServerEvent) => {
        events.push(service.recordAgentEvent(session, event))
      })
    },
    agentEventCallback: (event: AgentServerEvent) => events.push(event),
    getCurrentModel: () => 'test',
    saveSessions: () => undefined,
  })
  const first = service.sendMessage('原始任务', [], [], 'initial', 'one')
  const second = service.sendMessage('补充任务', [{
    kind: 'text', name: 'app.ts', path: '/workspace/app.ts', text: 'const n = 1', size: 11,
  }], [{ type: 'file', path: '/workspace/app.ts', name: 'app.ts' }], 'followup', 'one')
  const third = service.sendMessage('再补充', [], [], 'third', 'one')
  memoryReady.resolve()
  await modelStarted.promise
  await Promise.all([second, third])
  assert.equal(session.activeRun.id, 'run-initial')
  assert.equal(session.activeRun.status, 'running')
  assert.deepEqual(session.transcript.map((block: any) => block.id), ['initial', 'followup', 'third'])
  finishModel.resolve()
  await first
  assert.equal(requests.length, 1)
  assert.deepEqual(session.messages.filter((message: Message) => message.role === 'user').map((message: Message) => message.content),
    ['原始任务', '补充任务', '再补充'])
  assert.equal(session.messages[1].attachments[0].path, '/workspace/app.ts')
  assert.match(session.messages[1].contentBlocks[0].text, /const n = 1/)
  assert.equal(session.requestContexts.length, 1)
  assert.equal(session.requestContexts[0].requirements.length, 3)
  assert.equal(session.requestContexts[0].references[0].id, 'followup-ref-1')
  assert.equal(session.activeRun.status, 'completed')
  assert.equal(events.filter(event => event.type === 'message_complete').length, 1)
})
