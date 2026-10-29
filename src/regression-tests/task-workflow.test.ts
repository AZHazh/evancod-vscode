import assert from 'node:assert/strict'
import Module from 'node:module'
import { afterEach, describe, it, mock } from 'node:test'
import { TaskUpdateTool } from '../core/tools/task/TaskUpdateTool'
import { TaskListTool } from '../core/tools/task/TaskListTool'
import { TaskGetTool } from '../core/tools/task/TaskGetTool'
import { TaskCreateTool } from '../core/tools/task/TaskCreateTool'
import { ToolOrchestrator } from '../core/tools/execution/ToolOrchestrator'
import { recordCompactionEvent } from '../services/compact/compactionEvents'
import { replaceWithRollingSummary } from '../services/compact/compact'
import { prepareSessionForPersistence } from '../services/persistence/sessionSerialization'
import type { AgentTranscriptBlock, CompletionEvidence, Session, TaskItem, ToolCall } from '../types'
import type { TaskManager } from '../services/task/TaskManager'
import type { QueryEngine } from '../core/engine/QueryEngine'

// TaskStore 依赖 VS Code；单元测试注入内存存储，不访问编辑器或磁盘。
const moduleLoader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = moduleLoader._load
const requireModule = Module.createRequire(__filename)
const mockedLoad = mock.method(moduleLoader, '_load', function (
  this: typeof moduleLoader,
  id: string,
  ...args: unknown[]
) {
  return id === 'vscode' ? {} : originalLoad.call(this, id, ...args)
})
let TaskManagerConstructor: typeof TaskManager
let QueryEngineConstructor: typeof QueryEngine
try {
  TaskManagerConstructor = requireModule('../services/task/TaskManager').TaskManager
  QueryEngineConstructor = requireModule('../core/engine/QueryEngine').QueryEngine
} finally {
  mockedLoad.mock.restore()
}

const managers: TaskManager[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.dispose()))
})

function createManager(storedTasks: TaskItem[] = []) {
  let nextId = storedTasks.length
  const store = {
    nextTaskId: async () => `task-${++nextId}`,
    load: async () => structuredClone(storedTasks),
    saveTasks: async (tasks: TaskItem[]) => {
      storedTasks.splice(0, storedTasks.length, ...structuredClone(tasks))
    },
  }
  const manager = new TaskManagerConstructor({
    workspaceState: { update: async () => undefined },
  } as any)
  const internalManager = manager as any
  internalManager.taskStores.set('session-1', store)
  manager.setCurrentSession('session-1')
  manager.setActiveRequestContext({
    id: 'request-1',
    sourceMessageId: 'message-1',
    rawContent: '修复并验证',
    references: [],
    requirements: [
      { id: 'requirement-1', sourceText: '修复并验证', strength: 'explicit', referenceIds: [] },
    ],
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  })
  managers.push(manager)
  return manager
}

const evidence: CompletionEvidence[] = [
  {
    requirementId: 'requirement-1',
    summary: '修复已落地且验证通过',
    refs: ['src/example.ts', 'npm run lint'],
  },
]

async function createRunningTask(manager: TaskManager) {
  const task = await manager.createTask({ subject: '修复', description: '修复并验证' })
  await manager.updateTask(task.id, { status: 'in_progress' })
  return task
}

