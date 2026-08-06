/**
 * 获取模型的上下文窗口大小（单位：tokens）
 */
export function getContextWindowForModel(_model: string): number {
  return 1_000_000
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
