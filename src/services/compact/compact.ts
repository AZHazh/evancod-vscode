import type { Message } from '../../types'
import { getCompactPrompt } from './compactPrompt'

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
function stripImagesFromMessages(messages: Message[]): Message[] {
  return messages.map(msg => {
    if (!msg.contentBlocks?.length) {
      return msg
    }

    const strippedBlocks = msg.contentBlocks.map(block => {
      if (block.type === 'image') {
        return { type: 'text' as const, text: '[image]' }
      }
      return block
    })

    return { ...msg, contentBlocks: strippedBlocks }
  })
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
  apiClient: any,
  _model: string
): Promise<{ summaryMessage: Message; boundaryId: string }> {
  // 1. 构造摘要请求
  const summaryPrompt = getCompactPrompt()

  // 2. 剥离图片（用 [image] 替换）
  const stripped = stripImagesFromMessages(messages)

  // 3. 将消息历史转换为简单文本格式
  const historyText = stripped
    .map(msg => {
      const role = msg.role === 'user' ? 'User' : 'Assistant'
      const content = msg.contentBlocks?.length
        ? msg.contentBlocks.map(block => block.type === 'text' ? block.text || '' : '[image]').join('\n')
        : msg.content
      return `${role}: ${content}`
    })
    .join('\n\n')

  // 4. 调用模型生成摘要（使用 haiku-4 降低成本）
  const summaryResponse = await apiClient.sendMessageStream(
    [
      {
        role: 'user',
        content: `${summaryPrompt}\n\n---\n\n以下是需要总结的会话历史：\n\n${historyText}`,
        timestamp: Date.now(),
        id: 'compact-request',
      },
    ],
    () => {}, // 无需流式回调
    [], // 无工具
    { thinkingDisabled: true }
  )

  // 5. 格式化摘要
  const formattedSummary = formatCompactSummary(summaryResponse.content)

  // 6. 创建摘要消息
  const boundaryId = `compact-boundary-${Date.now()}`
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
