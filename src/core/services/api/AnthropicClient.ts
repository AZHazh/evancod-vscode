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
            break

          case 'message_stop':
            trackedStream('', 'end')
            break
        }
      }

      return {
        content: fullContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage,
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
    // 一旦向 UI 吐出正文，就不再重连（避免重复内容）
    let streamedContent = false

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

    const attempt = async (): Promise<ApiClientResponse> => {
      throwIfAborted(options?.signal)
      onStream('', 'start')

      const response = await this.fetchStream('/v1/chat/completions', body, options?.signal)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('上游没有返回流式内容')

      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''
      // OpenAI 流式工具调用重组。中转网关的实现千奇百怪，必须容忍两类畸形：
      //  1) 同一个调用的整名在多帧里重复下发 —— 不能盲目累加，否则得到 "read_fileread_file"；
      //  2) 复用同一个 index 承载多个不同调用 —— 必须靠 id / 换名另起 slot，
      //     否则两个工具名拼成 "list_directoryskill"。
      // 规则：函数名只在调用的首帧出现，续传帧只带 arguments。
      const slots: Array<{ id: string; name: string; inputJson: string }> = []
      const byId = new Map<string, number>()
      const byIndex = new Map<number, number>()

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
            streamedContent = true
            onStream(delta.content, 'delta')
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const toolCall of delta.tool_calls) {
              const fnName = toolCall.function?.name || ''
              const fnArgs = toolCall.function?.arguments || ''
              const id: string | undefined = toolCall.id || undefined
              const index = typeof toolCall.index === 'number' ? toolCall.index : undefined

              // 先尝试定位这一帧属于哪个已存在的调用：id 最可靠，其次 index。
              let slotIdx =
                (id !== undefined ? byId.get(id) : undefined) ??
                (index !== undefined ? byIndex.get(index) : undefined)

              // 判定是否要另起一个新调用：
              //  - 还没有任何 slot；
              //  - 或带了函数名，但定位到的 slot 名字不同（同一 index 被复用给了别的工具）。
              const located = slotIdx !== undefined ? slots[slotIdx] : undefined
              const isNewCall =
                located === undefined ||
                (!!fnName && !!located.name && located.name !== fnName)

              if (isNewCall) {
                slots.push({
                  id: id || `call_${slots.length}`,
                  name: fnName,
                  inputJson: fnArgs,
                })
                slotIdx = slots.length - 1
                if (id !== undefined) byId.set(id, slotIdx)
                if (index !== undefined) byIndex.set(index, slotIdx)
              } else if (located) {
                // 续传帧：补齐 id，名字只在缺失时填一次（绝不累加，避免 "read_fileread_file"），
                // arguments 才是需要跨帧拼接的部分。
                if (id && located.id.startsWith('call_')) {
                  located.id = id
                  byId.set(id, slotIdx as number)
                }
                if (!located.name && fnName) located.name = fnName
                located.inputJson += fnArgs
              }
            }
          }
        }
      }

      onStream('', 'end')

      const toolCalls = slots
        .filter(slot => slot.name)
        .map(slot => ({
          id: slot.id,
          name: slot.name,
          input: parseJsonObject(slot.inputJson),
        }))

      return {
        content: fullContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      }
    }

    return withStreamRetry(attempt, { signal: options?.signal, hasStreamedContent: () => streamedContent })
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
    // 已吐出正文或图片增量后不再重连，避免内容重复
    let streamedContent = false

    const attempt = async (): Promise<ApiClientResponse> => {
    throwIfAborted(options?.signal)
    onStream('', 'start')

    const requestBody: any = {
      model: this.config.model,
      // 结构化 input 数组，承载文本 / 工具调用 / 工具结果
      input: convertResponsesInputItems(messages),
      max_output_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature ?? 1,
      stream: true,
    }

    // system prompt 走顶层 instructions（Responses 规范），不进 input
    if (this.config.systemPrompt) {
      requestBody.instructions = this.config.systemPrompt
    }

    if (tools && tools.length > 0) {
      requestBody.tools = convertResponsesTools(tools)
    }

    const response = await this.fetchStream('/v1/responses', requestBody, options?.signal)

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

    // 工具调用重组：Responses 用独立的 function_call 事件流表达工具调用。
    //  - response.output_item.added（item.type === 'function_call'）：新调用开始，带 call_id/name
    //  - response.function_call_arguments.delta：逐块累加 arguments
    //  - response.function_call_arguments.done：该调用参数结束
    // 用 output_index 作为分片归属键（Responses 每个 output item 有稳定的 index）；
    // 缺失时用事件里的 item_id 兜底。
    const toolSlots: Array<{ id: string; name: string; argsJson: string }> = []
    const toolIndexMap = new Map<number, number>()
    const toolItemIdMap = new Map<string, number>()

    const locateToolSlot = (outputIndex: number | undefined, itemId: string | undefined): number | undefined => {
      if (outputIndex !== undefined && toolIndexMap.has(outputIndex)) return toolIndexMap.get(outputIndex)
      if (itemId !== undefined && toolItemIdMap.has(itemId)) return toolItemIdMap.get(itemId)
      return undefined
    }

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

        // === 工具调用：function_call 生命周期 ===
        if (type === 'response.output_item.added' && event.item?.type === 'function_call') {
          const item = event.item
          const outputIndex: number | undefined = typeof event.output_index === 'number' ? event.output_index : undefined
          const itemId: string | undefined = typeof item.id === 'string' ? item.id : undefined
          toolSlots.push({
            id: item.call_id || item.id || `call_${toolSlots.length}`,
            name: item.name || '',
            argsJson: typeof item.arguments === 'string' ? item.arguments : '',
          })
          const slotIdx = toolSlots.length - 1
          if (outputIndex !== undefined) toolIndexMap.set(outputIndex, slotIdx)
          if (itemId !== undefined) toolItemIdMap.set(itemId, slotIdx)
          continue
        }

        if (type === 'response.function_call_arguments.delta') {
          const outputIndex: number | undefined = typeof event.output_index === 'number' ? event.output_index : undefined
          const itemId: string | undefined = typeof event.item_id === 'string' ? event.item_id : undefined
          const slotIdx = locateToolSlot(outputIndex, itemId)
          const delta = typeof event.delta === 'string' ? event.delta : ''
          if (slotIdx !== undefined) {
            toolSlots[slotIdx].argsJson += delta
          } else {
            // 未见过 added 事件时兜底：新建一个 slot（缺名字，后续 done 事件补齐）
            toolSlots.push({ id: itemId || `call_${toolSlots.length}`, name: '', argsJson: delta })
            const idx = toolSlots.length - 1
            if (outputIndex !== undefined) toolIndexMap.set(outputIndex, idx)
            if (itemId !== undefined) toolItemIdMap.set(itemId, idx)
          }
          continue
        }

        if (type === 'response.function_call_arguments.done') {
          const outputIndex: number | undefined = typeof event.output_index === 'number' ? event.output_index : undefined
          const itemId: string | undefined = typeof event.item_id === 'string' ? event.item_id : undefined
          const slotIdx = locateToolSlot(outputIndex, itemId)
          // done 事件通常携带完整 arguments，用它校正累加结果，避免分片丢失
          if (slotIdx !== undefined && typeof event.arguments === 'string' && event.arguments) {
            toolSlots[slotIdx].argsJson = event.arguments
          }
          continue
        }

        // output_item.done 补齐 function_call 的 name/call_id（某些实现在 added 时不带全）
        if (type === 'response.output_item.done' && event.item?.type === 'function_call') {
          const item = event.item
          const outputIndex: number | undefined = typeof event.output_index === 'number' ? event.output_index : undefined
          const itemId: string | undefined = typeof item.id === 'string' ? item.id : undefined
          const slotIdx = locateToolSlot(outputIndex, itemId)
          if (slotIdx !== undefined) {
            const slot = toolSlots[slotIdx]
            if (!slot.name && item.name) slot.name = item.name
            if (item.call_id) slot.id = item.call_id
            if (typeof item.arguments === 'string' && item.arguments) slot.argsJson = item.arguments
          }
          continue
        }

        // === 原生生图：image_generation_call 生命周期 ===
        if (type === 'response.output_item.added' && event.item?.type === 'image_generation_call') {
          // 多图场景：新图开始前先落定上一张
          flushImage()
          pendingImageId = `imggen-${imageSeq++}-${Date.now()}`
          pendingImageB64 = undefined
          pendingImageMime = 'image/png'
          streamedContent = true
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
            streamedContent = true
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

    // 组装工具调用：过滤掉没拿到名字的残缺 slot，arguments 解析成对象
    const toolCalls = toolSlots
      .filter(slot => slot.name)
      .map(slot => ({
        id: slot.id,
        name: slot.name,
        input: parseJsonObject(slot.argsJson),
      }))

    return {
      content: fullContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
    }

    return withStreamRetry(attempt, { signal: options?.signal, hasStreamedContent: () => streamedContent })
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

/** 重试配置：最多重试 3 次，指数退避 1s / 2s / 4s。 */
const STREAM_MAX_RETRIES = 3
const STREAM_RETRY_BASE_DELAY = 1000

/**
 * 判断流式请求的错误是否可重试。
 *
 * 可重试：网络类错误（连接被断、超时、DNS）、以及上游 429 / 5xx。
 * 不可重试：用户主动取消（AbortSignal）、鉴权失败（401/403）、参数错误（4xx）。
 */
function isRetryableStreamError(error: unknown): boolean {
  if (!error) return false

  // 用户取消：不重试
  if (error instanceof Error && error.name === 'AbortError') return false
  const message = error instanceof Error ? error.message : String(error)
  if (/Query cancelled|aborted|The operation was aborted/i.test(message)) return false

  // Anthropic SDK 错误：按状态码判断
  if (error instanceof Anthropic.APIError) {
    const status = error.status
    return status === 429 || status === 408 || (typeof status === 'number' && status >= 500)
  }

  // fetch 抛出的 createFetchError：文案里带 "API 错误 (<status>)"
  const statusMatch = message.match(/API 错误 \((\d{3})\)/)
  if (statusMatch) {
    const status = Number(statusMatch[1])
    return status === 429 || status === 408 || status >= 500
  }

  // 原生 fetch / undici 网络层错误：连接被断、超时、DNS、流中途中断
  const code = (error as { code?: string }).code
  if (code && ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) {
    return true
  }
  if (/fetch failed|network|terminated|socket hang up|ECONNRESET|ETIMEDOUT|timeout|premature close/i.test(message)) {
    return true
  }

  return false
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * 为流式请求提供有限重试。
 *
 * 断流（网络中断、超时、上游 5xx/429）时自动重连，指数退避。
 * 约束：
 * - 用户主动取消不重试。
 * - 已经向 UI 吐出正文/图片的流不重试（重连会导致内容重复）。
 * - 仅对可重试错误重试；鉴权/参数错误立即抛出。
 */
async function withStreamRetry(
  attempt: () => Promise<ApiClientResponse>,
  opts: { signal?: AbortSignal; hasStreamedContent: () => boolean }
): Promise<ApiClientResponse> {
  let lastError: unknown

  for (let i = 0; i <= STREAM_MAX_RETRIES; i++) {
    try {
      return await attempt()
    } catch (error) {
      lastError = error

      // 用户取消：直接抛出，绝不重试
      if (opts.signal?.aborted) throw error

      const canRetry =
        i < STREAM_MAX_RETRIES &&
        !opts.hasStreamedContent() &&
        isRetryableStreamError(error)

      if (!canRetry) throw error

      const delay = STREAM_RETRY_BASE_DELAY * 2 ** i
      console.warn(
        `[StreamRetry] 流式请求失败（第 ${i + 1}/${STREAM_MAX_RETRIES} 次），${delay}ms 后重试：`,
        error instanceof Error ? error.message : error
      )
      await sleep(delay)
      throwIfAborted(opts.signal)
    }
  }

  throw lastError
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

function convertOpenAIChatMessages(messages: Message[]): any[] {
  const converted: any[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      converted.push({ role: 'system', content: message.content })
      continue
    }

    // 工具执行结果：OpenAI 协议要求单独一条 role:'tool' 消息，且必须携带
    // tool_call_id 与前一条 assistant 消息里的 tool_calls[].id 对应。
    // 之前这里被整条丢弃，导致 GPT 每轮都看不到"任务已创建"的结果，
    // 从而反复重新拆分、重复调用 task_create。
    if (message.role === 'tool') {
      converted.push({
        role: 'tool',
        tool_call_id: message.toolCallId || '',
        // OpenAI 协议要求 tool 消息的 content 为字符串（不同于 Anthropic 的数组结构）
        content: stringifyToolResultContent(message.content),
      })
      continue
    }

    if (message.role === 'assistant') {
      const assistantMessage: any = {
        role: 'assistant',
        // 有 tool_calls 时 content 可为空，保留文本（可能为空串）
        content: message.content || '',
      }

      // 保留 assistant 的工具调用，转换为 OpenAI function calling 格式。
      // arguments 必须是 JSON 字符串。
      if (message.toolCalls?.length) {
        assistantMessage.tool_calls = message.toolCalls.map(toolCall => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.input ?? toolCall.args ?? {}),
          },
        }))
      }

      converted.push(assistantMessage)
      continue
    }

    // user
    converted.push({ role: 'user', content: message.content })
  }

  return converted
}

