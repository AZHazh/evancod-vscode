/**
 * Tool 基类 - 所有工具的抽象基类
 *
 * 职责：
 * 1. 定义工具的标准接口
 * 2. 提供工具元数据（名称、描述、参数）
 * 3. 执行工具逻辑
 *
 * 设计模式：抽象工厂模式
 * - Tool 是抽象基类
 * - FileReadTool, FileEditTool 等是具体实现
 * - QueryEngine 是工具的使用者
 *
 * 工具执行流程：
 * 1. AI 决定调用哪个工具
 * 2. QueryEngine 实例化工具
 * 3. 调用 tool.execute(args)
 * 4. 返回结果给 AI
 * 5. AI 根据结果继续对话
 *
 * Anthropic 工具格式：
 * {
 *   name: "read_file",
 *   description: "读取文件内容",
 *   input_schema: {
 *     type: "object",
 *     properties: { path: { type: "string" } },
 *     required: ["path"]
 *   }
 * }
 */

/**
 * 工具参数定义
 * 使用 JSON Schema 格式
 */
export interface ToolParameter {
  /**
   * 参数类型
   */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'

  /**
   * 参数描述
   */
  description: string

  /**
   * 是否必需
   */
  required?: boolean

  /**
   * 枚举值（可选）
   */
  enum?: string[]

  /**
   * 对象属性（当 type 为 object 时）
   */
  properties?: Record<string, ToolParameter>

  /**
   * 数组项类型（当 type 为 array 时）
   */
  items?: ToolParameter
}

/**
 * 工具定义
 * 用于 Anthropic API
 */
export interface ToolDefinition {
  /**
   * 工具名称
   * 例如：read_file, edit_file
   */
  name: string

  /**
   * 工具描述
   * AI 会根据描述决定是否使用此工具
   */
  description: string

  /**
   * 输入参数 Schema（JSON Schema 格式）
   */
  input_schema: {
    type: 'object'
    properties: Record<string, ToolParameter>
    required: string[]
  }
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  /**
   * 是否成功
   */
  success: boolean

  /**
   * 结果内容（成功时）
   */
  content?: string

  /**
   * 错误消息（失败时）
   */
  error?: string

  /**
   * 元数据（可选）
   * 例如：文件大小、修改时间等
   */
  metadata?: Record<string, any>
}

/**
 * Tool 抽象基类
 */
export abstract class Tool {
  /**
   * 工具名称
   * 子类必须提供
   */
  abstract readonly name: string

  /**
   * 工具描述
   * 子类必须提供
   */
  abstract readonly description: string

  /**
   * 获取工具定义
   * 用于传递给 Anthropic API
   *
   * @returns ToolDefinition
   */
  abstract getDefinition(): ToolDefinition

  /**
   * 执行工具
   * 子类必须实现
   *
   * @param args - 工具参数（由 AI 提供）
   * @returns Promise<ToolResult> 执行结果
   */
  abstract execute(args: any, context?: { toolUseId?: string }): Promise<ToolResult>

  /**
   * 验证参数（可选）
   * 子类可以重写此方法进行自定义验证
   *
   * @param args - 工具参数
   * @returns boolean 是否有效
   */
  protected validateArgs(args: any): boolean {
    // 默认不验证，子类可以重写
    return true
  }

  /**
   * 格式化错误消息（辅助方法）
   *
   * @param error - 错误对象
   * @returns 友好的错误消息
   */
  protected formatError(error: any): string {
    if (error instanceof Error) {
      return error.message
    }
    return String(error)
  }

  /**
   * 创建成功结果（辅助方法）
   *
   * @param content - 结果内容
   * @param metadata - 元数据（可选）
   * @returns ToolResult
   */
  protected createSuccessResult(content: string, metadata?: Record<string, any>): ToolResult {
    return {
      success: true,
      content,
      metadata,
    }
  }

  /**
   * 创建失败结果（辅助方法）
   *
   * @param error - 错误消息或错误对象
   * @returns ToolResult
   */
  protected createErrorResult(error: any): ToolResult {
    return {
      success: false,
      error: this.formatError(error),
    }
  }
}
