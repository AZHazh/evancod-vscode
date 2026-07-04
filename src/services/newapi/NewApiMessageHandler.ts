/**
 * new-api 同步消息处理器（轮询版本）
 *
 * 职责：
 * 1. 处理来自 Webview 的 new-api 同步消息
 * 2. 调用 NewApiSyncService（轮询方式）
 * 3. 打开浏览器进行授权
 * 4. 批量创建 Provider
 * 5. 返回结果给 Webview
 *
 * 消息类型：
 * - newapi.sync.start: 开始同步（打开浏览器 + 轮询授权）
 * - newapi.sync.import: 执行导入
 */

import * as vscode from 'vscode'
import { ProviderService } from '../provider/ProviderService'
import { NewApiSyncService } from './NewApiSyncService'
import type { Provider } from '../../types'

/**
 * 处理 new-api 同步消息
 *
 * @param message - 来自 Webview 的消息
 * @param providerService - Provider 服务
 * @param webview - Webview 实例
 */
export async function handleNewApiMessage(
  message: any,
  providerService: ProviderService,
  webview: vscode.Webview
) {
  try {
    switch (message.type) {
      case 'newapi.sync.start':
        // 开始同步：打开浏览器授权 + 轮询
        await handleSyncStart(message.data ?? {}, webview)
        break

      case 'newapi.sync.import':
        // 执行导入：批量创建 Provider
        await handleSyncImport(message.data, providerService, webview)
        break
    }
  } catch (error) {
    // 发送错误消息到 Webview
    webview.postMessage({
      type: 'error',
      data: {
        message: error instanceof Error ? error.message : '同步失败',
        code: 'NEWAPI_SYNC_ERROR',
      },
    })
  }
}

/**
 * 处理同步开始（轮询版本）
 * Step 1: 打开浏览器授权 + 轮询获取 Token 列表
 *
 * @param data - { siteUrl }
 * @param webview - Webview 实例
 */
async function handleSyncStart(
  data: { siteUrl?: string },
  webview: vscode.Webview
) {
  try {
    const siteUrl = normalizeSiteUrl(
      data.siteUrl || vscode.workspace.getConfiguration('evancod').get<string>('newApiSiteUrl') || 'https://www.tiandouai.com'
    )

    // 创建同步服务
    const syncService = new NewApiSyncService({
      siteUrl,
    })

    // 创建本地回调服务并生成授权 URL
    const { session, code: callbackCode } = await syncService.createCallbackServer()

    // 打开系统浏览器
    const opened = await vscode.env.openExternal(
      vscode.Uri.parse(session.authorizeUrl)
    )

    if (!opened) {
      throw new Error('无法打开浏览器，请手动访问授权页面')
    }

    // 显示进度通知 + 轮询授权状态
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'new-api 同步',
        cancellable: false,
      },
      async (progress) => {
        progress.report({
          message: '已打开浏览器，等待授权...',
        })

        // 等待浏览器回调
        const code = await callbackCode
        progress.report({ message: '授权成功，正在获取数据...' })

        // 用 code 交换数据
        progress.report({ message: '正在获取 Token 列表...' })
        const result = await syncService.exchangeCode(code)

        // 发送预览数据到 Webview
        webview.postMessage({
          type: 'newapi.sync.preview',
          data: {
            siteUrl,
            tokens: result.tokens,
            models: result.availableModels,
            groupModels: result.groupModels,
          },
        })

        progress.report({
          message: `成功获取 ${result.tokens.length} 个 Token`,
        })
      }
    )
  } catch (error) {
    // 发送错误到 Webview
    throw error
  }
}

/**
 * 处理同步导入
 * Step 5: 批量创建 Provider
 *
 * @param data - { siteUrl, tokens: [{tokenId, tokenName, tokenKey, mapping}] }
 * @param providerService - Provider 服务
 * @param webview - Webview 实例
 */
