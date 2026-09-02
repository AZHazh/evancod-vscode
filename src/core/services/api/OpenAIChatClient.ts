import type { Message, TokenUsage } from '../../../types'
import { resolveOpenAIReasoningEffort } from '../../../utils/thinking'
import { sanitizeToolMessageSequence } from './toolMessageSanitizer'
import {
  buildOpenAIHeaders,
  buildUrl,
  createFetchError,
  isOutputLimitStopReason,
  normalizeOpenAIUsage,
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
      stream_options: { include_usage: true },
    }

    // OpenAI 推理参数。
    // 注意：Chat Completions 用扁平的 reasoning_effort 字段，
    // 而 Responses 用嵌套的 reasoning: { effort } 对象，两者不能混用。
    const reasoningEffort = resolveOpenAIReasoningEffort({
      provider: this.config.provider,
      model: this.config.model,
      effortLevel: this.config.effortLevel,
    })
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort
      console.log(`[OpenAIChatClient] Reasoning effort enabled: ${reasoningEffort}`)
    } else {
      console.log(
        '[OpenAIChatClient] Reasoning NOT enabled - effortLevel:',
        this.config.effortLevel,
        'model:',
        this.config.model
      )
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
      let finishReason: string | undefined
      let receivedDone = false
      let usage: TokenUsage | undefined

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

          const chunk = JSON.parse(data)
          if (chunk.usage) {
            usage = normalizeOpenAIUsage(chunk.usage)
          }
          const choice = chunk.choices?.[0]
          if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
            finishReason = choice.finish_reason
          }
          const delta = choice?.delta
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
        usage,
        stopReason: finishReason,
        incomplete:
          isOutputLimitStopReason(finishReason) || (!receivedDone && !finishReason),
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

function convertOpenAIChatMessages(rawMessages: Message[]): any[] {
  // 兜底修复未配对的 tool_calls / tool 结果，否则 OpenAI 直接 400
  const messages = sanitizeToolMessageSequence(rawMessages)
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
