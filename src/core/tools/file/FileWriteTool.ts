/**
 * FileWriteTool - 文件写入工具
 *
 * 职责：
 * 1. 创建新文件或覆盖现有文件
 * 2. 写入指定内容
 * 3. 自动创建父目录
 *
 * 使用场景：
 * - 创建新文件
 * - 完全重写文件内容
 * - 生成配置文件
 *
 * 注意：
 * - 如果文件已存在会被覆盖
 * - 适合创建新文件，不适合修改现有文件（应使用 FileEditTool）
 *
 * 示例：
 * User: "创建一个新的 README.md"
 * AI: 调用 write_file(path="README.md", content="# Project\n...")
 * Tool: 写入文件
 * AI: 告知用户文件已创建
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import * as path from 'path'

/**
 * FileWriteTool 参数
 */
interface FileWriteArgs {
  /**
   * 文件路径（相对于工作目录）
   */
  path: string

  /**
   * 文件内容
   */
  content: string
}

/**
 * FileWriteTool 实现
 */
export class FileWriteTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'write_file'

  /**
   * 工具描述
   */
  readonly description = '创建新文件或覆盖现有文件的内容。适合创建全新文件或完全重写文件。如果需要修改现有文件的部分内容，应使用 edit_file 工具。'

  /**
   * 构造函数
   *
   * @param cwd - 工作目录
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
            description: '要写入的文件路径（相对于项目根目录）',
          },
          content: {
            type: 'string',
            description: '要写入的文件内容',
          },
        },
        required: ['path', 'content'],
      },
    }
  }

  /**
   * 执行文件写入
   *
   * 流程：
   * 1. 验证参数
   * 2. 解析为绝对路径
   * 3. 安全检查
   * 4. 检查文件是否已存在（警告）
   * 5. 写入文件（自动创建父目录）
   * 6. 返回结果
   *
   * @param args - 工具参数
   * @returns Promise<ToolResult> 执行结果
   */
  async execute(args: FileWriteArgs): Promise<ToolResult> {
    try {
      // 1. 验证参数
      if (!args.path) {
        return this.createErrorResult('参数 path 不能为空')
      }

      if (args.content === undefined || args.content === null) {
        return this.createErrorResult('参数 content 不能为空')
      }

      // 2. 解析为绝对路径
      const absolutePath = path.resolve(this.cwd, args.path)

      // 3. 安全检查：确保路径在工作目录内
      if (!absolutePath.startsWith(this.cwd)) {
        return this.createErrorResult('安全错误：不能访问工作目录外的文件')
      }

      // 安全检查：禁止写入敏感文件
      const sensitiveFiles = ['.env', '.git', 'node_modules', '.ssh']
      const fileName = path.basename(absolutePath)
      const dirName = path.dirname(absolutePath)

      if (sensitiveFiles.some(f => fileName === f || dirName.includes(f))) {
        return this.createErrorResult(`安全错误：禁止写入敏感文件或目录: ${args.path}`)
      }

      // 4. 检查文件是否已存在
      const exists = await this.fs.exists(absolutePath)
      const action = exists ? 'overwritten' : 'created'

      // 5. 写入文件（FileSystemAdapter 会自动创建父目录）
      await this.fs.writeFile(absolutePath, args.content)

      // 6. 返回结果
      const message = exists
        ? `文件已覆盖: ${args.path}`
        : `文件已创建: ${args.path}`

      return this.createSuccessResult(message, {
        path: args.path,
        absolutePath,
        action,
        size: args.content.length,
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }
}
