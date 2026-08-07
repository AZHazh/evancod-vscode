/**
 * API 客户端共享层
 *
 * 三家协议（Anthropic messages / OpenAI chat completions / OpenAI responses）
 * 各自的实现拆分到独立文件，这里只放它们都要用到的东西：
 *  - 对外契约类型（ApiClientConfig / ApiClientResponse / ApiClient 等）
 *  - 流式请求的重试策略
 *  - fetch 层的 URL / header / 错误构造
 *  - 协议无关的小工具
 *
 * 判断某个函数该不该放这里的标准很简单：是否被两个以上客户端使用。
 * 只服务单一协议的转换逻辑（如 convertAnthropicMessages）留在各自文件里。
 */

import Anthropic from '@anthropic-ai/sdk'
import type { EffortLevel, Message, Provider, TokenUsage } from '../../../types'

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
  /** 上游返回的原始停止原因，例如 end_turn / tool_use / max_tokens / length。 */
  stopReason?: string
  /** 输出被限长截断，或流在明确完成事件之前结束。 */
  incomplete?: boolean
}

export interface ApiClientOptions {
  signal?: AbortSignal
  /** 原生生图事件回调（目前仅 OpenAI Responses 路径产生） */
  onImageEvent?: ImageStreamCallback
}

export interface ApiClient {
  sendMessage(messages: Message[]): Promise<string>
  sendMessageStream(messages: Message[], onStream: StreamCallback, tools?: any[], options?: ApiClientOptions): Promise<ApiClientResponse>
  testConnection(): Promise<boolean>
}

export function throwIfAborted(signal?: AbortSignal): void {
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

export function isOutputLimitStopReason(reason?: string): boolean {
  if (!reason) return false
  return /max[_-]?(?:output[_-]?)?tokens?|length|incomplete/i.test(reason)
}

/**
 * 为流式请求提供有限重试。
 *
 * 断流（网络中断、超时、上游 5xx/429）时自动重连，指数退避。
 * 约束：
 * - 用户主动取消不重试。
 * - 已经向 UI 吐出正文/图片的流不重试（重连会导致内容重复）。
 * - 仅对可重试错误重试；鉴权/参数错误立即抛出。
 */
export async function withStreamRetry(
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

export function buildUrl(provider: Provider, endpoint: string): string {
  if (!provider.baseUrl) {
    throw new Error('Provider 缺少 Base URL')
  }

  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const normalizedEndpoint = endpoint.replace(/^\/+/, '')
  return `${baseUrl}/${normalizedEndpoint}`
}

export function buildOpenAIHeaders(provider: Provider): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
  }
}

export async function createFetchError(response: Response): Promise<Error> {
  let detail = ''
  try {
    const data: any = await response.json()
    detail = data.error?.message || data.message || JSON.stringify(data)
  } catch {
    detail = await response.text().catch(() => '')
  }

  return new Error(`API 错误 (${response.status}): ${detail || response.statusText}`)
}

export function parseJsonObject(input: string): any {
  try {
    return JSON.parse(input || '{}')
  } catch {
    return {}
  }
}

/**
 * OpenAI Chat Completions 协议要求 role:'tool' 消息的 content 为字符串。
 * 若上游存了数组（Anthropic 风格的 tool_result blocks），这里拍平成纯文本，
 * 避免上游因类型不符而报错或忽略工具结果。
 */
export function stringifyToolResultContent(content: unknown): string {
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