describe('task completion review', () => {
  it('passes a review with stored evidence and keeps repeated completion idempotent', async () => {
    const manager = createManager()
    const task = await createRunningTask(manager)
    await manager.updateTask(task.id, { status: 'completed', completionEvidence: evidence })
    assert.equal(task.completion?.state, 'reviewing')
    const requestedAt = task.completion?.requestedAt

    const tool = new TaskUpdateTool(manager)
    const reviewed = await tool.execute({ taskId: task.id, status: 'completed' })
    assert.equal(reviewed.success, true)
    assert.equal(reviewed.metadata?.completionState, 'passed')
    assert.deepEqual(task.completion?.evidence, evidence)
    const reviewedAt = task.completion?.reviewedAt
    assert.ok(reviewedAt)

    for (let attempt = 0; attempt < 3; attempt++) {
      await tool.execute({ taskId: task.id, status: 'completed', completionEvidence: evidence })
      assert.equal(task.completion?.state, 'passed')
      assert.equal(task.completion?.requestedAt, requestedAt)
      assert.equal(task.completion?.reviewedAt, reviewedAt)
    }
  })

  it('requires new evidence after a task is reopened for repair', async () => {
    const manager = createManager()
    const task = await createRunningTask(manager)
    await manager.updateTask(task.id, { status: 'completed', completionEvidence: evidence })
    await manager.updateTask(task.id, { status: 'completed' })
    await manager.updateTask(task.id, { status: 'in_progress' })
    await assert.rejects(manager.updateTask(task.id, { status: 'completed' }), /Missing/)
    assert.equal(task.status, 'in_progress')
    await manager.updateTask(task.id, { status: 'completed', completionEvidence: evidence })
    assert.equal(task.completion?.state, 'reviewing')
  })

  it('rejects incomplete replacement evidence during review', async () => {
    const manager = createManager()
    const task = await createRunningTask(manager)
    await manager.updateTask(task.id, { status: 'completed', completionEvidence: evidence })
    await assert.rejects(
      manager.updateTask(task.id, { status: 'completed', completionEvidence: [] }),
      /Missing/
    )
    assert.equal(task.completion?.state, 'failed')
  })

  it('can finish a persisted review after runtime history has been compressed', async () => {
    const stored: TaskItem[] = []
    const manager = createManager(stored)
    const task = await createRunningTask(manager)
    await manager.updateTask(task.id, { status: 'completed', completionEvidence: evidence })
    await manager.dispose()

    const restored = createManager(stored)
    await restored.load()
    const runtimeMessages = replaceWithRollingSummary(
      [{ id: 'old-evidence', role: 'tool', content: JSON.stringify(evidence), timestamp: 1 }],
      { id: 'compact-boundary-1', role: 'user', content: '已完成实现，待复核', timestamp: 2 },
      0
    )
    assert.equal(runtimeMessages.length, 1)
    const result = await new TaskUpdateTool(restored).execute({ taskId: task.id, status: 'completed' })
    assert.equal(result.metadata?.completionState, 'passed')
    assert.deepEqual(restored.getTask(task.id)?.completion?.evidence, evidence)
  })

  it('refreshes cached task_list and task_get after updates and review', async () => {
    const manager = createManager()
    const task = await createRunningTask(manager)
    const tools = [
      new TaskUpdateTool(manager),
      new TaskListTool(manager),
      new TaskGetTool(manager),
      new TaskCreateTool(manager),
    ]
    const executor = {
      runToolUse: async (call: ToolCall) => {
        const tool = tools.find(candidate => candidate.name === call.name)!
        const result = await tool.execute(call.input as any)
        return {
          toolCallId: call.id,
          toolName: call.name,
          content: JSON.stringify(result),
          isError: !result.success,
        }
      },
      emitCachedResult: () => undefined,
    }
    const orchestrator = new ToolOrchestrator(tools, executor as any)
    let callId = 0
    const run = async (name: string, input: Record<string, unknown> = {}) => {
      const outcome = await orchestrator.runTools([{ id: `call-${++callId}`, name, input }])
      return outcome.results[0]
    }

    await run('task_list')
    await run('task_get', { taskId: task.id })
    await run('task_update', { taskId: task.id, status: 'completed', completionEvidence: evidence })
    const reviewingList = JSON.parse((await run('task_list')).content)
    assert.equal(reviewingList.metadata.tasks[0].completionState, 'reviewing')
    assert.equal(reviewingList.metadata.stats.reviewing, 1)
    await run('task_update', { taskId: task.id, status: 'completed' })
    const passedList = await run('task_list')
    assert.doesNotMatch(passedList.content, /重复调用/)
    assert.equal(JSON.parse(passedList.content).metadata.tasks[0].completionState, 'passed')
    assert.equal(JSON.parse(passedList.content).metadata.stats.reviewing, 0)
    assert.match((await run('task_get', { taskId: task.id })).content, /passed/)
    const created = JSON.parse(
      (await run('task_create', { subject: '新增', description: '新增任务' })).content
    )
    assert.equal(JSON.parse((await run('task_list')).content).metadata.totalCount, 2)
    await run('task_update', { taskId: created.metadata.taskId, status: 'deleted' })
    assert.equal(JSON.parse((await run('task_list')).content).metadata.totalCount, 1)
  })
})

