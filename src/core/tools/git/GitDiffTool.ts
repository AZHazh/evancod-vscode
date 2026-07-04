/**
 * GitDiffTool - Git 差异查看工具
 *
 * 职责：
 * 1. 查看文件的修改差异
 * 2. 比较工作区和暂存区
 * 3. 比较暂存区和最新提交
 * 4. 比较不同提交之间的差异
 *
 * 使用场景：
 * - 查看文件修改内容
 * - 了解具体改动
 * - 代码审查
 *
 * 示例：
 * User: "查看 src/index.ts 的改动"
 * AI: 调用 git_diff(path="src/index.ts")
 * Tool: 执行 git diff 并返回差异
 * AI: 总结改动内容
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { promisify } from 'util'
import { exec } from 'child_process'

const execAsync = promisify(exec)

/**
 * GitDiffTool 参数
 */
interface GitDiffArgs {
  /**
   * 文件路径（可选）
   * 不指定则查看所有文件
   */
  path?: string

  /**
   * 比较类型（可选）
   * - working: 工作区 vs 暂存区（默认）
   * - staged: 暂存区 vs HEAD
   * - commit: 两个提交之间
   */
  type?: 'working' | 'staged' | 'commit'

  /**
   * 起始提交（type=commit 时）
   */
  from_commit?: string

  /**
   * 结束提交（type=commit 时）
   */
  to_commit?: string

  /**
   * 是否只显示统计信息（可选）
   * 默认：false
   */
  stat_only?: boolean
}

/**
 * GitDiffTool 实现
 */
export class GitDiffTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'git_diff'

  /**
   * 工具描述
   */
  readonly description = '查看 Git 文件差异。可以比较工作区、暂存区、不同提交之间的差异。支持单个文件或所有文件。用于查看修改内容、代码审查。'

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
          path: {
            type: 'string',
            description: '文件路径（可选，不指定则查看所有文件）',
          },
          type: {
            type: 'string',
            description:
              '比较类型：working（工作区 vs 暂存区）、staged（暂存区 vs HEAD）、commit（两个提交）',
          },
          from_commit: {
            type: 'string',
            description: '起始提交（type=commit 时必填）',
          },
          to_commit: {
            type: 'string',
            description: '结束提交（type=commit 时必填）',
          },
          stat_only: {
            type: 'boolean',
            description: '是否只显示统计信息（默认 false）',
          },
        },
        required: [],
      },
    }
  }

  /**
   * 执行 Git 差异查询
   *
   * @param args - 工具参数
   * @returns Promise<ToolResult> 执行结果
   */
  async execute(args: GitDiffArgs): Promise<ToolResult> {
    try {
      // 检查是否为 Git 仓库
      try {
        await execAsync('git rev-parse --git-dir', { cwd: this.cwd })
      } catch {
        return this.createErrorResult('当前目录不是 Git 仓库')
      }

      // 构建 git diff 命令
      const command = this.buildDiffCommand(args)

      // 执行命令
      const { stdout } = await execAsync(command, {
        cwd: this.cwd,
        maxBuffer: 1024 * 1024 * 10, // 10MB
      })

      // 如果没有差异
      if (!stdout.trim()) {
        return this.createSuccessResult('没有差异', {
          hasDiff: false,
        })
      }

      // 格式化输出
      const message = this.formatDiff(stdout, args.stat_only || false)

      return this.createSuccessResult(message, {
        hasDiff: true,
        type: args.type || 'working',
        path: args.path,
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 构建 git diff 命令
   */
  private buildDiffCommand(args: GitDiffArgs): string {
    let command = 'git diff'

    // 添加选项
    if (args.stat_only) {
      command += ' --stat'
    }

    // 根据类型添加参数
    switch (args.type) {
      case 'staged':
        // 暂存区 vs HEAD
        command += ' --staged'
        break

      case 'commit':
        // 两个提交之间
        if (!args.from_commit || !args.to_commit) {
          throw new Error('type=commit 时需要提供 from_commit 和 to_commit')
        }
        command += ` ${args.from_commit} ${args.to_commit}`
        break

      case 'working':
      default:
        // 工作区 vs 暂存区（默认）
        break
    }

    // 添加文件路径
    if (args.path) {
      command += ` -- ${args.path}`
    }

    return command
  }

  /**
   * 格式化差异输出
   */
  private formatDiff(diff: string, statOnly: boolean): string {
    if (statOnly) {
      // 统计信息格式化
      return `文件变更统计:\n\n${diff}`
    }

    // 完整差异
    // 限制输出长度（避免过长）
    const lines = diff.split('\n')
    if (lines.length > 100) {
      const truncated = lines.slice(0, 100).join('\n')
      return `${truncated}\n\n... (显示前 100 行，共 ${lines.length} 行)`
    }

    return diff
  }
}
