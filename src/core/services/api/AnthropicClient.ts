import Anthropic from '@anthropic-ai/sdk'
import type { EffortLevel, Message, Provider, TokenUsage } from '../../../types'
import { resolveThinkingParam, resolveMaxTokens } from '../../../utils/thinking'

export interface ApiClientConfig {
  provider: Provider
  model: string
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  verbose?: boolean
  /** 推理程度，用于决定 thinking 参数 */
  effortLevel?: EffortLevel
}

export type StreamCallback = (delta: string, type: 'start' | 'delta' | 'end' | 'thinking') => void

/**
 * 原生生图事件（路线二：图片走独立通道，不进入文本内容/LLM 上下文）。
 * - start：上游开始生成图片（image_generation_call 出现），前端可展示骨架图。
 * - complete：图片就绪，携带 base64 + mime。
 */
export interface ImageStreamEvent {
  imageId: string
  phase: 'start' | 'complete'
  base64?: string
  mime?: string
}

export type ImageStreamCallback = (event: ImageStreamEvent) => void

export interface ApiClientResponse {
  content: string
  toolCalls?: any[]
  usage?: TokenUsage
}

export interface ApiClientOptions {
  signal?: AbortSignal
  /** 原生生图事件回调（目前仅 OpenAI Responses 路径产生） */
  onImageEvent?: ImageStreamCallback
}

interface ApiClient {
  sendMessage(messages: Message[]): Promise<string>
  sendMessageStream(messages: Message[], onStream: StreamCallback, tools?: any[], options?: ApiClientOptions): Promise<ApiClientResponse>
  testConnection(): Promise<boolean>
}

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

    const clientConfig: any = {
      apiKey: config.provider.apiKey || 'dummy',
    }

    if (config.provider.baseUrl) {
      clientConfig.baseURL = config.provider.baseUrl
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
    try {
      throwIfAborted(options?.signal)

      // 计算 thinking 参数（结合用户 effortLevel 与模型能力）
      const thinking = resolveThinkingParam({
        provider: this.config.provider,
        model: this.config.model,
        effortLevel: this.config.effortLevel,
      })

      const requestParams: any = {
        model: this.config.model,
        max_tokens: this.config.maxTokens ?? resolveMaxTokens(this.config.model, thinking),
        // 启用 thinking 时 temperature 必须为 1
        temperature: thinking && thinking.type !== 'disabled' ? 1 : this.config.temperature || 1,
        messages: convertAnthropicMessages(messages) as any,
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
      })

      const stream = this.client.messages.stream(requestParams)
      let fullContent = ''
      const toolCalls: any[] = []
      let currentToolCall: any = null
      let usage: TokenUsage | undefined

      for await (const event of stream) {
        throwIfAborted(options?.signal)
        switch (event.type) {
          case 'message_start':
            usage = normalizeAnthropicUsage(event.message?.usage)
            onStream('', 'start')
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
              onStream(delta.text || '', 'delta')
            } else if (delta.type === 'thinking_delta') {
              // 思考增量：Anthropic API 使用 thinking 字段，不是 text
              const thinkingText = delta.thinking || delta.text || ''
              console.log('[AnthropicClient] Received thinking_delta:', {
                hasThinking: !!delta.thinking,
                hasText: !!delta.text,
                content: thinkingText.substring(0, 100)
              })
              onStream(thinkingText, 'thinking')
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
            break

          case 'message_stop':
            onStream('', 'end')
            break
        }
      }

      return {
        content: fullContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage,
      }
    } catch (error) {
      throw handleApiError(error)
    }
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

export class OpenAIChatClient implements ApiClient {
  constructor(private config: ApiClientConfig) {}

  async sendMessage(messages: Message[]): Promise<string> {
    const response = await this.fetchJson('/v1/chat/completions', {
      model: this.config.model,
      messages: this.config.systemPrompt
        ? [{ role: 'system', content: this.config.systemPrompt }, ...convertOpenAIChatMessages(messages)]
        : convertOpenAIChatMessages(messages),
      max_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature ?? 1,
    })

    return response.choices?.[0]?.message?.content || ''
  }

