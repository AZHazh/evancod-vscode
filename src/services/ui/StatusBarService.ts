/**
 * 状态栏服务 - VSCode 底部状态栏集成
 *
 * 职责：
 * 1. 在 VSCode 状态栏显示插件图标和状态
 * 2. 显示当前激活的 Provider 名称
 * 3. 点击状态栏打开聊天面板
 *
 * 状态栏位置：VSCode 底部右侧
 * 优先级：100（较高，显示在前面）
 */

import * as vscode from 'vscode'
import { ProviderService } from '../provider/ProviderService'

export class StatusBarService {
  /**
   * VSCode 状态栏项
   */
  private statusBarItem: vscode.StatusBarItem

  /**
   * 构造函数 - 依赖注入
   *
   * @param context - VSCode 扩展上下文
   * @param providerService - Provider 服务（用于获取当前 Provider）
   */
  constructor(
    private context: vscode.ExtensionContext,
    private providerService: ProviderService
  ) {
    // 创建状态栏项
    // StatusBarAlignment.Right: 显示在右侧
    // 100: 优先级，数字越大越靠左
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    )

    // 注册到 context，VSCode 会在插件停用时自动清理
    this.context.subscriptions.push(this.statusBarItem)

    // 初始化状态栏内容
    this.update()
  }

  /**
   * 显示状态栏
   */
  show() {
    this.statusBarItem.show()
  }

  /**
   * 隐藏状态栏
   */
  hide() {
    this.statusBarItem.hide()
  }

  /**
   * 更新状态栏内容
   * 根据当前激活的 Provider 更新显示文本
   *
   * 显示格式：
   * - 有激活的 Provider: $(comment-discussion) Provider名称
   * - 没有激活的 Provider: $(comment-discussion) Evancod
   *
   * 图标说明：
   * - $(comment-discussion): VSCode Codicon 图标（聊天气泡）
   */
  update() {
    // 获取当前激活的 Provider
    const activeProvider = this.providerService.getActiveProvider()

    if (activeProvider) {
      // 显示 Provider 名称
      this.statusBarItem.text = `$(comment-discussion) ${activeProvider.name}`
      this.statusBarItem.tooltip = `当前 Provider: ${activeProvider.name}\n点击打开聊天`
    } else {
      // 没有激活的 Provider
      this.statusBarItem.text = '$(comment-discussion) Evancod'
      this.statusBarItem.tooltip = '点击打开聊天'
    }

    // 设置点击命令
    // 点击状态栏会执行此命令
    this.statusBarItem.command = 'evancod.openChat'
  }
}
