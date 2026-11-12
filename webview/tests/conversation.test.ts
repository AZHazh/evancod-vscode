import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from '../src/stores/chat'
import { groupToolActivity, summarizeToolActivity } from '../src/utils/activityGrouping'
import { groupCompletedTurns, isFinalAnswer } from '../src/utils/conversationGrouping'
import { isLocalFileReference } from '../src/utils/fileReferences'
import { collapseLongText, isLongText, pastedTextTitle } from '../src/utils/pastedText'
import { isClosedMermaidFence } from '../src/utils/mermaid'
import type { UIMessage } from '../src/types'

let listener: (event: any) => void
let posted: any[]
let rafs: Map<number, () => void>
let timers: Map<number, () => void>
let nextId = 0
let store: ReturnType<typeof useChatStore>
const send = (type: string, data: any) => listener({ data: { type, data } })
const emit = (data: any) => send('agent.event', { sessionId: store.currentSession?.id, ...data })
const session = (id = 'one', transcript: UIMessage[] = [], isRunning = true) => ({
  id, messages: [],
  transcript, isRunning, createdAt: 1, updatedAt: 1,
})
function flushFrame() {
  for (const [id, callback] of [...rafs]) { rafs.delete(id); callback() }
}

beforeEach(() => {
  posted = []
  rafs = new Map()
  timers = new Map()
  ;(globalThis as any).window = {
    acquireVsCodeApi: () => ({ postMessage: (message: any) => posted.push(message) }),
    addEventListener: (_type: string, handler: typeof listener) => { listener = handler },
    requestAnimationFrame: (callback: () => void) => { rafs.set(++nextId, callback); return nextId },
    cancelAnimationFrame: (id: number) => rafs.delete(id),
    setTimeout: (callback: () => void) => { timers.set(++nextId, callback); return nextId },
    clearTimeout: (id: number) => timers.delete(id),
  }
  setActivePinia(createPinia())
  store = useChatStore()
  store.initialize()
  send('session.restored', { session: session() })
})

test('groups consecutive tools while preserving progress, Thinking, Ask and plan boundaries', () => {
  const tool = (id: string): UIMessage => ({ id, type: 'tool_use', toolUseId: id, toolName: 'read_file', input: {}, timestamp: 1 })
  const messages: UIMessage[] = [
    { id: 'progress', type: 'assistant_text', content: '检查', timestamp: 1 },
    tool('a'), { id: 'p', type: 'permission_request', requestId: 'p', toolName: 'read_file', input: {}, timestamp: 1 },
    tool('b'), { id: 'ask', type: 'interaction_request', requestId: 'ask', toolName: 'ask_user_question', input: {}, timestamp: 1 },
    tool('c'), { id: 'thinking', type: 'thinking', content: '分析', timestamp: 1 }, tool('d'),
    { id: 'plan', type: 'plan_approval', timestamp: 1, plan: {} as any }, tool('e'),
  ]
  const items = groupToolActivity(messages)
  assert.deepEqual(items.map(item => item.id), ['progress', 'activity:a', 'ask', 'activity:c', 'thinking', 'activity:d', 'plan', 'activity:e'])
  assert.equal(items[1].type === 'tool_activity_group' && items[1].messages.length, 2)
  assert.equal(messages.length, 10)
  assert.equal(groupToolActivity(messages.slice(0, 2))[1].id, items[1].id)
  assert.equal(store.isExpandedState('activity:a'), false)
  assert.equal(store.isExpandedState('thinking:thinking'), false)
})

test('keeps streamed IDs and promotes only a successful final segment', () => {
  emit({ type: 'content_delta', itemId: 'progress', text: '先检查' })
  emit({ type: 'tool_use_complete', toolName: 'read_file', toolUseId: 'read', input: {} })
  emit({ type: 'tool_result', toolUseId: 'read', content: 'code', isError: false })
  emit({ type: 'content_delta', itemId: 'final', text: '已验证' })
  emit({ type: 'message_complete', completed: true })
  assert.deepEqual(store.uiMessages.map(message => message.id), ['progress', 'read', 'read:result', 'final'])
  assert.equal((store.uiMessages[0] as any).phase, 'commentary')
  assert.equal((store.uiMessages[3] as any).phase, 'final')
  assert.equal((store.uiMessages[3] as any).status, 'complete')
  const items = groupCompletedTurns(groupToolActivity(store.uiMessages), false)
  assert.deepEqual(items.map(item => item.type), ['turn_activity_group', 'assistant_text'])
  assert.equal(items[0].type === 'turn_activity_group' && items[0].items.length, 2)
  assert.equal(isFinalAnswer(store.uiMessages[0]), false)
  assert.equal(isFinalAnswer(store.uiMessages[3]), true)
})

