/**
 * 获取模型的上下文窗口大小（单位：tokens）
 */
export function getContextWindowForModel(_model: string, configuredWindow?: number): number {
  // 兼容中转通常不会暴露真实上限。未配置时使用保守值，避免 UI 仍显示 60%
  // 而请求已经超过上游窗口；用户可通过 Provider 配置显式覆盖。
  return configuredWindow && configuredWindow > 0 ? configuredWindow : 200_000
}

/**
 * 获取有效上下文窗口（扣除输出预留空间）
 */
export function getEffectiveContextWindow(model: string, configuredWindow?: number): number {
  const total = getContextWindowForModel(model, configuredWindow)

  // 预留输出空间：取模型最大输出 tokens 和 20k 中的较小值
  const reserved = Math.min(20_000, Math.floor(total * 0.1))

  return total - reserved
}
