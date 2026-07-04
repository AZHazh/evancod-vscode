/**
 * PlanModeManager - 计划模式管理服务
 *
 * 职责：
 * 1. 管理计划模式状态（进入/退出）
 * 2. 创建和管理计划文件
 * 3. 控制计划模式下的工具权限
 * 4. 处理用户审批流程
 *
 * 使用场景：
 * - AI 在执行复杂任务前先制定计划
 * - 用户审批计划后再执行
 * - 防止 AI 在计划阶段执行破坏性操作
 *
 * 设计原则：
 * - 计划模式下只允许读取操作和计划相关工具
 * - 计划文件存储在工作区 .evancod/plans/ 目录
 * - 用户必须明确批准才能退出计划模式并执行
 * - 计划内容包含任务拆解、执行步骤、风险评估
 *
 * 计划模式流程：
 * 1. AI 调用 enter_plan_mode 进入计划模式
 * 2. AI 只能使用读取工具分析代码和文件
 * 3. AI 生成结构化计划并写入计划文件
 * 4. 用户在 Webview 中审批计划
 * 5. 用户批准后，AI 调用 exit_plan_mode 退出计划模式
 * 6. AI 开始执行计划中的任务
 */

import * as vscode from 'vscode'
import * as path from 'path'

// 前向声明，避免循环依赖
interface IWebviewManager {
  sendPlanSubmitted(plan: Plan): void
}

/**
 * 计划模式状态
 */
export type PlanModeState = 'inactive' | 'planning' | 'approved' | 'rejected'

/**
 * 计划数据结构
 */
export interface Plan {
  /** 计划 ID */
  id: string

  /** 计划标题 */
  title: string

  /** 计划描述 */
  description: string

  /** 计划状态 */
  state: PlanModeState

  /** 任务列表 */
  tasks: {
    id: string
    subject: string
    description: string
    estimatedTime?: string
    risks?: string[]
  }[]

  /** 执行步骤 */
  steps: string[]

  /** 风险评估 */
  risks: {
    level: 'low' | 'medium' | 'high'
    description: string
    mitigation: string
  }[]

  /** 创建时间 */
  createdAt: string

  /** 审批时间 */
  approvedAt?: string

  /** 拒绝原因 */
  rejectedReason?: string

  /** 计划文件路径 */
  filePath?: string
}

/**
 * 允许在计划模式下使用的工具
 * 只包含读取和分析工具，不包含修改工具
 */
const PLAN_MODE_ALLOWED_TOOLS = [
  // 文件读取
  'read_file',
  'glob',
  'grep',
  'find',
  'list_directory',

  // 代码分析
  'analyze_ast',
  'analyze_dependencies',

  // Git 查询
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',

  // Task 查询
  'task_list',
  'task_get',

  // 用户交互
  'ask_user_question',

  // Plan Mode 工具
  'enter_plan_mode',
  'exit_plan_mode'
]

export class PlanModeManager {
  /** 当前计划 */
  private currentPlan: Plan | null = null

  /** 计划模式状态 */
  private state: PlanModeState = 'inactive'

  /** 计划文件目录 */
  private plansDir?: string

  /** 审批等待回调 */
  private approvalCallback?: (approved: boolean, reason?: string) => void

  /** Webview 管理器（可选，用于发送消息到 UI） */
  private webviewManager?: IWebviewManager

  /**
   * 构造函数
   *
   * @param context - VSCode Extension Context
   */
  constructor(private context: vscode.ExtensionContext) {
    this.initPlansDirectory()
  }

  /**
   * 设置 Webview 管理器
   * 用于发送消息到 UI
   *
   * @param manager - Webview 管理器实例
   */
  setWebviewManager(manager: IWebviewManager): void {
    this.webviewManager = manager
  }

