/**
 * MCP Tool - Model Context Protocol 工具调用
 *
 * 职责：
 * 1. 调用外部 MCP Server 提供的工具
 * 2. 读取 MCP Server 提供的资源
 * 3. 将 MCP 工具桥接到 Evancod 的工具系统
 *
 * MCP 协议说明：
 * - MCP 允许 AI 通过标准协议调用外部工具和资源
 * - 支持文件系统、数据库、API、Git 等各种类型的 Server
 * - 每个 Server 可以提供多个工具和资源
 *
 * 使用场景：
 * - AI 需要访问 MCP Server 提供的文件系统
 * - AI 需要查询 MCP Server 提供的数据库
 * - AI 需要调用 MCP Server 提供的 API
 *
 * 工具参数格式：
 * ```json
 * {
 *   "action": "call_tool",
 *   "server": "filesystem",
 *   "tool": "read_file",
 *   "args": {
 *     "path": "/path/to/file"
 *   }
 * }
 * ```
 *
 * 资源读取格式：
 * ```json
 * {
 *   "action": "read_resource",
 *   "server": "filesystem",
 *   "uri": "file:///path/to/file"
 * }
 * ```
 *
 * 设计原则：
 * - 参数验证：确保 server 和 tool 存在
 * - 错误处理：MCP 调用失败时返回友好的错误信息
 * - 结果格式化：将 MCP 结果转换为统一的格式
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { MCPConnectionManager } from '../../../services/mcp/MCPConnectionManager'

/**
 * MCP 工具参数
 */
interface MCPToolParams {
  /** 操作类型 */
  action: 'call_tool' | 'read_resource' | 'list_tools' | 'list_resources'

  /** MCP Server 名称 */
  server: string

  /** 工具名称（action 为 call_tool 时必需） */
  tool?: string

  /** 工具参数（action 为 call_tool 时可选） */
  args?: any

  /** 资源 URI（action 为 read_resource 时必需） */
  uri?: string
}

export class MCPTool extends Tool {
  /**
   * 构造函数
   *
   * @param mcpManager - MCP 连接管理器
   */
  constructor(private mcpManager: MCPConnectionManager) {
    super()
  }

  /**
   * 工具名称
   */
  get name(): string {
    return 'mcp'
  }

  /**
   * 工具描述
   */
  get description(): string {
    return `调用 MCP (Model Context Protocol) Server 提供的工具和资源。

MCP 是一个标准协议，允许 AI 连接到外部服务并使用它们提供的工具。

支持的操作：
1. call_tool - 调用 MCP 工具
2. read_resource - 读取 MCP 资源
3. list_tools - 列出 Server 提供的所有工具
4. list_resources - 列出 Server 提供的所有资源

使用示例：

1. 调用工具：
{
  "action": "call_tool",
  "server": "filesystem",
  "tool": "read_file",
  "args": { "path": "/path/to/file" }
}

2. 读取资源：
{
  "action": "read_resource",
  "server": "git",
  "uri": "git://repo/status"
}

3. 列出工具：
{
  "action": "list_tools",
  "server": "filesystem"
}

注意事项：
- 确保目标 MCP Server 已在配置文件中定义
- 工具名称和参数格式取决于具体的 MCP Server
- 资源 URI 格式取决于具体的 MCP Server`
  }

