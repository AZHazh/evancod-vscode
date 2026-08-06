import type { Message } from '../../../types'

/**
 * 合成工具结果的占位文本。用户在工具执行前后取消、或下一轮请求抛错时，
 * 历史里会留下没有配对结果的 tool_use，这里补一条明确的中断说明。
 */
const INTERRUPTED_RESULT = '[工具调用已中断，没有产生结果。该次调用未完成，请勿假设它已生效。]'

/**
 * 清理消息历史中的「孤儿」工具调用与工具结果。
 *
 * 三家协议（Anthropic messages / OpenAI chat completions / OpenAI responses）
 * 都强制要求 tool_use 与 tool_result 严格配对：
 *  - assistant 里的每个 tool_use，后面必须出现同 id 的 tool_result；
 *  - 每个 tool_result 必须能对应到前面某个 tool_use。
 * 任一条不满足，请求直接 400。
 *
 * 产生孤儿的真实路径：
 *  1. QueryEngine 先 push 带 toolCalls 的 assistant 消息，再执行工具。这中间
 *     的 throwIfCancelled（用户点停止）会让 tool 结果永远不被 push。
 *  2. 工具结果已写入，但下一轮 sendMessageStream 抛错（网络中断、429、超时）。
 *  3. 压缩/截断历史时把 assistant 或 tool 消息切掉一半。
 *
 * 因为 QueryEngine 跨请求复用同一份 messages，孤儿一旦进入就会导致之后每次
 * 请求都 400——表现为「会话断掉后再也无法继续」。所以这里做兜底修复而不是
 * 只在某一处防御。
 *
 * @param messages 原始消息数组
 * @returns 修复后的新数组（不修改入参）
 */
export function sanitizeToolMessageSequence(messages: Message[]): Message[] {
  if (!messages.length) return messages

  const resultQueues = new Map<string, Array<{ message: Message; index: number }>>()

  for (const [index, message] of messages.entries()) {
    if (message.role === 'tool' && message.toolCallId) {
      const queue = resultQueues.get(message.toolCallId) || []
      queue.push({ message, index })
      resultQueues.set(message.toolCallId, queue)
    }
  }

  const sanitized: Message[] = []
  const consumedResultIndexes = new Set<number>()

  for (const [index, message] of messages.entries()) {
    if (message.role === 'tool') {
      if (!consumedResultIndexes.has(index)) continue
      continue
    }

    sanitized.push(message)

    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      continue
    }

    for (const toolCall of message.toolCalls) {
      const queuedResult = resultQueues.get(toolCall.id)?.shift()
      if (queuedResult) {
        consumedResultIndexes.add(queuedResult.index)
        sanitized.push(queuedResult.message)
        continue
      }

      sanitized.push({
        id: 'synthetic-tool-result-' + toolCall.id,
        role: 'tool',
        content: INTERRUPTED_RESULT,
        timestamp: message.timestamp,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      })
    }
  }

  const unchanged =
    sanitized.length === messages.length &&
    sanitized.every((message, index) => message === messages[index])
  return unchanged ? messages : sanitized
}

/**
 * 为「未闭合的 tool_use」补齐工具结果，就地修改传入的数组。
 *
 * 与 sanitizeToolMessageSequence 的区别：后者作用于发给 API 的副本，是最后一道
 * 兜底；这个函数用于修复会话的真实历史（QueryEngine.config.messages），
 * 让被中断的会话在下一次请求时本身就是合法的、可以继续的。
 *
 * @param messages 会话真实历史（会被就地修改）
 * @returns 是否发生了修改
 */
export function closeDanglingToolCalls(messages: Message[]): boolean {
  const sanitized = sanitizeToolMessageSequence(messages)
  if (sanitized === messages) return false

  messages.splice(0, messages.length, ...sanitized)
  return true
}
