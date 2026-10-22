import type { ToolOutcome } from '../../../types'

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
  required?: boolean | string[]

  /** 数组最少元素数（JSON Schema） */
  minItems?: number

  /** 数组最多元素数（JSON Schema） */
  maxItems?: number

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

  /** 工具失败时的语义分类，供 UI 区分无结果、拒绝、可重试和真正失败。 */
  outcome?: ToolOutcome

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

/**
 * 将工具失败文本归类为用户可理解的结果。具体工具可以显式提供 outcome；
 * 这里只处理跨工具稳定的控制流和常见探查结果，未知错误保留为 error。
 */
export function classifyToolOutcome(
  toolName: string,
  error: unknown,
  metadata?: Record<string, any>
): ToolOutcome {
  const text = String(error || '').toLowerCase()
  if (
    toolName === 'bash' &&
    metadata?.exitCode === 1 &&
    typeof metadata.command === 'string' &&
    /(?:^|\s)(rg|grep|git\s+grep)\b/.test(metadata.command)
  ) {
    return 'no_match'
  }
  if (
    metadata?.cancelled === true ||
    text.includes('cancel') ||
    text.includes('取消') ||
    text.includes('query cancelled')
  ) {
    return 'cancelled'
  }
  if (
    text.includes('permission denied') ||
    text.includes('access denied') ||
    text.includes('用户拒绝')
  ) {
    return 'rejected'
  }
  if (
    text.includes('替换后内容与原内容相同') ||
    text.includes('没有任何修改') ||
    text.includes('no changes') ||
    text.includes('nothing to do')
  ) {
    return 'no_change'
  }
  if (
    text.includes('找不到指定的内容') ||
    text.includes('未找到匹配') ||
    text.includes('未找到符合条件') ||
    (toolName.startsWith('git_') && text.includes('不是 git 仓库'))
  ) {
    return 'no_match'
  }
  if (
    toolName.startsWith('task_') ||
    text.includes('超时') ||
    text.includes('timeout') ||
    text.includes('不存在') ||
    text.includes('不能为空') ||
    text.includes('invalid') ||
    text.includes('无效') ||
    text.includes('需要提供') ||
    text.includes('not found') ||
    text.includes('未配置') ||
    text.includes('未连接') ||
    text.includes('请求失败') ||
    text.includes('网络错误')
  ) {
    return 'retryable_error'
  }
  return 'error'
}
