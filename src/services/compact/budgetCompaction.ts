import { createHash, randomUUID } from 'node:crypto'
import type { CompactionRecord, Message } from '../../types'
import type { ApiClient } from '../../core/services/api/shared'
import {
  estimateMessagesTokens,
  estimateRequestTokens,
  getEffectiveInputWindow,
} from '../context/ContextBudgetManager'
import {
  buildRollingCompactionInput,
  COMPACT_PROMPT_VERSION,
  compactConversation,
  isCompactSummaryMessage,
} from './compact'
import { microcompact } from './microcompact'

const RETAIN_RATIO = 0.16
const PROTECTED_USER_RATIO = 0.1
const TARGET_RATIO = 0.55

export interface BudgetCompactionOptions {
  messages: Message[]
  apiClient: Pick<ApiClient, 'sendMessageStream'>
  providerId: string
  model: string
  trigger: CompactionRecord['trigger']
  contextWindow: number
  systemPrompt: string
  tools: unknown[]
  retainTokens?: number
  protectedUserTokens?: number
  buildRuntimeMessages?: () => Message[]
  estimateRequest?: (messages: Message[]) => number
  signal?: AbortSignal
}

export function isRuntimeContextMessage(message: Message): boolean {
  return message.id === 'runtime-context' || /^compact-task-(state|recovery)-/.test(message.id)
}

export function conversationDigest(messages: Message[]): string {
  return createHash('sha256').update(JSON.stringify(messages)).digest('hex')
}

function resolveBudget(value: number | undefined, fallback: number, window: number): number {
  const budget = value ?? fallback
  if (!Number.isFinite(budget) || budget < 0) throw new Error('Invalid compaction token budget')
  return Math.floor(Math.min(budget, window))
}

/** Group complete tool exchanges before selecting a tail, including parallel calls. */
function messageGroups(messages: Message[]): Message[][] {
  const results = new Map<string, number>()
  messages.forEach((message, index) => {
    if (message.role === 'tool' && message.toolCallId) results.set(message.toolCallId, index)
  })
  const groups: Message[][] = []
  for (let start = 0; start < messages.length;) {
    let end = start
    for (let index = start; index <= end; index++) {
      for (const call of messages[index].toolCalls || []) {
        const result = results.get(call.id)
        if (result === undefined || result <= index) throw new Error(`Unfinished tool call: ${call.id}`)
        end = Math.max(end, result)
      }
    }
    groups.push(messages.slice(start, end + 1))
    start = end + 1
  }
  return groups
}

export function selectRetainedMessages(
  messages: Message[], retainTokens: number, protectedUserTokens: number
): { messages: Message[]; protectedUserMessageIds: string[] } {
  const conversation = messages.filter(
    message => !isCompactSummaryMessage(message) && !isRuntimeContextMessage(message)
  )
  const selected = new Set<string>()
  const protectedUsers: string[] = []
  let userTokens = 0
  for (const message of [...conversation].reverse()) {
    if (message.role !== 'user' || message.internal) continue
    const tokens = estimateMessagesTokens([message])
    if (protectedUsers.length === 0 || userTokens + tokens <= protectedUserTokens) {
      selected.add(message.id)
      protectedUsers.push(message.id)
      userTokens += tokens
    }
  }
  let recentTokens = 0
  const groups = messageGroups(conversation)
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]
    const tokens = estimateMessagesTokens(group)
    if (index !== groups.length - 1 && recentTokens + tokens > retainTokens) break
    group.forEach(message => selected.add(message.id))
    recentTokens += tokens
  }
  conversation.filter(message => message.role === 'system').forEach(message => selected.add(message.id))
  return {
    messages: conversation.filter(message => selected.has(message.id)),
    protectedUserMessageIds: protectedUsers.reverse(),
  }
}

