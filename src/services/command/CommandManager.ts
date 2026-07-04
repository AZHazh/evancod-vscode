/**
 * 斜杠命令系统
 *
 * 职责：
 * 1. 解析用户输入的斜杠命令
 * 2. 执行对应的命令处理器
 * 3. 提供命令帮助信息
 *
 * 支持的命令：
 * - /help: 显示帮助信息
 * - /clear: 清空当前会话
 * - /commit: 快速创建 Git 提交
 * - /new: 创建新会话
 * - /history: 查看会话历史
 *
 * 设计理念：
 * - 命令模式（Command Pattern）
 * - 可扩展架构
 * - 统一的命令接口
 *
 * 使用场景：
 * User: "/help"
 * System: 显示所有可用命令
 *
 * User: "/commit feat: 添加新功能"
 * System: 执行 git add, git commit
 */

/**
 * 命令参数
 */
export interface CommandArgs {
  /**
   * 命令名称（不含斜杠）
   */
  command: string

  /**
   * 命令参数
   */
  args: string[]

  /**
   * 原始输入
   */
  raw: string
}

/**
 * 命令执行结果
 */
export interface CommandResult {
  /**
   * 是否成功
   */
  success: boolean

  /**
   * 结果消息
   */
  message: string

  /**
   * 是否需要发送给 AI
   * 某些命令（如 /clear）不需要 AI 处理
   */
  sendToAI?: boolean

  /**
   * 元数据
   */
  metadata?: Record<string, any>
}

/**
 * 命令处理器接口
 */
export interface CommandHandler {
  /**
   * 命令名称
   */
  name: string

  /**
   * 命令描述
   */
  description: string

  /**
   * 使用示例
   */
  usage: string

  /**
   * 执行命令
   *
   * @param args - 命令参数
   * @returns Promise<CommandResult> 执行结果
   */
  execute(args: CommandArgs): Promise<CommandResult>
}

/**
 * 命令管理器
 *
 * 负责注册、查找和执行命令
 */
export class CommandManager {
  /**
   * 注册的命令处理器
   */
  private handlers: Map<string, CommandHandler> = new Map()

  /**
   * 构造函数
   */
  constructor() {
    // 注册内置命令
    this.registerBuiltinCommands()
  }

  /**
   * 注册命令处理器
   *
   * @param handler - 命令处理器
   */
  register(handler: CommandHandler): void {
    this.handlers.set(handler.name, handler)
  }

  /**
   * 解析命令字符串
   *
   * @param input - 用户输入
   * @returns CommandArgs | null 解析后的命令参数
   */
  parse(input: string): CommandArgs | null {
    // 检查是否为斜杠命令
    if (!input.startsWith('/')) {
      return null
    }

    // 移除开头的斜杠
    const content = input.substring(1).trim()

    // 分割命令和参数
    const parts = content.split(/\s+/)
    const command = parts[0]
    const args = parts.slice(1)

    return {
      command,
      args,
      raw: input,
    }
  }

  /**
   * 执行命令
   *
   * @param args - 命令参数
   * @returns Promise<CommandResult> 执行结果
   */
  async execute(args: CommandArgs): Promise<CommandResult> {
    // 查找命令处理器
    const handler = this.handlers.get(args.command)

    if (!handler) {
      return {
        success: false,
        message: `未知命令: /${args.command}\n输入 /help 查看所有可用命令`,
      }
    }

    // 执行命令
    try {
      return await handler.execute(args)
    } catch (error) {
      return {
        success: false,
        message: `命令执行失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }
    }
  }

  /**
   * 获取所有命令
   *
   * @returns CommandHandler[] 命令列表
   */
  getAllCommands(): CommandHandler[] {
    return Array.from(this.handlers.values())
  }

  /**
   * 注册内置命令
   */
  private registerBuiltinCommands(): void {
    // /help 命令
    this.register({
      name: 'help',
      description: '显示所有可用命令',
      usage: '/help',
      execute: async () => {
        const commands = this.getAllCommands()
        const lines = ['可用命令：\n']

        commands.forEach(cmd => {
          lines.push(`/${cmd.name}`)
          lines.push(`  ${cmd.description}`)
          lines.push(`  用法: ${cmd.usage}`)
          lines.push('')
        })

        return {
          success: true,
          message: lines.join('\n'),
          sendToAI: false, // 不需要发送给 AI
        }
      },
    })

    // /clear 命令
    this.register({
      name: 'clear',
      description: '清空当前会话',
      usage: '/clear',
      execute: async () => {
        return {
          success: true,
          message: '会话已清空',
          sendToAI: false,
          metadata: {
            action: 'clear',
          },
        }
      },
    })

    // /new 命令
    this.register({
      name: 'new',
      description: '创建新会话',
      usage: '/new [会话名称]',
      execute: async (args) => {
        const name = args.args.join(' ') || '新会话'

        return {
          success: true,
          message: `已创建新会话: ${name}`,
          sendToAI: false,
          metadata: {
            action: 'new',
            name,
          },
        }
      },
    })

    // /compact 命令
    this.register({
      name: 'compact',
      description: '压缩当前会话上下文',
      usage: '/compact',
      execute: async () => ({
        success: true,
        message: '已压缩当前会话上下文',
        sendToAI: false,
        metadata: {
          action: 'compact',
        },
      }),
    })

    // /commit 命令
    this.register({
      name: 'commit',
      description: '快速创建 Git 提交',
      usage: '/commit <提交消息>',
      execute: async (args) => {
        if (args.args.length === 0) {
          return {
            success: false,
            message: '请提供提交消息\n用法: /commit <提交消息>',
          }
        }

        const message = args.args.join(' ')

        // 构造 AI 指令
        const instruction = `请帮我执行以下操作：
1. 使用 git_status 查看当前状态
2. 使用 bash 工具执行 git add . 添加所有文件
3. 使用 bash 工具执行 git commit -m "${message}" 创建提交
4. 总结提交结果`

        return {
          success: true,
          message: instruction,
          sendToAI: true, // 需要发送给 AI 处理
        }
      },
    })

    // /history 命令
    this.register({
      name: 'history',
      description: '查看 Git 提交历史',
      usage: '/history [数量]',
      execute: async (args) => {
        const limit = args.args[0] ? parseInt(args.args[0]) : 10

        if (isNaN(limit) || limit < 1) {
          return {
            success: false,
            message: '请提供有效的数量\n用法: /history [数量]',
          }
        }

        // 构造 AI 指令
        const instruction = `请使用 git_log 工具查看最近 ${limit} 次提交历史`

        return {
          success: true,
          message: instruction,
          sendToAI: true,
        }
      },
    })
  }
}

/**
 * 全局命令管理器实例
 */
export const commandManager = new CommandManager()
