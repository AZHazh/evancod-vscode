/**
 * BashTool - 命令执行工具
 *
 * 职责：
 * 1. 在工作目录中执行 Shell 命令
 * 2. 流式捕获 stdout/stderr
 * 3. 支持超时、取消和后台执行
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'

/**
 * BashTool 参数
 */
interface BashArgs {
  /** 要执行的命令 */
  command: string

  /** 命令描述 */
  description?: string

  /** 是否后台运行 */
  run_in_background?: boolean

  /** 超时时间（毫秒），默认 30000 */
  timeout?: number
}

export type BashStatus = 'running' | 'completed' | 'error' | 'timeout' | 'cancelled'

type BashStream = 'stdout' | 'stderr'

export interface BashExecutionContext {
  toolUseId: string
  onOutput?: (event: { toolUseId: string; taskId?: string; stream: BashStream; text: string }) => void
  onStatus?: (event: { toolUseId: string; taskId?: string; status: BashStatus; exitCode?: number | null }) => void
}

interface RunningProcess {
  process: ChildProcessWithoutNullStreams
  toolUseId: string
  taskId?: string
  timeoutId?: NodeJS.Timeout
  cancelled: boolean
}

/**
 * BashTool 实现
 */
export class BashTool extends Tool {
  /** 工具名称 */
  readonly name = 'bash'

  /** 工具描述 */
  readonly description = '在终端中执行 Shell 命令。可以运行构建、测试、Git 操作等。命令在项目根目录执行。实时返回命令输出，支持超时、取消和后台执行。'

  /** 默认超时时间（毫秒） */
  private readonly DEFAULT_TIMEOUT = 30000

  /** 最大超时时间（毫秒） */
  private readonly MAX_TIMEOUT = 120000

  /** 危险命令列表（禁止执行） */
  private readonly DANGEROUS_COMMANDS = [
    'rm -rf /',
    'rm -rf ~',
    'mkfs',
    'dd if=',
    ':(){:|:&};:',
    'chmod -R 777 /',
    'chown -R',
  ]

  private readonly running = new Map<string, RunningProcess>()

  /**
   * 构造函数
   *
   * @param cwd - 工作目录
   */
  constructor(private cwd: string) {
    super()
  }

