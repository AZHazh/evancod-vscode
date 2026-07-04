/**
 * Extension Provider 消息处理器
 *
 * 职责：
 * 1. 处理来自 Webview 的 Provider 相关消息
 * 2. 执行 Provider CRUD 操作
 * 3. 测试 Provider 连接
 * 4. 处理 new-api 同步消息
 * 5. 返回结果给 Webview
 *
 * 消息类型：
 * - provider.list.request: 获取 Provider 列表
 * - provider.create: 创建 Provider
 * - provider.update: 更新 Provider
 * - provider.delete: 删除 Provider
 * - provider.activate: 激活 Provider
 * - provider.test: 测试连接
 * - newapi.*: new-api 同步相关
 */

import * as vscode from 'vscode'
import { ProviderService } from '../provider/ProviderService'
import { createApiClient } from '../../core/services/api/AnthropicClient'
import { handleNewApiMessage } from '../newapi/NewApiMessageHandler'
import type { Provider } from '../../types'

/**
 * 处理 Provider 相关消息
 *
 * @param message - 来自 Webview 的消息
 * @param providerService - Provider 服务
 * @param webview - Webview 实例
 */
export async function handleProviderMessage(
  message: any,
  providerService: ProviderService,
  webview: vscode.Webview
) {
  try {
    // new-api 同步消息
    if (message.type.startsWith('newapi.')) {
      await handleNewApiMessage(message, providerService, webview)
      return
    }

    // Provider 操作消息
    switch (message.type) {
      case 'provider.list.request':
        // 获取 Provider 列表
        await handleProviderList(providerService, webview)
        break

      case 'provider.create':
        // 创建 Provider
        await handleProviderCreate(message.data, providerService, webview)
        break

      case 'provider.update':
        // 更新 Provider
        await handleProviderUpdate(message.data, providerService, webview)
        break

      case 'provider.delete':
        // 删除 Provider
        await handleProviderDelete(message.data.id, providerService, webview)
        break

      case 'provider.activate':
        // 激活 Provider
        await handleProviderActivate(message.data.id, providerService, webview)
        break

      case 'provider.test':
        // 测试连接
        await handleProviderTest(message.data.id, providerService, webview)
        break
    }
  } catch (error) {
    // 发送错误消息到 Webview
    webview.postMessage({
      type: 'error',
      data: {
        message: error instanceof Error ? error.message : '未知错误',
        code: 'PROVIDER_ERROR',
      },
    })
  }
}

/**
 * 获取 Provider 列表
 */
async function handleProviderList(
  providerService: ProviderService,
  webview: vscode.Webview
) {
  const providers = providerService.getProviders()
  const activeProvider = providerService.getActiveProvider()

  webview.postMessage({
    type: 'provider.list',
    data: {
      providers,
      activeId: activeProvider?.id || null,
    },
  })
}

/**
 * 创建 Provider
 */
async function handleProviderCreate(
  data: Omit<Provider, 'id' | 'createdAt'>,
  providerService: ProviderService,
  webview: vscode.Webview
) {
  // 创建 Provider
  const provider = await providerService.addProvider(data)

  // 发送成功消息
  webview.postMessage({
    type: 'provider.created',
    data: { provider },
  })

  // 显示通知
  vscode.window.showInformationMessage(`Provider "${provider.name}" 已创建`)
}

/**
 * 更新 Provider
 */
async function handleProviderUpdate(
  data: { id: string; updates: Partial<Provider> },
  providerService: ProviderService,
  webview: vscode.Webview
) {
  const updatedProvider = await providerService.updateProvider(data.id, data.updates)

  // 发送成功消息
  webview.postMessage({
    type: 'provider.updated',
    data: { provider: updatedProvider },
  })

  // 刷新列表
  await handleProviderList(providerService, webview)

  vscode.window.showInformationMessage(`Provider "${updatedProvider.name}" 已更新`)
}

/**
 * 删除 Provider
 */
async function handleProviderDelete(
  id: string,
  providerService: ProviderService,
  webview: vscode.Webview
) {
  // 删除 Provider
  await providerService.deleteProvider(id)

  // 刷新列表
  await handleProviderList(providerService, webview)

  vscode.window.showInformationMessage('Provider 已删除')
}

/**
 * 激活 Provider
 */
async function handleProviderActivate(
  id: string,
  providerService: ProviderService,
  webview: vscode.Webview
) {
  // 激活 Provider
  await providerService.activateProvider(id)

  // 发送成功消息
  webview.postMessage({
    type: 'provider.activated',
    data: { providerId: id },
  })

  // 刷新列表
  await handleProviderList(providerService, webview)

  const provider = providerService.getActiveProvider()
  vscode.window.showInformationMessage(`已切换到 "${provider?.name}"`)
}

/**
 * 测试 Provider 连接
 */
async function handleProviderTest(
  id: string,
  providerService: ProviderService,
  webview: vscode.Webview
) {
  // 获取 Provider
  const providers = providerService.getProviders()
  const provider = providers.find(p => p.id === id)

  if (!provider) {
    throw new Error('Provider 不存在')
  }

  // 显示测试中提示
  const statusBarItem = vscode.window.setStatusBarMessage(
    `正在测试 "${provider.name}" 连接...`
  )

  try {
    // 创建 API 客户端
    if (provider.runtimeKind === 'openai_oauth') {
      throw new Error('OpenAI 官方 OAuth provider 暂不支持 VSCode 插件直连')
    }

    const client = createApiClient({
      provider,
      model: provider.models.main,
    })

    // 测试连接
    const success = await client.testConnection()

    // 清除状态栏
    statusBarItem.dispose()

    if (success) {
      vscode.window.showInformationMessage(
        `✅ "${provider.name}" 连接测试成功`
      )
    } else {
      vscode.window.showWarningMessage(
        `⚠️ "${provider.name}" 连接测试失败`
      )
    }
  } catch (error) {
    // 清除状态栏
    statusBarItem.dispose()

    // 显示错误
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    vscode.window.showErrorMessage(
      `❌ "${provider.name}" 连接测试失败: ${errorMessage}`
    )
  }
}
