import type { ContentBlock, Message, Provider, TokenUsage } from '../../types'
import { createApiClient } from '../../core/services/api'

const VISUAL_CONTEXT_PREFIX = 'visual-context-'
const MAX_IMAGES_PER_BATCH = 3

export interface VisualContextResult {
  contexts: Array<{ sourceMessageId: string; message: Message }>
  usage?: TokenUsage
}

/**
 * 将截图只解析一次。原图继续留在持久化消息中，后续主循环只发送结构化视觉报告。
 */
export class VisualContextBuilder {
  constructor(
    private readonly provider: Provider,
    private readonly model: string
  ) {}

  async buildPending(messages: Message[], signal?: AbortSignal): Promise<VisualContextResult> {
    const existing = new Set(
      messages
        .filter(message => message.id.startsWith(VISUAL_CONTEXT_PREFIX))
        .map(message => message.id.slice(VISUAL_CONTEXT_PREFIX.length))
    )
    const sources = messages.filter(
      message =>
        !existing.has(message.id) &&
        message.contentBlocks?.some(block => block.type === 'image' && block.source?.data)
    )
    if (!sources.length) return { contexts: [] }

    const client = createApiClient({
      provider: this.provider,
      model: this.model,
      effortLevel: 'low',
      maxTokens: 3_000,
      systemPrompt:
        '你是软件工程 Agent 的视觉上下文提取器。准确读取截图中的界面、文字、错误、' +
        '代码、布局和状态。输出结构化中文事实报告，不提出任务计划，不猜测看不清的内容。',
    })
    const contexts: VisualContextResult['contexts'] = []
    let usage: TokenUsage | undefined

    for (const source of sources) {
      try {
        const images = (source.contentBlocks || []).filter(
          (block): block is ContentBlock & { source: NonNullable<ContentBlock['source']> } =>
            block.type === 'image' && Boolean(block.source?.data)
        )
        const reports: string[] = []

        for (let index = 0; index < images.length; index += MAX_IMAGES_PER_BATCH) {
          const batch = images.slice(index, index + MAX_IMAGES_PER_BATCH)
          const prompt =
            `分析这组截图（第 ${Math.floor(index / MAX_IMAGES_PER_BATCH) + 1} 组，共 ` +
            `${Math.ceil(images.length / MAX_IMAGES_PER_BATCH)} 组）。逐张记录：可见文字、` +
            '界面结构、关键状态、错误信息，以及对后续软件工程任务有用的细节。'
          const response = await client.sendMessageStream(
            [
              {
                id: `visual-analysis-${source.id}-${index}`,
                role: 'user',
                content: prompt,
                contentBlocks: [{ type: 'text', text: prompt }, ...batch],
                timestamp: Date.now(),
                internal: true,
              },
            ],
            () => {},
            [],
            { signal }
          )
          if (!response.content.trim()) {
            throw new Error(`截图视觉分析未返回内容：${source.id}`)
          }
          reports.push(response.content.trim())
          usage = mergeUsage(usage, response.usage)
        }

        contexts.push({
          sourceMessageId: source.id,
          message: {
            id: `${VISUAL_CONTEXT_PREFIX}${source.id}`,
            role: 'user',
            content:
              `[内部视觉上下文，来源消息 ${source.id}；以下是已完成的一次性截图解析，` +
              `后续无需重新读取原图。]\n\n${reports.join('\n\n')}`,
            timestamp: source.timestamp + 1,
            internal: true,
          },
        })
      } catch (error) {
        if (signal?.aborted) throw error
        console.warn(`[VisualContextBuilder] 截图解析失败，保留原图：${source.id}`, error)
      }
    }

    return { contexts, usage }
  }
}

export function insertVisualContexts(
  messages: Message[],
  contexts: VisualContextResult['contexts']
): Message[] {
  if (!contexts.length) return messages
  const bySource = new Map(contexts.map(context => [context.sourceMessageId, context.message]))
  return messages.flatMap(message => {
    const context = bySource.get(message.id)
    return context ? [message, context] : [message]
  })
}

/** 返回请求副本；存在视觉报告时去掉对应源消息中的 base64 图片。 */
export function stripVirtualizedImages(messages: Message[]): Message[] {
  const virtualized = new Set(
    messages
      .filter(message => message.id.startsWith(VISUAL_CONTEXT_PREFIX))
      .map(message => message.id.slice(VISUAL_CONTEXT_PREFIX.length))
  )
  if (!virtualized.size) return messages

  return messages.map(message => {
    if (!virtualized.has(message.id) || !message.contentBlocks?.length) return message
    return {
      ...message,
      contentBlocks: message.contentBlocks.filter(block => block.type !== 'image'),
    }
  })
}

function mergeUsage(
  current: TokenUsage | undefined,
  incoming: TokenUsage | undefined
): TokenUsage | undefined {
  if (!incoming) return current
  const merged: TokenUsage = { ...(current || {}), ...incoming }
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    merged[key] = (current?.[key] || 0) + (incoming[key] || 0)
  }
  return merged
}
