/**
 * API 客户端统一出口。
 *
 * 三家协议各自独立成文件，共享部分（类型、重试、URL/鉴权、错误处理）在 shared.ts。
 * 外部只需从本目录导入，不必关心具体实现文件：
 *
 *   import { createApiClient } from '../services/api'
 *   import type { ImageStreamEvent } from '../services/api'
 */

import type { ApiClient, ApiClientConfig } from './shared'
import { AnthropicClient } from './AnthropicClient'
import { OpenAIChatClient } from './OpenAIChatClient'
import { OpenAIResponsesClient } from './OpenAIResponsesClient'

/**
 * 按 Provider 的 apiFormat 选择对应协议的客户端。
 * 未识别的格式回退到 Anthropic（与拆分前行为一致）。
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  switch (config.provider.apiFormat) {
    case 'openai_chat':
      return new OpenAIChatClient(config)
    case 'openai_responses':
      return new OpenAIResponsesClient(config)
    case 'anthropic':
    default:
      return new AnthropicClient(config)
  }
}

// 类型与共享工具
export type {
  ApiClient,
  ApiClientConfig,
  ApiClientResponse,
  ApiClientOptions,
  StreamCallback,
  ImageStreamEvent,
  ImageStreamCallback,
} from './shared'

// 客户端实现（按需直接使用）
export { AnthropicClient } from './AnthropicClient'
export { OpenAIChatClient } from './OpenAIChatClient'
export { OpenAIResponsesClient } from './OpenAIResponsesClient'
