import type { Message } from '../../types'
import { randomUUID } from 'node:crypto'
import type { ApiClient, ApiClientOptions } from '../../core/services/api/shared'
import { isOutputLimitStopReason } from '../../core/services/api/shared'
import { sanitizeToolMessageSequence } from '../../core/services/api/toolMessageSanitizer'
import { getCompactPrompt } from './compactPrompt'

export const COMPACT_PROMPT_VERSION = 'structured-v1'

export function isCompactSummaryMessage(message: Message): boolean {
  return (
    /^(compact-boundary|summary|deep-summary)-/.test(message.id) ||
    message.content.startsWith('This session is being continued from a previous conversation')
  )
}

/** 旧摘要只参与下一次摘要生成一次，不作为最近消息继续叠加。 */
export function buildRollingCompactionInput(messages: Message[]): Message[] {
  const summaries = messages.filter(isCompactSummaryMessage)
  const conversation = messages.filter(message => !isCompactSummaryMessage(message))
  const latestSummary = summaries[summaries.length - 1]
  return latestSummary ? [latestSummary, ...conversation] : conversation
}

export function replaceWithRollingSummary(
  messages: Message[],
  summaryMessage: Message,
  keepRecent: number
): Message[] {
  const conversation = messages.filter(message => !isCompactSummaryMessage(message))
  let start = Math.max(0, conversation.length - keepRecent)
  const first = conversation[start]
  if (first?.role === 'tool' && first.toolCallId) {
    for (let index = start - 1; index >= 0; index--) {
      if (conversation[index].toolCalls?.some(call => call.id === first.toolCallId)) {
        start = index
        break
      }
    }
  }
  return [summaryMessage, ...conversation.slice(start)]
}

/**
 * 剥离消息中的图片，用 [image] 占位
 * 避免摘要请求消耗过多 tokens
 */
export function buildStructuredCompactionMessages(messages: Message[]): Message[] {
  const history = sanitizeToolMessageSequence(messages).map(msg => {
    if (!msg.contentBlocks?.length) {
      return msg
    }

    const strippedBlocks = msg.contentBlocks.map(block => {
      if (block.type === 'image') {
        const paths = msg.attachments?.filter(item => item.kind === 'image').map(item => item.path)
        return { type: 'text' as const, text: `[image omitted${paths?.length ? `: ${paths.join(', ')}` : ''}]` }
      }
      return block
    })

    return { ...msg, contentBlocks: strippedBlocks }
  })
  return [...history, {
    id: 'compact-request',
    role: 'user',
    content: getCompactPrompt(),
    timestamp: Date.now(),
    internal: true,
  }]
}

/**
 * 格式化摘要内容
 */
function formatCompactSummary(content: string): string {
  // 如果摘要已经包含了提示词结构，直接返回
  if (content.includes('Primary Request and Intent:')) {
    return content
  }

  // 否则简单格式化
  return `Summary:\n${content}`
}

/**
 * 使用模型生成会话摘要
 *
 * @param messages 原始消息数组
 * @param apiClient API 客户端（已固化摘要模型）
 * @param _model 保留参数，模型已固化在 apiClient 中
 * @returns 摘要消息和边界ID
 */
export async function compactConversation(
  messages: Message[],
  apiClient: Pick<ApiClient, 'sendMessageStream'>,
  _model: string,
  options: { tools?: unknown[]; signal?: AbortSignal } = {}
): Promise<{ summaryMessage: Message; boundaryId: string }> {
  options.signal?.throwIfAborted()
  const requestOptions: ApiClientOptions = { signal: options.signal }
  const summaryResponse = await apiClient.sendMessageStream(
    buildStructuredCompactionMessages(messages),
    () => {},
    options.tools || [],
    requestOptions
  )
  options.signal?.throwIfAborted()
  if (summaryResponse.incomplete || summaryResponse.degenerate || isOutputLimitStopReason(summaryResponse.stopReason) ||
      summaryResponse.toolCalls?.length || !summaryResponse.content.trim()) {
    throw new Error('Compaction did not produce a complete text summary')
  }

  // 5. 格式化摘要
  const formattedSummary = formatCompactSummary(summaryResponse.content)

  // 6. 创建摘要消息
  const boundaryId = `compact-boundary-${randomUUID()}`
  const summaryMessage: Message = {
    id: boundaryId,
    role: 'user',
    content: `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

${formattedSummary}

Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.`,
    timestamp: Date.now(),
  }

  return { summaryMessage, boundaryId }
}
