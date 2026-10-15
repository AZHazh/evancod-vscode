import type { ContentBlock, Message, TokenUsage } from '../../types'

const DEFAULT_CONTEXT_WINDOW = 200_000
const DEFAULT_TRIGGER_RATIO = 0.75
const DEFAULT_REARM_RATIO = 0.6
const ESTIMATE_SAFETY_FACTOR = 1.1
const IMAGE_FALLBACK_TOKENS = 2_048
const IMAGE_MAX_TOKENS = 8_192

export interface ContextBudgetInput {
  messages: Message[]
  systemPrompt?: string
  tools?: unknown[]
  configuredWindow?: number
}

export interface ContextBudgetSnapshot {
  estimatedTokens: number
  effectiveWindow: number
  usageRatio: number
  shouldCompact: boolean
}

/**
 * 统一计算最终请求预算，并用成功请求的真实 prompt usage 校准本地估算。
 */
export class ContextBudgetManager {
  private calibrationFactor = 1
  private compressionArmed = true

  constructor(
    private readonly triggerRatio = DEFAULT_TRIGGER_RATIO,
    private readonly rearmRatio = DEFAULT_REARM_RATIO
  ) {}

  assess(input: ContextBudgetInput): ContextBudgetSnapshot {
    const contextWindow = normalizeContextWindow(input.configuredWindow)
    const effectiveWindow = getEffectiveInputWindow(contextWindow)
    const rawEstimate = estimateRequestTokens(input.messages, input.systemPrompt, input.tools)
    const estimatedTokens = Math.ceil(rawEstimate * this.calibrationFactor)
    const usageRatio = estimatedTokens / effectiveWindow

    if (!this.compressionArmed && usageRatio <= this.rearmRatio) {
      this.compressionArmed = true
    }

    return {
      estimatedTokens,
      effectiveWindow,
      usageRatio,
      shouldCompact: this.compressionArmed && usageRatio >= this.triggerRatio,
    }
  }

  recordServerUsage(estimatedTokens: number, usage: TokenUsage | undefined): void {
    const actual = usage?.lastPromptTokens
    if (!actual || actual <= 0 || estimatedTokens <= 0) return

    // 只向上校准。向下校准会让一次短请求削弱后续大图/代码请求的安全边际。
    const observed = clamp(actual / estimatedTokens, 1, 3)
    this.calibrationFactor = clamp(
      this.calibrationFactor * (0.7 + observed * 0.3),
      1,
      3
    )
  }

  /** 上游明确拒绝上下文后，临时收紧本会话预算，避免用同一错误窗口反复重试。 */
  recordContextLimitFailure(): void {
    this.calibrationFactor = Math.min(3, Math.max(1.25, this.calibrationFactor * 1.35))
    this.compressionArmed = true
  }

  markCompacted(): void {
    this.compressionArmed = false
  }

  reset(): void {
    this.calibrationFactor = 1
    this.compressionArmed = true
  }
}

export function normalizeContextWindow(configuredWindow?: number): number {
  return configuredWindow && configuredWindow > 0 ? configuredWindow : DEFAULT_CONTEXT_WINDOW
}

export function getEffectiveInputWindow(contextWindow: number): number {
  const outputReserve = Math.min(32_000, Math.max(8_000, Math.floor(contextWindow * 0.15)))
  return Math.max(1, contextWindow - outputReserve)
}

/** 估算真正发送的 messages + instructions + tools，而不是只估算会话消息。 */
export function estimateRequestTokens(
  messages: Message[],
  systemPrompt = '',
  tools: unknown[] = []
): number {
  const messageTokens = estimateMessagesTokens(messages, false)
  const systemTokens = estimateTextTokens(systemPrompt)
  const toolTokens = estimateTextTokens(safeStringify(tools))
  return Math.ceil((messageTokens + systemTokens + toolTokens) * ESTIMATE_SAFETY_FACTOR)
}

/**
 * 消息估算遵循 API 的实际序列化语义：contentBlocks 存在时不会再次计算 content。
 */
export function estimateMessagesTokens(messages: Message[], withSafetyFactor = true): number {
  let total = 0

  for (const message of messages) {
    if (message.contentBlocks?.length) {
      total += message.contentBlocks.reduce((sum, block) => sum + estimateContentBlockTokens(block), 0)
    } else {
      total += estimateTextTokens(message.content || '')
    }

    for (const toolCall of message.toolCalls || []) {
      total += estimateTextTokens(safeStringify(toolCall.input ?? toolCall.args ?? ''))
      total += estimateTextTokens(toolCall.name || '')
    }

    // role、消息边界和工具协议字段的固定开销。
    total += 8
  }

  return withSafetyFactor ? Math.ceil(total * ESTIMATE_SAFETY_FACTOR) : Math.ceil(total)
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0

  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length
  const remaining = Math.max(0, text.length - cjkCount)
  const looksLikeCode = /```|\b(?:const|let|function|class|interface|import|export)\b|[{;}][\r\n]/.test(text)
  const nonCjkDivisor = looksLikeCode ? 3 : 3.5

  // CJK 使用接近 1 字/token 的保守估算，其余文本按代码/自然语言分别估算。
  return Math.ceil(cjkCount + remaining / nonCjkDivisor)
}

export function estimateImageTokens(block: ContentBlock): number {
  if (block.type !== 'image' || !block.source?.data) return 0

  const dimensions = readImageDimensions(block.source.data, block.source.media_type)
  if (!dimensions) return IMAGE_FALLBACK_TOKENS

  let { width, height } = dimensions
  const maxSide = Math.max(width, height)
  if (maxSide > 2048) {
    const scale = 2048 / maxSide
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
  }

  const minSide = Math.min(width, height)
  if (minSide > 768) {
    const scale = 768 / minSide
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
  }

  const tiles = Math.ceil(width / 512) * Math.ceil(height / 512)
  const estimated = Math.ceil((85 + tiles * 170) * 1.5)
  return clamp(estimated, 256, IMAGE_MAX_TOKENS)
}

function estimateContentBlockTokens(block: ContentBlock): number {
  return block.type === 'image' ? estimateImageTokens(block) : estimateTextTokens(block.text || '')
}

function readImageDimensions(
  base64: string,
  mediaType: string
): { width: number; height: number } | undefined {
  try {
    // 尺寸信息位于文件头附近，不解码整张多 MB 图片，避免预算检查自身制造内存峰值。
    const sampleChars = mediaType === 'image/png' ? 64 : Math.min(base64.length, 256 * 1024)
    const bytes = Buffer.from(base64.slice(0, sampleChars - (sampleChars % 4)), 'base64')
    if (mediaType === 'image/png' && bytes.length >= 24) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    }

    if ((mediaType === 'image/jpeg' || mediaType === 'image/jpg') && bytes.length >= 4) {
      let offset = 2
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++
          continue
        }
        const marker = bytes[offset + 1]
        const length = bytes.readUInt16BE(offset + 2)
        if (length < 2) break
        if (marker >= 0xc0 && marker <= 0xc3) {
          return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
        }
        offset += 2 + length
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