describe('compaction transcript', () => {
  it('restores live task state outside the model summary and resets stale read caches', async () => {
    const manager = createManager()
    const task = await createRunningTask(manager)
    await manager.updateTask(task.id, { status: 'completed', completionEvidence: evidence })
    const apiModule = requireModule('../core/services/api')
    const summaryRequest = mock.fn(async () => ({ content: '实现已完成，等待复核。' }))
    const factoryMock = mock.method(apiModule, 'createApiClient', () => ({
      sendMessageStream: summaryRequest,
    }))
    const resetDedup = mock.fn()
    // 跳过编辑器和工具初始化，运行真实压缩逻辑，摘要 API 使用隔离替身。
    const engine = Object.assign(Object.create(QueryEngineConstructor.prototype), {
      apiClient: {},
      tools: [],
      requestSystemPrompt: '',
      toolOrchestrator: { resetDedup },
      config: {
        model: 'test-model',
        provider: { models: {}, autoCompactWindow: 100_000 },
        taskManager: manager,
        compactKeepRecentMessages: 5,
        messages: [
          { id: 'long-history', role: 'user', content: '历史'.repeat(100_000), timestamp: 1 },
          ...Array.from({ length: 6 }, (_, index) => ({
            id: `recent-${index}`,
            role: 'assistant',
            content: '最近进展',
            timestamp: index + 2,
          })),
        ],
      },
    })
    try {
      await engine.performAutoCompact()
      assert.equal(summaryRequest.mock.callCount(), 1)
      assert.equal(resetDedup.mock.callCount(), 1)
      const recovered = engine.config.messages.at(-1)
      assert.equal(recovered.internal, true)
      assert.match(recovered.content, /reviewing/)
      assert.match(recovered.content, /task_update completed/)
      assert.match(recovered.content, /src\/example.ts/)
      assert.match(recovered.content, /npm run lint/)
      assert.equal(task.completion?.state, 'reviewing')
    } finally {
      factoryMock.mock.restore()
    }
  })

  it('keeps a completed compaction at its original position and persists it', () => {
    const transcript: AgentTranscriptBlock[] = [
      { id: 'before', type: 'assistant_text', content: '之前', timestamp: 1 },
    ]
    const started = recordCompactionEvent(
      transcript,
      { type: 'system_notification', subtype: 'compact_started' },
      () => 'compact-1',
      2
    )
    transcript.push({ id: 'after', type: 'assistant_text', content: '继续', timestamp: 3 })
    const complete = recordCompactionEvent(
      transcript,
      { type: 'system_notification', subtype: 'compact_complete', data: { success: true } },
      () => 'unexpected-new-id',
      4
    )
    assert.equal((started.data as any).compaction.id, (complete.data as any).compaction.id)
    assert.deepEqual(transcript.map(block => block.id), ['before', 'compact-1', 'after'])
    assert.deepEqual(transcript[1], {
      id: 'compact-1',
      type: 'context_compaction',
      status: 'completed',
      message: '上下文已自动压缩',
      timestamp: 2,
      automatic: true,
    })
    const persisted = prepareSessionForPersistence({ messages: [], transcript } as unknown as Session)
    assert.deepEqual(JSON.parse(JSON.stringify(persisted)).transcript[1], transcript[1])
  })

  it('keeps multiple compactions and failed attempts separate', () => {
    const transcript: AgentTranscriptBlock[] = []
    recordCompactionEvent(
      transcript,
      { type: 'system_notification', subtype: 'compact_started' },
      () => 'compact-1',
      1
    )
    recordCompactionEvent(
      transcript,
      { type: 'system_notification', subtype: 'compact_complete', data: { success: false } },
      () => 'unused',
      2
    )
    recordCompactionEvent(
      transcript,
      { type: 'system_notification', subtype: 'compact_started', data: { automatic: false } },
      () => 'compact-2',
      3
    )
    recordCompactionEvent(
      transcript,
      { type: 'system_notification', subtype: 'compact_complete', data: { success: true } },
      () => 'unused',
      4
    )
    assert.equal(transcript.length, 2)
    assert.equal((transcript[0] as any).status, 'failed')
    assert.equal((transcript[1] as any).message, '上下文已压缩')
    assert.equal((transcript[1] as any).automatic, false)
  })

  it('isolates concurrent compactions by session', () => {
    const first: AgentTranscriptBlock[] = []
    const second: AgentTranscriptBlock[] = []
    recordCompactionEvent(
      first,
      { type: 'system_notification', subtype: 'compact_started' },
      () => 'first',
      1
    )
    recordCompactionEvent(
      second,
      { type: 'system_notification', subtype: 'compact_started' },
      () => 'second',
      2
    )
    recordCompactionEvent(
      first,
      { type: 'system_notification', subtype: 'compact_complete', data: { success: true } },
      () => 'unused',
      3
    )
    assert.equal((first[0] as any).status, 'completed')
    assert.equal((second[0] as any).status, 'compacting')
  })
})
