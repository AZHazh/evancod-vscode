/**
 * new-api 同步服务（轮询版本）
 *
 * 职责：
 * 1. 生成授权 URL 并打开浏览器
 * 2. 轮询检查授权状态
 * 3. 用 code 交换 Token 列表
 * 4. 提供模型映射功能
 *
 * 架构说明：
 * VSCode Extension 无法启动 HTTP 服务器，因此采用轮询方案：
 * 1. 打开浏览器到 new-api 授权页（mode=polling）
 * 2. 用户授权后，new-api 前端将 code 存储到服务端
 * 3. VSCode 轮询 /api/desktop-sync/sessions/{state} 获取 code
 * 4. 用 code 调用 /api/desktop-sync/exchange 获取数据
 */

import { randomBytes } from 'crypto'
import * as http from 'http'
import axios, { type AxiosInstance } from 'axios'

/**
 * new-api Token 信息
 */
export interface NewApiToken {
  /**
   * Token ID
   */
  id: number

  /**
   * Token 名称
   */
  name: string

  /**
   * Token Key（完整，含 sk- 前缀）
   */
  key: string

  /**
   * 所属分组
   */
  group: string

  /**
   * 状态（1: 启用，2: 禁用）
   */
  status: number

  /**
   * 是否无限额度
   */
  unlimited_quota: boolean

  /**
   * 剩余额度
   */
  remain_quota: number

  /**
   * 过期时间（Unix 时间戳）
   */
  expired_time: number

  /**
   * 支持的模型列表（从 group_models 解析）
   */
  models?: string[]
}

/**
 * 同步配置
 */
export interface SyncConfig {
  /**
   * new-api 站点 URL
   * 例如：https://www.tiandouai.com
   */
  siteUrl: string
}

/**
 * 同步会话
 */
export interface SyncSession {
  /**
   * 随机生成的 state
   */
  state: string

  /**
   * 授权 URL（需要在浏览器中打开）
   */
  authorizeUrl: string

  /**
   * 当前状态
   */
  status: 'pending' | 'authorized' | 'completed' | 'timeout' | 'error'

  /**
   * 错误消息
   */
  error?: string
}

/**
 * Exchange 响应
 */
interface ExchangeResponse {
  tokens: NewApiToken[]
  availableModels: string[]
  groupModels: Record<string, string[]>
  siteName?: string
}

/**
 * 模型映射配置
 */
export interface ModelMapping {
  /**
   * 主模型（用于对话）
   */
  main: string

  /**
   * Sonnet 模型
   */
  sonnet: string

  /**
   * Opus 模型
   */
  opus: string

  /**
   * Haiku 模型
   */
  haiku: string
}

/**
 * new-api 同步服务
 */
export class NewApiSyncService {
  /**
   * HTTP 客户端
   */
  private client: AxiosInstance

  /**
   * 站点 URL
   */
  private siteUrl: string

