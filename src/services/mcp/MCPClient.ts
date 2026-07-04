/**
 * MCP Client - Model Context Protocol 客户端
 *
 * 职责：
 * 1. 连接到 MCP Server（stdio 协议）
 * 2. 发送请求并接收响应
 * 3. 管理连接生命周期
 * 4. 处理 MCP 协议消息
 *
 * MCP 协议说明：
 * - MCP 是一个基于 JSON-RPC 的协议
 * - 支持 stdio（标准输入输出）和 HTTP 两种传输方式
 * - 本实现专注于 stdio 方式
 *
 * 使用场景：
 * - 连接到本地 MCP Server（如文件系统、数据库等）
 * - 调用 MCP Server 提供的工具
 * - 读取 MCP Server 提供的资源
 *
 * 设计原则：
 * - 连接状态管理（connecting、connected、disconnected）
 * - 自动重连机制
 * - 请求超时处理
 * - 错误恢复
 */

import { spawn, ChildProcess } from 'child_process'
import * as readline from 'readline'

/**
 * MCP Server 配置
 */
export interface MCPServerConfig {
  /** Server 名称 */
  name: string

  /** Server 命令 */
  command: string

  /** 命令参数 */
  args: string[]

  /** 环境变量 */
  env?: Record<string, string>

  /** 工作目录 */
  cwd?: string
}

/**
 * MCP 连接状态
 */
export type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * MCP 请求
 */
interface MCPRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: any
}

/**
 * MCP 响应
 */
interface MCPResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

/**
 * MCP 通知
 */
interface MCPNotification {
  jsonrpc: '2.0'
  method: string
  params?: any
}

/**
 * 待处理的请求
 */
interface PendingRequest {
  resolve: (result: any) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export class MCPClient {
  /** 子进程 */
  private process?: ChildProcess

  /** 连接状态 */
  private state: MCPConnectionState = 'disconnected'

  /** 请求 ID 计数器 */
  private requestId = 0

  /** 待处理的请求 */
  private pendingRequests: Map<string | number, PendingRequest> = new Map()

  /** 请求超时时间（毫秒） */
  private readonly REQUEST_TIMEOUT = 30000

  /** readline 接口 */
  private rl?: readline.Interface

  /**
   * 构造函数
   *
   * @param config - MCP Server 配置
   */
  constructor(private config: MCPServerConfig) {}

  /**
   * 连接到 MCP Server
   *
   * @returns Promise<void>
   */
  async connect(): Promise<void> {
    if (this.state === 'connected') {
      console.log(`MCP Client ${this.config.name} already connected`)
      return
    }

    if (this.state === 'connecting') {
      console.log(`MCP Client ${this.config.name} is connecting...`)
      return
    }

    this.state = 'connecting'

    try {
      // 启动子进程
      this.process = spawn(this.config.command, this.config.args, {
        env: { ...process.env, ...this.config.env },
        cwd: this.config.cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      // 处理错误
      this.process.on('error', (error) => {
        console.error(`MCP Server ${this.config.name} error:`, error)
        this.handleDisconnect()
      })

      // 处理退出
      this.process.on('exit', (code, signal) => {
        console.log(`MCP Server ${this.config.name} exited with code ${code}, signal ${signal}`)
        this.handleDisconnect()
      })

      // 设置 readline 读取标准输出
      if (this.process.stdout) {
        this.rl = readline.createInterface({
          input: this.process.stdout,
          crlfDelay: Infinity
        })

        this.rl.on('line', (line) => {
          this.handleMessage(line)
        })
      }

      // 监听标准错误
      if (this.process.stderr) {
        this.process.stderr.on('data', (data) => {
          console.error(`MCP Server ${this.config.name} stderr:`, data.toString())
        })
      }

      // 发送初始化请求
      await this.initialize()

      this.state = 'connected'
      console.log(`MCP Client ${this.config.name} connected successfully`)
    } catch (error) {
      this.state = 'error'
      console.error(`Failed to connect to MCP Server ${this.config.name}:`, error)
      throw error
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.process) {
      this.process.kill()
      this.process = undefined
    }

    if (this.rl) {
      this.rl.close()
      this.rl = undefined
    }

    // 拒绝所有待处理的请求
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Connection closed'))
      this.pendingRequests.delete(id)
    }

    this.state = 'disconnected'
  }

  /**
   * 发送初始化请求
   */
  private async initialize(): Promise<void> {
    const response = await this.sendRequest('initialize', {
      protocolVersion: '1.0.0',
      clientInfo: {
        name: 'evancod',
        version: '1.0.0'
      }
    })

    console.log(`MCP Server ${this.config.name} initialized:`, response)
  }

  /**
   * 调用工具
   *
   * @param toolName - 工具名称
   * @param args - 工具参数
   * @returns Promise<any> - 工具执行结果
   */
  async callTool(toolName: string, args: any): Promise<any> {
    if (this.state !== 'connected') {
      throw new Error(`MCP Client ${this.config.name} is not connected`)
    }

    return await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args
    })
  }