  /**
   * 初始化计划文件目录
   *
   * 策略：
   * - 如果有工作区，使用 <workspace>/.evancod/plans/
   * - 否则不创建计划文件
   */
  private initPlansDirectory(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders && workspaceFolders.length > 0) {
      const rootPath = workspaceFolders[0].uri.fsPath
      this.plansDir = path.join(rootPath, '.evancod', 'plans')
    }
  }

  /**
   * 进入计划模式
   *
   * @param title - 计划标题
   * @param description - 计划描述
   * @returns 计划对象
   */
  async enterPlanMode(title: string, description: string): Promise<Plan> {
    // 检查是否已在计划模式中
    if (this.state !== 'inactive') {
      throw new Error(
        `Already in plan mode (state: ${this.state}). Please exit current plan first.`
      )
    }

    // 生成计划 ID
    const planId = this.generatePlanId()

    // 创建计划对象
    const plan: Plan = {
      id: planId,
      title,
      description,
      state: 'planning',
      tasks: [],
      steps: [],
      risks: [],
      createdAt: new Date().toISOString()
    }

    // 设置当前计划
    this.currentPlan = plan
    this.state = 'planning'

    return plan
  }

  /**
   * 退出计划模式
   *
   * 注意：此方法只标记为等待审批，真正的退出需要用户批准
   *
   * @param plan - 完整的计划内容
   * @returns 计划对象
   */
  async exitPlanMode(plan: Partial<Plan>): Promise<Plan> {
    // 检查是否在计划模式中
    if (this.state !== 'planning') {
      throw new Error(`Not in planning mode (state: ${this.state})`)
    }

    if (!this.currentPlan) {
      throw new Error('No current plan found')
    }

    // 更新计划内容
    if (plan.tasks) {
      this.currentPlan.tasks = plan.tasks
    }
    if (plan.steps) {
      this.currentPlan.steps = plan.steps
    }
    if (plan.risks) {
      this.currentPlan.risks = plan.risks
    }

    // 保存计划文件
    await this.savePlanFile(this.currentPlan)

    // 发送消息到 Webview
    if (this.webviewManager) {
      this.webviewManager.sendPlanSubmitted(this.currentPlan)
    }

    // 返回计划，等待用户审批
    return this.currentPlan
  }

  /**
   * 用户批准计划
   *
   * @param planId - 计划 ID
   */
  async approvePlan(planId: string): Promise<void> {
    if (!this.currentPlan || this.currentPlan.id !== planId) {
      throw new Error(`Plan not found: ${planId}`)
    }

    // 更新计划状态
    this.currentPlan.state = 'approved'
    this.currentPlan.approvedAt = new Date().toISOString()
    this.state = 'approved'

    // 更新计划文件
    await this.savePlanFile(this.currentPlan)

    // 调用审批回调
    if (this.approvalCallback) {
      this.approvalCallback(true)
      this.approvalCallback = undefined
    }
  }

  /**
   * 用户拒绝计划
   *
   * @param planId - 计划 ID
   * @param reason - 拒绝原因
   */
  async rejectPlan(planId: string, reason: string): Promise<void> {
    if (!this.currentPlan || this.currentPlan.id !== planId) {
      throw new Error(`Plan not found: ${planId}`)
    }

    // 更新计划状态
    this.currentPlan.state = 'rejected'
    this.currentPlan.rejectedReason = reason
    this.state = 'rejected'

    // 更新计划文件
    await this.savePlanFile(this.currentPlan)

    // 调用审批回调
    if (this.approvalCallback) {
      this.approvalCallback(false, reason)
      this.approvalCallback = undefined
    }
  }

  /**
   * 完成计划执行，清除状态
   */
  async completePlan(): Promise<void> {
    this.currentPlan = null
    this.state = 'inactive'
    this.approvalCallback = undefined
  }

  /**
   * 获取当前计划
   *
   * @returns 当前计划，如果没有则返回 null
   */
  getCurrentPlan(): Plan | null {
    return this.currentPlan
  }

  /**
   * 获取当前状态
   *
   * @returns 计划模式状态
   */
  getState(): PlanModeState {
    return this.state
  }

  /**
   * 检查工具是否在计划模式下允许使用
   *
   * @param toolName - 工具名称
   * @returns 是否允许
   */
  isToolAllowedInPlanMode(toolName: string): boolean {
    // 如果不在计划模式，所有工具都允许
    if (this.state === 'inactive' || this.state === 'approved') {
      return true
    }

    // 在计划模式下，只允许特定工具
    return PLAN_MODE_ALLOWED_TOOLS.includes(toolName)
  }

  /**
   * 等待用户审批
   *
   * 此方法会阻塞，直到用户批准或拒绝计划
   *
   * @returns Promise<boolean> - true 表示批准，false 表示拒绝
   */
  async waitForApproval(): Promise<{ approved: boolean; reason?: string }> {
    return new Promise((resolve) => {
      this.approvalCallback = (approved: boolean, reason?: string) => {
        resolve({ approved, reason })
      }
    })
  }

  /**
   * 保存计划文件
   *
   * @param plan - 计划对象
   */
  private async savePlanFile(plan: Plan): Promise<void> {
    if (!this.plansDir) {
      console.warn('No workspace folder, skipping plan file save')
      return
    }

    try {
      // 确保目录存在
      const dirUri = vscode.Uri.file(this.plansDir)
      try {
        await vscode.workspace.fs.stat(dirUri)
      } catch {
        await vscode.workspace.fs.createDirectory(dirUri)
      }

      // 创建计划文件
      const fileName = `${plan.id}.md`
      const filePath = path.join(this.plansDir, fileName)
      const fileUri = vscode.Uri.file(filePath)

      // 格式化计划为 Markdown
      const content = this.formatPlanAsMarkdown(plan)

      // 写入文件
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'))

      // 保存文件路径到计划对象
      plan.filePath = filePath

      console.log(`Plan saved to: ${filePath}`)
    } catch (error) {
      console.error('Failed to save plan file:', error)
    }
  }

  /**
   * 格式化计划为 Markdown
   *
   * @param plan - 计划对象
   * @returns Markdown 内容
   */
  private formatPlanAsMarkdown(plan: Plan): string {
    const lines: string[] = []

    // 标题
    lines.push(`# ${plan.title}`)
    lines.push('')

    // 元数据
    lines.push(`**状态**: ${this.formatState(plan.state)}`)
    lines.push(`**创建时间**: ${plan.createdAt}`)
    if (plan.approvedAt) {
      lines.push(`**批准时间**: ${plan.approvedAt}`)
    }
    if (plan.rejectedReason) {
      lines.push(`**拒绝原因**: ${plan.rejectedReason}`)
    }
    lines.push('')

    // 描述
    lines.push('## 描述')
    lines.push('')
    lines.push(plan.description)
    lines.push('')

    // 任务列表
    if (plan.tasks.length > 0) {
      lines.push('## 任务列表')
      lines.push('')
      plan.tasks.forEach((task, index) => {
        lines.push(`### ${index + 1}. ${task.subject}`)
        lines.push('')
        lines.push(task.description)
        if (task.estimatedTime) {
          lines.push(`- 预估时间: ${task.estimatedTime}`)
        }
        if (task.risks && task.risks.length > 0) {
          lines.push(`- 风险:`)
          task.risks.forEach((risk) => {
            lines.push(`  - ${risk}`)
          })
        }
        lines.push('')
      })
    }

    // 执行步骤
    if (plan.steps.length > 0) {
      lines.push('## 执行步骤')
      lines.push('')
      plan.steps.forEach((step, index) => {
        lines.push(`${index + 1}. ${step}`)
      })
      lines.push('')
    }

    // 风险评估
    if (plan.risks.length > 0) {
      lines.push('## 风险评估')
      lines.push('')
      plan.risks.forEach((risk) => {
        const levelIcon = risk.level === 'high' ? '🔴' : risk.level === 'medium' ? '🟡' : '🟢'
        lines.push(`### ${levelIcon} ${risk.level.toUpperCase()} - ${risk.description}`)
        lines.push('')
        lines.push(`**缓解措施**: ${risk.mitigation}`)
        lines.push('')
      })
    }

    return lines.join('\n')
  }

  /**
   * 格式化状态
   *
   * @param state - 计划状态
   * @returns 友好的状态描述
   */
  private formatState(state: PlanModeState): string {
    const stateMap: Record<PlanModeState, string> = {
      inactive: '未激活',
      planning: '🔄 规划中',
      approved: '✅ 已批准',
      rejected: '❌ 已拒绝'
    }
    return stateMap[state] || state
  }

  /**
   * 生成计划 ID
   *
   * @returns 计划 ID
   */
  private generatePlanId(): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 9)
    return `plan-${timestamp}-${random}`
  }

  /**
   * 销毁服务
   */
  dispose(): void {
    this.currentPlan = null
    this.state = 'inactive'
    this.approvalCallback = undefined
  }
}
