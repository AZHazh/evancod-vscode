import { Tool, type ToolDefinition, type ToolParameter, type ToolResult } from '../base/Tool'
import type { MCPConnectionManager } from '../../../services/mcp/MCPConnectionManager'

export interface MCPDiscoveredTool {
  name: string
  description?: string
  inputSchema?: Record<string, any>
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    openWorldHint?: boolean
  }
}

export function normalizeMcpInputSchema(
  schema: Record<string, any> | undefined
): ToolDefinition['input_schema'] {
  const properties: Record<string, ToolParameter> = {}
  for (const [name, value] of Object.entries(schema?.properties || {})) {
    properties[name] = normalizeParameter(value as Record<string, any>)
  }
  return {
    type: 'object',
    properties,
    required: Array.isArray(schema?.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

function normalizeParameter(schema: Record<string, any>): ToolParameter {
  const supported = new Set(['string', 'number', 'boolean', 'object', 'array'])
  const type = schema.type === 'integer' ? 'number' : supported.has(schema.type) ? schema.type : 'object'
  const parameter: ToolParameter = {
    type,
    description: typeof schema.description === 'string' ? schema.description : '',
  }
  if (Array.isArray(schema.enum)) {
    parameter.enum = schema.enum.filter((item: unknown): item is string => typeof item === 'string')
  }
  if (type === 'object' && schema.properties && typeof schema.properties === 'object') {
    parameter.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, value]) => [
        name,
        normalizeParameter(value as Record<string, any>),
      ])
    )
  }
  if (type === 'array' && schema.items && typeof schema.items === 'object') {
    parameter.items = normalizeParameter(schema.items)
  }
  return parameter
}

export class MCPRemoteTool extends Tool {
  readonly description: string

  constructor(
    private readonly manager: MCPConnectionManager,
    private readonly serverName: string,
    private readonly remoteTool: MCPDiscoveredTool,
    readonly name: string
  ) {
    super()
    this.description = remoteTool.description || `调用 ${serverName} MCP Server 的 ${remoteTool.name}`
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      input_schema: normalizeMcpInputSchema(this.remoteTool.inputSchema),
    }
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = (await this.manager.callTool(
        this.serverName,
        this.remoteTool.name,
        args
      )) as Record<string, any>
      const blocks = Array.isArray(result?.content) ? result.content : []
      const texts = blocks
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
      const image = blocks.find(
        block => block?.type === 'image' && typeof block.data === 'string' && block.mimeType
      )
      const content = texts.join('\n') || JSON.stringify(result?.structuredContent ?? result, null, 2)
      return {
        success: result?.isError !== true,
        content,
        error: result?.isError === true ? content : undefined,
        metadata: {
          server: this.serverName,
          remoteTool: this.remoteTool.name,
          structuredContent: result?.structuredContent,
          ...(image ? { image: { base64: image.data, mime: image.mimeType } } : {}),
        },
      }
    } catch (error) {
      return this.createErrorResult(error)
    }
  }
}