function convertResponsesInput(messages: Message[]): string {
  return messages
    .filter(message => message.role !== 'tool')
    .map(message => `${message.role}: ${message.content}`)
    .join('\n\n')
}

/**
 * 把内部 Message[] 转成 OpenAI Responses API 的结构化 `input` 数组。
 *
 * 相比旧的 convertResponsesInput（拍平成一段纯文本），结构化 input 是承载
 * 工具调用/工具结果的前提：
 *  - assistant 的 tool_use → `function_call` item（arguments 为 JSON 字符串）
 *  - tool 结果 → `function_call_output` item（用 call_id 与上面对应）
 *  - user/assistant 文本 → message item，多模态图片走 input_image
 *
 * system prompt 不进 input，改由顶层 `instructions` 字段承载（Responses 规范）。
 */
function convertResponsesInputItems(messages: Message[]): any[] {
  const items: any[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      // system 由顶层 instructions 承载，这里跳过
      continue
    }

    if (message.role === 'tool') {
      // 工具执行结果：Responses 用独立的 function_call_output item，
      // 通过 call_id 与前面的 function_call 对应。output 必须是字符串。
      items.push({
        type: 'function_call_output',
        call_id: message.toolCallId || '',
        output: stringifyToolResultContent(message.content),
      })
      continue
    }

    if (message.role === 'assistant') {
      // 先放文本（若有），再把每个工具调用展开成 function_call item
      if (message.content) {
        items.push({
          role: 'assistant',
          content: [{ type: 'output_text', text: message.content }],
        })
      }

      if (message.toolCalls?.length) {
        for (const toolCall of message.toolCalls) {
          items.push({
            type: 'function_call',
            call_id: toolCall.id,
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.input ?? toolCall.args ?? {}),
          })
        }
      }
      continue
    }

    // user：支持多模态（文本 + 图片）
    items.push({
      role: 'user',
      content: buildResponsesUserContent(message),
    })
  }

  return items
}