test('completed turns collapse independently with frozen duration and the final answer outside', () => {
  const messages: UIMessage[] = [
    { id: 'user1', type: 'user_text', content: '修复问题', timestamp: 1000 },
    { id: 'thinking1', type: 'thinking', content: '分析', timestamp: 2000, endedAt: 3000 },
    { id: 'progress1', type: 'assistant_text', content: '正在修复', phase: 'commentary', timestamp: 3000 },
    { id: 'read1', type: 'tool_use', toolName: 'read_file', toolUseId: 'read1', input: {}, timestamp: 4000 },
    { id: 'compact1', type: 'context_compaction', status: 'completed', message: '已压缩', timestamp: 6000 },
    { id: 'final1', type: 'assistant_text', content: '已修复', phase: 'final', status: 'complete', timestamp: 7000, endedAt: 11000 },
    { id: 'user2', type: 'user_text', content: '再检查', timestamp: 20000 },
    { id: 'progress2', type: 'assistant_text', content: '检查中', phase: 'commentary', timestamp: 21000 },
    { id: 'final2', type: 'assistant_text', content: '检查完成', phase: 'final', status: 'complete', timestamp: 23000, endedAt: 25000 },
  ]
  const before = JSON.stringify(messages)
  const items = groupCompletedTurns(groupToolActivity(messages), false)
  assert.deepEqual(items.map(item => item.id), ['user1', 'turn:final1', 'final1', 'user2', 'turn:final2', 'final2'])
  const groups = items.filter(item => item.type === 'turn_activity_group')
  assert.deepEqual(groups.map(group => group.endedAt - group.startedAt), [10000, 5000])
  assert.deepEqual(groups[0].items.map(item => item.id), ['thinking1', 'progress1', 'activity:read1', 'compact1'])
  assert.deepEqual(items.filter(item => item.type !== 'turn_activity_group' && isFinalAnswer(item)).map(item => item.id), ['final1', 'final2'])
  assert.equal(store.isExpandedState(groups[0].id), false)
  store.setExpandedState(groups[0].id, true)
  assert.equal(store.isExpandedState(groups[1].id), false)
  const restored = groupCompletedTurns(groupToolActivity(JSON.parse(before)), false)
  assert.deepEqual(restored, items)
  assert.equal(JSON.stringify(messages), before)
})

test('a new streaming or interrupted turn stays visible while completed history stays collapsed', () => {
  const messages: UIMessage[] = [
    { id: 'old-progress', type: 'assistant_text', content: '先检查', timestamp: 1, phase: 'commentary' },
    { id: 'old-final', type: 'assistant_text', content: '已完成', timestamp: 2, phase: 'final', status: 'complete' },
    { id: 'user', type: 'user_text', content: '下一轮', timestamp: 3 },
    { id: 'progress', type: 'assistant_text', content: '执行中', timestamp: 4, phase: 'commentary', status: 'complete' },
    { id: 'live', type: 'assistant_text', content: '部分答复', timestamp: 5, phase: 'commentary', status: 'streaming' },
  ]
  const running = groupCompletedTurns(groupToolActivity(messages), true)
  assert.deepEqual(running.map(item => item.id), ['turn:old-final', 'old-final', 'user', 'progress', 'live'])
  assert.equal(isFinalAnswer(messages.at(-1)!), false)
  const last = messages.at(-1) as Extract<UIMessage, { type: 'assistant_text' }>
  last.status = 'interrupted'
  assert.deepEqual(groupCompletedTurns(groupToolActivity(messages), false).map(item => item.id), running.map(item => item.id))
  last.phase = 'final'
  assert.equal(isFinalAnswer(last), false)
})