  /**
   * 列出所有工具
   *
   * @returns Promise<any[]> - 工具列表
   */
  async listTools(): Promise<any[]> {
    if (this.state !== 'connected') {
      throw new Error(`MCP Client ${this.config.name} is not connected`)
    }

    const response = await this.sendRequest('tools/list', {})
    return response.tools || []
  }

  /**
   * 读取资源
   *
   * @param uri - 资源 URI
   * @returns Promise<any> - 资源内容
   */
  async readResource(uri: string): Promise<any> {
    if (this.state !== 'connected') {
      throw new Error(`MCP Client ${this.config.name} is not connected`)
    }

    return await this.sendRequest('resources/read', {
      uri
    })
  }

  /**
   * 列出所有资源
   *
   * @returns Promise<any[]> - 资源列表
   */
  async listResources(): Promise<any[]> {
    if (this.state !== 'connected') {
      throw new Error(`MCP Client ${this.config.name} is not connected`)
    }

    const response = await this.sendRequest('resources/list', {})
    return response.resources || []
  }

  /**
   * 获取连接状态
   *
   * @returns MCPConnectionState
   */
  getState(): MCPConnectionState {
    return this.state
  }

  /**
   * 发送请求
   *
   * @param method - 方法名
   * @param params - 参数
   * @returns Promise<any> - 响应结果
   */
  private async sendRequest(method: string, params?: any): Promise<any> {
    if (!this.process || !this.process.stdin) {
      throw new Error('MCP Client is not connected')
    }

    const id = ++this.requestId
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }

    // 创建 Promise 并添加超时
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout: ${method}`))
      }, this.REQUEST_TIMEOUT)

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout
      })

      // 发送请求
      const message = JSON.stringify(request) + '\n'
      this.process!.stdin!.write(message)
    })
  }

  /**
   * 处理接收到的消息
   *
   * @param line - 消息行
   */
  private handleMessage(line: string): void {
    try {
      const message = JSON.parse(line)

      // 响应消息
      if ('id' in message) {
        const response = message as MCPResponse
        const pending = this.pendingRequests.get(response.id)

        if (pending) {
          clearTimeout(pending.timeout)
          this.pendingRequests.delete(response.id)

          if (response.error) {
            pending.reject(
              new Error(`${response.error.message} (code: ${response.error.code})`)
            )
          } else {
            pending.resolve(response.result)
          }
        }
      }
      // 通知消息
      else if ('method' in message) {
        const notification = message as MCPNotification
        this.handleNotification(notification)
      }
    } catch (error) {
      console.error(`Failed to parse MCP message: ${line}`, error)
    }
  }

  /**
   * 处理通知消息
   *
   * @param notification - 通知消息
   */
  private handleNotification(notification: MCPNotification): void {
    console.log(`MCP Notification: ${notification.method}`, notification.params)
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(): void {
    this.state = 'disconnected'

    // 拒绝所有待处理的请求
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Connection lost'))
      this.pendingRequests.delete(id)
    }
  }
}
