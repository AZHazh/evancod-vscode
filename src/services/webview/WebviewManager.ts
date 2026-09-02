/**
 * Webview 管理器 - Webview 生命周期和消息通信
 *
 * 职责：
 * 1. 创建和管理 Webview 视图
 * 2. 加载 HTML 内容（开发/生产模式）
 * 3. 处理 Extension ↔ Webview 消息通信
 * 4. 管理 Webview 生命周期
 *
 * 设计模式：单例模式 + 工厂模式
 * - 只创建一个 Webview 实例（避免资源浪费）
 * - 如果已存在则复用（show）
 * - 保持状态（retainContextWhenHidden: true）
 *
 * 为什么只创建一个 Webview？
 * 1. VSCode Webview 比较重，不适合创建多个
 * 2. 用户一次只能看一个聊天界面
 * 3. 保持状态，避免重新加载
 */

import * as vscode from 'vscode'
import * as path from 'path'
import { execFile } from 'child_process'
import { ChatService } from '../chat/ChatService'
import { ProviderService } from '../provider/ProviderService'
import { TaskManager } from '../task/TaskManager'
import { PlanModeManager } from '../plan/PlanModeManager'
import { AgentCoordinator } from '../agent/AgentCoordinator'
import type { AgentServerEvent } from '../../types/messages'

/**
 * 会改变"当前激活 Provider 快照"的消息类型。
 * 处理完这些消息后需使 ChatService 缓存的 QueryEngine 失效。
 * 只读消息（provider.list.request / provider.test / newapi.sync.start）不在其中。
 */
const PROVIDER_MUTATION_TYPES = new Set([
  'provider.update',
  'provider.activate',
  'provider.delete',
  'newapi.sync.import',
])

// 开发模式下 Webview 通过 Vite 加载资源。可用环境变量覆盖默认端口，
// 以保证扩展端地址与 webview/vite.config.ts 的 server.port 保持一致。
const DEV_WEBVIEW_ORIGIN = process.env.EVANCOD_WEBVIEW_URL || 'http://localhost:9999'
const DEV_WEBVIEW_WS_ORIGIN = DEV_WEBVIEW_ORIGIN.replace(/^http/, 'ws')

export class WebviewManager implements vscode.WebviewViewProvider {
  /**
   * Webview 视图实例
   * undefined 表示视图尚未被 VS Code 解析
   */
  private view: vscode.WebviewView | undefined
  private webview: vscode.Webview | undefined
  private viewReadyPromise: Promise<vscode.Webview> | undefined
  private resolveViewReady: ((webview: vscode.Webview) => void) | undefined
  private createFreshSessionOnReady = false

  /**
   * 可释放资源列表
   * 用于在 Webview 关闭时清理资源
   */
  private disposables: vscode.Disposable[] = []

  /**
   * 性能优化：权限回调使用内存缓存
   *
   * 原代码把这些回调存在 context.globalState 中，每次点击授权按钮都要：
   *   globalState.get → 查找 → delete → await globalState.update
   * 这是一串异步操作 + 序列化开销，导致从点击到回调执行有明显延迟。
   * 改为纯内存 Map 后，查找和执行都是同步的，去除所有 async/await 和序列化。
   */
  private permissionCallbacks = new Map<string, (response: { requestId: string; approved: boolean; reason?: string; updatedInput?: unknown; rule?: 'once' | 'always' }) => void>()

  /**
   * 构造函数 - 依赖注入
   *
   * @param context - VSCode 扩展上下文
   * @param chatService - 聊天服务（用于处理消息）
   * @param providerService - Provider 服务
   * @param taskManager - 任务管理器（可选）
   * @param planModeManager - 计划模式管理器（可选）
   * @param agentCoordinator - Agent 协调器（可选）
   */
  constructor(
    private context: vscode.ExtensionContext,
    private chatService: ChatService,
    private providerService: ProviderService,
    private taskManager?: TaskManager,
    private planModeManager?: PlanModeManager,
    private agentCoordinator?: AgentCoordinator
  ) {}