  /**
   * 输入 Schema
   */
  get inputSchema(): any {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['call_tool', 'read_resource', 'list_tools', 'list_resources'],
          description: '操作类型'
        },
        server: {
          type: 'string',
          description: 'MCP Server 名称（如 filesystem、git 等）'
        },
        tool: {
          type: 'string',
          description: '工具名称（action 为 call_tool 时必需）'
        },
        args: {
          type: 'object',
          description: '工具参数（action 为 call_tool 时可选）'
        },
        uri: {
          type: 'string',
          description: '资源 URI（action 为 read_resource 时必需）'
        }
      },
      required: ['action', 'server']
    }
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.inputSchema,
    }
  }

  /**
   * 执行工具
   *
   * @param params - 工具参数
   * @returns 执行结果
   */
  async execute(params: MCPToolParams): Promise<ToolResult> {
    try {
      // 验证参数
      this.validateParams(params)

      // 检查 Server 是否已连接
      const connectedServers = this.mcpManager.getConnectedServers()
      if (!connectedServers.includes(params.server)) {
        return this.createErrorResult(`MCP Server "${params.server}" 未连接或不存在。\n\n可用的 MCP Server：${connectedServers.length > 0 ? connectedServers.join(', ') : '无'}\n\n请检查：\n1. MCP Server 配置文件是否存在：~/.claude/cc-evancod/mcp-servers.json\n2. Server 名称是否正确\n3. Server 是否启动成功`)
      }

      // 根据操作类型执行
      switch (params.action) {
        case 'call_tool':
          return this.createSuccessResult(await this.handleCallTool(params))
        case 'read_resource':
          return this.createSuccessResult(await this.handleReadResource(params))
        case 'list_tools':
          return this.createSuccessResult(await this.handleListTools(params))
        case 'list_resources':
          return this.createSuccessResult(await this.handleListResources(params))
        default:
          return this.createErrorResult(`不支持的操作类型 "${params.action}"`)
      }
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 验证参数
   *
   * @param params - 工具参数
   */
  private validateParams(params: MCPToolParams): void {
    if (!params.action) {
      throw new Error('缺少必需参数：action')
    }

    if (!params.server) {
      throw new Error('缺少必需参数：server')
    }

    if (params.action === 'call_tool' && !params.tool) {
      throw new Error('action 为 call_tool 时必须提供 tool 参数')
    }

    if (params.action === 'read_resource' && !params.uri) {
      throw new Error('action 为 read_resource 时必须提供 uri 参数')
    }
  }

  /**
   * 处理工具调用
   *
   * @param params - 工具参数
   * @returns 执行结果
   */
  private async handleCallTool(params: MCPToolParams): Promise<string> {
    const result = await this.mcpManager.callTool(
      params.server,
      params.tool!,
      params.args || {}
    )

    return this.formatResult('工具调用成功', result)
  }

  /**
   * 处理资源读取
   *
   * @param params - 工具参数
   * @returns 执行结果
   */
  private async handleReadResource(params: MCPToolParams): Promise<string> {
    const result = await this.mcpManager.readResource(params.server, params.uri!)

    return this.formatResult('资源读取成功', result)
  }

  /**
   * 处理列出工具
   *
   * @param params - 工具参数
   * @returns 执行结果
   */
  private async handleListTools(params: MCPToolParams): Promise<string> {
    const serverInfo = this.mcpManager
      .getServerInfoList()
      .find((info) => info.name === params.server)

    if (!serverInfo) {
      return `MCP Server "${params.server}" 不存在`
    }

    if (serverInfo.tools.length === 0) {
      return `MCP Server "${params.server}" 没有提供任何工具`
    }

    const toolsList = serverInfo.tools.map((tool, index) => `${index + 1}. ${tool}`).join('\n')

    return `MCP Server "${params.server}" 提供的工具（共 ${serverInfo.tools.length} 个）：

${toolsList}

使用方法：
{
  "action": "call_tool",
  "server": "${params.server}",
  "tool": "工具名称",
  "args": { ... }
}`
  }

  /**
   * 处理列出资源
   *
   * @param params - 工具参数
   * @returns 执行结果
   */
  private async handleListResources(params: MCPToolParams): Promise<string> {
    const serverInfo = this.mcpManager
      .getServerInfoList()
      .find((info) => info.name === params.server)

    if (!serverInfo) {
      return `MCP Server "${params.server}" 不存在`
    }

    if (serverInfo.resources.length === 0) {
      return `MCP Server "${params.server}" 没有提供任何资源`
    }

    const resourcesList = serverInfo.resources
      .map((uri, index) => `${index + 1}. ${uri}`)
      .join('\n')

    return `MCP Server "${params.server}" 提供的资源（共 ${serverInfo.resources.length} 个）：

${resourcesList}

使用方法：
{
  "action": "read_resource",
  "server": "${params.server}",
  "uri": "资源 URI"
}`
  }

  /**
   * 格式化结果
   *
   * @param message - 消息
   * @param data - 数据
   * @returns 格式化的结果
   */
  private formatResult(message: string, data: any): string {
    if (typeof data === 'string') {
      return `${message}：\n\n${data}`
    }

    if (typeof data === 'object') {
      return `${message}：\n\n${JSON.stringify(data, null, 2)}`
    }

    return `${message}：\n\n${String(data)}`
  }
}