  /** 获取工具定义 */
  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的 Shell 命令。例如：npm test, git status, ls -la',
          },
          description: {
            type: 'string',
            description: '命令用途说明，展示给用户确认和查看',
          },
          run_in_background: {
            type: 'boolean',
            description: '是否在后台运行长时间命令。后台运行会立即返回 taskId，输出继续显示在 UI 中',
          },
          timeout: {
            type: 'number',
            description: `超时时间（毫秒），默认 ${this.DEFAULT_TIMEOUT}，最大 ${this.MAX_TIMEOUT}`,
          },
        },
        required: ['command'],
      },
    }
  }

  /** 执行 Shell 命令 */
  async execute(args: BashArgs, context?: BashExecutionContext): Promise<ToolResult> {
    try {
      if (!args.command) {
        return this.createErrorResult('参数 command 不能为空')
      }

      if (!this.checkCommandSafety(args.command)) {
        return this.createErrorResult('安全错误：禁止执行潜在危险的命令')
      }

      const timeout = Math.min(args.timeout || this.DEFAULT_TIMEOUT, this.MAX_TIMEOUT)
      const toolUseId = context?.toolUseId || this.generateId()
      const taskId = args.run_in_background ? this.generateId() : undefined
      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      let timedOut = false

      const child = spawn(args.command, {
        cwd: this.cwd,
        shell: true,
        env: {
          ...process.env,
          LANG: 'en_US.UTF-8',
        },
      })

      const runningProcess: RunningProcess = {
        process: child,
        toolUseId,
        taskId,
        cancelled: false,
      }
      this.running.set(toolUseId, runningProcess)
      if (taskId) this.running.set(taskId, runningProcess)

      const emitStatus = (status: BashStatus, exitCode?: number | null) => {
        context?.onStatus?.({ toolUseId, taskId, status, exitCode })
      }

      emitStatus('running', null)

      child.stdout.on('data', data => {
        const text = data.toString()
        stdoutChunks.push(text)
        context?.onOutput?.({ toolUseId, taskId, stream: 'stdout', text })
      })

      child.stderr.on('data', data => {
        const text = data.toString()
        stderrChunks.push(text)
        context?.onOutput?.({ toolUseId, taskId, stream: 'stderr', text })
      })

      runningProcess.timeoutId = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeout)

      const completion = new Promise<ToolResult>(resolve => {
        child.on('error', error => {
          this.cleanupProcess(toolUseId, taskId)
          emitStatus('error', 1)
          resolve(this.createErrorResult(error))
        })

        child.on('close', code => {
          this.cleanupProcess(toolUseId, taskId)
          const stdout = stdoutChunks.join('')
          const stderr = stderrChunks.join('')
          const exitCode = typeof code === 'number' ? code : 1
          const cancelled = runningProcess.cancelled
          const status: BashStatus = cancelled ? 'cancelled' : timedOut ? 'timeout' : exitCode === 0 ? 'completed' : 'error'
          emitStatus(status, exitCode)
          resolve(this.buildResult(args, stdout, stderr, exitCode, status, taskId))
        })
      })

      if (args.run_in_background) {
        void completion
        return this.createSuccessResult(`命令已在后台运行（taskId: ${taskId}）`, {
          command: args.command,
          description: args.description,
          exitCode: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          cancelled: false,
          taskId,
          runInBackground: true,
        })
      }

      return await completion
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  cancel(toolUseId: string, taskId?: string): boolean {
    const runningProcess = this.running.get(taskId || toolUseId) || this.running.get(toolUseId)
    if (!runningProcess) return false
    runningProcess.cancelled = true
    runningProcess.process.kill('SIGTERM')
    return true
  }

  cancelAll(): void {
    const processes = new Set(this.running.values())
    for (const runningProcess of processes) {
      runningProcess.cancelled = true
      runningProcess.process.kill('SIGTERM')
    }
  }

  private buildResult(args: BashArgs, stdout: string, stderr: string, exitCode: number, status: BashStatus, taskId?: string): ToolResult {
    const sections: string[] = []
    if (stdout) sections.push(stdout)
    if (stderr) sections.push(`${stdout ? '\n' : ''}[stderr]\n${stderr}`)

    let content = sections.join('') || '命令执行成功（无输出）'
    if (status === 'timeout') content = `命令执行超时\n${content}`
    if (status === 'cancelled') content = `命令已取消\n${content}`
    if (status === 'error') content = `命令执行失败（退出码 ${exitCode}）\n\n${content}`

    return {
      success: status === 'completed',
      content,
      error: status === 'completed' ? undefined : content,
      metadata: {
        command: args.command,
        description: args.description,
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut: status === 'timeout',
        cancelled: status === 'cancelled',
        taskId,
        runInBackground: !!args.run_in_background,
      },
    }
  }

  private cleanupProcess(toolUseId: string, taskId?: string) {
    const runningProcess = this.running.get(toolUseId)
    if (runningProcess?.timeoutId) clearTimeout(runningProcess.timeoutId)
    this.running.delete(toolUseId)
    if (taskId) this.running.delete(taskId)
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }

  /**
   * 检查命令安全性
   * 防止执行危险命令
   *
   * @param command - 要检查的命令
   * @returns boolean 是否安全
   */
  private checkCommandSafety(command: string): boolean {
    const lowerCommand = command.toLowerCase()

    for (const dangerous of this.DANGEROUS_COMMANDS) {
      if (lowerCommand.includes(dangerous.toLowerCase())) {
        return false
      }
    }

    const dangerousPatterns = [
      /rm\s+(-[rf]+\s+)?\/($|\s)/,
      /rm\s+(-[rf]+\s+)?~($|\s)/,
      /rm\s+(-[rf]+\s+)?\*($|\s)/,
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return false
      }
    }

    return true
  }
}
