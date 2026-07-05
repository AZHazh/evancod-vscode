/**
 * 模型能力判断
 *
 * 本项目使用 Provider 配置对象（而非环境变量）管理 API 提供商，
 * 因此这里基于 Provider.type / apiFormat / baseUrl 判断模型能力。
 *
 * 判断分两层：
 * 1. Provider 级别能力覆盖（modelCapabilities 配置）
 * 2. 按 provider 类型 + 模型名的默认白名单
 */

import type { Provider } from '../../types'
import { getCanonicalName } from './modelStrings'

/** 可覆盖的模型能力 */
export type ModelCapability = 'thinking' | 'adaptive_thinking'

/** 第一方 Anthropic 官方 host 白名单 */
const FIRST_PARTY_HOSTS = ['api.anthropic.com', 'api-staging.anthropic.com']

/**
 * 判断 Provider 是否指向第一方 Anthropic 官方端点
 * - anthropic 类型且未设置 baseUrl（走 SDK 默认）视为第一方
 * - baseUrl host 命中官方白名单也视为第一方
 */
export function isFirstPartyAnthropic(provider: Provider): boolean {
  if (provider.type !== 'anthropic') return false
  if (!provider.baseUrl) return true
  try {
    const host = new URL(provider.baseUrl).host
    return FIRST_PARTY_HOSTS.includes(host)
  } catch {
    return false
  }
}

/** 判断 baseUrl 是否为 MiniMax 端点 */
function isMiniMaxEndpoint(provider: Provider): boolean {
  const baseUrl = provider.baseUrl?.toLowerCase() ?? ''
  return baseUrl.includes('minimax') || baseUrl.includes('minimaxi')
}

/**
 * 读取 Provider 上的模型能力覆盖配置
 *
 * 支持在 Provider 上挂载 modelCapabilities 字段，例如：
 * {
 *   "gpt-4": ["thinking"],
 *   "deepseek-chat": ["thinking", "adaptive_thinking"]
 * }
 *
 * 匹配大小写不敏感，key 需与请求时传入的 model 完全一致（归一化前）。
 * 返回 undefined 表示未配置覆盖，交由默认白名单判断。
 */
export function getModelCapabilityOverride(
  provider: Provider,
  model: string,
  capability: ModelCapability
): boolean | undefined {
  const overrides = provider.modelCapabilities
  if (!overrides || typeof overrides !== 'object') return undefined

  const target = model.toLowerCase()
  for (const [rawKey, caps] of Object.entries(overrides)) {
    if (rawKey.toLowerCase() !== target) continue
    if (!Array.isArray(caps)) return undefined
    return caps.map(c => String(c).toLowerCase().trim()).includes(capability)
  }
  return undefined
}

/**
 * 判断模型是否支持 thinking（budget 或 adaptive 任意一种）
 */
export function modelSupportsThinking(provider: Provider, model: string): boolean {
  // 1. Provider 级别覆盖优先
  const override = getModelCapabilityOverride(provider, model, 'thinking')
  if (override !== undefined) return override

  const canonical = getCanonicalName(model)

  // 2. 第一方 Anthropic：所有 Claude 4+ 支持，排除 Claude 3.x
  if (isFirstPartyAnthropic(provider)) {
    return !canonical.includes('claude-3-')
  }

  // 3. MiniMax 端点
  if (isMiniMaxEndpoint(provider) && canonical.includes('minimax')) {
    return true
  }

  // 4. 其他云厂商（Bedrock / Vertex / Azure）：仅 Sonnet 4+ 和 Opus 4+
  if (provider.type === 'bedrock' || provider.type === 'vertex' || provider.type === 'azure') {
    return canonical.includes('sonnet-4') || canonical.includes('opus-4')
  }

  // 5. custom / 兼容端点：保守起见默认不支持，需通过 modelCapabilities 显式开启
  return false
}

/**
 * 判断模型是否支持自适应思考（adaptive thinking）
 *
 * 自适应思考由模型自主决定思考深度，不设固定 token 预算。
 * 仅第一方 Anthropic 的 Opus 4.6+ / Sonnet 4.6+ 支持。
 */
export function modelSupportsAdaptiveThinking(provider: Provider, model: string): boolean {
  const override = getModelCapabilityOverride(provider, model, 'adaptive_thinking')
  if (override !== undefined) return override

  // 仅第一方支持自适应思考
  if (!isFirstPartyAnthropic(provider)) return false

  const canonical = getCanonicalName(model)

  // 白名单：Opus 4.6+ / Sonnet 4.6+
  if (canonical.includes('opus-4-6') || canonical.includes('sonnet-4-6')) {
    return true
  }

  // 已知旧模型明确不支持
  if (
    canonical.includes('opus') ||
    canonical.includes('sonnet') ||
    canonical.includes('haiku')
  ) {
    return false
  }

  // 第一方未知新模型：默认视为支持
  return true
}