test('legacy histories infer only settled final text and do not mutate stored phases', () => {
  const messages: UIMessage[] = [
    { id: 'user', type: 'user_text', content: '检查', timestamp: 1000 },
    { id: 'progress', type: 'assistant_text', content: '先看文件', timestamp: 2000 },
    { id: 'read', type: 'tool_use', toolName: 'read_file', toolUseId: 'read', input: {}, timestamp: 3000 },
    { id: 'final', type: 'assistant_text', content: '历史答复', timestamp: 6000 },
  ]
  assert.deepEqual(groupCompletedTurns(groupToolActivity(messages), true).map(item => item.id), ['user', 'progress', 'activity:read', 'final'])
  const restored = groupCompletedTurns(groupToolActivity(messages), false)
  assert.deepEqual(restored.map(item => item.id), ['user', 'turn:final', 'final'])
  assert.equal(restored.at(-1)?.type !== 'turn_activity_group' && isFinalAnswer(restored.at(-1) as any), true)
  assert.equal((messages.at(-1) as any).phase, undefined)
  const nextUser: UIMessage = { id: 'next-user', type: 'user_text', content: '继续', timestamp: 12000 }
  assert.deepEqual(groupCompletedTurns(groupToolActivity([...messages, nextUser]), true).map(item => item.id), ['user', 'turn:final', 'final', 'next-user'])
  assert.equal(restored[1].type === 'turn_activity_group' && restored[1].endedAt - restored[1].startedAt, 5000)
  const direct = groupCompletedTurns(groupToolActivity(messages.slice(-1)), false)
  assert.equal(direct.length, 1)
  assert.equal(direct[0].type !== 'turn_activity_group' && isFinalAnswer(direct[0]), true)
})

test('pending Ask and plan approvals remain visible, and generated images stay next to the final', () => {
  const progress: UIMessage = { id: 'progress', type: 'assistant_text', content: '准备执行', timestamp: 1, phase: 'commentary' }
  const final: UIMessage = { id: 'final', type: 'assistant_text', content: '答复', timestamp: 10, phase: 'final', status: 'complete' }
  const ask: UIMessage = { id: 'ask', type: 'interaction_request', requestId: 'ask', toolName: 'ask_user_question', input: {}, timestamp: 2, responseState: 'pending' }
  const plan: UIMessage = { id: 'plan', type: 'plan_approval', plan: { state: 'planning' } as any, timestamp: 3 }
  for (const interaction of [ask, plan]) {
    const items = groupCompletedTurns(groupToolActivity([progress, interaction, final]), false)
    assert.deepEqual(items.map(item => item.id), ['progress', interaction.id, 'final'])
  }
  ask.responseState = 'answered'
  const image: UIMessage = { id: 'image', type: 'image_generation', imageId: 'image', timestamp: 8, image: { mime: 'image/png', path: 'result.png' } }
  const items = groupCompletedTurns(groupToolActivity([progress, ask, image, final]), false)
  assert.deepEqual(items.map(item => item.id), ['turn:final', 'image', 'final'])
  assert.deepEqual(items[0].type === 'turn_activity_group' && items[0].items.map(item => item.id), ['progress', 'ask'])
})

test('supports legacy providers with no message identity, phase or Thinking', () => {
  emit({ type: 'content_start', blockType: 'text' })
  emit({ type: 'content_delta', text: '检查' })
  emit({ type: 'tool_use_complete', toolName: 'glob', toolUseId: 'glob', input: {} })
  emit({ type: 'tool_result', toolUseId: 'glob', content: [], isError: false })
  emit({ type: 'content_delta', text: '回答' })
  emit({ type: 'message_complete', completed: true })
  const texts = store.uiMessages.filter(message => message.type === 'assistant_text')
  assert.equal(texts.length, 2)
  assert.notEqual(texts[0].id, texts[1].id)
  assert.equal(texts[1].phase, 'final')
  assert.ok(!store.uiMessages.some(message => message.type === 'thinking'))
})

