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
 * - ~/.evancod/mcp-servers.json（兼容读取旧路径）
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
import type { ToolCapability, ToolRegistry } from '../../core/tools/registry/ToolRegistry'
import {
  MCPRemoteTool,
  normalizeMcpInputSchema,
  type MCPDiscoveredTool,
} from '../../core/tools/mcp/MCPRemoteTool'

/**
 * MCP Server 配置文件格式
 */
interface MCPServersConfig {
  mcpServers: Record<string, {
    command: string
    args: string[]
    env?: Record<string, string>
    cwd?: string
    enabled?: boolean
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

  prompts: string[]

  capabilities: Record<string, unknown>

  serverVersion?: { name: string; version: string }

  error?: string

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
  private legacyConfigPath: string

  /** 已发现的工具 */
  private discoveredTools: Map<string, { serverName: string; tool: any }> = new Map()

  /** 已发现的资源 */
  private discoveredResources: Map<string, { serverName: string; resource: any }> = new Map()
  private discoveredPrompts: Map<string, { serverName: string; prompt: any }> = new Map()
  private registeredToolIds: Map<string, Set<string>> = new Map()
  private configError?: string

  /**
   * 构造函数
   *
   * @param context - VSCode Extension Context
   */
  constructor(
    private context: vscode.ExtensionContext,
    private toolRegistry?: ToolRegistry
  ) {
    // Evancod 使用自己的用户目录；旧 Claude 路径只用于兼容读取。
    const homeDir = os.homedir()
    this.configPath = path.join(homeDir, '.evancod', 'mcp-servers.json')
    this.legacyConfigPath = path.join(homeDir, '.claude', 'cc-evancod', 'mcp-servers.json')
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
    this.configError = undefined
    try {
      let configData: Uint8Array
      let loadedLegacy = false
      try {
        configData = await vscode.workspace.fs.readFile(vscode.Uri.file(this.configPath))
      } catch {
        configData = await vscode.workspace.fs.readFile(vscode.Uri.file(this.legacyConfigPath))
        loadedLegacy = true
      }
      const configContent = Buffer.from(configData).toString('utf-8')
      const config: MCPServersConfig = JSON.parse(configContent)

      if (loadedLegacy) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(this.configPath)))
        await vscode.workspace.fs.writeFile(vscode.Uri.file(this.configPath), configData)
        console.log(`Migrated legacy MCP config to ${this.configPath}`)
      }

