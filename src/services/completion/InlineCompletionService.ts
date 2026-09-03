import * as vscode from 'vscode'
import { createApiClient } from '../../core/services/api'
import type { ProviderService } from '../provider/ProviderService'
import type { Message } from '../../types'

/**
 * 基于当前 Provider 的轻量级内联代码补全服务。
 * 请求与聊天会话隔离，不会写入聊天历史或触发工具调用。
 */
export class InlineCompletionService implements vscode.Disposable {
  private readonly provider: vscode.InlineCompletionItemProvider
  private readonly output: vscode.OutputChannel
  private activeRequest?: AbortController
  private cachedCompletion?: {
    key: string
    value: string
    expiresAt: number
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly providerService: ProviderService
  ) {
    this.output = vscode.window.createOutputChannel('Evancod Inline Completion')
    context.subscriptions.push(this.output)
    this.provider = {
      provideInlineCompletionItems: (document, position, _inlineContext, token) =>
        this.provide(document, position, token),
    }

    // 使用通配 scheme，覆盖本地、Remote/WSL、untitled 及 notebook cell 文档。
    const selector: vscode.DocumentSelector = [{ scheme: '*' }]
    context.subscriptions.push(
      vscode.languages.registerInlineCompletionItemProvider(selector, this.provider)
    )
    this.writeLog('[InlineCompletion] provider registered')
  }

  dispose(): void {
    // 注册对象由 ExtensionContext 统一释放。
  }

  private async provide(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    this.writeLog(
      `[InlineCompletion] invoked ${document.languageId} ${document.uri.toString()} ` +
        `at ${position.line + 1}:${position.character}`
    )
    if (!vscode.workspace.getConfiguration('evancod.inlineCompletion').get<boolean>('enabled', true)) {
      this.writeLog('[InlineCompletion] skipped: evancod.inlineCompletion.enabled=false')
      return undefined
    }

    const provider = this.providerService.getActiveProvider()
    if (
      !provider ||
      provider.apiFormat === 'openai_image' ||
      token.isCancellationRequested
    ) {
      this.writeLog(
        `[InlineCompletion] skipped: ${!provider ? 'no active provider' : provider.apiFormat === 'openai_image' ? 'image provider' : 'cancelled'}`
      )
      return undefined
    }

    const linePrefix = document.lineAt(position.line).text.slice(0, position.character)
    // 空白行不触发请求，避免编辑器启动或换行时产生大量无意义调用。
    if (!linePrefix.trim()) {
      this.writeLog('[InlineCompletion] skipped: empty line prefix')
      return undefined
    }

    const configuration = vscode.workspace.getConfiguration('evancod.inlineCompletion')
    const modelOverride = configuration.get<string>('model', '').trim()
    const maxPrefix = configuration.get<number>('maxPrefixChars', 3500)
    const maxSuffix = configuration.get<number>('maxSuffixChars', 1200)
    const maxTokens = configuration.get<number>('maxTokens', 160)
    const debounceMs = configuration.get<number>('debounceMs', 120)
    const timeoutMs = configuration.get<number>('timeoutMs', 15000)
    const offset = document.offsetAt(position)
    const source = document.getText()
    const before = source.slice(0, offset)
    const after = source.slice(offset)
    const prefix = this.takeCompleteLines(before, maxPrefix, true)
    const suffix = this.takeCompleteLines(after, maxSuffix, false)
    const language = document.languageId || 'plaintext'
    const model = modelOverride || provider.models.main

    this.writeLog(`[InlineCompletion] requesting ${language} completion with model ${model}`)

    const cacheKey = `${document.uri.toString()}@${document.version}:${offset}:${model}:${prefix}:${suffix}`
    if (this.cachedCompletion && this.cachedCompletion.key === cacheKey && this.cachedCompletion.expiresAt > Date.now()) {
      return [new vscode.InlineCompletionItem(this.cachedCompletion.value, new vscode.Range(position, position))]
    }

    const prompt = [
      '你是低延迟代码补全引擎。根据光标前后的代码，预测用户下一步最可能输入的内容。',
      '只输出插入光标处的代码，不要解释、Markdown 围栏或重复已有代码；没有把握时输出空字符串。',
      '不要进行长篇分析或输出思考过程，直接返回代码结果。',
      '优先完成当前表达式/语句，保持已有缩进、风格和命名，通常只返回一到数行。',
      '',
      `语言: ${language}`,
      '<|prefix|>',
      prefix,
      '<|suffix|>',
      suffix,
      '<|completion|>',
    ].join('\n')

    const message: Message = {
      id: `inline-completion-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    }

    const abortController = new AbortController()
    // VS Code 可能在前一个请求尚未完成时再次询问；只保留最新请求，避免并发消耗 Token。
    this.activeRequest?.abort()
    this.activeRequest = abortController
    const cancellation = token.onCancellationRequested(() => abortController.abort())
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      abortController.abort()
    }, timeoutMs)
    try {
      if (!(await this.waitForDebounce(token, debounceMs))) return undefined

      const client = createApiClient({
        provider,
        model,
        maxTokens,
        temperature: 0.15,
        effortLevel: 'low',
      })
      let completion = ''
      const response = await client.sendMessageStream(
        [message],
        (delta, type) => {
          if (type === 'delta') completion += delta
        },
        undefined,
        { signal: abortController.signal }
      )

      if (token.isCancellationRequested) return undefined
      // 兼容部分中转协议只返回最终 content、不发送 delta 事件的情况。
      if (!completion && response.content) completion = response.content
      completion = this.cleanCompletion(completion)
      this.writeLog(
        `[InlineCompletion] received ${completion.length} characters` +
          (response.stopReason ? ` (stopReason: ${response.stopReason})` : '')
      )
      if (!completion) return undefined
      this.cachedCompletion = {
        key: cacheKey,
        value: completion,
        expiresAt: Date.now() + 5000,
      }
      return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))]
    } catch (error) {
      if (timedOut) {
        this.writeLog(`[InlineCompletion] request timed out after ${timeoutMs}ms`)
        return undefined
      }
      if (abortController.signal.aborted && token.isCancellationRequested) {
        return undefined
      }
      if (abortController.signal.aborted) {
        this.writeLog('[InlineCompletion] request cancelled by a newer completion request')
      } else {
        this.writeLog(
          `[InlineCompletion] request failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      return undefined
    } finally {
      clearTimeout(timeout)
      if (this.activeRequest === abortController) this.activeRequest = undefined
      cancellation.dispose()
    }
  }

