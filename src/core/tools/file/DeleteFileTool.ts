/**
 * DeleteFileTool - 文件删除工具
 *
 * 职责：
 * 1. 删除文件或目录
 * 2. 支持递归删除目录
 * 3. 安全检查和确认
 *
 * 使用场景：
 * - 清理临时文件
 * - 删除不需要的文件
 * - 清理构建产物
 *
 * 安全注意：
 * - 禁止删除重要系统文件
 * - 禁止删除 .git 目录
 * - 禁止删除 node_modules（应使用 npm 命令）
 *
 * 示例：
 * User: "删除 temp.txt"
 * AI: 调用 delete_file(path="temp.txt")
 * Tool: 删除文件
 * AI: 告知用户删除成功
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import * as path from 'path'
import * as fsp from 'fs/promises'

/**
 * DeleteFileTool 参数
 */
interface DeleteFileArgs {
  /**
   * 文件或目录路径（相对于工作目录）
   */
  path: string

  /**
   * 是否递归删除目录（可选）
   * 默认：false
   */
  recursive?: boolean
}

/**
 * DeleteFileTool 实现
 */
export class DeleteFileTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'delete_file'

  /**
   * 工具描述
   */
  readonly description = '删除文件或目录。支持递归删除整个目录树。有安全检查，禁止删除重要系统文件和目录（.git、node_modules 等）。用于清理临时文件、删除不需要的文件。'

  /**
   * 禁止删除的路径列表
   */
  private readonly FORBIDDEN_PATHS = [
    '.git',
    'node_modules',
    '.env',
    'package.json',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
  ]

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
            description: '要删除的文件或目录路径',
          },
          recursive: {
            type: 'boolean',
            description: '是否递归删除目录（默认 false）',
          },
        },
        required: ['path'],
      },
    }
  }

  /**
   * 执行文件删除
   *
   * 流程：
   * 1. 验证参数
   * 2. 解析为绝对路径
   * 3. 安全检查（禁止删除重要文件）
   * 4. 检查文件是否存在
   * 5. 执行删除（文件或目录）
   * 6. 返回结果
   *
   * @param args - 工具参数
   * @returns Promise<ToolResult> 执行结果
   */
  async execute(args: DeleteFileArgs): Promise<ToolResult> {
    try {
      // 1. 验证参数
      if (!args.path) {
        return this.createErrorResult('参数 path 不能为空')
      }

      // 2. 解析为绝对路径
      const absolutePath = path.resolve(this.cwd, args.path)

      // 3. 安全检查
      if (!absolutePath.startsWith(this.cwd)) {
        return this.createErrorResult('安全错误：不能访问工作目录外的路径')
      }

      // 禁止删除工作目录本身
      if (absolutePath === this.cwd) {
        return this.createErrorResult('安全错误：不能删除工作目录本身')
      }

      // 检查是否为禁止删除的路径
      const fileName = path.basename(absolutePath)
      if (this.FORBIDDEN_PATHS.includes(fileName)) {
        return this.createErrorResult(
          `安全错误：禁止删除重要文件或目录: ${fileName}`
        )
      }

      // 检查路径中是否包含禁止的目录
      const relativePath = path.relative(this.cwd, absolutePath)
      for (const forbidden of this.FORBIDDEN_PATHS) {
        if (relativePath.includes(forbidden + path.sep)) {
          return this.createErrorResult(
            `安全错误：路径包含受保护的目录: ${forbidden}`
          )
        }
      }

      // 4. 检查文件是否存在
      const exists = await this.fs.exists(absolutePath)
      if (!exists) {
        return this.createErrorResult(`路径不存在: ${args.path}`)
      }

      // 5. 判断是文件还是目录
      const stats = await this.fs.stat(absolutePath)
      const isDirectory = stats.isDirectory

      if (isDirectory) {
        // 删除目录
        const recursive = args.recursive !== false
        if (!recursive) {
          return this.createErrorResult('删除目录需要 recursive=true')
        }

        await this.deleteDirectory(absolutePath)
      } else {
        // 删除文件
        await this.fs.deleteFile(absolutePath)
      }

      // 6. 返回结果
      const message = isDirectory
        ? `目录已删除: ${args.path}`
        : `文件已删除: ${args.path}`

      return this.createSuccessResult(message, {
        path: args.path,
        type: isDirectory ? 'directory' : 'file',
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 递归删除目录
   *
   * @param dirPath - 目录绝对路径
   */
  private async deleteDirectory(dirPath: string): Promise<void> {
    // 一次拿到条目及类型，避免逐条 statSync
    const entries = await this.fs.readDirectoryWithTypes(dirPath)

    // 删除所有子项
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      try {
        if (entry.isDirectory) {
          // 递归删除子目录
          await this.deleteDirectory(fullPath)
        } else {
          // 删除文件
          await this.fs.deleteFile(fullPath)
        }
      } catch (error) {
        // 跳过无法访问的文件
        continue
      }
    }

    // 删除空目录（异步，不阻塞事件循环）
    await fsp.rmdir(dirPath)
  }
}
