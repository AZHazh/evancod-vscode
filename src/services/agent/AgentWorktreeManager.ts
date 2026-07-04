import { execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as vscode from 'vscode'

const execFileAsync = promisify(execFile)

export interface WorktreeLease {
  repoRoot: string
  worktreePath: string
  branchName: string
}

export class AgentWorktreeManager {
  async prepare(input: { agentId: string; cwd: string }): Promise<WorktreeLease> {
    const repoRoot = await this.getRepoRoot(input.cwd)
    const safeAgentId = this.sanitize(input.agentId)
    const branchName = `evancod/agent-${safeAgentId}`
    const worktreesRoot = path.join(repoRoot, '.evancod', 'worktrees')
    const worktreePath = path.join(worktreesRoot, safeAgentId)

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(worktreesRoot))

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(worktreePath))
      throw new Error(`worktree path already exists: ${worktreePath}`)
    } catch (error) {
      if (error instanceof Error && error.message.includes('worktree path already exists')) {
        throw error
      }
    }

    await this.git(['worktree', 'add', worktreePath, '-b', branchName, 'HEAD'], repoRoot)
    return { repoRoot, worktreePath, branchName }
  }

  async cleanup(lease: WorktreeLease): Promise<string | undefined> {
    const warnings: string[] = []

    try {
      await this.git(['worktree', 'remove', lease.worktreePath, '--force'], lease.repoRoot)
    } catch (error) {
      warnings.push(`Failed to remove worktree ${lease.worktreePath}: ${this.errorMessage(error)}`)
    }

    try {
      await this.git(['branch', '-D', lease.branchName], lease.repoRoot)
    } catch (error) {
      warnings.push(`Failed to delete branch ${lease.branchName}: ${this.errorMessage(error)}`)
    }

    return warnings.length ? warnings.join('\n') : undefined
  }

  private async getRepoRoot(cwd: string): Promise<string> {
    try {
      const { stdout } = await this.git(['rev-parse', '--show-toplevel'], cwd)
      return stdout.trim()
    } catch (error) {
      throw new Error(`isolation=worktree requires cwd to be inside a git repository: ${cwd}. ${this.errorMessage(error)}`)
    }
  }

  private async git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('git', args, { cwd })
  }

  private sanitize(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80)
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return String(error)
  }
}
