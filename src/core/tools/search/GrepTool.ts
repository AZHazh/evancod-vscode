/**
 * GrepTool - 内容搜索工具
 *
 * 职责：
 * 1. 在文件中搜索指定内容
 * 2. 支持正则表达式
 * 3. 返回匹配的行及其上下文
 *
 * 使用场景：
 * - 搜索特定的函数、类、变量
 * - 查找 TODO、FIXME 注释
 * - 查找错误信息
 * - 代码分析
 *
 * 与 GlobTool 的区别：
 * - GlobTool: 根据文件名搜索文件
 * - GrepTool: 根据文件内容搜索
 *
 * 示例：
 * User: "搜索包含 'function' 的代码"
 * AI: 调用 grep(pattern="function", path="src")
 * Tool: 返回所有包含 function 的行
 * AI: 总结搜索结果
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import { mapLimit } from '../../../utils/concurrency'
import * as path from 'path'

/**
 * GrepTool 参数
 */
interface GrepArgs {
  /**
   * 搜索模式（支持正则表达式）
   */
  pattern: string

  /**
   * 搜索路径（可选）
   * 默认：工作目录
   */
  path?: string

  /**
   * 文件过滤（可选）
   * 例如：*.ts 只搜索 TypeScript 文件
   */
  file_pattern?: string

  /**
   * 是否区分大小写（可选）
   * 默认：true
   */
  case_sensitive?: boolean

  /**
   * 显示上下文行数（可选）
   * 默认：0（不显示上下文）
   */
  context?: number
}

/**
 * 搜索结果项
 */
interface GrepMatch {
  /**
   * 文件路径
   */
  file: string

  /**
   * 行号
   */
  line: number

  /**
   * 匹配的行内容
   */
  content: string

  /**
   * 上下文（可选）
   */
  context?: {
    before: string[]
    after: string[]
  }
}

/**
 * GrepTool 实现
 */
