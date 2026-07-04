/**
 * MCP Connection Manager - MCP 连接管理器
 *
 * 职责：
 * 1. 管理多个 MCP Server 连接
 * 2. 从配置文件加载 MCP Server 配置
 * 3. 提供统一的工具调用和资源读取接口
 * 4. 管理连接生命周期（连接、断开、重连）
 *
 * 配置文件位置：
 * - ~/.claude/cc-evancod/mcp-servers.json
 *
 * 配置文件格式：
 * ```json
 * {
 *   "mcpServers": {
 *     "filesystem": {
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed"],
 *       "env": {}
 *     },
 *     "git": {
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-git"],
 *       "env": {}
 *     }
 *   }
 * }
 * ```
 *
 * 使用场景：
 * - 插件启动时自动连接所有配置的 MCP Server
 * - AI 调用 MCP 工具时路由到对应的 Server
 * - 提供 MCP Server 状态监控
 *
 * 设计原则：
 * - 延迟连接：只在需要时才连接
 * - 错误隔离：单个 Server 失败不影响其他 Server
 * - 工具发现：自动发现所有 Server 提供的工具
 */

import * as vscode from 'vscode'
import * as path from 'path'
import * as os from 'os'
import { MCPClient, MCPServerConfig, MCPConnectionState } from './MCPClient'

/**
 * MCP Server 配置文件格式
 */
interface MCPServersConfig {
  mcpServers: Record<string, {
    command: string
    args: string[]
    env?: Record<string, string>
  }>
}

/**
 * MCP Server 信息
 */
export interface MCPServerInfo {
  /** Server 名称 */
  name: string

  /** 连接状态 */
  state: MCPConnectionState

  /** 可用的工具列表 */
  tools: string[]

  /** 可用的资源列表 */
  resources: string[]

  /** 配置 */
  config: MCPServerConfig
}

export class MCPConnectionManager {
  /** MCP Client 实例映射 */
  private clients: Map<string, MCPClient> = new Map()

  /** MCP Server 配置 */
  private serverConfigs: Map<string, MCPServerConfig> = new Map()

  /** 配置文件路径 */
  private configPath: string

  /** 已发现的工具 */
  private discoveredTools: Map<string, { serverName: string; tool: any }> = new Map()

  /** 已发现的资源 */
  private discoveredResources: Map<string, { serverName: string; resource: any }> = new Map()

  /**
   * 构造函数
   *
   * @param context - VSCode Extension Context
   */
  constructor(private context: vscode.ExtensionContext) {
    // 配置文件路径：~/.claude/cc-evancod/mcp-servers.json
    const homeDir = os.homedir()
    this.configPath = path.join(homeDir, '.claude', 'cc-evancod', 'mcp-servers.json')
  }

  /**
   * 初始化 MCP 连接管理器
   *
   * 流程：
   * 1. 加载配置文件
   * 2. 创建所有 MCP Client（不立即连接）
   * 3. 延迟连接到所有 Server
   */
  async initialize(): Promise<void> {
    try {
      // 加载配置
      await this.loadConfig()

      console.log(`Loaded ${this.serverConfigs.size} MCP server configurations`)

      // 创建 Client（不立即连接）
      for (const [name, config] of this.serverConfigs.entries()) {
        const client = new MCPClient(config)
        this.clients.set(name, client)
      }

      // 延迟连接（后台执行，不阻塞启动）
      setTimeout(() => {
        this.connectAll().catch((error) => {
          console.error('Failed to connect to MCP servers:', error)
        })
      }, 1000)
    } catch (error) {
      console.error('Failed to initialize MCP Connection Manager:', error)
    }
  }

