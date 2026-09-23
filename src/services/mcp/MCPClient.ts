import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export interface MCPServerConfig {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
  enabled?: boolean
}

export type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export class MCPClient {
  private client?: Client
  private transport?: StdioClientTransport
  private state: MCPConnectionState = 'disconnected'
  private connecting?: Promise<void>
  private lastError?: string

  constructor(private readonly config: MCPServerConfig) {}

  async connect(): Promise<void> {
    if (this.state === 'connected') return
    if (this.connecting) return this.connecting

    this.state = 'connecting'
    this.lastError = undefined
    this.connecting = this.connectWithSdk()
    try {
      await this.connecting
      this.state = 'connected'
    } catch (error) {
      this.state = 'error'
      this.lastError = error instanceof Error ? error.message : String(error)
      await this.closeSdkResources()
      throw error
    } finally {
      this.connecting = undefined
    }
  }

  disconnect(): void {
    this.state = 'disconnected'
    void this.closeSdkResources()
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const client = this.requireConnected()
    return client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { timeout: 30_000 }
    )
  }

  async listTools(): Promise<any[]> {
    return (await this.requireConnected().listTools(undefined, { timeout: 30_000 })).tools
  }

  async readResource(uri: string): Promise<unknown> {
    return this.requireConnected().readResource({ uri }, { timeout: 30_000 })
  }

  async listResources(): Promise<any[]> {
    return (await this.requireConnected().listResources(undefined, { timeout: 30_000 })).resources
  }

  async listPrompts(): Promise<any[]> {
    const client = this.requireConnected()
    if (!client.getServerCapabilities()?.prompts) return []
    return (await client.listPrompts(undefined, { timeout: 30_000 })).prompts
  }

  getState(): MCPConnectionState {
    return this.state
  }

  getLastError(): string | undefined {
    return this.lastError
  }

  getCapabilities(): Record<string, unknown> {
    return (this.client?.getServerCapabilities() || {}) as Record<string, unknown>
  }

  getServerVersion(): { name: string; version: string } | undefined {
    return this.client?.getServerVersion()
  }

  private async connectWithSdk(): Promise<void> {
    // MCP SDK/Zod 在 VS Code Extension Host 中访问 navigator 时会产生弃用告警。
    // 延迟加载还可以避免 MCP SDK 导入失败阻断整个扩展的激活。
    const [{ Client }, { getDefaultEnvironment, StdioClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js'),
    ])
    const client = new Client(
      { name: 'evancod-vscode', version: '0.1.42' },
      { capabilities: {} }
    )
    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      cwd: this.config.cwd,
      env: { ...getDefaultEnvironment(), ...(this.config.env || {}) },
      stderr: 'pipe',
    })
    transport.onerror = error => {
      this.lastError = error.message
      if (this.state === 'connected') this.state = 'error'
    }
    transport.onclose = () => {
      if (this.state === 'connected') this.state = 'disconnected'
    }
    transport.stderr?.on('data', chunk => {
      console.error(`[MCP:${this.config.name}] ${String(chunk).trimEnd()}`)
    })

    this.client = client
    this.transport = transport
    await client.connect(transport, { timeout: 30_000 })
  }

  private requireConnected(): Client {
    if (this.state !== 'connected' || !this.client) {
      throw new Error(`MCP Client ${this.config.name} is not connected`)
    }
    return this.client
  }

  private async closeSdkResources(): Promise<void> {
    const client = this.client
    const transport = this.transport
    this.client = undefined
    this.transport = undefined
    try {
      if (client) await client.close()
      else if (transport) await transport.close()
    } catch (error) {
      console.warn(`[MCP:${this.config.name}] 关闭连接失败:`, error)
    }
  }
}
