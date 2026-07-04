/**
 * GitLogTool - Git 提交历史查看工具
 *
 * 职责：
 * 1. 查看提交历史
 * 2. 过滤特定作者或日期的提交
 * 3. 查看指定文件的历史
 *
 * 使用场景：
 * - 查看最近提交
 * - 了解开发历史
 * - 追踪文件变更
 * - 查找特定提交
 *
 * 示例：
 * User: "查看最近 10 次提交"
 * AI: 调用 git_log(limit=10)
 * Tool: 执行 git log 并格式化输出
 * AI: 展示提交历史
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { promisify } from 'util'
import { exec } from 'child_process'

const execAsync = promisify(exec)

/**
 * GitLogTool 参数
 */
interface GitLogArgs {
  /**
   * 限制提交数量（可选）
   * 默认：10
   */
  limit?: number

  /**
   * 作者过滤（可选）
   */
  author?: string

  /**
   * 起始日期（可选）
   * 格式：YYYY-MM-DD
   */
  since?: string

  /**
   * 结束日期（可选）
   * 格式：YYYY-MM-DD
   */
  until?: string

  /**
   * 文件路径（可选）
   * 只查看指定文件的历史
   */
  path?: string

  /**
   * 是否显示简洁信息（可选）
   * 默认：false
   */
  oneline?: boolean
}

/**
 * 提交信息
 */
interface CommitInfo {
  /**
   * 提交哈希（短）
   */
  hash: string

  /**
   * 作者
   */
  author: string

  /**
   * 提交日期
   */
  date: string

  /**
   * 提交消息
   */
  message: string
}

/**
 * GitLogTool 实现
 */
export class GitLogTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'git_log'

  /**
   * 工具描述
   */
  readonly description = '查看 Git 提交历史。支持按数量、作者、日期、文件过滤。用于了解开发历史、追踪文件变更、查找特定提交。'

  /**
   * 构造函数
   *
   * @param cwd - 工作目录
   */
  constructor(private cwd: string) {
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
          limit: {
            type: 'number',
            description: '限制提交数量（默认 10）',
          },
          author: {
            type: 'string',
            description: '按作者过滤',
          },
          since: {
            type: 'string',
            description: '起始日期（格式：YYYY-MM-DD）',
          },
          until: {
            type: 'string',
            description: '结束日期（格式：YYYY-MM-DD）',
          },
          path: {
            type: 'string',
            description: '只查看指定文件的历史',
          },
          oneline: {
            type: 'boolean',
            description: '是否显示简洁信息（默认 false）',
          },
        },
        required: [],
      },
    }
  }

  /**
   * 执行 Git 日志查询
   */
  async execute(args: GitLogArgs): Promise<ToolResult> {
    try {
      // 检查是否为 Git 仓库
      try {
        await execAsync('git rev-parse --git-dir', { cwd: this.cwd })
      } catch {
        return this.createErrorResult('当前目录不是 Git 仓库')
      }

      // 构建命令
      const command = this.buildLogCommand(args)

      // 执行命令
      const { stdout } = await execAsync(command, { cwd: this.cwd })

      if (!stdout.trim()) {
        return this.createSuccessResult('没有找到提交记录', {
          commits: [],
        })
      }

      // 解析提交
      const commits = this.parseGitLog(stdout)

      // 格式化输出
      const message = this.formatCommits(commits, args.oneline || false)

      return this.createSuccessResult(message, {
        count: commits.length,
        commits,
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 构建 git log 命令
   */
  private buildLogCommand(args: GitLogArgs): string {
    // 使用格式化输出：hash|author|date|message
    let command = 'git log --pretty=format:"%h|%an|%ad|%s" --date=short'

    // 限制数量
    const limit = args.limit || 10
    command += ` -${limit}`

    // 作者过滤
    if (args.author) {
      command += ` --author="${args.author}"`
    }

    // 日期过滤
    if (args.since) {
      command += ` --since="${args.since}"`
    }

    if (args.until) {
      command += ` --until="${args.until}"`
    }

    // 文件路径
    if (args.path) {
      command += ` -- ${args.path}`
    }

    return command
  }

  /**
   * 解析 git log 输出
   */
  private parseGitLog(output: string): CommitInfo[] {
    const commits: CommitInfo[] = []
    const lines = output.split('\n').filter(line => line.trim())

    for (const line of lines) {
      const parts = line.split('|')
      if (parts.length >= 4) {
        commits.push({
          hash: parts[0],
          author: parts[1],
          date: parts[2],
          message: parts.slice(3).join('|'), // 消息可能包含 |
        })
      }
    }

    return commits
  }

  /**
   * 格式化提交历史
   */
  private formatCommits(commits: CommitInfo[], oneline: boolean): string {
    const lines: string[] = [`提交历史 (${commits.length} 条):\n`]

    commits.forEach((commit, index) => {
      if (oneline) {
        // 简洁模式
        lines.push(`${commit.hash} ${commit.message}`)
      } else {
        // 详细模式
        lines.push(`${index + 1}. ${commit.hash} - ${commit.message}`)
        lines.push(`   作者: ${commit.author}`)
        lines.push(`   日期: ${commit.date}`)
        if (index < commits.length - 1) {
          lines.push('') // 空行分隔
        }
      }
    })

    return lines.join('\n')
  }
}
