/**
 * FindTool - 高级文件查找工具
 *
 * 职责：
 * 1. 根据多种条件查找文件
 * 2. 支持文件名、大小、修改时间等过滤
 * 3. 支持组合条件
 *
 * 使用场景：
 * - 查找特定大小的文件
 * - 查找最近修改的文件
 * - 查找特定扩展名的文件
 *
 * 与其他工具的区别：
 * - GlobTool: 简单的模式匹配
 * - FindTool: 高级查找，支持多种条件
 *
 * 示例：
 * User: "找出最近 7 天内修改的所有 TypeScript 文件"
 * AI: 调用 find(path=".", name="*.ts", mtime=7)
 * Tool: 返回符合条件的文件列表
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import * as path from 'path'
import * as fs from 'fs'

/**
 * FindTool 参数
 */
interface FindArgs {
  /**
   * 搜索路径（可选）
   * 默认：当前目录
   */
  path?: string

  /**
   * 文件名模式（可选）
   * 支持通配符，例如：*.ts
   */
  name?: string

  /**
   * 文件类型（可选）
   * f: 文件，d: 目录
   */
  type?: 'f' | 'd'

  /**
   * 文件大小（可选）
   * 例如：+1M（大于 1MB），-100K（小于 100KB）
   */
  size?: string

  /**
   * 修改时间（可选）
   * 例如：7（最近 7 天），-30（30 天前）
   */
  mtime?: number

  /**
   * 最大深度（可选）
   * 默认：10
   */
  max_depth?: number
}

/**
 * 查找结果项
 */
interface FindResult {
  path: string
  name: string
  type: 'file' | 'directory'
  size: number
  mtime: number
}

/**
 * FindTool 实现
 */
export class FindTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'find'

  /**
   * 工具描述
   */
  readonly description = '高级文件查找工具。支持按文件名、类型、大小、修改时间等条件查找。例如：找出最近修改的大文件、查找特定扩展名的文件。'

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
            description: '搜索路径（默认当前目录）',
          },
          name: {
            type: 'string',
            description: '文件名模式，支持通配符。例如：*.ts, test*.js',
          },
          type: {
            type: 'string',
            description: '文件类型：f（文件）或 d（目录）',
          },
          size: {
            type: 'string',
            description: '文件大小。例如：+1M（大于1MB），-100K（小于100KB）',
          },
          mtime: {
            type: 'number',
            description: '修改时间（天数）。例如：7（最近7天），-30（30天前）',
          },
          max_depth: {
            type: 'number',
            description: '搜索最大深度（默认 10）',
          },
        },
        required: [],
      },
    }
  }

  /**
   * 执行查找
   */
  async execute(args: FindArgs): Promise<ToolResult> {
    try {
      // 解析路径
      const searchPath = args.path
        ? path.resolve(this.cwd, args.path)
        : this.cwd

      // 安全检查
      if (!searchPath.startsWith(this.cwd)) {
        return this.createErrorResult('安全错误：不能访问工作目录外的路径')
      }

      // 执行查找
      const maxDepth = args.max_depth || 10
      const results = await this.findFiles(searchPath, args, maxDepth, 0)

      // 格式化结果
      if (results.length === 0) {
        return this.createSuccessResult('未找到符合条件的文件', {
          count: 0,
          results: [],
        })
      }

      const message = this.formatResults(results)

      return this.createSuccessResult(message, {
        count: results.length,
        results: results.map(r => ({
          path: path.relative(this.cwd, r.path),
          size: r.size,
          mtime: new Date(r.mtime).toISOString(),
        })),
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 递归查找文件
   */
  private async findFiles(
    dir: string,
    criteria: FindArgs,
    maxDepth: number,
    currentDepth: number
  ): Promise<FindResult[]> {
    const results: FindResult[] = []

    if (currentDepth > maxDepth) {
      return results
    }

    try {
      const entries = await this.fs.readDirectory(dir)

      for (const entry of entries) {
        // 跳过隐藏文件和常见忽略目录
        if (entry.startsWith('.') || entry === 'node_modules') {
          continue
        }

        const fullPath = path.join(dir, entry)

        try {
          const stats = fs.statSync(fullPath)
          const isFile = stats.isFile()
          const isDir = stats.isDirectory()

          // 检查类型过滤
          if (criteria.type) {
            if (criteria.type === 'f' && !isFile) continue
            if (criteria.type === 'd' && !isDir) continue
          }

          // 检查文件名过滤
          if (criteria.name && !this.matchPattern(entry, criteria.name)) {
            if (!isDir) continue
          }

          // 检查大小过滤
          if (
            criteria.size &&
            isFile &&
            !this.matchSize(stats.size, criteria.size)
          ) {
            continue
          }

          // 检查修改时间过滤
          if (
            criteria.mtime !== undefined &&
            !this.matchMtime(stats.mtime.getTime(), criteria.mtime)
          ) {
            continue
          }

          // 匹配成功
          if (
            !criteria.name ||
            this.matchPattern(entry, criteria.name) ||
            isDir
          ) {
            results.push({
              path: fullPath,
              name: entry,
              type: isFile ? 'file' : 'directory',
              size: stats.size,
              mtime: stats.mtime.getTime(),
            })
          }

          // 递归搜索子目录
          if (isDir) {
            const subResults = await this.findFiles(
              fullPath,
              criteria,
              maxDepth,
              currentDepth + 1
            )
            results.push(...subResults)
          }
        } catch {
          continue
        }
      }
    } catch {
      return results
    }

    return results
  }

  /**
   * 匹配文件名模式
   */
  private matchPattern(filename: string, pattern: string): boolean {
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')
          + '$'
    )
    return regex.test(filename)
  }

  /**
   * 匹配文件大小
   */
  private matchSize(fileSize: number, sizeStr: string): boolean {
    const match = sizeStr.match(/^([+-]?)(\d+)([KMG]?)$/)
    if (!match) return true

    const [, op, num, unit] = match
    let targetSize = parseInt(num)

    // 转换单位
    switch (unit) {
      case 'K':
        targetSize *= 1024
        break
      case 'M':
        targetSize *= 1024 * 1024
        break
      case 'G':
        targetSize *= 1024 * 1024 * 1024
        break
    }

    // 比较
    if (op === '+') return fileSize > targetSize
    if (op === '-') return fileSize < targetSize
    return fileSize === targetSize
  }

  /**
   * 匹配修改时间
   */
  private matchMtime(fileTime: number, days: number): boolean {
    const now = Date.now()
    const targetTime = now - Math.abs(days) * 24 * 60 * 60 * 1000

    if (days > 0) {
      // 最近 N 天
      return fileTime >= targetTime
    } else {
      // N 天前
      return fileTime <= targetTime
    }
  }

  /**
   * 格式化结果
   */
  private formatResults(results: FindResult[]): string {
    const lines: string[] = [`找到 ${results.length} 个符合条件的项目：\n`]

    for (const result of results) {
      const relativePath = path.relative(this.cwd, result.path)
      const icon = result.type === 'file' ? '📄' : '📁'
      const size =
        result.type === 'file' ? ` (${this.formatSize(result.size)})` : ''
      lines.push(`${icon} ${relativePath}${size}`)
    }

    return lines.join('\n')
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }
}
