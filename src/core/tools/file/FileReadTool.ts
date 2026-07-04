/**
 * FileReadTool - 文件读取工具
 *
 * 职责：
 * 1. 读取指定路径的文件内容
 * 2. 返回文件内容给 AI
 * 3. 处理文件不存在、无权限等错误
 *
 * 使用场景：
 * - AI 需要查看文件内容
 * - AI 需要理解代码结构
 * - AI 需要基于现有代码进行修改
 *
 * 示例：
 * User: "查看 src/index.ts 的内容"
 * AI: 调用 read_file(path="src/index.ts")
 * Tool: 返回文件内容
 * AI: 根据内容回答用户
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import * as path from 'path'

/**
 * FileReadTool 参数
 */
interface FileReadArgs {
  /**
   * 文件路径（相对于工作目录）
   */
  path: string
}

/**
 * FileReadTool 实现
 */
export class FileReadTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'read_file'

  /**
   * 工具描述
   */
  readonly description = '读取指定路径的文件内容。用于查看文件、理解代码结构、分析问题等。'

  /**
   * 构造函数
   *
   * @param cwd - 工作目录（当前项目根目录）
   * @param fs - 文件系统适配器
   */
  constructor(
    private cwd: string,
    private fs: IFileSystemAdapter
  ) {
    super()
  }

  /**
   * 获取工具定义
   * 用于 Anthropic API
   */
  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要读取的文件路径（相对于项目根目录）',
          },
        },
        required: ['path'],
      },
    }
  }

  /**
   * 执行文件读取
   *
   * 流程：
   * 1. 验证参数
   * 2. 解析为绝对路径
   * 3. 检查文件是否存在
   * 4. 读取文件内容
   * 5. 返回结果
   *
   * @param args - 工具参数
   * @returns Promise<ToolResult> 执行结果
   */
  async execute(args: FileReadArgs): Promise<ToolResult> {
    try {
      // 1. 验证参数
      if (!args.path) {
        return this.createErrorResult('参数 path 不能为空')
      }

      // 2. 解析为绝对路径
      const absolutePath = path.resolve(this.cwd, args.path)

      // 安全检查：确保路径在工作目录内
      // 防止读取工作目录外的敏感文件
      if (!absolutePath.startsWith(this.cwd)) {
        return this.createErrorResult('安全错误：不能访问工作目录外的文件')
      }

      // 3. 检查文件是否存在
      const exists = await this.fs.exists(absolutePath)
      if (!exists) {
        return this.createErrorResult(`文件不存在: ${args.path}`)
      }

      // 4. 读取文件内容
      const content = await this.fs.readFile(absolutePath)

      // 5. 返回结果
      return this.createSuccessResult(content, {
        path: args.path,
        absolutePath,
        size: content.length,
      })
    } catch (error) {
      // 错误处理
      return this.createErrorResult(error)
    }
  }
}