test('queues permissions, preserves rejection semantics, and waits for remaining requests', () => {
  for (const requestId of ['p1', 'p2']) emit({ type: 'permission_request', requestId, toolName: 'bash', input: { command: 'pwd' } })
  assert.equal(store.pendingPermission?.requestId, 'p1')
  store.sendPermissionResponse({ requestId: 'p1', approved: false })
  assert.equal(store.pendingPermission?.requestId, 'p2')
  assert.equal(store.chatState, 'waiting_permission')
  emit({ type: 'permission_response', requestId: 'p1', approved: false })
  assert.equal(store.pendingPermission?.requestId, 'p2')
  store.sendPermissionResponse({ requestId: 'p2', approved: true, rule: 'always' })
  assert.equal(store.pendingPermission, null)
  assert.equal(store.chatState, 'thinking')
  assert.equal(posted.at(-1).data.rule, 'always')
  assert.equal(posted.at(-1).data.sessionId, 'one')
})

test('restores multiple permissions and isolates late events from another session', () => {
  emit({ type: 'permission_request', requestId: 'old', toolName: 'bash', input: {} })
  store.sendPermissionResponse({ requestId: 'old', approved: true })
  send('session.restored', { session: session('two') })
  assert.equal(timers.size, 0)
  emit({ type: 'permission_request', sessionId: 'one', requestId: 'late', toolName: 'bash', input: {} })
  assert.equal(store.pendingPermission, null)
  send('session.runtime.snapshot', { sessionId: 'two', agents: [], pendingEvents: [
    { type: 'permission_request', requestId: 'a', toolName: 'bash', input: {}, requestedAt: 2, responseState: 'pending' },
    { type: 'permission_request', requestId: 'b', toolName: 'bash', input: {}, requestedAt: 3, responseState: 'pending' },
  ] })
  assert.deepEqual(store.pendingPermissions.map(request => request.requestId), ['a', 'b'])
  emit({ type: 'permission_response', requestId: 'a', approved: false, reason: '超时' })
  assert.equal(store.pendingPermission?.requestId, 'b')
})

test('an older pending snapshot cannot undo a choice; an expired snapshot ends retries', () => {
  const request = { type: 'permission_request', requestId: 'p', toolName: 'bash', input: {} }
  emit(request)
  store.sendPermissionResponse({ requestId: 'p', approved: true })
  emit(request)
  assert.equal(store.pendingPermission, null)
  send('chat.messages.update', { session: session('one', [{
    ...request, id: 'p', timestamp: 1, responseState: 'pending',
  }] as UIMessage[]) })
  assert.equal(store.pendingPermission, null)
  emit({ ...request, responseState: 'expired' })
  assert.equal(timers.size, 0)
  assert.equal(store.pendingPermission, null)
  assert.equal((store.uiMessages[0] as any).responseState, 'expired')
})

test('stop seals Thinking and text, cancels tools and permissions, and ignores late deltas', () => {
  emit({ type: 'thinking', blockId: 'think', text: '分析' })
  emit({ type: 'content_delta', itemId: 'partial', text: '正在检查' })
  emit({ type: 'tool_use_complete', toolName: 'read_file', toolUseId: 'read', input: {} })
  emit({ type: 'permission_request', requestId: 'p', toolName: 'bash', input: {} })
  store.stopGeneration()
  const before = JSON.stringify(store.uiMessages)
  emit({ type: 'content_delta', text: '迟到' })
  assert.equal(JSON.stringify(store.uiMessages), before)
  assert.equal(store.pendingPermission, null)
  assert.ok((store.uiMessages[0] as any).endedAt)
  assert.equal(summarizeToolActivity(store.uiMessages).cancelled, 1)
})

test('interrupted responses never appear as final and discarded drafts stay removed', () => {
  emit({ type: 'content_delta', itemId: 'draft', text: '临时总结' })
  emit({ type: 'content_discard', itemId: 'draft' })
  emit({ type: 'content_delta', itemId: 'partial', text: '部分结果' })
  emit({ type: 'message_complete', completed: false, terminationReason: 'output_limit' })
  assert.deepEqual(store.uiMessages.map(message => message.id), ['partial'])
  assert.equal((store.uiMessages[0] as any).status, 'interrupted')
  assert.equal((store.uiMessages[0] as any).phase, 'commentary')
})

