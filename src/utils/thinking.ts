/**
 * 思考模式（Thinking Mode）核心逻辑
 *
 * 负责将「用户配置（effortLevel）」与「模型能力」结合，
 * 计算出最终发送给 Anthropic API 的 thinking 参数。
 *
 * 判断分两层：
 * 1. 用户是否开启思考（由 effortLevel 决定，低于阈值视为关闭）
 * 2. 模型是否支持思考（modelSupportsThinking / modelSupportsAdaptiveThinking）
 *
 * 只有两者同时满足，才会附加 thinking 参数。
 */

import type { EffortLevel, Provider } from '../types'
import {
  modelSupportsThinking,
  modelSupportsAdaptiveThinking,
} from './model/modelCapabilities'
import {
  getModelMaxOutputTokens,
  getMaxThinkingTokensForModel,
} from './model/modelTokens'

/** 发送给 API 的 thinking 参数（SDK 0.30 未内置类型，此处自定义） */
export type ThinkingParam =
  | { type: 'adaptive' }
  | { type: 'enabled'; budget_tokens: number }
  | { type: 'disabled' }

export interface ResolveThinkingOptions {
  provider: Provider
  model: string
  /** 推理程度，决定是否开启思考以及 budget 大小 */
  effortLevel?: EffortLevel
  /** 显式覆盖 budget（可选） */
  budgetTokens?: number
  /**
   * 是否在模型支持但用户关闭时，显式发送 { type: 'disabled' }
   * 某些代理端点需要显式声明。默认 false（直接不带 thinking 字段）。
   */
  sendDisabledWhenOff?: boolean
}

/**
 * effortLevel → thinking budget 的映射比例
 * budget 会再受模型 upperLimit - 1 约束。
 */
const EFFORT_BUDGET: Record<EffortLevel, number> = {
  low: 0, // 关闭思考
  medium: 16_000,
  high: 32_000,
  max: 128_000, // 由模型上限收敛
}

/**
 * 用户配置层面是否开启思考
 * low 视为关闭，其余视为开启
 */
export function isThinkingEnabledByEffort(effortLevel: EffortLevel = 'medium'): boolean {
  return effortLevel !== 'low'
}

/**
 * 计算最终 thinking 参数
 *
 * @returns thinking 参数；返回 undefined 表示不附加该字段
 */
export function resolveThinkingParam(
  options: ResolveThinkingOptions
): ThinkingParam | undefined {
  const { provider, model, effortLevel = 'medium', budgetTokens, sendDisabledWhenOff } = options

  const userEnabled = isThinkingEnabledByEffort(effortLevel)
  const modelCanThink = modelSupportsThinking(provider, model)

  // 用户关闭思考
  if (!userEnabled) {
    if (modelCanThink && sendDisabledWhenOff) {
      return { type: 'disabled' }
    }
    return undefined
  }

  // 模型不支持思考
  if (!modelCanThink) {
    return undefined
  }

  // 优先自适应思考
  if (modelSupportsAdaptiveThinking(provider, model)) {
    return { type: 'adaptive' }
  }

  // 退回 budget 思考
  const limits = getModelMaxOutputTokens(model)
  let budget = budgetTokens ?? EFFORT_BUDGET[effortLevel] ?? EFFORT_BUDGET.medium

  // budget 必须小于 max_tokens，且不超过模型允许的上限
  budget = Math.min(budget, getMaxThinkingTokensForModel(model), limits.upperLimit - 1)

  // Anthropic 要求 budget_tokens 至少为 1024
  if (budget < 1024) {
    return undefined
  }

  return { type: 'enabled', budget_tokens: budget }
}

/**
 * 根据 thinking 参数推算合适的 max_tokens
 *
 * 当启用 budget 思考时，max_tokens 必须大于 budget_tokens，
 * 这里返回模型的 upperLimit 以确保输出空间充足。
 */
export function resolveMaxTokens(model: string, thinking?: ThinkingParam): number {
  const limits = getModelMaxOutputTokens(model)
  if (thinking?.type === 'enabled') {
    return limits.upperLimit
  }
  if (thinking?.type === 'adaptive') {
    return limits.upperLimit
  }
  return limits.default
}