  /**
   * 加载配置文件
   */
  private async loadConfig(): Promise<void> {
    try {
      const configUri = vscode.Uri.file(this.configPath)
      const configData = await vscode.workspace.fs.readFile(configUri)
      const configContent = Buffer.from(configData).toString('utf-8')
      const config: MCPServersConfig = JSON.parse(configContent)

      // 解析配置
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        this.serverConfigs.set(name, {
          name,
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env
        })
      }
    } catch (error) {
      console.log('No MCP server config found or failed to load:', this.configPath)
      // 配置文件不存在或加载失败时不抛出错误，允许继续运行
    }
  }

  /**
   * 连接到所有 MCP Server
   */
  async connectAll(): Promise<void> {
    const promises: Promise<void>[] = []

    for (const [name, client] of this.clients.entries()) {
      promises.push(
        client
          .connect()
          .then(() => this.discoverTools(name))
          .then(() => this.discoverResources(name))
          .catch((error) => {
            console.error(`Failed to connect to MCP server ${name}:`, error)
          })
      )
    }

    await Promise.allSettled(promises)
    console.log(`Connected to ${this.getConnectedServers().length} MCP servers`)
  }

  /**
   * 发现 MCP Server 提供的工具
   *
   * @param serverName - Server 名称
   */
  private async discoverTools(serverName: string): Promise<void> {
    const client = this.clients.get(serverName)
    if (!client) {
      return
    }

    try {
      const tools = await client.listTools()

      for (const tool of tools) {
        const toolKey = `${serverName}.${tool.name}`
        this.discoveredTools.set(toolKey, {
          serverName,
          tool
        })
      }

      console.log(`Discovered ${tools.length} tools from ${serverName}`)
    } catch (error) {
      console.error(`Failed to discover tools from ${serverName}:`, error)
    }
  }

  /**
   * 发现 MCP Server 提供的资源
   *
   * @param serverName - Server 名称
   */
  private async discoverResources(serverName: string): Promise<void> {
    const client = this.clients.get(serverName)
    if (!client) {
      return
    }

    try {
      const resources = await client.listResources()

      for (const resource of resources) {
        const resourceKey = `${serverName}.${resource.uri}`
        this.discoveredResources.set(resourceKey, {
          serverName,
          resource
        })
      }

      console.log(`Discovered ${resources.length} resources from ${serverName}`)
    } catch (error) {
      console.error(`Failed to discover resources from ${serverName}:`, error)
    }
  }

  /**
   * 调用 MCP 工具
   *
   * @param serverName - Server 名称
   * @param toolName - 工具名称
   * @param args - 工具参数
   * @returns Promise<any> - 工具执行结果
   */
  async callTool(serverName: string, toolName: string, args: any): Promise<any> {
    const client = this.clients.get(serverName)
    if (!client) {
      throw new Error(`MCP server not found: ${serverName}`)
    }

    // 确保已连接
    if (client.getState() !== 'connected') {
      await client.connect()
    }

    return await client.callTool(toolName, args)
  }

  /**
   * 读取 MCP 资源
   *
   * @param serverName - Server 名称
   * @param uri - 资源 URI
   * @returns Promise<any> - 资源内容
   */
  async readResource(serverName: string, uri: string): Promise<any> {
    const client = this.clients.get(serverName)
    if (!client) {
      throw new Error(`MCP server not found: ${serverName}`)
    }

    // 确保已连接
    if (client.getState() !== 'connected') {
      await client.connect()
    }

    return await client.readResource(uri)
  }

  /**
   * 获取所有 MCP Server 信息
   *
   * @returns MCPServerInfo[] - Server 信息列表
   */
  getServerInfoList(): MCPServerInfo[] {
    const infos: MCPServerInfo[] = []

    for (const [name, client] of this.clients.entries()) {
      const config = this.serverConfigs.get(name)!
      const tools = Array.from(this.discoveredTools.entries())
        .filter(([key]) => key.startsWith(`${name}.`))
        .map(([, value]) => value.tool.name)

      const resources = Array.from(this.discoveredResources.entries())
        .filter(([key]) => key.startsWith(`${name}.`))
        .map(([, value]) => value.resource.uri)

      infos.push({
        name,
        state: client.getState(),
        tools,
        resources,
        config
      })
    }

    return infos
  }

  /**
   * 获取已连接的 Server 列表
   *
   * @returns string[] - Server 名称列表
   */
  getConnectedServers(): string[] {
    return Array.from(this.clients.entries())
      .filter(([, client]) => client.getState() === 'connected')
      .map(([name]) => name)
  }

  /**
   * 获取所有已发现的工具
   *
   * @returns Map<string, { serverName: string; tool: any }>
   */
  getDiscoveredTools(): Map<string, { serverName: string; tool: any }> {
    return this.discoveredTools
  }

  /**
   * 获取所有已发现的资源
   *
   * @returns Map<string, { serverName: string; resource: any }>
   */
  getDiscoveredResources(): Map<string, { serverName: string; resource: any }> {
    return this.discoveredResources
  }

  /**
   * 断开所有连接
   */
  dispose(): void {
    for (const client of this.clients.values()) {
      client.disconnect()
    }

    this.clients.clear()
    this.serverConfigs.clear()
    this.discoveredTools.clear()
    this.discoveredResources.clear()
  }
}