  private cleanCompletion(value: string): string {
    let result = value.trim()
    result = result.replace(/^```(?:[a-zA-Z0-9_+-]+)?\s*/, '').replace(/\s*```$/, '')
    // 部分模型会在结果前复述提示标记，丢弃这类协议性前缀。
    const marker = result.indexOf('<|completion|>')
    if (marker >= 0) result = result.slice(marker + '<|completion|>'.length).trimStart()
    return result
  }

  /** 截取完整代码行，避免从半个字符串/表达式中间截断上下文。 */
  private takeCompleteLines(value: string, limit: number, fromEnd: boolean): string {
    if (value.length <= limit) return value
    if (fromEnd) {
      const start = value.length - limit
      const lineStart = value.indexOf('\n', start)
      return lineStart >= 0 ? value.slice(lineStart + 1) : value.slice(start)
    }
    const end = value.lastIndexOf('\n', limit)
    return end > 0 ? value.slice(0, end + 1) : value.slice(0, limit)
  }

  private waitForDebounce(token: vscode.CancellationToken, milliseconds: number): Promise<boolean> {
    if (milliseconds <= 0 || token.isCancellationRequested) {
      return Promise.resolve(!token.isCancellationRequested)
    }

    return new Promise(resolve => {
      const timer = setTimeout(() => {
        cancellation.dispose()
        resolve(true)
      }, milliseconds)
      const cancellation = token.onCancellationRequested(() => {
        clearTimeout(timer)
        cancellation.dispose()
        resolve(false)
      })
    })
  }

  private writeLog(message: string): void {
    console.log(message)
    this.output.appendLine(`${new Date().toISOString()} ${message}`)
  }
}
