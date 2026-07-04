/**
 * GitBranchTool - Git 分支管理工具
 *
 * 职责：
 * 1. 列出所有分支
 * 2. 创建新分支
 * 3. 切换分支
 * 4. 删除分支
 *
 * 使用场景：
 * - 查看分支列表
 * - 创建功能分支
 * - 切换到其他分支
 * - 清理旧分支
 *
 * 示例：
 * User: "查看所有分支"
 * AI: 调用 git_branch(action="list")
 * Tool: 执行 git branch 并返回列表
 * AI: 展示分支信息
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { promisify } from 'util'
import { exec } from 'child_process'

const execAsync = promisify(exec)

/**
 * GitBranchTool 参数
 */
interface GitBranchArgs {
  /**
   * 操作类型
   */
  action: 'list' | 'create' | 'switch' | 'delete'

  /**
   * 分支名称（create/switch/delete 时必填）
   */
  name?: string

  /**
   * 是否包含远程分支（list 时）
   * 默认：false
   */
  include_remote?: boolean

  /**
   * 是否强制删除（delete 时）
   * 默认：false
   */
  force?: boolean
}

/**
 * 分支信息
 */
interface BranchInfo {
  /**
   * 分支名称
   */
  name: string

  /**
   * 是否为当前分支
   */
  current: boolean

  /**
   * 是否为远程分支
   */
  remote: boolean
}

/**
 * GitBranchTool 实现
 */
export class GitBranchTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'git_branch'

  /**
   * 工具描述
   */
  readonly description = 'Git 分支管理工具。支持列出、创建、切换、删除分支。用于管理功能分支、切换工作环境。'

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
          action: {
            type: 'string',
            description: '操作类型：list（列出）、create（创建）、switch（切换）、delete（删除）',
          },
          name: {
            type: 'string',
            description: '分支名称（create/switch/delete 时必填）',
          },
          include_remote: {
            type: 'boolean',
            description: '是否包含远程分支（list 时，默认 false）',
          },
          force: {
            type: 'boolean',
            description: '是否强制删除（delete 时，默认 false）',
          },
        },
        required: ['action'],
      },
    }
  }

  /**
   * 执行分支操作
   */
  async execute(args: GitBranchArgs): Promise<ToolResult> {
    try {
      // 检查是否为 Git 仓库
      try {
        await execAsync('git rev-parse --git-dir', { cwd: this.cwd })
      } catch {
        return this.createErrorResult('当前目录不是 Git 仓库')
      }

      // 根据操作类型执行
      switch (args.action) {
        case 'list':
          return await this.listBranches(args.include_remote || false)

        case 'create':
          if (!args.name) {
            return this.createErrorResult('action=create 时需要提供 name 参数')
          }
          return await this.createBranch(args.name)

        case 'switch':
          if (!args.name) {
            return this.createErrorResult('action=switch 时需要提供 name 参数')
          }
          return await this.switchBranch(args.name)

        case 'delete':
          if (!args.name) {
            return this.createErrorResult('action=delete 时需要提供 name 参数')
          }
          return await this.deleteBranch(args.name, args.force || false)

        default:
          return this.createErrorResult(`未知的操作类型: ${args.action}`)
      }
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 列出分支
   */
  private async listBranches(includeRemote: boolean): Promise<ToolResult> {
    const command = includeRemote ? 'git branch -a' : 'git branch'

    const { stdout } = await execAsync(command, { cwd: this.cwd })

    const branches = this.parseBranchList(stdout)

    const message = this.formatBranchList(branches)

    return this.createSuccessResult(message, {
      count: branches.length,
      current: branches.find(b => b.current)?.name,
      branches,
    })
  }

  /**
   * 创建分支
   */
  private async createBranch(name: string): Promise<ToolResult> {
    await execAsync(`git branch ${name}`, { cwd: this.cwd })

    return this.createSuccessResult(`分支已创建: ${name}`, {
      branch: name,
      action: 'created',
    })
  }

  /**
   * 切换分支
   */
  private async switchBranch(name: string): Promise<ToolResult> {
    await execAsync(`git checkout ${name}`, { cwd: this.cwd })

    return this.createSuccessResult(`已切换到分支: ${name}`, {
      branch: name,
      action: 'switched',
    })
  }

  /**
   * 删除分支
   */
  private async deleteBranch(name: string, force: boolean): Promise<ToolResult> {
    const flag = force ? '-D' : '-d'
    await execAsync(`git branch ${flag} ${name}`, { cwd: this.cwd })

    return this.createSuccessResult(`分支已删除: ${name}`, {
      branch: name,
      action: 'deleted',
    })
  }

  /**
   * 解析分支列表
   */
  private parseBranchList(output: string): BranchInfo[] {
    const branches: BranchInfo[] = []
    const lines = output.split('\n').filter(line => line.trim())

    for (const line of lines) {
      const trimmed = line.trim()
      const current = trimmed.startsWith('*')
      const remote = trimmed.includes('remotes/')

      let name = trimmed
        .replace('*', '')
        .replace('remotes/', '')
        .trim()

      branches.push({
        name,
        current,
        remote,
      })
    }

    return branches
  }

  /**
   * 格式化分支列表
   */
  private formatBranchList(branches: BranchInfo[]): string {
    const lines: string[] = [`分支列表 (${branches.length} 个):\n`]

    const local = branches.filter(b => !b.remote)
    const remote = branches.filter(b => b.remote)

    if (local.length > 0) {
      lines.push('本地分支:')
      local.forEach(b => {
        const marker = b.current ? '* ' : '  '
        lines.push(`${marker}${b.name}${b.current ? ' (当前)' : ''}`)
      })
    }

    if (remote.length > 0) {
      lines.push('\n远程分支:')
      remote.forEach(b => {
        lines.push(`  ${b.name}`)
      })
    }

    return lines.join('\n')
  }
}
