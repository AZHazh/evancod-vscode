/**
 * Anthropic Messages API 客户端
 *
 * 走官方 SDK（@anthropic-ai/sdk），支持 thinking（推理）与 vision（图片）。
 * 消息转换 convertAnthropicMessages 只服务本协议，故与客户端同文件。
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Message, TokenUsage } from '../../../types'
import { resolveThinkingParam, resolveMaxTokens } from '../../../utils/thinking'
import { sanitizeToolMessageSequence } from './toolMessageSanitizer'
import {
  type ApiClient,
  type ApiClientConfig,
  type ApiClientOptions,
  type ApiClientResponse,
  type StreamCallback,
  isOutputLimitStopReason,
  throwIfAborted,
  withStreamRetry,
} from './shared'

type AnthropicContentBlock = {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: any[]
}

export class AnthropicClient implements ApiClient {
  private client: Anthropic
  private config: ApiClientConfig

  constructor(config: ApiClientConfig) {
    this.config = config

    const provider = config.provider
    const clientConfig: any = {}

    // 按鉴权策略决定使用 x-api-key（apiKey）还是 Authorization: Bearer（authToken），
    // 与桌面端 buildAnthropicAuthHeaders 保持一致。若忽略 authStrategy 一律走 x-api-key，
    // 会导致仅接受 Bearer Token 的中转（如甜豆）鉴权失败（401）。
    switch (provider.authStrategy) {
      case 'auth_token':
      case 'auth_token_empty_api_key':
        clientConfig.authToken = provider.apiKey
        break
      case 'dual_same_token':
        clientConfig.apiKey = provider.apiKey
        clientConfig.authToken = provider.apiKey
        break
      case 'dual_dummy':
        clientConfig.apiKey = 'dummy'
        clientConfig.authToken = 'dummy'
        break
      case 'api_key':
      default:
        clientConfig.apiKey = provider.apiKey || 'dummy'
        break
    }

    if (provider.baseUrl) {
      clientConfig.baseURL = provider.baseUrl
    }

    this.client = new Anthropic(clientConfig)
  }

  async sendMessage(messages: Message[]): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens || 4096,
        temperature: this.config.temperature || 1,
        messages: convertAnthropicMessages(messages) as any,
        ...(this.config.systemPrompt ? { system: this.config.systemPrompt } : {}),
      })

      const textContent = response.content.find(c => c.type === 'text')
      return textContent?.type === 'text' ? textContent.text : ''
    } catch (error) {
      throw handleApiError(error)
    }
  }

  async sendMessageStream(
    messages: Message[],
    onStream: StreamCallback,
    tools?: any[],
    options?: ApiClientOptions
  ): Promise<ApiClientResponse> {
    // 跟踪是否已向 UI 吐出正文/思考增量。一旦吐出，重试会导致内容重复，
    // 因此只在「尚未产出任何内容」时才允许重连。
    let streamedContent = false
    const trackedStream: StreamCallback = (delta, type) => {
      if ((type === 'delta' || type === 'thinking') && delta) streamedContent = true
      onStream(delta, type)
    }

    const attempt = async (): Promise<ApiClientResponse> => {
      throwIfAborted(options?.signal)

      // 计算 thinking 参数（结合用户 effortLevel 与模型能力）
      const thinking = resolveThinkingParam({
        provider: this.config.provider,
        model: this.config.model,
        effortLevel: this.config.effortLevel,
      })

      const convertedMessages = convertAnthropicMessages(messages)
      const requestParams: any = {
        model: this.config.model,
        max_tokens: this.config.maxTokens ?? resolveMaxTokens(this.config.model, thinking),
        // 启用 thinking 时 temperature 必须为 1
        temperature: thinking && thinking.type !== 'disabled' ? 1 : this.config.temperature || 1,
        messages: convertedMessages,
        stream: true,
        ...(this.config.systemPrompt ? { system: this.config.systemPrompt } : {}),
      }

      if (thinking) {
        requestParams.thinking = thinking
        console.log('[AnthropicClient] Thinking enabled:', JSON.stringify(thinking))
      } else {
        console.log('[AnthropicClient] Thinking NOT enabled - effortLevel:', this.config.effortLevel, 'model:', this.config.model)
      }

      if (tools && tools.length > 0) {
        requestParams.tools = tools
      }

      console.log('[AnthropicClient] Request params:', {
        model: requestParams.model,
        max_tokens: requestParams.max_tokens,
        temperature: requestParams.temperature,
        thinking: requestParams.thinking,
        messageCount: convertedMessages.length,
      })

      const stream = this.client.messages.stream(requestParams)
      let fullContent = ''
      const toolCalls: any[] = []
      let currentToolCall: any = null
      let usage: TokenUsage | undefined
      let stopReason: string | undefined
      let receivedMessageStop = false

      for await (const event of stream) {
        throwIfAborted(options?.signal)
        switch (event.type) {
          case 'message_start':
            usage = normalizeAnthropicUsage(event.message?.usage)
            trackedStream('', 'start')
            break

          case 'content_block_start':
            if (event.content_block?.type === 'tool_use') {
              currentToolCall = {
                id: event.content_block.id,
                name: event.content_block.name,
                input: {},
              }
            }
            break

          case 'content_block_delta': {
            const delta = event.delta as { type: string; text?: string; partial_json?: string; thinking?: string }
            if (delta.type === 'text_delta') {
              fullContent += delta.text || ''
              trackedStream(delta.text || '', 'delta')
            } else if (delta.type === 'thinking_delta') {
              // 思考增量：Anthropic API 使用 thinking 字段，不是 text
              const thinkingText = delta.thinking || delta.text || ''
              trackedStream(thinkingText, 'thinking')
            } else if (delta.type === 'input_json_delta' && currentToolCall) {
              currentToolCall.inputJson = `${currentToolCall.inputJson || ''}${delta.partial_json}`
            }
            break
          }

          case 'content_block_stop':
            if (currentToolCall) {
              try {
                currentToolCall.input = JSON.parse(currentToolCall.inputJson || '{}')
              } catch {
                currentToolCall.input = {}
              }
              delete currentToolCall.inputJson
              toolCalls.push(currentToolCall)
              currentToolCall = null
            }
            break

          case 'message_delta':
            usage = mergeClientUsage(usage, normalizeAnthropicUsage(event.usage))
            stopReason = (event.delta as { stop_reason?: string | null })?.stop_reason || stopReason
            break

          case 'message_stop':
            receivedMessageStop = true
            trackedStream('', 'end')
            break
        }
      }

      return {
        content: fullContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage,
        stopReason,
        incomplete: !receivedMessageStop || isOutputLimitStopReason(stopReason),
      }
    }

    return withStreamRetry(attempt, { signal: options?.signal, hasStreamedContent: () => streamedContent })
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hello' }] as any,
        ...(this.config.systemPrompt ? { system: this.config.systemPrompt } : {}),
      })

      return response.content.length > 0
    } catch (error) {
      throw handleApiError(error)
    }
  }
}

function convertAnthropicMessages(rawMessages: Message[]): AnthropicMessage[] {
  // 兜底修复未配对的 tool_use / tool_result，否则 Anthropic 直接 400
  const messages = sanitizeToolMessageSequence(rawMessages)

  const converted: AnthropicMessage[] = []
  let pendingToolResultBlocks: AnthropicContentBlock[] = []

  const flushToolResultBlocks = () => {
    if (pendingToolResultBlocks.length > 0) {
      converted.push({
        role: 'user',
        content: pendingToolResultBlocks,
      })
      pendingToolResultBlocks = []
    }
  }

  for (const message of messages) {
    if (message.role === 'system') {
      continue
    }

    if (message.role === 'tool') {
      // 工具结果含图片时，QueryEngine 会在 contentBlocks 里放好 Anthropic 风格的
      // tool_result blocks（text + image），优先使用它让模型以 vision 方式看见图片；
      // 否则回退到纯文本 content。
      pendingToolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: message.toolCallId || '',
        content: message.contentBlocks?.length
          ? (message.contentBlocks as any[])
          : normalizeToolResultContent(message.content),
      })
      continue
    }

    flushToolResultBlocks()

    if (message.role === 'user') {
      converted.push({
        role: 'user',
        content: message.contentBlocks?.length ? message.contentBlocks as any[] : [{ type: 'text', text: message.content }],
      })
      continue
    }

    if (message.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = []

      if (message.content) {
        blocks.push({ type: 'text', text: message.content })
      }

      if (message.toolCalls?.length) {
        blocks.push(
          ...message.toolCalls.map(toolCall => ({
            type: 'tool_use' as const,
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input ?? toolCall.args,
          }))
        )
      }

      if (blocks.length > 0) {
        converted.push({
          role: 'assistant',
          content: blocks,
        })
      }
    }
  }

  flushToolResultBlocks()
  return converted
}

function normalizeToolResultContent(content: unknown): unknown {
  if (Array.isArray(content)) {
    return content
  }

  if (content && typeof content === 'object') {
    return content
  }

  return [{ type: 'text', text: String(content ?? '') }]
}

function normalizeAnthropicUsage(usage: any): TokenUsage | undefined {
  if (!usage) return undefined
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
  }
}

function mergeClientUsage(current: TokenUsage | undefined, next: TokenUsage | undefined): TokenUsage | undefined {
  if (!next) return current
  const merged: TokenUsage = { ...(current || {}) }
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    const value = next[key]
    if (typeof value === 'number') {
      const previous = typeof merged[key] === 'number' ? (merged[key] as number) : 0
      merged[key] = previous + value
    }
  }
  return merged
}

function handleApiError(error: any): Error {
  if (error instanceof Anthropic.APIError) {
    const status = error.status

    switch (status) {
      case 401:
        return new Error('API Key 无效，请检查 Provider 配置')
      case 429:
        return new Error('请求过多，请稍后再试')
      case 500:
      case 502:
      case 503:
        return new Error('API 服务器错误，请稍后再试')
      default:
        return new Error(`API 错误 (${status}): ${error.message}`)
    }
  }

  if (error.code === 'ECONNREFUSED') {
    return new Error('无法连接到 API 服务器，请检查网络或 Base URL 配置')
  }

  if (error.code === 'ETIMEDOUT') {
    return new Error('请求超时，请检查网络连接')
  }

  return new Error(error.message || '未知错误')
}
