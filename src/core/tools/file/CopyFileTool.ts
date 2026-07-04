/**
 * CopyFileTool - 文件复制工具
 *
 * 职责：
 * 1. 复制文件或目录
 * 2. 支持递归复制目录
 * 3. 处理覆盖选项
 *
 * 使用场景：
 * - 备份文件
 * - 复制模板文件
 * - 创建文件副本
 *
 * 示例：
 * User: "复制 src/config.ts 到 src/config.backup.ts"
 * AI: 调用 copy_file(source="src/config.ts", dest="src/config.backup.ts")
 * Tool: 复制文件
 * AI: 告知用户复制成功
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import * as path from 'path'
import * as fs from 'fs'

/**
 * CopyFileTool 参数
 */
interface CopyFileArgs {
  /**
   * 源路径（相对于工作目录）
   */
  source: string

  /**
   * 目标路径（相对于工作目录）
   */
  destination: string

  /**
   * 是否覆盖已存在的文件（可选）
   * 默认：false
   */
  overwrite?: boolean

  /**
   * 是否递归复制（目录）（可选）
   * 默认：true
   */
  recursive?: boolean
}

/**
 * CopyFileTool 实现
 */
export class CopyFileTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'copy_file'

  /**
   * 工具描述
   */
  readonly description = '复制文件或目录。支持递归复制整个目录树。可以指定是否覆盖已存在的文件。用于备份、创建模板副本等。'

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
          source: {
            type: 'string',
            description: '源文件或目录路径',
          },
          destination: {
            type: 'string',
            description: '目标文件或目录路径',
          },
          overwrite: {
            type: 'boolean',
            description: '是否覆盖已存在的文件（默认 false）',
          },
          recursive: {
            type: 'boolean',
            description: '是否递归复制目录（默认 true）',
          },
        },
        required: ['source', 'destination'],
      },
    }
  }

  /**
   * 执行文件复制
   *
   * 流程：
   * 1. 验证参数
   * 2. 解析为绝对路径
   * 3. 检查源是否存在
   * 4. 检查目标是否已存在
   * 5. 执行复制（文件或目录）
   * 6. 返回结果
   *
   * @param args - 工具参数
   * @returns Promise<ToolResult> 执行结果
   */
  async execute(args: CopyFileArgs): Promise<ToolResult> {
    try {
      // 1. 验证参数
      if (!args.source) {
        return this.createErrorResult('参数 source 不能为空')
      }

      if (!args.destination) {
        return this.createErrorResult('参数 destination 不能为空')
      }

      // 2. 解析为绝对路径
      const sourcePath = path.resolve(this.cwd, args.source)
      const destPath = path.resolve(this.cwd, args.destination)

      // 3. 安全检查
      if (!sourcePath.startsWith(this.cwd) || !destPath.startsWith(this.cwd)) {
        return this.createErrorResult('安全错误：不能访问工作目录外的路径')
      }

      // 4. 检查源是否存在
      const sourceExists = await this.fs.exists(sourcePath)
      if (!sourceExists) {
        return this.createErrorResult(`源路径不存在: ${args.source}`)
      }

      // 5. 检查目标是否已存在
      const destExists = await this.fs.exists(destPath)
      if (destExists && !args.overwrite) {
        return this.createErrorResult(
          `目标路径已存在: ${args.destination}。使用 overwrite=true 强制覆盖。`
        )
      }

      // 6. 判断是文件还是目录
      const stats = fs.statSync(sourcePath)
      const isDirectory = stats.isDirectory()

      if (isDirectory) {
        // 复制目录
        const recursive = args.recursive !== false
        if (!recursive) {
          return this.createErrorResult('复制目录需要 recursive=true')
        }

        await this.copyDirectory(sourcePath, destPath, args.overwrite || false)
      } else {
        // 复制文件
        await this.copyFile(sourcePath, destPath)
      }

      // 7. 返回结果
      const message = isDirectory
        ? `目录已复制: ${args.source} → ${args.destination}`
        : `文件已复制: ${args.source} → ${args.destination}`

      return this.createSuccessResult(message, {
        source: args.source,
        destination: args.destination,
        type: isDirectory ? 'directory' : 'file',
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 复制文件
   *
   * @param source - 源文件绝对路径
   * @param dest - 目标文件绝对路径
   */
  private async copyFile(source: string, dest: string): Promise<void> {
    // 确保目标目录存在
    const destDir = path.dirname(dest)
    await this.fs.createDirectory(destDir)

    // 读取源文件
    const content = await this.fs.readFile(source)

    // 写入目标文件
    await this.fs.writeFile(dest, content)
  }

  /**
   * 递归复制目录
   *
   * @param source - 源目录绝对路径
   * @param dest - 目标目录绝对路径
   * @param overwrite - 是否覆盖
   */
  private async copyDirectory(
    source: string,
    dest: string,
    overwrite: boolean
  ): Promise<void> {
    // 创建目标目录
    await this.fs.createDirectory(dest)

    // 读取源目录内容
    const entries = await this.fs.readDirectory(source)

    for (const entry of entries) {
      const sourcePath = path.join(source, entry)
      const destPath = path.join(dest, entry)

      try {
        const stats = fs.statSync(sourcePath)

        if (stats.isDirectory()) {
          // 递归复制子目录
          await this.copyDirectory(sourcePath, destPath, overwrite)
        } else {
          // 检查目标文件是否存在
          const destExists = await this.fs.exists(destPath)
          if (!destExists || overwrite) {
            await this.copyFile(sourcePath, destPath)
          }
        }
      } catch (error) {
        // 跳过无法访问的文件
        continue
      }
    }
  }
}
