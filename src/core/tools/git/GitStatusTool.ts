/**
 * GitStatusTool - Git 状态查看工具
 *
 * 职责：
 * 1. 查看当前 Git 仓库状态
 * 2. 显示已修改、已暂存、未跟踪的文件
 * 3. 显示当前分支信息
 *
 * 使用场景：
 * - 查看工作区状态
 * - 了解哪些文件被修改
 * - 准备提交前检查
 *
 * 示例：
 * User: "查看 Git 状态"
 * AI: 调用 git_status()
 * Tool: 执行 git status 并解析输出
 * AI: 总结状态信息
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { promisify } from 'util'
import { exec } from 'child_process'

const execAsync = promisify(exec)

/**
 * GitStatusTool 参数
 */
interface GitStatusArgs {
  /**
   * 是否显示简洁信息（可选）
   * 默认：false
   */
  short?: boolean

  /**
   * 是否包含未跟踪的文件（可选）
   * 默认：true
   */
  include_untracked?: boolean
}

/**
 * Git 文件状态
 */
interface FileStatus {
  /**
   * 文件路径
   */
  path: string

  /**
   * 状态类型
   */
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'staged'

  /**
   * 状态标识（M, A, D, R, ??）
   */
  statusCode: string
}

/**
 * GitStatusTool 实现
 */
export class GitStatusTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'git_status'

  /**
   * 工具描述
   */
  readonly description = '查看 Git 仓库状态。显示当前分支、已修改文件、已暂存文件、未跟踪文件等。用于了解工作区状态、准备提交。'

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
          short: {
            type: 'boolean',
            description: '是否显示简洁信息（默认 false）',
          },
          include_untracked: {
            type: 'boolean',
            description: '是否包含未跟踪的文件（默认 true）',
          },
        },
        required: [],
      },
    }
  }

  /**
   * 执行 Git 状态查询
   *
   * 流程：
   * 1. 检查是否为 Git 仓库
   * 2. 获取当前分支
   * 3. 执行 git status --porcelain
   * 4. 解析输出
   * 5. 分类文件状态
   * 6. 返回结果
   *
   * @param args - 工具参数
   * @returns Promise<ToolResult> 执行结果
   */
  async execute(args: GitStatusArgs): Promise<ToolResult> {
    try {
      // 1. 检查是否为 Git 仓库
      try {
        await execAsync('git rev-parse --git-dir', { cwd: this.cwd })
      } catch {
        return this.createErrorResult('当前目录不是 Git 仓库')
      }

      // 2. 获取当前分支
      const { stdout: branchOutput } = await execAsync(
        'git branch --show-current',
        { cwd: this.cwd }
      )
      const currentBranch = branchOutput.trim() || 'HEAD detached'

      // 3. 执行 git status --porcelain
      const { stdout } = await execAsync('git status --porcelain', {
        cwd: this.cwd,
      })

      // 4. 解析输出
      const files = this.parseGitStatus(stdout, args.include_untracked !== false)

      // 5. 分类文件
      const staged = files.filter(f => f.status === 'staged')
      const modified = files.filter(f => f.status === 'modified')
      const untracked = files.filter(f => f.status === 'untracked')
      const deleted = files.filter(f => f.status === 'deleted')

      // 6. 格式化结果
      const message = this.formatGitStatus(
        currentBranch,
        { staged, modified, untracked, deleted },
        args.short || false
      )

      return this.createSuccessResult(message, {
        branch: currentBranch,
        staged: staged.length,
        modified: modified.length,
        untracked: untracked.length,
        deleted: deleted.length,
        files,
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 解析 git status --porcelain 输出
   *
   * 格式说明：
   * - M  file.txt  : 已修改（工作区）
   * - A  file.txt  : 已添加（暂存区）
   * - D  file.txt  : 已删除
   * - ?? file.txt  : 未跟踪
   *
   * @param output - git status 输出
   * @param includeUntracked - 是否包含未跟踪文件
   * @returns FileStatus[] 文件状态列表
   */
  private parseGitStatus(output: string, includeUntracked: boolean): FileStatus[] {
    const files: FileStatus[] = []

    if (!output.trim()) {
      return files
    }

    const lines = output.split('\n').filter(line => line.trim())

    for (const line of lines) {
      // 状态码是前两个字符
      const statusCode = line.substring(0, 2)
      const path = line.substring(3).trim()

      // 跳过未跟踪文件（如果不包含）
      if (!includeUntracked && statusCode === '??') {
        continue
      }

      // 解析状态
      let status: FileStatus['status']

      if (statusCode === '??') {
        status = 'untracked'
      } else if (statusCode[0] === 'M' || statusCode[1] === 'M') {
        status = statusCode[0] === 'M' ? 'staged' : 'modified'
      } else if (statusCode[0] === 'A') {
        status = 'added'
      } else if (statusCode[0] === 'D' || statusCode[1] === 'D') {
        status = 'deleted'
      } else if (statusCode[0] === 'R') {
        status = 'renamed'
      } else {
        status = 'modified'
      }

      files.push({
        path,
        status,
        statusCode,
      })
    }

    return files
  }

  /**
   * 格式化 Git 状态信息
   */
  private formatGitStatus(
    branch: string,
    files: {
      staged: FileStatus[]
      modified: FileStatus[]
      untracked: FileStatus[]
      deleted: FileStatus[]
    },
    short: boolean
  ): string {
    const lines: string[] = []

    lines.push(`当前分支: ${branch}`)
    lines.push('')

    const total =
      files.staged.length +
      files.modified.length +
      files.untracked.length +
      files.deleted.length

    if (total === 0) {
      lines.push('工作区干净，没有需要提交的更改')
      return lines.join('\n')
    }

    lines.push(`总计: ${total} 个文件有变更`)

    // 已暂存的文件
    if (files.staged.length > 0) {
      lines.push(`\n已暂存的更改 (${files.staged.length}):`)
      files.staged.forEach(f => {
        lines.push(`  ✓ ${f.path}`)
      })
    }

    // 已修改但未暂存
    if (files.modified.length > 0) {
      lines.push(`\n已修改但未暂存 (${files.modified.length}):`)
      files.modified.forEach(f => {
        lines.push(`  M ${f.path}`)
      })
    }

    // 未跟踪的文件
    if (files.untracked.length > 0) {
      lines.push(`\n未跟踪的文件 (${files.untracked.length}):`)
      if (short && files.untracked.length > 5) {
        files.untracked.slice(0, 5).forEach(f => {
          lines.push(`  ? ${f.path}`)
        })
        lines.push(`  ... 还有 ${files.untracked.length - 5} 个文件`)
      } else {
        files.untracked.forEach(f => {
          lines.push(`  ? ${f.path}`)
        })
      }
    }

    // 已删除的文件
    if (files.deleted.length > 0) {
      lines.push(`\n已删除的文件 (${files.deleted.length}):`)
      files.deleted.forEach(f => {
        lines.push(`  D ${f.path}`)
      })
    }

    return lines.join('\n')
  }
}
