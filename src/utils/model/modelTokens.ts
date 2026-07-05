/**
 * 模型 token 上限
 *
 * 提供各模型系列的最大输出 token 与 thinking budget 计算。
 * thinking budget 必须严格小于 max_tokens，否则 API 会报错。
 */

import { getCanonicalName } from './modelStrings'

export interface ModelOutputLimits {
  /** 默认输出 token 上限 */
  default: number
  /** 该模型允许的最大输出 token */
  upperLimit: number
}

/**
 * 获取模型的最大输出 token 限制
 */
export function getModelMaxOutputTokens(model: string): ModelOutputLimits {
  const canonical = getCanonicalName(model)

  if (canonical.includes('opus-4-6')) {
    return { default: 64_000, upperLimit: 128_000 }
  }
  if (canonical.includes('sonnet-4-6')) {
    return { default: 32_000, upperLimit: 128_000 }
  }
  if (
    canonical.includes('opus-4-5') ||
    canonical.includes('sonnet-4') ||
    canonical.includes('haiku-4')
  ) {
    return { default: 32_000, upperLimit: 64_000 }
  }
  if (canonical.includes('opus-4')) {
    return { default: 32_000, upperLimit: 32_000 }
  }
  if (canonical.includes('claude-3-opus')) {
    return { default: 4_096, upperLimit: 4_096 }
  }
  if (canonical.includes('claude-3-sonnet')) {
    return { default: 8_192, upperLimit: 8_192 }
  }
  if (canonical.includes('claude-3-haiku') || canonical.includes('claude-3-5-haiku')) {
    return { default: 8_192, upperLimit: 8_192 }
  }
  if (canonical.includes('claude-3-5-sonnet')) {
    return { default: 8_192, upperLimit: 8_192 }
  }

  // 未知模型的保守默认值
  return { default: 32_000, upperLimit: 64_000 }
}

/**
 * 获取模型允许的最大 thinking token budget
 * 必须小于 max_tokens，这里取 upperLimit - 1
 */
export function getMaxThinkingTokensForModel(model: string): number {
  return getModelMaxOutputTokens(model).upperLimit - 1
}