/**
 * 构造 Responses user 消息的 content 数组。
 * 纯文本时用 input_text；带 contentBlocks 时把 image 转成 input_image（data URL）。
 */
function buildResponsesUserContent(message: Message): any[] {
  if (message.contentBlocks?.length) {
    return message.contentBlocks.map(block => {
      if (block.type === 'image' && block.source) {
        return {
          type: 'input_image',
          image_url: `data:${block.source.media_type};base64,${block.source.data}`,
        }
      }
      return { type: 'input_text', text: block.text ?? '' }
    })
  }

  return [{ type: 'input_text', text: message.content }]
}

/**
 * 把内部工具定义转成 Responses API 的 tools 格式。
 * 注意：Responses 的 function 是扁平结构（name/description/parameters 直接平铺），
 * 不像 Chat Completions 那样再套一层 `function: {}`。
 */
function convertResponsesTools(tools: any[]): any[] {
  return tools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  }))
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

/**
 * OpenAI Chat Completions 协议要求 role:'tool' 消息的 content 为字符串。
 * 若上游存了数组（Anthropic 风格的 tool_result blocks），这里拍平成纯文本，
 * 避免上游因类型不符而报错或忽略工具结果。
 */
function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map(block => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text?: unknown }).text ?? '')
        }
        return JSON.stringify(block)
      })
      .join('\n')
  }

  if (content && typeof content === 'object') {
    return JSON.stringify(content)
  }

  return String(content ?? '')
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
