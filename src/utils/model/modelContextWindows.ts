import { getCanonicalName } from './modelStrings'

/**
 * 获取模型的上下文窗口大小（单位：tokens）
 */
export function getContextWindowForModel(model: string): number {
  const canonical = getCanonicalName(model)

  // Claude 4 系列
  if (canonical.includes('opus-4') || canonical.includes('sonnet-4') || canonical.includes('haiku-4')) {
    return 200_000
  }

  // Claude 3 系列
  if (canonical.includes('claude-3')) {
    return 200_000
  }

  // GPT-4 系列
  if (canonical.includes('gpt-4')) {
    if (canonical.includes('32k')) return 32_768
    if (canonical.includes('turbo')) return 128_000
    return 8_192
  }

  // GPT-3.5
  if (canonical.includes('gpt-3.5')) {
    if (canonical.includes('16k')) return 16_384
    return 4_096
  }

  // 保守默认值
  return 200_000
}

/**
 * 获取有效上下文窗口（扣除输出预留空间）
 */
export function getEffectiveContextWindow(model: string): number {
  const total = getContextWindowForModel(model)

  // 预留输出空间：取模型最大输出 tokens 和 20k 中的较小值
  const reserved = Math.min(20_000, Math.floor(total * 0.1))

  return total - reserved
}
