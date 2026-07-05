/**
 * VSCode Evancod Extension 入口文件
 *
 * 职责：
 * 1. 插件生命周期管理（activate/deactivate）
 * 2. 服务初始化和依赖注入
 * 3. 命令注册
 * 4. 资源清理
 *
 * 设计模式：依赖注入 + 服务定位器
 */

import * as vscode from 'vscode'
import { ChatService } from './services/chat/ChatService'
import { WebviewManager } from './services/webview/WebviewManager'
import { ProviderService } from './services/provider/ProviderService'
import { StatusBarService } from './services/ui/StatusBarService'
import { TaskManager } from './services/task/TaskManager'
import { PlanModeManager } from './services/plan/PlanModeManager'
import { AgentCoordinator } from './services/agent/AgentCoordinator'
import { MCPConnectionManager } from './services/mcp/MCPConnectionManager'
import { SkillManager } from './services/skill/SkillManager'
import { MemoryManager } from './services/memory/MemoryManager'

// 使用模块级变量（而非全局变量）保存服务实例
// 这样可以保证作用域隔离，且通过 ExtensionContext 管理生命周期
let chatService: ChatService
let webviewManager: WebviewManager
let providerService: ProviderService
let statusBarService: StatusBarService
let taskManager: TaskManager
let planModeManager: PlanModeManager
let agentCoordinator: AgentCoordinator
let mcpManager: MCPConnectionManager
let skillManager: SkillManager
let memoryManager: MemoryManager

/**
 * 插件激活入口
 * VSCode 会在以下情况调用此函数：
 * - 用户执行插件命令
 * - 满足 activationEvents 条件（onStartupFinished）
 *
 * @param context - VSCode 扩展上下文，用于注册资源和订阅事件
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log('Evancod extension is now active!')

  /**
   * 先注册命令，再初始化服务。
   * 如果服务初始化失败，命令仍然存在，并会提示具体错误，而不是 command not found。
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('evancod.openChat', () => {
      if (!webviewManager) {
        vscode.window.showErrorMessage('Evancod 尚未初始化完成，请查看 Debug Console 中的错误。')
        return
      }
      webviewManager.show()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('evancod.newSession', async () => {
      if (!chatService || !webviewManager) {
        vscode.window.showErrorMessage('Evancod 尚未初始化完成，请查看 Debug Console 中的错误。')
        return
      }
      await chatService.createNewSession()
      webviewManager.show()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('evancod.syncNewApi', () => {
      if (!webviewManager) {
        vscode.window.showErrorMessage('Evancod 尚未初始化完成，请查看 Debug Console 中的错误。')
        return
      }
      webviewManager.startNewApiSync()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('evancod.pickFiles', async () => {
      console.log('[Extension] evancod.pickFiles command called')

      try {
        console.log('[Extension] Calling showOpenDialog...')
        const files = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: true,
          canSelectMany: true,
          openLabel: '添加到上下文',
          title: '选择要添加到 Evancod 上下文的文件或图片',
          defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        })

        console.log('[Extension] showOpenDialog returned:', files)

        if (webviewManager && files?.length) {
          webviewManager.handlePickedFiles(files)
        } else {
          console.log('[Extension] No files selected or webviewManager not available')
        }
      } catch (error) {
        console.error('[Extension] Error in pickFiles:', error)
        vscode.window.showErrorMessage(`文件选择失败: ${error}`)
      }
    })
  )

  try {
    // 初始化 Provider 服务（从 ~/.claude/cc-evancod/providers.json 加载配置）
    providerService = new ProviderService(context)
    await providerService.initialize()

    // 初始化 Task 管理服务
    taskManager = new TaskManager(context)
    await taskManager.load()

    // 初始化 Plan Mode 管理服务
    planModeManager = new PlanModeManager(context)

    // 初始化 Agent 协调器
    agentCoordinator = new AgentCoordinator(context)

    // 初始化 MCP 连接管理器
    mcpManager = new MCPConnectionManager(context)
    await mcpManager.initialize()

    // 初始化 Skill 管理器
    skillManager = new SkillManager(context)
    await skillManager.initialize()

    // 初始化 Memory 管理器
    memoryManager = new MemoryManager(context)
    await memoryManager.initialize()

    // 初始化聊天服务（传入所有服务）
    chatService = new ChatService(
      context,
      providerService,
      taskManager,
      planModeManager,
      agentCoordinator,
      mcpManager,
      skillManager,
      memoryManager
    )
    await chatService.initialize()

    // 初始化 Webview 管理器（传入所有需要的服务）
    webviewManager = new WebviewManager(
      context,
      chatService,
      providerService,
      taskManager,
      planModeManager,
      agentCoordinator
    )

    // 将 WebviewManager 注入到服务中（反向依赖注入）
    taskManager.setWebviewManager(webviewManager)
    planModeManager.setWebviewManager(webviewManager)
    agentCoordinator.setWebviewManager(webviewManager)
    agentCoordinator.setSharedServices({
      taskManager,
      planModeManager,
      mcpManager,
      skillManager,
      memoryManager,
      onTaskListChange: () => taskManager.notifyTaskList(),
      permissionMode: chatService.getRuntimeState().permissionMode,
    })
    await agentCoordinator.restorePersistedTasks()

    // 初始化状态栏服务
    statusBarService = new StatusBarService(context, providerService)
    statusBarService.show()

    console.log('Evancod services initialized')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Evancod initialization failed:', error)
    vscode.window.showErrorMessage(`Evancod 初始化失败：${message}`)
  }
}

/**
 * 插件停用清理
 * VSCode 会在以下情况调用此函数：
 * - 用户禁用插件
 * - VSCode 关闭
 * - 插件重新加载
 *
 * 注意：通过 context.subscriptions 注册的资源会自动清理
 * 这里只需要处理特殊的清理逻辑
 */
export function deactivate() {
  console.log('Evancod extension is deactivated')

  // 清理 TaskManager
  if (taskManager) {
    taskManager.dispose()
  }

  // 清理 PlanModeManager
  if (planModeManager) {
    planModeManager.dispose()
  }

  // 清理 AgentCoordinator
  if (agentCoordinator) {
    agentCoordinator.dispose()
  }

  // 清理 MCPConnectionManager
  if (mcpManager) {
    mcpManager.dispose()
  }

  // 清理 SkillManager
  if (skillManager) {
    skillManager.dispose()
  }

  // 清理 MemoryManager
  if (memoryManager) {
    memoryManager.dispose()
  }

  if (chatService) {
    void chatService.flush()
    chatService.dispose()
  }

  // TODO: 关闭打开的连接
}