      // 解析配置
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        const env = await this.resolveEnvironment(name, serverConfig.env)
        this.serverConfigs.set(name, {
          name,
          command: serverConfig.command,
          args: serverConfig.args,
          env,
          cwd: serverConfig.cwd,
          enabled: serverConfig.enabled !== false
        })
      }
    } catch (error) {
      console.log('No MCP server config found or failed to load:', this.configPath)
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'FileNotFound') {
        this.configError = error instanceof Error ? error.message : String(error)
      }
      // 配置文件不存在或加载失败时不抛出错误，允许继续运行
    }
  }

  /**
   * 连接到所有 MCP Server
   */
  async connectAll(): Promise<void> {
    const promises: Promise<void>[] = []

    for (const [name, client] of this.clients.entries()) {
      if (this.serverConfigs.get(name)?.enabled === false) continue
      promises.push(
        client
          .connect()
          .then(() => this.discoverTools(name))
          .then(() => this.discoverResources(name))
          .then(() => this.discoverPrompts(name))
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
      this.clearDiscoveredTools(serverName)
      const tools = await client.listTools()

      for (const tool of tools) {
        const toolKey = `${serverName}.${tool.name}`
        this.discoveredTools.set(toolKey, {
          serverName,
          tool
        })
        this.registerDiscoveredTool(serverName, tool as MCPDiscoveredTool)
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
      for (const [key, value] of [...this.discoveredResources.entries()]) {
        if (value.serverName === serverName) this.discoveredResources.delete(key)
      }
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

  private async discoverPrompts(serverName: string): Promise<void> {
    const client = this.clients.get(serverName)
    if (!client) return
    for (const [key, value] of [...this.discoveredPrompts.entries()]) {
      if (value.serverName === serverName) this.discoveredPrompts.delete(key)
    }
    try {
      const prompts = await client.listPrompts()
      for (const prompt of prompts) {
        this.discoveredPrompts.set(`${serverName}.${prompt.name}`, { serverName, prompt })
      }
    } catch (error) {
      console.error(`Failed to discover prompts from ${serverName}:`, error)
    }
  }

  private registerDiscoveredTool(serverName: string, tool: MCPDiscoveredTool): void {
    if (!this.toolRegistry) return
    const safeServer = serverName.replace(/[^a-z0-9._-]/gi, '_')
    const safeTool = tool.name.replace(/[^a-z0-9._-]/gi, '_')
    const id = `mcp.${safeServer}.${safeTool}`
    this.toolRegistry.unregister(id)
    const capabilities: ToolCapability[] = ['execute']
    capabilities.push(tool.annotations?.readOnlyHint ? 'read' : 'write')
    if (tool.annotations?.openWorldHint) capabilities.push('network')
    this.toolRegistry.register({
      id,
      name: id,
      description: tool.description || `调用 ${serverName} MCP Server 的 ${tool.name}`,
      source: 'mcp',
      category: 'mcp',
      capabilities,
      inputSchema: normalizeMcpInputSchema(tool.inputSchema),
      defaultEnabled: true,
      create: () => new MCPRemoteTool(this, serverName, tool, id),
    })
    const ids = this.registeredToolIds.get(serverName) || new Set<string>()
    ids.add(id)
    this.registeredToolIds.set(serverName, ids)
  }

  private clearDiscoveredTools(serverName: string): void {
    for (const [key, value] of [...this.discoveredTools.entries()]) {
      if (value.serverName === serverName) this.discoveredTools.delete(key)
    }
    for (const id of this.registeredToolIds.get(serverName) || []) {
      this.toolRegistry?.unregister(id)
    }
    this.registeredToolIds.delete(serverName)
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
      const prompts = Array.from(this.discoveredPrompts.values())
        .filter(value => value.serverName === name)
        .map(value => value.prompt.name)

      infos.push({
        name,
        state: client.getState(),
        tools,
        resources,
        prompts,
        capabilities: client.getCapabilities(),
        serverVersion: client.getServerVersion(),
        error: client.getLastError(),
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

  getConfigError(): string | undefined {
    return this.configError
  }

  async refreshServer(name: string): Promise<void> {
    const client = this.clients.get(name)
    if (!client) throw new Error(`MCP server not found: ${name}`)
    client.disconnect()
    this.clearDiscoveredTools(name)
    await client.connect()
    await Promise.all([
      this.discoverTools(name),
      this.discoverResources(name),
      this.discoverPrompts(name),
    ])
  }

  async saveServer(config: MCPServerConfig): Promise<void> {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(config.name)) {
      throw new Error('MCP Server 名称只能包含字母、数字、点、下划线和连字符')
    }
    if (!config.command?.trim()) throw new Error('MCP Server command 不能为空')
    if (!Array.isArray(config.args) || !config.args.every(arg => typeof arg === 'string')) {
      throw new Error('MCP Server args 必须是字符串数组')
    }

    const existing = this.serverConfigs.get(config.name)
    this.clients.get(config.name)?.disconnect()
    this.clearDiscoveredTools(config.name)
    const normalized: MCPServerConfig = {
      name: config.name,
      command: config.command.trim(),
      args: [...config.args],
      env: config.env ? { ...config.env } : existing?.env,
      cwd: config.cwd?.trim() || undefined,
      enabled: config.enabled !== false,
    }
    this.serverConfigs.set(config.name, normalized)
    this.clients.set(config.name, new MCPClient(normalized))
    await this.saveConfig()
    if (normalized.enabled) await this.refreshServer(config.name)
  }

  async setServerEnabled(name: string, enabled: boolean): Promise<void> {
    const config = this.serverConfigs.get(name)
    if (!config) throw new Error(`MCP server not found: ${name}`)
    config.enabled = enabled
    await this.saveConfig()
    if (enabled) await this.refreshServer(name)
    else {
      this.clients.get(name)?.disconnect()
      this.clearDiscoveredTools(name)
    }
  }

  async deleteServer(name: string): Promise<void> {
    const config = this.serverConfigs.get(name)
    for (const key of Object.keys(config?.env || {})) {
      await this.context.secrets.delete(this.secretKey(name, key))
    }
    this.clients.get(name)?.disconnect()
    this.clients.delete(name)
    this.serverConfigs.delete(name)
    this.clearDiscoveredTools(name)
    await this.saveConfig()
  }

  private async saveConfig(): Promise<void> {
    const mcpServers: Record<string, unknown> = {}
    for (const [name, config] of this.serverConfigs) {
      let env: Record<string, string> | undefined
      if (config.env) {
        env = {}
        for (const [key, value] of Object.entries(config.env)) {
          await this.context.secrets.store(this.secretKey(name, key), value)
          env[key] = `\${secret:${key}}`
        }
      }
      mcpServers[name] = {
        command: config.command,
        args: config.args,
        ...(env ? { env } : {}),
        ...(config.cwd ? { cwd: config.cwd } : {}),
        enabled: config.enabled !== false,
      }
    }
    const target = vscode.Uri.file(this.configPath)
    const temporary = vscode.Uri.file(`${this.configPath}.${process.pid}.${Date.now()}.tmp`)
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(this.configPath)))
    await vscode.workspace.fs.writeFile(
      temporary,
      Buffer.from(JSON.stringify({ mcpServers }, null, 2), 'utf8')
    )
    await vscode.workspace.fs.rename(temporary, target, { overwrite: true })
  }

  private async resolveEnvironment(
    serverName: string,
    env?: Record<string, string>
  ): Promise<Record<string, string> | undefined> {
    if (!env) return undefined
    const resolved: Record<string, string> = {}
    for (const [key, value] of Object.entries(env)) {
      const secretMatch = value.match(/^\$\{secret:([^}]+)\}$/)
      if (secretMatch) {
        const secret = await this.context.secrets.get(this.secretKey(serverName, secretMatch[1]))
        if (secret !== undefined) resolved[key] = secret
        continue
      }
      const environmentMatch = value.match(/^\$\{([^}:]+)\}$/)
      resolved[key] = environmentMatch ? process.env[environmentMatch[1]] || value : value
    }
    return resolved
  }

  private secretKey(serverName: string, variableName: string): string {
    return `mcp.server.${serverName}.env.${variableName}`
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
    this.discoveredPrompts.clear()
    for (const ids of this.registeredToolIds.values()) {
      for (const id of ids) this.toolRegistry?.unregister(id)
    }
    this.registeredToolIds.clear()
  }
}