  async sendMessageStream(
    messages: Message[],
    onStream: StreamCallback,
    tools?: any[],
    options?: ApiClientOptions
  ): Promise<ApiClientResponse> {
    throwIfAborted(options?.signal)
    onStream('', 'start')

    const body: any = {
      model: this.config.model,
      messages: this.config.systemPrompt
        ? [{ role: 'system', content: this.config.systemPrompt }, ...convertOpenAIChatMessages(messages)]
        : convertOpenAIChatMessages(messages),
      max_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature ?? 1,
      stream: true,
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      }))
    }

    const response = await this.fetchStream('/v1/chat/completions', body, options?.signal)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('上游没有返回流式内容')

    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''
    const toolCallChunks = new Map<number, any>()

    while (true) {
      const { value, done } = await reader.read()
      throwIfAborted(options?.signal)
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue

        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue

        const chunk = JSON.parse(data)
        const delta = chunk.choices?.[0]?.delta
        if (!delta) continue

        if (delta.content) {
          fullContent += delta.content
          onStream(delta.content, 'delta')
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index ?? 0
            const current = toolCallChunks.get(index) || {
              id: toolCall.id || `call_${index}`,
              name: '',
              inputJson: '',
            }
            current.id = toolCall.id || current.id
            current.name += toolCall.function?.name || ''
            current.inputJson += toolCall.function?.arguments || ''
            toolCallChunks.set(index, current)
          }
        }
      }
    }

    onStream('', 'end')

    const toolCalls = Array.from(toolCallChunks.values()).map(toolCall => ({
      id: toolCall.id,
      name: toolCall.name,
      input: parseJsonObject(toolCall.inputJson),
    }))

    return {
      content: fullContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
  }

  async testConnection(): Promise<boolean> {
    const response = await this.fetchJson('/v1/chat/completions', {
      model: this.config.model,
      messages: [{ role: 'user', content: 'Hello' }] as any,
      max_tokens: 10,
    })

    return Boolean(response.choices?.[0]?.message?.content)
  }

  private async fetchJson(endpoint: string, body: any, signal?: AbortSignal): Promise<any> {
    const response = await fetch(buildUrl(this.config.provider, endpoint), {
      method: 'POST',
      headers: buildOpenAIHeaders(this.config.provider),
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      throw await createFetchError(response)
    }

    return response.json()
  }

  private async fetchStream(endpoint: string, body: any, signal?: AbortSignal): Promise<Response> {
    const response = await fetch(buildUrl(this.config.provider, endpoint), {
      method: 'POST',
      headers: buildOpenAIHeaders(this.config.provider),
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      throw await createFetchError(response)
    }

    return response
  }
}

export class OpenAIResponsesClient implements ApiClient {
  constructor(private config: ApiClientConfig) {}

  async sendMessage(messages: Message[]): Promise<string> {
    const response = await this.fetchJson('/v1/responses', {
      model: this.config.model,
      input: this.config.systemPrompt ? `${this.config.systemPrompt}\n\n${convertResponsesInput(messages)}` : convertResponsesInput(messages),
      max_output_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature ?? 1,
    })

    return extractResponsesText(response)
  }

  async sendMessageStream(messages: Message[], onStream: StreamCallback, tools?: any[], options?: ApiClientOptions): Promise<ApiClientResponse> {
    void tools
    throwIfAborted(options?.signal)
    onStream('', 'start')

    const response = await this.fetchStream('/v1/responses', {
      model: this.config.model,
      input: this.config.systemPrompt ? `${this.config.systemPrompt}\n\n${convertResponsesInput(messages)}` : convertResponsesInput(messages),
      max_output_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature ?? 1,
      stream: true,
    }, options?.signal)

    const reader = response.body?.getReader()
    if (!reader) throw new Error('上游没有返回流式内容')

    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''

    // 原生生图状态：Responses 流不发送独立的 completed 事件，
    // 以最后一帧 partial_image 作为最终图片，在遇到文本输出或流结束时落定。
    let pendingImageId: string | undefined
    let pendingImageB64: string | undefined
    let pendingImageMime = 'image/png'
    let imageSeq = 0

    const flushImage = () => {
      if (pendingImageId && pendingImageB64) {
        options?.onImageEvent?.({
          imageId: pendingImageId,
          phase: 'complete',
          base64: pendingImageB64,
          mime: pendingImageMime,
        })
      }
      pendingImageId = undefined
      pendingImageB64 = undefined
      pendingImageMime = 'image/png'
    }

    while (true) {
      const { value, done } = await reader.read()
      throwIfAborted(options?.signal)
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue

        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue

        let event: any
        try {
          event = JSON.parse(data)
        } catch {
          continue
        }

        const type: string = typeof event.type === 'string' ? event.type : ''

        // === 原生生图：image_generation_call 生命周期 ===
        if (type === 'response.output_item.added' && event.item?.type === 'image_generation_call') {
          // 多图场景：新图开始前先落定上一张
          flushImage()
          pendingImageId = `imggen-${imageSeq++}-${Date.now()}`
          pendingImageB64 = undefined
          pendingImageMime = 'image/png'
          options?.onImageEvent?.({ imageId: pendingImageId, phase: 'start' })
          continue
        }

        if (type === 'response.image_generation_call.partial_image') {
          const b64 = typeof event.partial_image_b64 === 'string' ? event.partial_image_b64 : undefined
          if (b64) {
            // 保留最后一帧作为最终图片
            pendingImageB64 = b64
            if (typeof event.output_format === 'string' && event.output_format) {
              pendingImageMime = `image/${event.output_format.toLowerCase()}`
            }
          }
          // 未拿到 imageId（如缺 added 事件）时兜底补发 start
          if (!pendingImageId) {
            pendingImageId = `imggen-${imageSeq++}-${Date.now()}`
            options?.onImageEvent?.({ imageId: pendingImageId, phase: 'start' })
          }
          continue
        }

        // 文本输出开始/增量，说明生图阶段结束，先落定图片
        if (type === 'response.output_text.delta') {
          flushImage()
          const delta = typeof event.delta === 'string' ? event.delta : ''
          if (delta) {
            fullContent += delta
            onStream(delta, 'delta')
          }
          continue
        }

        // 其余事件（output_text.done / content_part.* / output_item.done 等）不重复累计文本，
        // 避免 delta 与 done.text 双计。
      }
    }

    // 流结束兜底：仅有图片、无后续文本时也要落定
    flushImage()

    onStream('', 'end')
    return { content: fullContent }
  }

  async testConnection(): Promise<boolean> {
    const response = await this.fetchJson('/v1/responses', {
      model: this.config.model,
      input: 'Hello',
      max_output_tokens: 10,
    })

    return Boolean(extractResponsesText(response))
  }

  private async fetchJson(endpoint: string, body: any, signal?: AbortSignal): Promise<any> {
    const response = await fetch(buildUrl(this.config.provider, endpoint), {
      method: 'POST',
      headers: buildOpenAIHeaders(this.config.provider),
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      throw await createFetchError(response)
    }

    return response.json()
  }

  private async fetchStream(endpoint: string, body: any, signal?: AbortSignal): Promise<Response> {
    const response = await fetch(buildUrl(this.config.provider, endpoint), {
      method: 'POST',
      headers: buildOpenAIHeaders(this.config.provider),
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      throw await createFetchError(response)
    }

    return response
  }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  switch (config.provider.apiFormat) {
    case 'openai_chat':
      return new OpenAIChatClient(config)
    case 'openai_responses':
      return new OpenAIResponsesClient(config)
    case 'anthropic':
    default:
      return new AnthropicClient(config)
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Query cancelled')
  }
}

function convertAnthropicMessages(messages: Message[]): AnthropicMessage[] {
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
      pendingToolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: message.toolCallId || '',
        content: normalizeToolResultContent(message.content),
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

function convertOpenAIChatMessages(messages: Message[]): any[] {
  return messages
    .filter(message => message.role !== 'tool')
    .map(message => ({
      role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
      content: message.content,
    }))
}

function convertResponsesInput(messages: Message[]): string {
  return messages
    .filter(message => message.role !== 'tool')
    .map(message => `${message.role}: ${message.content}`)
    .join('\n\n')
}

function buildUrl(provider: Provider, endpoint: string): string {
  if (!provider.baseUrl) {
    throw new Error('Provider 缺少 Base URL')
  }

  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const normalizedEndpoint = endpoint.replace(/^\/+/, '')
  return `${baseUrl}/${normalizedEndpoint}`
}

function buildOpenAIHeaders(provider: Provider): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
  }
}

async function createFetchError(response: Response): Promise<Error> {
  let detail = ''
  try {
    const data: any = await response.json()
    detail = data.error?.message || data.message || JSON.stringify(data)
  } catch {
    detail = await response.text().catch(() => '')
  }

  return new Error(`API 错误 (${response.status}): ${detail || response.statusText}`)
}

function parseJsonObject(input: string): any {
  try {
    return JSON.parse(input || '{}')
  } catch {
    return {}
  }
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

function extractResponsesText(response: any): string {
  if (typeof response.output_text === 'string') {
    return response.output_text
  }

  if (Array.isArray(response.output)) {
    return response.output
      .flatMap((item: any) => item.content || [])
      .map((content: any) => content.text || '')
      .join('')
  }

  return ''
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