  /**
   * 显示右侧 Webview 视图。
   * WebviewView 由 VS Code 根据 package.json 中的视图贡献创建，
   * 这里仅负责展开它。首次展开时会触发 resolveWebviewView。
   */
  show(options: { createFreshSessionOnOpen?: boolean } = {}) {
    if (this.view) {
      this.view.show()
      return
    }

    this.createFreshSessionOnReady = options.createFreshSessionOnOpen !== false

    // 展开 evancod 容器，不会创建新的编辑器 Tab。
    void vscode.commands.executeCommand('workbench.view.extension.evancod')
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    this.webview = webviewView.webview

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'dist'))
      ],
    }
    webviewView.webview.html = this.getHtmlContent(webviewView.webview)

    this.setupMessageHandler(webviewView.webview)
    this.setupChatEventForwarding()

    this.resolveViewReady?.(webviewView.webview)
    this.resolveViewReady = undefined
    this.viewReadyPromise = undefined

    webviewView.onDidDispose(() => {
      if (this.view !== webviewView) return
      this.view = undefined
      this.webview = undefined
      this.disposables.forEach(d => d.dispose())
      this.disposables = []
    }, undefined, this.disposables)
  }

  /**
   * 直接发起 new-api 浏览器授权同步
   */
  async startNewApiSync() {
    this.show()

    const webview = await this.getWebview()

    const { handleNewApiMessage } = await import('../newapi/NewApiMessageHandler')
    await handleNewApiMessage(
      { type: 'newapi.sync.start', data: {} },
      this.providerService,
      webview
    )
  }

  private getWebview(): Promise<vscode.Webview> {
    if (this.webview) return Promise.resolve(this.webview)
    if (!this.viewReadyPromise) {
      this.viewReadyPromise = new Promise(resolve => {
        this.resolveViewReady = resolve
      })
    }
    return this.viewReadyPromise
  }

  /**
   * 设置消息处理器
   * 监听来自 Webview 的消息并路由到相应的处理器
   *
   * 消息流向：Webview → Extension
   *
   * 支持的消息类型：
   * - ready: Webview 初始化完成
   * - chat.send: 发送消息
   * - session.new: 创建新会话
   * - provider.*: Provider 相关操作
   * - newapi.*: new-api 同步相关
   * - task.*: Task 相关操作
   * - plan.*: Plan Mode 相关操作
   * - question.*: AskUserQuestion 相关操作
   * - agent.*: Agent 相关操作
   *
   * @param webview - VSCode Webview 实例
   */
  private setupMessageHandler(webview: vscode.Webview) {
    // 导入 Provider 消息处理器
    import('../provider/ProviderMessageHandler').then(({ handleProviderMessage }) => {
      // 监听来自 Webview 的消息
      webview.onDidReceiveMessage(
        async message => {
          // Provider 相关消息
          if (message.type.startsWith('provider.') || message.type.startsWith('newapi.')) {
            await handleProviderMessage(message, this.providerService, webview)
            // 修改配置 / 切换激活项 / 同步导入后，激活 Provider 的快照可能已变，
            // 使 ChatService 缓存的 QueryEngine 失效，下次发消息按新协议重建。
            if (PROVIDER_MUTATION_TYPES.has(message.type)) {
              this.chatService.invalidateEngine()
            }
            return
          }

          // 根据消息类型路由到不同的处理器
          switch (message.type) {
          case 'ready': {
            // Webview 准备就绪，发送初始数据
            // 这是 Webview 加载后发送的第一条消息

            const shouldCreateFreshSession = this.createFreshSessionOnReady
            this.createFreshSessionOnReady = false

            let session = this.chatService.getCurrentSession()
            if (shouldCreateFreshSession || !session) {
              console.log('[WebviewManager] Creating a fresh session for the Webview')
              session = await this.chatService.createNewSession()
            }

            this.postMessage({
              type: 'session.restored',
              data: {
                session: await this.chatService.hydrateSessionImages(session),
                sessions: this.chatService.getSessions(),
              },
            })
            this.postMessage({
              type: 'slash.commands',
              data: {
                commands: this.chatService.getSlashCommands(),
              },
            })
            this.postMessage({
              type: 'skills.list',
              data: {
                skills: this.chatService.getSkills(),
              },
            })
            this.sendSessionList()
            this.postRuntimeState()
            // 会话恢复后主动刷新当前会话任务列表，避免重新打开对话后任务丢失
            this.chatService.notifyTaskList()
            break
          }

          case 'chat.send': {
            // 处理用户发送消息
            const requestSessionId = this.chatService.getCurrentSession()?.id
            try {
              await this.chatService.sendMessage(
                message.data.content,
                message.data.files || message.data.images || [],
                message.data.inlineSegments || []
              )
              // 切换会话期间，旧请求完成后不能把旧消息推回新会话。
              const currentSession = this.chatService.getCurrentSession()
              if (currentSession && currentSession.id === requestSessionId) {
                const sessionMessages = currentSession.messages
                const hydratedSession = await this.chatService.hydrateSessionImages(currentSession)
                this.postMessage({
                  type: 'chat.messages.update',
                  data: {
                    session: hydratedSession,
                    messages: sessionMessages,
                  },
                })
              }
              this.sendSessionList()
            } catch (error) {
              this.postMessage({
                type: 'error',
                data: {
                  message: error instanceof Error ? error.message : 'Unknown error',
                },
              })
            }
            break
          }

          case 'chat.stop': {
            const requestSessionId = message.data?.sessionId
            const session = await this.chatService.stopGeneration()
            // 停止请求也可能与会话切换并发；旧会话完成后不再覆盖新会话 UI。
            if (this.chatService.getCurrentSession()?.id === requestSessionId) {
              this.postMessage({
                type: 'agent.event',
                data: { type: 'status', state: 'idle', verb: 'stopped' },
              })
              this.postMessage({
                type: 'chat.messages.update',
                data: {
                  session,
                  messages: session?.messages || [],
                },
              })
            }
            this.sendSessionList()
            break
          }

          case 'runtime.set':
            this.chatService.setRuntimeOptions(message.data)
            this.postRuntimeState()
            break

          case 'runtime.reset':
            this.chatService.resetRuntime()
            this.postRuntimeState()
            break

          case 'file.pick':
            await this.handleFilePick()
            break

          case 'file.open':
            await this.handleFileOpen(message.data?.path)
            break

          case 'workspace.pick':
            await this.handleWorkspacePick(message.data?.query)
            break

          case 'filesystem.search':
            await this.handleFilesystemSearch(message.data?.query)
            break

          case 'filesystem.browse':
            await this.handleFilesystemBrowse(message.data?.dirPath)
            break

          case 'slash.commands.request':
            this.postMessage({
              type: 'slash.commands',
              data: {
                commands: this.chatService.getSlashCommands(),
              },
            })
            break

          case 'skills.request':
            this.postMessage({
              type: 'skills.list',
              data: {
                skills: this.chatService.getSkills(),
              },
            })
            break

          case 'session.new': {
            // 创建新会话
            const newSession = await this.chatService.createNewSession()

            // 通知 Webview 新会话已创建
            this.postMessage({
              type: 'session.created',
              data: { session: newSession },
            })
            this.sendSessionList()
            this.postRuntimeState()
            break
          }

          case 'session.load': {
            const loaded = await this.chatService.loadSession(message.data.sessionId)
            if (loaded) {
              this.postMessage({
                type: 'session.restored',
                data: {
                  session: await this.chatService.hydrateSessionImages(loaded),
                  sessions: this.chatService.getSessions(),
                },
              })
              this.sendSessionList()
              this.postRuntimeState()
            }
            break
          }

          case 'session.list.request':
            this.sendSessionList()
            break

          case 'session.delete':
            await this.chatService.deleteSession(message.data.sessionId)
            this.postMessage({
              type: 'session.restored',
              data: {
                session: await this.chatService.hydrateSessionImages(this.chatService.getCurrentSession()),
                sessions: this.chatService.getSessions(),
              },
            })
            this.sendSessionList()
            this.postRuntimeState()
            break

          // ============ Task 相关消息 ============
          case 'task.list.request':
            // 请求任务列表
            await this.handleTaskListRequest()
            break

          case 'task.update':
            // 更新任务
            await this.handleTaskUpdate(message.data)
            break

          // ============ Plan 相关消息 ============
          case 'plan.approve':
            // 批准计划
            await this.handlePlanApprove(message.data)
            break

          case 'plan.reject':
            // 拒绝计划
            await this.handlePlanReject(message.data)
            break

          // ============ Agent 相关消息 ============
          case 'permission_response':
            await this.handlePermissionResponse(message.data)
            break

          case 'interaction_response':
            this.handleInteractionResponse(message.data)
            break

          case 'task.list.refresh':
            this.chatService.notifyTaskList()
            break

          case 'agent.cancel':
            // 取消 Agent
            await this.handleAgentCancel(message.data)
            break

          case 'bash.cancel':
            await this.handleBashCancel(message.data)
            break

          case 'image.save':
            await this.handleImageSave(message.data)
            break

          default:
            // 未知消息类型，记录警告
            console.warn('Unknown message type:', message.type)
            break
        }
      },
      undefined,
      this.disposables // 将监听器添加到可释放资源列表
    )
    })
  }

  private setupChatEventForwarding() {
    // 高频事件跨进程发送前再做一次短窗口合并。缓冲区保持原始事件顺序，
    // 只合并相邻且同类型的事件，避免 content/thinking/bash 之间被重新排序。
    let pendingEvents: AgentServerEvent[] = []
    let flushTimer: NodeJS.Timeout | undefined
    const FLUSH_INTERVAL_MS = 50

    const flushPending = () => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = undefined
      }
      const events = pendingEvents
      pendingEvents = []
      for (const event of events) {
        this.sendAgentEvent(event)
      }
    }

    const enqueueHighFrequencyEvent = (event: AgentServerEvent) => {
      const last = pendingEvents[pendingEvents.length - 1]

      if (event.type === 'content_delta' && typeof event.text === 'string') {
        if (last?.type === 'content_delta' && typeof last.text === 'string' && !last.toolInput) {
          last.text += event.text
        } else {
          pendingEvents.push({ ...event })
        }
      } else if (event.type === 'thinking') {
        if (last?.type === 'thinking') {
          last.text += event.text
        } else {
          pendingEvents.push({ ...event })
        }
      } else if (event.type === 'bash_output') {
        if (
          last?.type === 'bash_output' &&
          last.toolUseId === event.toolUseId &&
          last.stream === event.stream &&
          last.taskId === event.taskId
        ) {
          last.text += event.text
        } else {
          pendingEvents.push({ ...event })
        }
      }

      if (!flushTimer) {
        flushTimer = setTimeout(flushPending, FLUSH_INTERVAL_MS)
      }
    }

    this.chatService.onAgentEvent(event => {
      if (
        (event.type === 'content_delta' && typeof event.text === 'string' && !event.toolInput) ||
        event.type === 'thinking' ||
        event.type === 'bash_output'
      ) {
        enqueueHighFrequencyEvent(event)
        return
      }

      flushPending()
      this.sendAgentEvent(event)
    })
  }

  /**
   * 处理文件选择
   */
  private async handleFilePick(): Promise<void> {
    try {
      console.log('[WebviewManager] handleFilePick called, invoking command')
      await vscode.commands.executeCommand('evancod.pickFiles')
    } catch (error) {
      console.error('[WebviewManager] handleFilePick error:', error)
      const message = error instanceof Error ? error.message : '未知错误'
      vscode.window.showErrorMessage(`打开文件选择框失败: ${message}`)
      this.postMessage({
        type: 'error',
        data: { message: `打开文件选择框失败: ${message}` },
      })
    }
  }

  /**
   * 处理生成图片的“下载/保存”：弹出系统保存对话框，将工作区中的图片
   * 复制到用户选择的位置；若源文件缺失则用 base64 兜底写出。
   */
  private async handleImageSave(data: { path?: string; name?: string; base64?: string; mime?: string }): Promise<void> {
    try {
      const workDir = this.chatService.getCurrentSession()?.workDir || ''
      const defaultName = data.name || (data.path ? path.basename(data.path) : 'generated-image.png')

      // 计算默认保存位置：优先用户工作区根目录
      const defaultUri = workDir
        ? vscode.Uri.file(path.join(workDir, defaultName))
        : vscode.Uri.file(defaultName)

      const target = await vscode.window.showSaveDialog({
        defaultUri,
        saveLabel: '保存图片',
      })
      if (!target) return // 用户取消

      // 优先从磁盘源文件复制
      if (data.path) {
        const sourceAbs = path.isAbsolute(data.path) ? data.path : path.join(workDir, data.path)
        const sourceUri = vscode.Uri.file(sourceAbs)
        try {
          await vscode.workspace.fs.copy(sourceUri, target, { overwrite: true })
          vscode.window.showInformationMessage(`图片已保存到 ${target.fsPath}`)
          return
        } catch {
          // 源文件不存在则走 base64 兜底
        }
      }

      if (data.base64) {
        await vscode.workspace.fs.writeFile(target, Buffer.from(data.base64, 'base64'))
        vscode.window.showInformationMessage(`图片已保存到 ${target.fsPath}`)
        return
      }

      vscode.window.showErrorMessage('保存失败：未找到可用的图片数据。')
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      vscode.window.showErrorMessage(`保存图片失败: ${message}`)
    }
  }

  /**
   * 处理命令返回的文件
   */
  public handlePickedFiles(files: vscode.Uri[]): void {
    console.log('[WebviewManager] handlePickedFiles called with', files.length, 'files')
    this.postMessage({
      type: 'file.picked',
      data: {
        files: files.map(file => ({
          path: file.fsPath,
          name: path.basename(file.fsPath),
        })),
      },
    })
  }

  /**
   * 使用 `git check-ignore` 过滤掉被 .gitignore 排除的文件。
   *
   * 为什么用 git 而不是自己解析 .gitignore：
   * - git 天然遵守嵌套 .gitignore、全局 gitignore、.git/info/exclude 等全部规则
   * - 零额外依赖
   *
   * 行为：
   * - 非 git 仓库或 git 不可用时，原样返回（不过滤），保证功能可用
   * - 通过 stdin 批量传入，避免命令行长度限制
   *
   * @param files - findFiles 返回的文件 Uri 列表
   * @param cwd - git 工作目录（工作区根路径）
   * @returns 未被 gitignore 排除的文件列表
   */
  private async filterGitIgnored(
    files: vscode.Uri[],
    cwd: string
  ): Promise<vscode.Uri[]> {
    if (files.length === 0) return files

    // 用绝对路径喂给 git check-ignore，避免相对路径解析歧义
    const paths = files.map(f => f.fsPath)

    const ignored = await new Promise<Set<string>>(resolve => {
      const child = execFile(
        'git',
        // --stdin: 从标准输入读取路径；-z: 用 NUL 分隔，兼容含空格/换行的路径
        ['check-ignore', '--stdin', '-z'],
        { cwd, maxBuffer: 1024 * 1024 * 16 },
        (error, stdout) => {
          // exit code 0: 有被忽略的路径；1: 没有任何被忽略的路径（都不是错误）
          // 其它情况（非 git 仓库、git 未安装等）视为不过滤
          if (error && (error as { code?: number }).code !== 1 && !stdout) {
            resolve(new Set())
            return
          }
          const set = new Set(
            stdout.split('\0').map(p => p.trim()).filter(Boolean)
          )
          resolve(set)
        }
      )

      child.on('error', () => resolve(new Set()))
      child.stdin?.end(paths.join('\0'))
    })

    if (ignored.size === 0) return files
    return files.filter(f => !ignored.has(f.fsPath))
  }

  private async handleWorkspacePick(query?: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      this.postMessage({
        type: 'error',
        data: { message: '当前没有打开工作区' },
      })
      return
    }

    const pattern = query?.trim() ? `**/*${query.trim()}*` : '**/*'
    const found = await vscode.workspace.findFiles(pattern, '**/{node_modules,.git,out,dist}/**', 300)
    const files = (await this.filterGitIgnored(found, workspaceFolder.uri.fsPath)).slice(0, 100)
    const picked = await vscode.window.showQuickPick(
      files.map(file => ({
        label: vscode.workspace.asRelativePath(file),
        description: file.fsPath,
        path: file.fsPath,
      })),
      {
        canPickMany: true,
        placeHolder: '选择工作区文件添加到上下文',
      }
    )

    if (!picked?.length) return

    this.postMessage({
      type: 'file.picked',
      data: {
        files: picked.map(file => ({
          path: file.path,
          name: file.label,
        })),
      },
    })
  }

  private async handleFilesystemSearch(query?: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      this.postMessage({ type: 'filesystem.search.results', data: { entries: [] } })
      return
    }

    const normalizedQuery = query?.trim() || ''
    const pattern = normalizedQuery ? `**/*${normalizedQuery}*` : '**/*'
    const found = await vscode.workspace.findFiles(pattern, '**/{node_modules,.git,out,dist,build}/**', 300)
    const files = (await this.filterGitIgnored(found, workspaceFolder.uri.fsPath)).slice(0, 100)
    this.postMessage({
      type: 'filesystem.search.results',
      data: {
        entries: files.map(file => ({
          name: path.basename(file.fsPath),
          path: file.fsPath,
          relativePath: vscode.workspace.asRelativePath(file),
          type: 'file',
        })),
      },
    })
  }

  private async handleFilesystemBrowse(dirPath?: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      this.postMessage({ type: 'filesystem.browse.results', data: { entries: [] } })
      return
    }

    const rootPath = workspaceFolder.uri.fsPath
    const targetPath = dirPath?.trim() || rootPath
    const normalizedRoot = path.resolve(rootPath)
    const normalizedTarget = path.resolve(targetPath)
    if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)) {
      this.postMessage({
        type: 'error',
        data: { message: '只能浏览当前工作区内的文件' },
      })
      return
    }

    if (normalizedTarget === normalizedRoot) {
      const found = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,out,dist,build}/**', 300)
      const files = (await this.filterGitIgnored(found, rootPath)).slice(0, 100)
      this.postMessage({
        type: 'filesystem.browse.results',
        data: {
          entries: files.map(file => ({
            name: path.basename(file.fsPath),
            path: file.fsPath,
            relativePath: vscode.workspace.asRelativePath(file),
            type: 'file',
          })),
        },
      })
      return
    }

    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(normalizedTarget))
    this.postMessage({
      type: 'filesystem.browse.results',
      data: {
        entries: entries.slice(0, 100).map(([name, type]) => {
          const entryPath = path.join(normalizedTarget, name)
          return {
            name,
            path: entryPath,
            relativePath: vscode.workspace.asRelativePath(entryPath),
            type: type === vscode.FileType.Directory ? 'directory' : 'file',
          }
        }),
      },
    })
  }

  private sendSessionList(): void {
    this.postMessage({
      type: 'session.list',
      data: {
        sessions: this.chatService.getSessions().map(session => ({
          id: session.id,
          title: session.name,
          workDir: session.workDir,
          createdAt: new Date(session.createdAt).toISOString(),
          modifiedAt: new Date(session.updatedAt).toISOString(),
          messageCount: session.messages.filter(message => message.role === 'user' || message.role === 'assistant').length,
        })),
      },
    })
  }

  /**
   * 处理任务列表请求
   */
  private async handleTaskListRequest(): Promise<void> {
    try {
      if (!this.taskManager) {
        console.warn('TaskManager not available')
        return
      }

      const tasks = this.taskManager.listTasks()
      this.sendTaskList(tasks)
    } catch (error) {
      console.error('Failed to handle task list request:', error)
    }
  }

  /**
   * 处理任务更新
   */
  private async handleTaskUpdate(data: { taskId: string; status: string }): Promise<void> {
    try {
      if (!this.taskManager) {
        console.warn('TaskManager not available')
        return
      }

      const task = await this.taskManager.updateTask(data.taskId, {
        status: data.status as any
      })
      this.sendTaskUpdated(task)
    } catch (error) {
      console.error('Failed to handle task update:', error)
      this.postMessage({
        type: 'error',
        data: {
          message: error instanceof Error ? error.message : 'Failed to update task'
        }
      })
    }
  }

  /**
   * 处理计划批准
   */
  private async handlePlanApprove(data: { planId: string }): Promise<void> {
    try {
      if (!this.planModeManager) {
        console.warn('PlanModeManager not available')
        return
      }

      await this.planModeManager.approvePlan(data.planId)
      this.sendPlanApproved(data.planId)
    } catch (error) {
      console.error('Failed to handle plan approve:', error)
      this.postMessage({
        type: 'error',
        data: {
          message: error instanceof Error ? error.message : 'Failed to approve plan'
        }
      })
    }
  }

  /**
   * 处理计划拒绝
   */
  private async handlePlanReject(data: { planId: string; reason: string }): Promise<void> {
    try {
      if (!this.planModeManager) {
        console.warn('PlanModeManager not available')
        return
      }

      await this.planModeManager.rejectPlan(data.planId, data.reason)
      this.sendPlanRejected(data.planId, data.reason)
    } catch (error) {
      console.error('Failed to handle plan reject:', error)
      this.postMessage({
        type: 'error',
        data: {
          message: error instanceof Error ? error.message : 'Failed to reject plan'
        }
      })
    }
  }

  /**
   * 处理 Agent 取消
   */
  private handlePermissionResponse(data: { requestId: string; approved: boolean; reason?: string; updatedInput?: unknown; rule?: 'once' | 'always' }): void {
    try {
      // 性能优化：从内存 Map 同步查找回调，不再经过 globalState 异步读写
      const callback = this.permissionCallbacks.get(data.requestId)
      if (callback) {
        this.permissionCallbacks.delete(data.requestId)
        callback(data)
      }

      // 子 Agent 有独立的 QueryEngine，先按 requestId 尝试路由；未命中再交给主会话。
      const handledBySubAgent = this.agentCoordinator?.handlePermissionResponse(data) ?? false
      if (!handledBySubAgent) {
        this.chatService.handlePermissionResponse(data)
      }
    } catch (error) {
      console.error('Failed to handle permission response:', error)
    }
  }

  private async handleFileOpen(filePath?: string): Promise<void> {
    if (!filePath) return
    try {
      const workDir = this.chatService.getCurrentSession()?.workDir
      const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(workDir || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(), filePath)
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath))
      await vscode.window.showTextDocument(document, { preview: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法打开文件'
      vscode.window.showWarningMessage(`打开文件失败: ${message}`)
    }
  }

  private handleInteractionResponse(data: {
    requestId: string
    answered: boolean
    answers?: unknown
    reason?: string
  }): void {
    try {
      const handledBySubAgent = this.agentCoordinator?.handleInteractionResponse(data) ?? false
      if (!handledBySubAgent) {
        this.chatService.handleInteractionResponse(data)
      }
    } catch (error) {
      console.error('Failed to handle interaction response:', error)
    }
  }

  /**
   * 处理 Agent 取消
   */
  private async handleAgentCancel(data: { agentId: string }): Promise<void> {
    try {
      if (!this.agentCoordinator) {
        console.warn('AgentCoordinator not available')
        return
      }

      this.agentCoordinator.cancelAgent(data.agentId)
    } catch (error) {
      console.error('Failed to handle agent cancel:', error)
    }
  }

  private async handleBashCancel(data: { toolUseId: string; taskId?: string }): Promise<void> {
    try {
      const cancelled = (this.chatService as any).cancelBash?.(data.toolUseId, data.taskId) ?? false
      if (!cancelled) {
        this.postMessage({
          type: 'error',
          data: { message: '未找到正在运行的 Bash 命令' },
        })
      }
    } catch (error) {
      console.error('Failed to handle bash cancel:', error)
    }
  }

  /**
   * 发送消息到 Webview
   *
   * @param message - 要发送的消息对象
   */
  postMessage(message: any) {
    void this.webview?.postMessage(message)
  }

  sendAgentEvent(event: AgentServerEvent): void {
    this.postMessage({
      type: 'agent.event',
      data: event,
    })
  }

  private postRuntimeState() {
    const activeProvider = this.providerService.getActiveProvider()
    const runtimeState = this.chatService.getRuntimeState()
    this.postMessage({
      type: 'runtime.state',
      data: {
        activeProviderId: activeProvider?.id || null,
        currentModel: runtimeState.currentModel,
        effortLevel: runtimeState.effortLevel,
        permissionMode: runtimeState.permissionMode,
      },
    })
  }

  /**
   * 发送任务创建消息
   */
  sendTaskCreated(task: any): void {
    this.postMessage({
      type: 'task.created',
      data: { task }
    })
  }

  /**
   * 发送任务更新消息
   */
  sendTaskUpdated(task: any): void {
    this.postMessage({
      type: 'task.updated',
      data: { task }
    })
  }

  /**
   * 发送任务列表消息
   */
  sendTaskList(tasks: any[]): void {
    this.postMessage({
      type: 'task.list',
      data: { tasks }
    })
  }

  /**
   * 发送任务删除消息
   */
  sendTaskDeleted(taskId: string): void {
    this.postMessage({
      type: 'task.deleted',
      data: { taskId }
    })
  }

  /**
   * 发送计划提交消息
   */
  sendPlanSubmitted(plan: any): void {
    this.postMessage({
      type: 'plan.submitted',
      data: { plan }
    })
  }

  /**
   * 发送计划批准消息
   */
  sendPlanApproved(planId: string): void {
    this.postMessage({
      type: 'plan.approved',
      data: { planId }
    })
  }

  /**
   * 发送计划拒绝消息
   */
  sendPlanRejected(planId: string, reason: string): void {
    this.postMessage({
      type: 'plan.rejected',
      data: { planId, reason }
    })
  }

  /**
   * 发送问题询问消息
   */
  sendQuestionAsk(question: any): void {
    this.postMessage({
      type: 'question.ask',
      data: { question }
    })
  }

  /**
   * 发送 Agent 启动消息
   */
  sendAgentStarted(agent: any): void {
    this.postMessage({
      type: 'agent.started',
      data: { agent }
    })
  }

  /**
   * 发送 Agent 完成消息
   */
  sendAgentCompleted(agent: any): void {
    this.postMessage({
      type: 'agent.completed',
      data: { agent }
    })
  }

  /**
   * 获取 HTML 内容
   * 根据开发/生产模式返回不同的 HTML
   *
   * 开发模式：连接到 Vite dev server（热重载）
   * 生产模式：使用打包后的文件
   *
   * @param webview - VSCode Webview 实例
   * @returns HTML 字符串
   */
  private getHtmlContent(webview: vscode.Webview): string {
    // 判断是否为开发模式
    // 开发模式下 NODE_ENV 环境变量为 'development'
    const isDevelopment = this.context.extensionMode === vscode.ExtensionMode.Development

    if (isDevelopment) {
      // 开发模式：连接到 Vite dev server
      // 默认运行在 localhost:9999，可通过 EVANCOD_WEBVIEW_URL 覆盖
      // 支持热重载（修改代码后自动刷新）
      return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' ${DEV_WEBVIEW_ORIGIN}; script-src ${webview.cspSource} 'unsafe-eval' ${DEV_WEBVIEW_ORIGIN}; connect-src ${DEV_WEBVIEW_ORIGIN} ${DEV_WEBVIEW_WS_ORIGIN}; img-src ${webview.cspSource} data: ${DEV_WEBVIEW_ORIGIN};">
  <title>Evancod Chat</title>
</head>
<body>
  <div id="app"></div>
  <!-- Vite 客户端（用于热重载） -->
  <script type="module" src="${DEV_WEBVIEW_ORIGIN}/@vite/client"></script>
  <!-- Vue 应用入口 -->
  <script type="module" src="${DEV_WEBVIEW_ORIGIN}/src/main.ts"></script>
</body>
</html>`
    }

    // 生产模式：使用打包后的文件
    // Vite 打包后会生成 index.js 和 index.css
    // 使用 asWebviewUri 将本地路径转换为 Webview 可访问的 URI
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'dist', 'index.js'))
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'dist', 'index.css'))
    )

    // 返回生产模式的 HTML
    // 包含 CSP（内容安全策略）防止 XSS 攻击
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- CSP 安全策略 -->
  <!-- default-src 'none': 默认禁止所有资源 -->
  <!-- style-src: 允许样式（包括内联样式） -->
  <!-- script-src: 只允许来自 Webview 的脚本 -->
  <!-- img-src: 允许 Webview 和 data: 协议的图片 -->
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <link href="${styleUri}" rel="stylesheet">
  <title>Evancod Chat</title>
</head>
<body>
  <div id="app"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`
  }
}
