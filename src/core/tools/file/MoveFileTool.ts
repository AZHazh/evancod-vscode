/**
 * MoveFileTool - 文件移动/重命名工具
 *
 * 职责：
 * 1. 移动文件或目录到新位置
 * 2. 重命名文件或目录
 * 3. 处理覆盖选项
 *
 * 使用场景：
 * - 重命名文件
 * - 移动文件到其他目录
 * - 组织文件结构
 *
 * 示例：
 * User: "把 old-name.ts 重命名为 new-name.ts"
 * AI: 调用 move_file(source="old-name.ts", dest="new-name.ts")
 * Tool: 移动文件
 * AI: 告知用户重命名成功
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import * as path from 'path'
import * as fs from 'fs'

/**
 * MoveFileTool 参数
 */
interface MoveFileArgs {
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
}

/**
 * MoveFileTool 实现
 */
export class MoveFileTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'move_file'

  /**
   * 工具描述
   */
  readonly description = '移动或重命名文件和目录。可以将文件移动到不同目录，或在同一目录下重命名。支持覆盖选项。用于组织文件结构、重命名等。'

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
        },
        required: ['source', 'destination'],
      },
    }
  }

  /**
   * 执行文件移动
   *
   * 流程：
   * 1. 验证参数
   * 2. 解析为绝对路径
   * 3. 检查源是否存在
   * 4. 检查目标是否已存在
   * 5. 执行移动（使用 fs.rename）
   * 6. 返回结果
   *
   * @param args - 工具参数
   * @returns Promise<ToolResult> 执行结果
   */
  async execute(args: MoveFileArgs): Promise<ToolResult> {
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

      // 禁止移动到自己
      if (sourcePath === destPath) {
        return this.createErrorResult('源路径和目标路径相同')
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

      // 6. 如果目标已存在且需要覆盖，先删除
      if (destExists && args.overwrite) {
        await this.fs.deleteFile(destPath)
      }

      // 7. 确保目标目录存在
      const destDir = path.dirname(destPath)
      await this.fs.createDirectory(destDir)

      // 8. 执行移动（重命名）
      fs.renameSync(sourcePath, destPath)

      // 9. 判断操作类型
      const sourceDir = path.dirname(sourcePath)
      const destDirPath = path.dirname(destPath)
      const isRename = sourceDir === destDirPath
      const operation = isRename ? '重命名' : '移动'

      const message = `${operation}成功: ${args.source} → ${args.destination}`

      return this.createSuccessResult(message, {
        source: args.source,
        destination: args.destination,
        operation,
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }
}