test('same-session refresh does not duplicate streamed text or lose stable expansion state', () => {
  emit({ type: 'content_delta', itemId: 'live', text: '第一段' })
  flushFrame()
  store.setExpandedState('activity:read', true)
  send('chat.messages.update', { session: session('one', [...store.uiMessages]) })
  emit({ type: 'content_delta', itemId: 'live', text: '第二段' })
  emit({ type: 'message_complete', completed: true })
  assert.equal(store.uiMessages.length, 1)
  assert.equal((store.uiMessages[0] as any).content, '第一段第二段')
  assert.equal(store.isExpandedState('activity:read'), true)
})

test('recognizes file links with Windows paths and locations while excluding external schemes', () => {
  for (const value of ['D:/project/app.ts:12:3', '/D:/project/app.ts#L8',
    'file:///D:/my%20project/app.ts#L8', 'src/main.rs:4-9', 'app.ts:12:3',
    'components/My App.vue', '.env.local', 'Dockerfile']) {
    assert.equal(isLocalFileReference(value), true, value)
  }
  assert.equal(isLocalFileReference('../folder', true), true)
  assert.equal(isLocalFileReference('path/without-extension', true), true)
  for (const value of ['https://example.com/app.ts:4', 'mailto:name@example.com',
    'javascript:alert(1)', '#heading', '', 'npm run test']) {
    assert.equal(isLocalFileReference(value), false, value)
  }
})

test('collapses long text without losing content and preserves mixed file/skill order', () => {
  assert.equal(isLongText('x'.repeat(2000)), false)
  assert.equal(isLongText('x'.repeat(2001)), true)
  assert.equal(isLongText(Array(20).fill('行').join('\n')), true)
  const text = '\n  标题 <html> & "\n' + '完整内容\n'.repeat(100)
  const original = [
    { type: 'text' as const, text: '先检查' },
    { type: 'file' as const, path: 'src/app.ts', name: 'app.ts' },
    { type: 'text' as const, text },
    { type: 'skill' as const, name: 'review' },
  ]
  const collapsed = collapseLongText(original)
  assert.deepEqual(collapsed.map(segment => segment.type), ['text', 'file', 'pasted_text', 'skill'])
  assert.equal(collapsed[2].text, text)
  assert.equal(original[2].type, 'text')
  const splitText = collapseLongText([
    { type: 'text', text: 'x'.repeat(1500) }, { type: 'text', text: 'y'.repeat(1500) },
  ])
  assert.equal(splitText.length, 1)
  assert.equal(splitText[0].type, 'pasted_text')
  assert.equal(splitText[0].text, 'x'.repeat(1500) + 'y'.repeat(1500))
  assert.equal(pastedTextTitle(text), '标题 <html> & "')
  store.sendMessage(text, [], [], [], [collapsed[2]])
  assert.equal(posted.at(-1).data.inlineSegments[0].text, text)
  assert.equal((store.uiMessages.at(-1) as any).inlineSegments[0].text, text)
  send('session.restored', { session: session('restored', [{
    id: 'long', type: 'user_text', content: text, inlineSegments: [collapsed[2]], timestamp: 1,
  }], false) })
  assert.equal((store.uiMessages[0] as any).inlineSegments[0].text, text)
})

test('refresh flushes pending deltas and switching sessions cannot carry a queued frame', () => {
  emit({ type: 'content_delta', itemId: 'live', text: '第一段' })
  flushFrame()
  emit({ type: 'content_delta', itemId: 'live', text: '第二段' })
  send('chat.messages.update', { session: session('one', [...store.uiMessages]) })
  emit({ type: 'content_delta', itemId: 'live', text: '第三段' })
  emit({ type: 'message_complete', completed: true })
  assert.equal((store.uiMessages[0] as any).content, '第一段第二段第三段')
  emit({ type: 'thinking', blockId: 'old-thinking', text: '旧会话内容' })
  emit({ type: 'content_delta', itemId: 'old-live', text: '旧会话正文' })
  send('session.restored', { session: session('two') })
  flushFrame()
  assert.equal(store.uiMessages.length, 0)
  assert.equal(store.activeThinkingMessageId, null)
})

