import assert from 'node:assert/strict'
import Module from 'node:module'
import { describe, it, mock } from 'node:test'
import type { ChatService } from '../services/chat/ChatService'
import type { SessionPersistenceService } from '../services/persistence/SessionPersistenceService'
import type { Session } from '../types'
import type { AgentServerEvent } from '../types/messages'
import { prepareSessionForPersistence } from '../services/persistence/sessionSerialization'

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
const requireModule = Module.createRequire(__filename)
const mockedLoad = mock.method(loader, '_load', function (
  this: typeof loader, id: string, ...args: unknown[]
) {
  return id === 'vscode' ? {} : originalLoad.call(this, id, ...args)
})
let ChatServiceConstructor: typeof ChatService
let SessionPersistenceConstructor: typeof SessionPersistenceService
try {
  ChatServiceConstructor = requireModule('../services/chat/ChatService').ChatService
  SessionPersistenceConstructor = requireModule('../services/persistence/SessionPersistenceService').SessionPersistenceService
} finally {
  mockedLoad.mock.restore()
}

function fixture() {
  let nextId = 0
  const service = Object.assign(Object.create(ChatServiceConstructor.prototype), {
    transcriptDeltaBuffers: new Map(),
    transcriptDeltaFlushAt: new Map(),
    activeThinkingBlockIds: new Map(),
    activeAssistantBlockIds: new Map(),
    currentSessionId: 'one',
    generateId: () => `segment-${++nextId}`,
    getCurrentModel: () => 'any-provider-model',
    saveSessions: () => undefined,
  })
  const session = { id: 'one', messages: [], transcript: [], updatedAt: Date.now() } as unknown as Session
  const emit = (event: AgentServerEvent, target = session): AgentServerEvent =>
    service.recordAgentEvent(target, event)
  return { service, session, emit }
}

describe('provider independent conversation lifecycle', () => {
  it('detects finalization even when content, ID and timestamp stay the same', () => {
    const persistence = Object.create(SessionPersistenceConstructor.prototype)
    const session = { messages: [], transcript: [{ id: 'stable', type: 'assistant_text',
      content: '回答', timestamp: 1, status: 'streaming', phase: 'commentary' }],
      updatedAt: 1 } as unknown as Session
    const before = persistence.createSessionSnapshot(session)
    Object.assign(session.transcript![0], { status: 'complete', phase: 'final', endedAt: 1 })
    assert.notEqual(persistence.createSessionSnapshot(session), before)
  })

  it('keeps host IDs through streaming, tools, finalization and persistence', () => {
    const { session, emit } = fixture()
    const first = emit({ type: 'content_delta', text: '先检查' }) as any
    emit({ type: 'content_delta', text: '实现。' })
    emit({ type: 'tool_use_complete', toolName: 'read_file', toolUseId: 'read', input: {} })
    emit({ type: 'tool_result', toolUseId: 'read', content: 'code', isError: false })
    const last = emit({ type: 'content_delta', text: '已完成验证。' }) as any
    emit({ type: 'message_complete', completed: true, terminationReason: 'model_completed' })
    assert.notEqual(first.itemId, last.itemId)
    const transcript = session.transcript as any[]
    assert.deepEqual(transcript.map(block => block.id), [first.itemId, 'read', 'read:result', last.itemId])
    assert.equal(transcript[0].content, '先检查实现。')
    assert.equal(transcript[0].phase, 'commentary')
    assert.equal(transcript[3].phase, 'final')
    assert.equal(transcript[3].status, 'complete')
    assert.ok(transcript[3].endedAt >= transcript[3].timestamp)
    assert.deepEqual(prepareSessionForPersistence(session).transcript, transcript)
  })

  for (const reason of ['user_cancelled', 'provider_error', 'output_limit', 'max_iterations', 'task_incomplete'] as const) {
    it(`does not promote ${reason} to a final answer`, () => {
      const { session, emit } = fixture()
      emit({ type: 'content_delta', text: '部分结果' })
      emit({ type: 'message_complete', completed: false, terminationReason: reason })
      assert.equal((session.transcript?.[0] as any).status, 'interrupted')
      assert.equal((session.transcript?.[0] as any).phase, 'commentary')
    })
  }

  it('discards only the active draft and isolates concurrent sessions', () => {
    const { session, emit } = fixture()
    const other: Session = { ...session, id: 'two', transcript: [] }
    const draft = emit({ type: 'content_delta', text: '临时总结' }) as any
    const retained = emit({ type: 'content_delta', text: '另一个会话' }, other) as any
    assert.equal((emit({ type: 'content_discard' }) as any).itemId, draft.itemId)
    emit({ type: 'message_complete', completed: true }, other)
    emit({ type: 'content_delta', text: '正式总结' })
    emit({ type: 'message_complete', completed: true })
    assert.equal(session.transcript?.length, 1)
    assert.equal((session.transcript?.[0] as any).content, '正式总结')
    assert.equal(other.transcript?.[0].id, retained.itemId)
    assert.equal((other.transcript?.[0] as any).content, '另一个会话')
  })

  it('seals provider response boundaries without renaming earlier messages', () => {
    const { session, emit } = fixture()
    const first = emit({ type: 'content_delta', text: '第一段' }) as any
    emit({ type: 'content_start', blockType: 'text' })
    emit({ type: 'content_delta', text: '第二段' })
    emit({ type: 'message_complete', completed: true })
    assert.equal(session.transcript?.[0].id, first.itemId)
    assert.equal((session.transcript?.[0] as any).phase, 'commentary')
    assert.equal((session.transcript?.[1] as any).phase, 'final')
  })

  it('expires restored streams and permissions without changing finished results', () => {
    const { service, session, emit } = fixture()
    emit({ type: 'thinking', blockId: 'think', text: '分析' })
    emit({ type: 'content_delta', text: '进展' })
    emit({ type: 'tool_use_complete', toolName: 'bash', toolUseId: 'cmd', input: {} })
    emit({ type: 'permission_request', requestId: 'p', toolName: 'bash', input: {} })
    session.transcript?.push({ id: 'restored', type: 'assistant_text', content: '断线',
      status: 'streaming', timestamp: 1 })
    service.activeAssistantBlockIds.clear()
    service.expirePendingTranscript(session)
    const blocks = session.transcript as any[]
    assert.equal(blocks.find(block => block.id === 'restored').status, 'interrupted')
    assert.equal(blocks.find(block => block.id === 'cmd').executionStatus, 'cancelled')
    assert.equal(blocks.find(block => block.id === 'p').responseState, 'cancelled')
    assert.equal(blocks.find(block => block.type === 'assistant_text').status, 'complete')
    const endedAt = blocks[0].endedAt
    service.expirePendingTranscript(session)
    assert.equal(blocks[0].endedAt, endedAt)
  })
})