/** Prepare a checkpoint without mutating live history; callers commit it after persistence. */
export async function compactWithBudget(options: BudgetCompactionOptions): Promise<CompactionRecord> {
  const source = structuredClone(options.messages.filter(message => !isRuntimeContextMessage(message)))
  const sourceDigest = conversationDigest(source)
  const effectiveWindow = getEffectiveInputWindow(options.contextWindow)
  const target = Math.floor(effectiveWindow * TARGET_RATIO)
  let retainTokens = resolveBudget(options.retainTokens, effectiveWindow * RETAIN_RATIO, effectiveWindow)
  const protectedUserTokens = resolveBudget(
    options.protectedUserTokens, Math.min(20_000, effectiveWindow * PROTECTED_USER_RATIO), effectiveWindow
  )
  const runtime = () => options.buildRuntimeMessages?.() || []
  const estimate = options.estimateRequest || ((messages: Message[]) =>
    estimateRequestTokens(messages, options.systemPrompt, options.tools))
  const beforeTokens = estimate([...runtime(), ...source])
  const summaryInput = [...runtime(), ...microcompact(buildRollingCompactionInput(source), 5)]
  const { summaryMessage } = await compactConversation(
    summaryInput, options.apiClient, options.model, options
  )
  options.signal?.throwIfAborted()
  const currentSource = options.messages.filter(message => !isRuntimeContextMessage(message))
  if (conversationDigest(currentSource) !== sourceDigest) {
    throw new Error('Conversation changed during compaction; checkpoint was not applied')
  }
  let retained = selectRetainedMessages(source, retainTokens, protectedUserTokens)
  let replacement: Message[] = []
  let afterTokens = Infinity
  for (;;) {
    retained = selectRetainedMessages(source, retainTokens, protectedUserTokens)
    replacement = [...runtime(), summaryMessage, ...retained.messages]
    afterTokens = estimate(replacement)
    if (afterTokens <= target || retainTokens === 0) break
    retainTokens = Math.floor(retainTokens / 2)
  }
  if (afterTokens > target || afterTokens >= beforeTokens * 0.9) {
    throw new Error(
      `Compaction did not reduce the request safely (${beforeTokens} -> ${afterTokens} tokens, ` +
      `target ${target}); original history retained`
    )
  }
  return structuredClone({
    version: 1,
    id: randomUUID(),
    timestamp: Date.now(),
    trigger: options.trigger,
    providerId: options.providerId,
    model: options.model,
    promptVersion: COMPACT_PROMPT_VERSION,
    contextWindow: options.contextWindow,
    beforeTokens,
    afterTokens,
    retainTokens,
    protectedUserTokens,
    sourceDigest,
    replacementDigest: conversationDigest(replacement),
    sourceMessages: source,
    replacementMessages: replacement,
    summaryMessageId: summaryMessage.id,
    retainedMessageIds: retained.messages.map(message => message.id),
    protectedUserMessageIds: retained.protectedUserMessageIds,
    requestContext: { systemPrompt: options.systemPrompt, tools: options.tools },
  })
}

/** Replay recorded content, without regenerating the summary or executing any tool. */
export function replayCompaction(record: CompactionRecord): Message[] {
  if (record.version !== 1 || !Array.isArray(record.sourceMessages) ||
      !Array.isArray(record.replacementMessages) ||
      conversationDigest(record.sourceMessages) !== record.sourceDigest ||
      conversationDigest(record.replacementMessages) !== record.replacementDigest ||
      !record.replacementMessages.some(message => message.id === record.summaryMessageId)) {
    throw new Error('Invalid compaction checkpoint')
  }
  return structuredClone(record.replacementMessages)
}

/** Recover a committed replacement if a saved history still contains its source prefix. */
export function restoreCompactedMessages(
  messages: Message[], records: CompactionRecord[] = []
): Message[] {
  if (!Array.isArray(records)) {
    console.warn('Invalid compaction journal; preserving saved history')
    return messages
  }
  let current = messages
  for (const record of records) {
    if (!record || record.version !== 1 || !Array.isArray(record.sourceMessages) ||
        current.some(message => message.id === record.summaryMessageId)) continue
    const conversation = current.filter(message => !isRuntimeContextMessage(message))
    const prefix = conversation.slice(0, record.sourceMessages.length)
    if (conversationDigest(prefix) !== record.sourceDigest) continue
    try {
      current = [...replayCompaction(record), ...conversation.slice(prefix.length)]
    } catch (error) {
      console.warn('Cannot replay compaction checkpoint; preserving saved history:', error)
    }
  }
  return current
}
