import { getEffectiveContextWindow } from '../../utils/model/modelContextWindows'

/**
 * 自动压缩预留 buffer（tokens）
 * 在真正到达上下文窗口前触发压缩
 *
 * 调整为更保守的值：从 13000 提升到 50000
 * 原因：
 * 1. estimateMessagesTokens 的估算偏低（字符数/4），实际 token 数可能更多
 * 2. new-api 等中转层可能不返回准确的 usage，完全依赖估算时需要更大 buffer
 * 3. 避免在真的到达上限时才压缩，那时已经来不及了
 *
 * 可通过 evancod.autoCompactBufferTokens 配置覆盖
 */
const DEFAULT_AUTOCOMPACT_BUFFER_TOKENS = 50_000

/**
 * 获取自动压缩的 buffer token 数
 */
function getAutoCompactBuffer(configuredBuffer?: number): number {
  return configuredBuffer && configuredBuffer > 0
    ? configuredBuffer
    : DEFAULT_AUTOCOMPACT_BUFFER_TOKENS
}

/**
 * 获取自动压缩阈值
 * @param model 模型名称
 * @param configuredBuffer 用户配置的 buffer（可选）
 * @returns 触发自动压缩的 token 数
 */
export function getAutoCompactThreshold(
  model: string,
  configuredWindow?: number,
  configuredBuffer?: number
): number {
  const effective = getEffectiveContextWindow(model, configuredWindow)
  const buffer = getAutoCompactBuffer(configuredBuffer)
  return effective - buffer
}

/**
 * 判断是否应该触发自动压缩
 * @param currentTokens 当前上下文 token 数
 * @param model 模型名称
 * @param compactFailures 连续压缩失败次数
 * @param configuredWindow 用户配置的上下文窗口（可选）
 * @param configuredBuffer 用户配置的 buffer（可选）
 * @returns 是否应该压缩
 */
export function shouldAutoCompact(
  currentTokens: number,
  model: string,
  compactFailures: number,
  configuredWindow?: number,
  configuredBuffer?: number
): boolean {
  // 断路器：3 次失败后停止自动压缩
  if (compactFailures >= 3) {
    return false
  }

  const threshold = getAutoCompactThreshold(model, configuredWindow, configuredBuffer)
  return currentTokens >= threshold
}

/**
 * 计算上下文使用百分比
 * @param currentTokens 当前 token 数
 * @param model 模型名称
 * @returns 百分比（0-100）
 */
export function calculateContextPercent(currentTokens: number, model: string, configuredWindow?: number): number {
  const effective = getEffectiveContextWindow(model, configuredWindow)
  return Math.min(Math.round((currentTokens / effective) * 100), 100)
}