  /**
   * 构造函数
   *
   * @param config - 同步配置
   */
  constructor(config: SyncConfig) {
    this.siteUrl = config.siteUrl.replace(/\/+$/, '') // 移除尾部斜杠
    this.client = axios.create({
      baseURL: this.siteUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  /**
   * 开始同步流程
   * 生成 state 和授权 URL
   *
   * @returns SyncSession 同步会话
   */
  startSync(): SyncSession {
    const state = this.generateState()
    const authorizeUrl = new URL('/desktop-sync', this.siteUrl)
    authorizeUrl.searchParams.set('state', state)

    return {
      state,
      authorizeUrl: authorizeUrl.toString(),
      status: 'pending',
    }
  }

  /**
   * 启动本地 HTTP 服务接收授权回调
   */
  createCallbackServer(timeout = 5 * 60 * 1000): Promise<{
    session: SyncSession
    code: Promise<string>
  }> {
    return new Promise((resolve, reject) => {
      const state = this.generateState()
      const server = http.createServer()
      let settled = false
      let timer: NodeJS.Timeout

      const cleanup = () => {
        clearTimeout(timer)
        server.close()
      }

      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }

      const code = new Promise<string>((resolveCode, rejectCode) => {
        const rejectCallback = (error: Error) => {
          cleanup()
          rejectCode(error)
        }

        server.on('request', (req, res) => {
          try {
            const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
            if (requestUrl.pathname !== '/callback') {
              res.writeHead(404)
              res.end('Not found')
              return
            }

            const returnedState = requestUrl.searchParams.get('state')
            const authCode = requestUrl.searchParams.get('code')
            if (returnedState !== state) {
              throw new Error('授权 state 校验失败')
            }
            if (!authCode) {
              throw new Error('授权回调缺少 code')
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<!doctype html><meta charset="utf-8"><title>授权成功</title><h2>授权成功，请回到 VSCode 继续。</h2>')
            cleanup()
            resolveCode(authCode)
          } catch (error) {
            rejectCallback(error instanceof Error ? error : new Error('授权回调失败'))
          }
        })

        timer = setTimeout(() => {
          rejectCallback(new Error('授权超时（5分钟），请重试'))
        }, timeout)
      })

      code.finally(() => {
        settled = true
      })

      server.once('error', fail)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (typeof address !== 'object' || !address) {
          fail(new Error('无法启动本地授权回调服务'))
          return
        }

        const redirectUri = `http://127.0.0.1:${address.port}/callback`
        const authorizeUrl = new URL('/desktop-sync', this.siteUrl)
        authorizeUrl.searchParams.set('redirect_uri', redirectUri)
        authorizeUrl.searchParams.set('state', state)

        resolve({
          session: {
            state,
            authorizeUrl: authorizeUrl.toString(),
            status: 'pending',
          },
          code,
        })
      })
    })
  }

  /**
   * 轮询检查授权状态
   * 每 2 秒检查一次，最多等待 5 分钟
   *
   * @param state - 会话 state
   * @param onProgress - 进度回调
   * @returns Promise<string> - 授权成功后返回 code
   */
  async pollAuthorization(
    state: string,
    onProgress?: (message: string) => void
  ): Promise<string> {
    const maxAttempts = 150 // 5 分钟（2 秒 * 150）
    const pollInterval = 2000 // 2 秒

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.client.get(
          `/api/desktop-sync/sessions/${encodeURIComponent(state)}`
        )

        if (!response.data.success) {
          throw new Error('查询授权状态失败')
        }

        const { status, code } = response.data.data

        if (status === 'authorized' && code) {
          onProgress?.('授权成功，正在获取数据...')
          return code
        }

        // 仍在等待
        const remaining = Math.ceil((maxAttempts - attempt) * pollInterval / 1000)
        onProgress?.(`等待浏览器授权... (${remaining}秒后超时)`)

        await this.sleep(pollInterval)
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.code === 'ECONNREFUSED') {
            throw new Error('无法连接到 new-api 服务器，请检查 URL')
          }
          if (error.response?.status === 404) {
            // 会话不存在，继续轮询（可能服务器还没收到授权）
            const remaining = Math.ceil((maxAttempts - attempt) * pollInterval / 1000)
            onProgress?.(`等待浏览器授权... (${remaining}秒后超时)`)
            await this.sleep(pollInterval)
            continue
          }
        }
        // 其他错误继续轮询（网络抖动）
        await this.sleep(pollInterval)
      }
    }

    throw new Error('授权超时（5分钟），请重试')
  }

  /**
   * 用 code 交换 Token 列表
   * 调用 new-api 的 /api/desktop-sync/exchange 端点
   *
   * @param code - 授权码
   * @returns Promise<ExchangeResponse> - Token 列表和模型信息
   */
  async exchangeCode(code: string): Promise<ExchangeResponse> {
    try {
      const response = await this.client.post('/api/desktop-sync/exchange', {
        code,
      })

      if (!response.data.success) {
        throw new Error(response.data.message || 'exchange 失败')
      }

      const data = response.data.data
      const tokens: NewApiToken[] = data.tokens || []
      const availableModels: string[] = data.available_models || []
      const groupModels: Record<string, string[]> = data.group_models || {}

      // 为每个 token 填充 models 字段（从 group_models 解析）
      tokens.forEach(token => {
        if (token.group && groupModels[token.group]) {
          token.models = groupModels[token.group]
        } else {
          token.models = availableModels
        }
      })

      return {
        tokens,
        availableModels,
        groupModels,
        siteName: data.site_name,
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 400) {
          throw new Error('授权码无效或已过期，请重新授权')
        }
        if (error.response?.status === 401) {
          throw new Error('授权失败，请重新登录')
        }
      }
      throw error
    }
  }

  /**
   * 完整的同步流程（一键式）
   *
   * @param onProgress - 进度回调
   * @returns Promise<ExchangeResponse> - Token 列表和模型信息
   */
  async sync(onProgress?: (message: string) => void): Promise<ExchangeResponse> {
    // 1. 开始同步，返回授权 URL
    const session = this.startSync()
    onProgress?.(`授权 URL: ${session.authorizeUrl}`)

    // 2. 轮询等待授权
    const code = await this.pollAuthorization(session.state, onProgress)

    // 3. 用 code 交换数据
    const result = await this.exchangeCode(code)
    onProgress?.(`成功获取 ${result.tokens.length} 个 Token`)

    return result
  }

  /**
   * 创建默认模型映射
   * 智能选择合适的模型
   *
   * @param token - Token 信息
   * @returns ModelMapping 模型映射
   */
  createDefaultMapping(token: NewApiToken): ModelMapping {
    const models = token.models || []

    // 查找 Sonnet 模型
    const sonnet =
      models.find(m => m.includes('sonnet') || m.includes('claude-3-5-sonnet')) ||
      models[0] ||
      'claude-3-5-sonnet-20241022'

    // 查找 Opus 模型
    const opus =
      models.find(m => m.includes('opus') || m.includes('claude-3-opus')) ||
      sonnet

    // 查找 Haiku 模型
    const haiku =
      models.find(m => m.includes('haiku') || m.includes('claude-3-5-haiku')) ||
      sonnet

    return {
      main: sonnet,
      sonnet,
      opus,
      haiku,
    }
  }

  /**
   * 生成随机 state
   */
  private generateState(): string {
    return randomBytes(24).toString('base64url')
  }

  /**
   * 睡眠指定毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