test('running sends keep permissions active and confirm identical messages by client ID', () => {
  emit({ type: 'permission_request', requestId: 'approval', toolName: 'bash', input: {} })
  store.sendMessage('同样的追加要求')
  const first = posted.at(-1)
  store.sendMessage('同样的追加要求')
  const second = posted.at(-1)
  assert.equal(first.type, 'chat.send')
  assert.equal(second.data.sessionId, 'one')
  assert.notEqual(first.data.messageId, second.data.messageId)
  assert.equal(posted.some(message => message.type === 'chat.stop'), false)
  assert.equal(store.chatState, 'waiting_permission')
  const message = (request: any) => ({
    id: request.data.messageId, role: 'user', content: request.data.content, timestamp: 1,
  })
  emit({ type: 'user_input', message: message(first) })
  assert.equal(store.uiMessages.filter(message => message.id.startsWith('optimistic-user-')).length, 1)
  emit({ type: 'user_input', message: message(second) })
  emit({ type: 'user_input', message: message(second) })
  assert.deepEqual(store.uiMessages.filter(message => message.type === 'user_text').map(message => message.id),
    [first.data.messageId, second.data.messageId])
  assert.equal((store.uiMessages.find(message => message.id === 'approval') as any).responseState, 'pending')
})

test('refresh preserves an unconfirmed followup with the same content as a confirmed message', () => {
  store.sendMessage('继续')
  const first = posted.at(-1)
  emit({ type: 'user_input', message: { id: first.data.messageId, role: 'user', content: '继续', timestamp: 1 } })
  store.sendMessage('继续')
  const second = posted.at(-1)
  send('chat.messages.update', { session: session('one', [{
    id: first.data.messageId, type: 'user_text', content: '继续', timestamp: 1,
  }]) })
  assert.equal(store.uiMessages.filter(message => message.type === 'user_text').length, 2)
  assert.ok(store.uiMessages.some(message => message.id === `optimistic-${second.data.messageId}`))
})

test('only complete Mermaid fences render while streaming, including tilde and long fences', () => {
  assert.equal(isClosedMermaidFence('```mermaid\nflowchart TD\nA-->B'), false)
  assert.equal(isClosedMermaidFence('```mermaid\nA-->B\n```\n'), true)
  assert.equal(isClosedMermaidFence('~~~~mermaid\nA-->B\n~~~'), false)
  assert.equal(isClosedMermaidFence('~~~~mermaid\nA-->B\n~~~~'), true)
  assert.equal(isClosedMermaidFence('```mermaid\nA-->B\n``` more'), false)
})

test('failed steering removes its optimistic message while preserving the active stream and permissions', () => {
  emit({ type: 'permission_request', requestId: 'p', toolName: 'bash', input: {} })
  store.sendMessage('补充')
  const request = posted.at(-1)
  send('chat.send.rejected', { sessionId: 'other', messageId: request.data.messageId, message: '旧会话错误', running: false })
  assert.ok(store.uiMessages.some(message => message.id === `optimistic-${request.data.messageId}`))
  send('chat.send.rejected', { sessionId: 'one', messageId: request.data.messageId, message: '附件读取失败', running: true })
  assert.equal(store.uiMessages.some(message => message.id === `optimistic-${request.data.messageId}`), false)
  assert.match(store.sendError, /附件读取失败/)
  assert.equal(store.chatState, 'waiting_permission')
  store.sendMessage('重试')
  assert.equal(store.sendError, '')
})

test('late snapshots cannot replace the current session and stopping removes unconsumed messages', () => {
  store.sendMessage('补充')
  send('chat.messages.update', { session: session('other') })
  assert.equal(store.currentSession?.id, 'one')
  assert.equal(store.uiMessages.filter(message => message.type === 'user_text').length, 1)
  store.stopGeneration()
  assert.equal(store.uiMessages.filter(message => message.id.startsWith('optimistic-user-')).length, 0)
  assert.equal(store.chatState, 'idle')
})
