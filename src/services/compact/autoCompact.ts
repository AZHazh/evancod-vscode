import { getEffectiveContextWindow } from '../../utils/model/modelContextWindows'

/**
 * 自动压缩预留 buffer（tokens）
 * 在真正到达上下文窗口前触发压缩
 */
const AUTOCOMPACT_BUFFER_TOKENS = 13_000

/**
 * 获取自动压缩阈值
 * @param model 模型名称
 * @returns 触发自动压缩的 token 数
 */
export function getAutoCompactThreshold(model: string): number {
  const effective = getEffectiveContextWindow(model)
  return effective - AUTOCOMPACT_BUFFER_TOKENS
}

/**
 * 判断是否应该触发自动压缩
 * @param currentTokens 当前上下文 token 数
 * @param model 模型名称
 * @param compactFailures 连续压缩失败次数
 * @returns 是否应该压缩
 */
export function shouldAutoCompact(
  currentTokens: number,
  model: string,
  compactFailures: number
): boolean {
  // 断路器：3 次失败后停止自动压缩
  if (compactFailures >= 3) {
    return false
  }

  const threshold = getAutoCompactThreshold(model)
  return currentTokens >= threshold
}

/**
 * 计算上下文使用百分比
 * @param currentTokens 当前 token 数
 * @param model 模型名称
 * @returns 百分比（0-100）
 */
export function calculateContextPercent(currentTokens: number, model: string): number {
  const effective = getEffectiveContextWindow(model)
  return Math.min(Math.round((currentTokens / effective) * 100), 100)
}