export class GrepTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'grep'

  /**
   * 工具描述
   */
  readonly description = '在文件内容中搜索指定模式。支持正则表达式。可以搜索函数名、变量名、注释、错误信息等。返回匹配的行及其位置。'

  /**
   * 最大搜索结果数
   * 避免返回过多结果
   */
  private readonly MAX_RESULTS = 100

  /**
   * 单层目录内并发读取/递归的最大并发数。
   * 太大反而会因文件句柄争用变慢，16 是经验上的稳妥值。
   */
  private readonly CONCURRENCY = 16

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
          pattern: {
            type: 'string',
            description: '要搜索的模式（支持正则表达式）',
          },
          path: {
            type: 'string',
            description: '搜索路径（可选，默认为项目根目录）',
          },
          file_pattern: {
            type: 'string',
            description: '文件过滤模式（可选），例如：*.ts 只搜索 TypeScript 文件',
          },
          case_sensitive: {
            type: 'boolean',
            description: '是否区分大小写（可选，默认 true）',
          },
          context: {
            type: 'number',
            description: '显示上下文行数（可选，默认 0）',
          },
        },
        required: ['pattern'],
      },
    }
  }

  /**
   * 执行内容搜索
   *
   * 流程：
   * 1. 验证参数
   * 2. 解析搜索路径
   * 3. 遍历文件搜索
   * 4. 返回结果
   *
   * @param args - 工具参数
   * @returns Promise<ToolResult> 执行结果
   */
  async execute(args: GrepArgs): Promise<ToolResult> {
    try {
      // 1. 验证参数
      if (!args.pattern) {
        return this.createErrorResult('参数 pattern 不能为空')
      }

      // 2. 解析搜索路径
      const searchPath = args.path
        ? path.resolve(this.cwd, args.path)
        : this.cwd

      // 安全检查
      if (!searchPath.startsWith(this.cwd)) {
        return this.createErrorResult('安全错误：不能访问工作目录外的路径')
      }

      // 3. 执行搜索
      const matches = await this.searchContent(searchPath, args)

      // 4. 返回结果
      if (matches.length === 0) {
        return this.createSuccessResult(
          `未找到匹配 "${args.pattern}" 的内容`,
          { pattern: args.pattern, count: 0, matches: [] }
        )
      }

      // 格式化结果
      const message = this.formatMatches(matches, args.pattern)

      return this.createSuccessResult(message, {
        pattern: args.pattern,
        count: matches.length,
        matches: matches.map(m => ({
          file: path.relative(this.cwd, m.file),
          line: m.line,
          content: m.content,
        })),
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 搜索文件内容（递归）
   *
   * @param dir - 搜索目录
   * @param args - 搜索参数
   * @returns Promise<GrepMatch[]> 匹配结果
   */
  private async searchContent(dir: string, args: GrepArgs): Promise<GrepMatch[]> {
    const results: GrepMatch[] = []

    try {
      // 一次拿到目录内所有条目及其类型，避免逐条 stat 探测
      const entries = await this.fs.readDirectoryWithTypes(dir)

      // 分离出「要搜的文件」和「要递归的子目录」
      const files: string[] = []
      const dirs: string[] = []
      for (const entry of entries) {
        if (this.shouldIgnore(entry.name)) {
          continue
        }
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory) {
          dirs.push(fullPath)
        } else if (entry.isFile) {
          // 关键：先按 file_pattern 过滤，再决定是否读取，
          // 避免把不匹配的文件（如 *.png/*.lock）全读进内存再丢弃
          if (args.file_pattern && !this.matchFilePattern(entry.name, args.file_pattern)) {
            continue
          }
          files.push(fullPath)
        }
      }

      // 并发读取并搜索本层文件
      const fileMatchLists = await mapLimit(files, this.CONCURRENCY, async filePath => {
        try {
          const content = await this.fs.readFile(filePath)
          return this.searchInFile(filePath, content, args)
        } catch {
          // 无法读取（权限/二进制等），跳过
          return []
        }
      })
      for (const list of fileMatchLists) {
        results.push(...list)
        if (results.length >= this.MAX_RESULTS) {
          return results.slice(0, this.MAX_RESULTS)
        }
      }

      // 并发递归子目录
      const subLists = await mapLimit(dirs, this.CONCURRENCY, subDir =>
        this.searchContent(subDir, args)
      )
      for (const list of subLists) {
        results.push(...list)
        if (results.length >= this.MAX_RESULTS) {
          return results.slice(0, this.MAX_RESULTS)
        }
      }

      return results.slice(0, this.MAX_RESULTS)
    } catch {
      return results
    }
  }

  /**
   * 在单个文件中搜索
   *
   * @param filePath - 文件路径
   * @param content - 文件内容
   * @param args - 搜索参数
   * @returns GrepMatch[] 匹配结果
   */
  private searchInFile(filePath: string, content: string, args: GrepArgs): GrepMatch[] {
    const matches: GrepMatch[] = []
    const lines = content.split('\n')

    // 创建正则表达式：不带 g 标志。
    // 之前用 g 标志复用同一个正则反复 .test()，会因 lastIndex 记忆状态导致隔行漏匹配
    // （匹配成功后 lastIndex 前移，下一行从该位置起测，短行就被跳过）。
    // 这里按行匹配，无需全局标志，去掉 g 即可保证每行独立判断。
    const flags = args.case_sensitive === false ? 'i' : ''
    const regex = new RegExp(args.pattern, flags)

    // 搜索每一行
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (regex.test(line)) {
        const match: GrepMatch = {
          file: filePath,
          line: i + 1,  // 行号从 1 开始
          content: line.trim(),
        }

        // 添加上下文
        if (args.context && args.context > 0) {
          match.context = {
            before: this.getContextLines(lines, i, -args.context),
            after: this.getContextLines(lines, i, args.context),
          }
        }

        matches.push(match)
      }
    }

    return matches
  }

  /**
   * 获取上下文行
   *
   * @param lines - 所有行
   * @param index - 当前行索引
   * @param count - 上下文行数（正数：之后，负数：之前）
   * @returns string[] 上下文行
   */
  private getContextLines(lines: string[], index: number, count: number): string[] {
    const start = count < 0 ? Math.max(0, index + count) : index + 1
    const end = count < 0 ? index : Math.min(lines.length, index + count + 1)

    return lines.slice(start, end).map(l => l.trim())
  }

  /**
   * 格式化匹配结果
   *
   * @param matches - 匹配结果
   * @param pattern - 搜索模式
   * @returns string 格式化后的消息
   */
  private formatMatches(matches: GrepMatch[], pattern: string): string {
    const lines: string[] = [
      `找到 ${matches.length} 处匹配 "${pattern}" 的内容：\n`,
    ]

    for (const match of matches) {
      const relativePath = path.relative(this.cwd, match.file)
      lines.push(`${relativePath}:${match.line}`)
      lines.push(`  ${match.content}`)
    }

    if (matches.length >= this.MAX_RESULTS) {
      lines.push(`\n(已达到最大结果数 ${this.MAX_RESULTS}，可能还有更多匹配)`)
    }

    return lines.join('\n')
  }

  /**
   * 匹配文件过滤模式
   *
   * @param filename - 文件名
   * @param pattern - 过滤模式
   * @returns boolean 是否匹配
   */
  private matchFilePattern(filename: string, pattern: string): boolean {
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
   * 是否应该忽略此目录/文件
   *
   * @param name - 文件或目录名
   * @returns boolean 是否忽略
   */
  private shouldIgnore(name: string): boolean {
    const ignoreList = [
      'node_modules',
      '.git',
      '.vscode',
      'dist',
      'out',
      'build',
      '.DS_Store',
      'coverage',
      '.next',
      '.cache',
    ]

    return ignoreList.includes(name)
  }
}