async function handleSyncImport(
  data: {
    siteUrl: string
    apiFormat?: 'anthropic' | 'openai_chat' | 'openai_responses'
    tokens: Array<{
      tokenId: number
      tokenName: string
      tokenKey: string
      mapping: {
        main: string
        sonnet: string
        opus: string
        haiku: string
      }
    }>
  },
  providerService: ProviderService,
  webview: vscode.Webview
) {
  console.log('[NewApi] 开始导入，数据:', JSON.stringify(data, null, 2))

  // 验证必需参数
  if (!data || !data.siteUrl) {
    console.error('[NewApi] 缺少 siteUrl')
    throw new Error('缺少 new-api 站点地址')
  }

  if (!data.tokens || data.tokens.length === 0) {
    console.error('[NewApi] tokens 为空')
    throw new Error('没有选择任何 Token')
  }

  // 显示进度提示
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `正在导入 ${data.tokens.length} 个 Provider...`,
      cancellable: false,
    },
    async progress => {
      let imported = 0
      const skipped: string[] = []
      const failed: Array<{ name: string; error: string }> = []

      // 获取现有 Provider 列表（用于去重）
      const existingProviders = providerService.getProviders()
      const existingKeys = new Set(
        existingProviders.map(p => `${p.baseUrl}:${p.apiKey}`)
      )

      console.log(`[NewApi] 现有 Provider 数量: ${existingProviders.length}`)

      // 批量创建 Provider
      for (const token of data.tokens) {
        // 更新进度
        progress.report({
          message: `${imported + 1}/${data.tokens.length}: ${token.tokenName}`,
        })

        try {
          console.log(`[NewApi] 处理 Token: ${token.tokenName}`)

          if (!token.tokenKey) {
            throw new Error('Token key 为空')
          }

          // 规范化 API Key（确保有 sk- 前缀）
          const apiKey = token.tokenKey.startsWith('sk-')
            ? token.tokenKey
            : `sk-${token.tokenKey}`

          // 去重检查
          const dedupKey = `${data.siteUrl}:${apiKey}`
          if (existingKeys.has(dedupKey)) {
            console.log(`[NewApi] 跳过重复: ${token.tokenName}`)
            skipped.push(token.tokenName)
            continue
          }

          // 创建 Provider
          const provider: Omit<Provider, 'id' | 'createdAt'> = {
            name: `[甜豆] ${token.tokenName}`,
            type: 'custom',
            apiFormat: data.apiFormat || 'openai_chat',
            baseUrl: data.siteUrl,
            apiKey,
            models: token.mapping,
            source: 'newapi-sync',
          }

          console.log(`[NewApi] 创建 Provider: ${provider.name}`)
          const createdProvider = await providerService.addProvider(provider)
          existingKeys.add(dedupKey)
          imported++

          // 如果是第一个导入的 Provider，自动激活它
          if (imported === 1 && !providerService.getActiveProvider()) {
            console.log(`[NewApi] 自动激活第一个 Provider: ${provider.name}`)
            await providerService.activateProvider(createdProvider.id)
          }

          console.log(`[NewApi] 成功导入: ${token.tokenName}`)
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : '未知错误'
          console.error(`[NewApi] 导入失败 ${token.tokenName}:`, errorMsg)
          failed.push({
            name: token.tokenName,
            error: errorMsg,
          })
        }
      }

      console.log(`[NewApi] 导入完成 - 成功: ${imported}, 跳过: ${skipped.length}, 失败: ${failed.length}`)

      // 发送完成消息
      webview.postMessage({
        type: 'newapi.sync.complete',
        data: {
          imported,
          skipped: skipped.length,
          failed: failed.length,
          details: {
            skipped,
            failed,
            firstError: failed[0]?.error,
          },
        },
      })

      // 显示成功通知
      let message = `✅ 成功导入 ${imported} 个 Provider`
      if (skipped.length > 0) {
        message += `，跳过 ${skipped.length} 个重复项`
      }
      if (failed.length > 0) {
        message += `，${failed.length} 个失败`
      }

      vscode.window.showInformationMessage(message)
    }
  )
}

function normalizeSiteUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('new-api 站点地址不能为空')
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('new-api 站点地址格式不正确')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('new-api 站点地址必须使用 http 或 https')
  }

  return url.origin
}
