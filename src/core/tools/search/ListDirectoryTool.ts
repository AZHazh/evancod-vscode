/**
 * ListDirectoryTool - 目录列举工具
 *
 * 职责：
 * 1. 列出指定目录下的所有文件和子目录
 * 2. 支持递归列举
 * 3. 支持文件过滤
 * 4. 显示文件信息（大小、修改时间等）
 *
 * 使用场景：
 * - 查看目录结构
 * - 了解项目组成
 * - 查找特定文件
 *
 * 与其他工具的区别：
 * - GlobTool: 按模式搜索文件（支持通配符）
 * - ListDirectoryTool: 列出目录内容（支持递归）
 *
 * 示例：
 * User: "查看 src 目录下有哪些文件"
 * AI: 调用 list_directory(path="src", recursive=false)
 * Tool: 返回文件列表
 * AI: 总结目录结构
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import * as path from 'path'
import * as fs from 'fs'

/**
 * ListDirectoryTool 参数
 */
interface ListDirectoryArgs {
  /**
   * 目录路径（相对于工作目录）
   */
  path?: string

  /**
   * 是否递归列举（可选）
   * 默认：false
   */
  recursive?: boolean

  /**
   * 是否显示隐藏文件（可选）
   * 默认：false
   */
  show_hidden?: boolean

  /**
   * 最大深度（递归时）（可选）
   * 默认：3
   */
  max_depth?: number
}

/**
 * 文件信息
 */
interface FileInfo {
  /**
   * 文件名
   */
  name: string

  /**
   * 相对路径
   */
  path: string

  /**
   * 文件类型
   */
  type: 'file' | 'directory'

  /**
   * 文件大小（字节）
   */
  size?: number

  /**
   * 修改时间
   */
  mtime?: number

  /**
   * 子文件（目录且递归时）
   */
  children?: FileInfo[]
}

/**
 * ListDirectoryTool 实现
 */
export class ListDirectoryTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'list_directory'

  /**
   * 工具描述
   */
  readonly description = '列出指定目录下的文件和子目录。可以递归列举，显示文件大小和修改时间。用于了解项目结构、查看目录内容。'

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
            description: '目录路径（可选，默认为当前目录）',
          },
          recursive: {
            type: 'boolean',
            description: '是否递归列举子目录（默认 false）',
          },
          show_hidden: {
            type: 'boolean',
            description: '是否显示隐藏文件（默认 false）',
          },
          max_depth: {
            type: 'number',
            description: '递归最大深度（默认 3）',
          },
        },
        required: [],
      },
    }
  }

  /**
   * 执行目录列举
   *
   * 流程：
   * 1. 验证参数
   * 2. 解析为绝对路径
   * 3. 检查目录是否存在
   * 4. 列举目录内容
   * 5. 格式化结果
   *
   * @param args - 工具参数
   * @returns Promise<ToolResult> 执行结果
   */
  async execute(args: ListDirectoryArgs): Promise<ToolResult> {
    try {
      // 1. 解析路径（默认为当前目录）
      const dirPath = args.path
        ? path.resolve(this.cwd, args.path)
        : this.cwd

      // 安全检查
      if (!dirPath.startsWith(this.cwd)) {
        return this.createErrorResult('安全错误：不能访问工作目录外的路径')
      }

      // 2. 检查目录是否存在
      const exists = await this.fs.exists(dirPath)
      if (!exists) {
        return this.createErrorResult(`目录不存在: ${args.path || '.'}`)
      }

      // 3. 列举目录内容
      const recursive = args.recursive || false
      const showHidden = args.show_hidden || false
      const maxDepth = args.max_depth || 3

      const files = await this.listDirectory(
        dirPath,
        recursive,
        showHidden,
        maxDepth,
        0
      )

      // 4. 格式化结果
      const message = this.formatFileList(files, args.path || '.')

      return this.createSuccessResult(message, {
        path: args.path || '.',
        count: this.countFiles(files),
        files,
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 列举目录内容（递归）
   *
   * @param dirPath - 目录绝对路径
   * @param recursive - 是否递归
   * @param showHidden - 是否显示隐藏文件
   * @param maxDepth - 最大深度
   * @param currentDepth - 当前深度
   * @returns Promise<FileInfo[]> 文件列表
   */
  private async listDirectory(
    dirPath: string,
    recursive: boolean,
    showHidden: boolean,
    maxDepth: number,
    currentDepth: number
  ): Promise<FileInfo[]> {
    const files: FileInfo[] = []

    try {
      // 读取目录内容
      const entries = await this.fs.readDirectory(dirPath)

      for (const entry of entries) {
        // 跳过隐藏文件（以 . 开头）
        if (!showHidden && entry.startsWith('.')) {
          continue
        }

        const fullPath = path.join(dirPath, entry)
        const relativePath = path.relative(this.cwd, fullPath)

        try {
          // 获取文件信息
          const stats = fs.statSync(fullPath)

          const fileInfo: FileInfo = {
            name: entry,
            path: relativePath,
            type: stats.isDirectory() ? 'directory' : 'file',
            size: stats.isFile() ? stats.size : undefined,
            mtime: stats.mtime.getTime(),
          }

          // 递归列举子目录
          if (
            stats.isDirectory() &&
            recursive &&
            currentDepth < maxDepth
          ) {
            fileInfo.children = await this.listDirectory(
              fullPath,
              recursive,
              showHidden,
              maxDepth,
              currentDepth + 1
            )
          }

          files.push(fileInfo)
        } catch (error) {
          // 跳过无法访问的文件
          continue
        }
      }

      // 排序：目录在前，文件在后
      files.sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name)
        }
        return a.type === 'directory' ? -1 : 1
      })

      return files
    } catch (error) {
      return []
    }
  }

  /**
   * 格式化文件列表
   *
   * @param files - 文件列表
   * @param basePath - 基础路径
   * @param indent - 缩进级别
   * @returns string 格式化后的文本
   */
  private formatFileList(
    files: FileInfo[],
    basePath: string,
    indent: number = 0
  ): string {
    const lines: string[] = []

    if (indent === 0) {
      lines.push(`${basePath}/`)
      lines.push(`包含 ${this.countFiles(files)} 个项目：\n`)
    }

    for (const file of files) {
      const prefix = '  '.repeat(indent)
      const icon = file.type === 'directory' ? '📁' : '📄'
      const size = file.size ? ` (${this.formatSize(file.size)})` : ''

      lines.push(`${prefix}${icon} ${file.name}${size}`)

      // 递归格式化子文件
      if (file.children && file.children.length > 0) {
        lines.push(this.formatFileList(file.children, '', indent + 1))
      }
    }

    return lines.join('\n')
  }

  /**
   * 统计文件数量
   *
   * @param files - 文件列表
   * @returns number 文件总数
   */
  private countFiles(files: FileInfo[]): number {
    let count = files.length

    for (const file of files) {
      if (file.children) {
        count += this.countFiles(file.children)
      }
    }

    return count
  }

  /**
   * 格式化文件大小
   *
   * @param bytes - 字节数
   * @returns string 格式化后的大小
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }
}
