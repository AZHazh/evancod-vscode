import type { Message } from '../../../types'
import { resolveOpenAIReasoningEffort } from '../../../utils/thinking'
import { sanitizeToolMessageSequence } from './toolMessageSanitizer'
import {
  buildOpenAIHeaders,
  buildUrl,
  createFetchError,
  isOutputLimitStopReason,
  parseJsonObject,
  stringifyToolResultContent,
  throwIfAborted,
  withStreamRetry,
  type ApiClient,
  type ApiClientConfig,
  type ApiClientOptions,
  type ApiClientResponse,
  type StreamCallback,
} from './shared'

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

    // OpenAI Responses API 推理参数。
    // 注意：Responses 用嵌套的 reasoning: { effort } 对象，
    // 而 Chat Completions 用扁平的 reasoning_effort 字段，两者不能混用。
    const reasoningEffort = resolveOpenAIReasoningEffort({
      provider: this.config.provider,
      model: this.config.model,
      effortLevel: this.config.effortLevel,
    })
    if (reasoningEffort) {
      requestBody.reasoning = { effort: reasoningEffort }
      console.log(`[OpenAIResponsesClient] Reasoning effort enabled: ${reasoningEffort}`)
    } else {
      console.log(
        '[OpenAIResponsesClient] Reasoning NOT enabled - effortLevel:',
        this.config.effortLevel,
        'model:',
        this.config.model
      )
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
    let receivedDone = false
    let receivedTerminalEvent = false
    let stopReason: string | undefined
    let responseIncomplete = false

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
        if (!data) continue
        if (data === '[DONE]') {
          receivedDone = true
          continue
        }

        let event: any
        try {
          event = JSON.parse(data)
        } catch {
          continue
        }

        const type: string = typeof event.type === 'string' ? event.type : ''

        if (type === 'response.completed') {
          receivedTerminalEvent = true
          stopReason = event.response?.status || 'completed'
          continue
        }

        if (type === 'response.incomplete') {
          receivedTerminalEvent = true
          responseIncomplete = true
          stopReason =
            event.response?.incomplete_details?.reason ||
            event.response?.status ||
            'incomplete'
          continue
        }

        if (type === 'response.failed' || type === 'error') {
          const message =
            event.response?.error?.message || event.error?.message || event.message || 'Responses 流执行失败'
          throw new Error(message)
        }

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
      stopReason,
      incomplete:
        responseIncomplete ||
        isOutputLimitStopReason(stopReason) ||
        (!receivedDone && !receivedTerminalEvent),
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
function convertResponsesInputItems(rawMessages: Message[]): any[] {
  // 兜底修复未配对的 function_call / function_call_output，否则 Responses 直接 400
  const messages = sanitizeToolMessageSequence(rawMessages)
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
