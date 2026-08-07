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

  // 5. custom 兼容端点：根据 API 格式和模型名称判断
  if (provider.type === 'custom') {
    // 5.1 如果使用 Anthropic API 格式，采用宽松策略
    if (provider.apiFormat === 'anthropic') {
      // 已知支持的模型系列
      const knownSupportedPatterns = [
        /claude-[45]/,           // Claude 4.x, 5.x
        /opus-[45]/,             // Opus 4.x, 5.x
        /sonnet-[45]/,           // Sonnet 4.x, 5.x
        /gpt-.*-o[13]/,          // GPT o1, o3
        /^o[13]/,                // o1, o3
        /deepseek.*reasoner/,    // DeepSeek reasoner
        /deepseek.*-r[12]/,      // DeepSeek R2, R2
        /qwen.*thinking/,        // Qwen thinking
        /glm.*think/,            // GLM thinking 系列
      ]

      for (const pattern of knownSupportedPatterns) {
        if (pattern.test(canonical)) {
          return true
        }
      }

      // 中转服务通常能正确处理 thinking 参数：
      // - 支持的模型会传递给后端
      // - 不支持的模型会忽略或返回友好错误
      // 采用宽松策略：默认启用，让中转服务决定
      return true
    }

    // 5.2 如果使用 OpenAI API 格式（openai_chat, openai_responses）
    if (provider.apiFormat === 'openai_chat' || provider.apiFormat === 'openai_responses') {
      // 已知支持推理的 OpenAI 模型系列
      const openaiReasoningPatterns = [
        /^o[13]/,                // o1, o3
        /gpt-.*-o[13]/,          // gpt-4-o1, gpt-5-o3
        /gpt-[56]/,              // gpt-5, gpt-6
        /gpt.*pro/,              // gpt-pro, gpt-4-pro, gpt-5-pro
        /gpt.*turbo/,            // gpt-4-turbo 等可能支持推理
        /deepseek.*reasoner/,    // DeepSeek reasoner
        /deepseek.*-r[12]/,      // DeepSeek R1, R2
        /qwen.*think/,           // Qwen thinking
        /glm.*think/,            // GLM thinking
      ]

      for (const pattern of openaiReasoningPatterns) {
        if (pattern.test(canonical)) {
          return true
        }
      }

      // OpenAI 格式采用保守策略：未知模型默认不支持
      return false
    }

    // 5.3 其他 API 格式：不支持
    return false
  }

  // 6. 其他情况：保守起见默认不支持，需通过 modelCapabilities 显式开启
  return false
}

/**
 * 判断模型是否支持自适应思考（adaptive thinking）
 *
 * 自适应思考由模型自主决定思考深度，不设固定 token 预算。
 * 第一方 Anthropic 的 Opus 5+ / Sonnet 5+ 以及使用 Anthropic API 格式的中转服务支持。
 */
export function modelSupportsAdaptiveThinking(provider: Provider, model: string): boolean {
  const override = getModelCapabilityOverride(provider, model, 'adaptive_thinking')
  if (override !== undefined) return override

  const canonical = getCanonicalName(model)

  // custom 兼容端点：如果使用 Anthropic API 格式，根据模型特征判断
  if (provider.type === 'custom' && provider.apiFormat === 'anthropic') {
    // Claude 5+ 系列
    if (canonical.includes('opus-5') || canonical.includes('sonnet-5')) {
      return true
    }

    // GPT o 系列（o1, o3 通常支持自适应推理）
    if (canonical.includes('gpt-') && (
      canonical.includes('-o1') ||
      canonical.includes('-o3') ||
      canonical.includes('-o-') ||
      canonical.match(/^o\d/)
    )) {
      return true
    }

    // DeepSeek R1/R2（推理模型通常支持自适应）
    if (canonical.includes('deepseek') && (
      canonical.includes('reasoner') ||
      canonical.includes('-r1') ||
      canonical.includes('-r2')
    )) {
      return true
    }

    // 其他模型：默认不支持自适应，使用 budget 模式
    return false
  }

  // 第一方 Anthropic
  if (!isFirstPartyAnthropic(provider)) return false

  // 白名单：Opus 5+ / Sonnet 5+
  if (canonical.includes('opus-5') || canonical.includes('sonnet-5')) {
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
