/**
 * LSPTool - Language Server Protocol 工具
 *
 * 职责：
 * AI Agent 调用此工具使用 VSCode 的 LSP 能力进行代码分析
 *
 * 使用场景：
 * - 查找符号定义（Go to Definition）
 * - 查找符号引用（Find References）
 * - 获取诊断信息（Errors、Warnings）
 * - 查找符号实现（Go to Implementation）
 * - 获取符号类型信息（Type Definition）
 *
 * 设计原则：
 * - 利用 VSCode 原生 LSP 能力
 * - 支持所有语言（通过已安装的语言服务器）
 * - 返回结构化的代码位置信息
 *
 * 示例：
 * 用户："找到 getUserById 函数的所有调用位置"
 * AI 调用：
 * lsp({
 *   action: "findReferences",
 *   filePath: "src/services/UserService.ts",
 *   line: 45,
 *   character: 10
 * })
 *
 * 参数：
 * - action: 操作类型（definition | references | implementations | diagnostics | typeDefinition）
 * - filePath: 文件路径（必需）
 * - line: 行号（部分操作需要）
 * - character: 列号（部分操作需要）
 */

import * as vscode from 'vscode'
import { Tool, ToolDefinition, ToolResult } from '../base/Tool'

/**
 * LSP 操作类型
 */
export type LSPAction = 'definition' | 'references' | 'implementations' | 'diagnostics' | 'typeDefinition'

/**
 * 位置信息
 */
interface LocationInfo {
  filePath: string
  line: number
  character: number
  text?: string
}

export class LSPTool extends Tool {
  readonly name = 'lsp'
  readonly description =
    '使用 VSCode 的 Language Server Protocol 能力进行代码分析。支持查找定义、查找引用、查找实现、获取诊断信息、获取类型定义。'

  /**
   * 获取工具定义
   *
   * @returns Anthropic 工具定义
   */
  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: `操作类型：
- definition: 查找符号定义（Go to Definition），找到变量、函数、类等的定义位置
- references: 查找符号引用（Find References），找到符号在哪些地方被使用
- implementations: 查找接口实现（Go to Implementation），找到接口或抽象类的具体实现
- diagnostics: 获取文件诊断信息（Errors/Warnings），找出代码中的错误和警告
- typeDefinition: 获取类型定义（Go to Type Definition），找到变量的类型定义`,
            enum: ['definition', 'references', 'implementations', 'diagnostics', 'typeDefinition']
          },
          filePath: {
            type: 'string',
            description: '文件路径（相对于工作区根目录），例如 "src/services/UserService.ts"'
          },
          line: {
            type: 'number',
            description: '行号（从 0 开始）。对于 definition、references、implementations、typeDefinition 操作是必需的。'
          },
          character: {
            type: 'number',
            description: '列号（从 0 开始）。对于 definition、references、implementations、typeDefinition 操作是必需的。'
          }
        },
        required: ['action', 'filePath']
      }
    }
  }

  /**
   * 执行工具 - LSP 操作
   *
   * @param args - 工具参数
   * @returns 执行结果
   */
  async execute(args: {
    action: LSPAction
    filePath: string
    line?: number
    character?: number
  }): Promise<ToolResult> {
    try {
      // 参数验证
      if (!args.action) {
        return this.createErrorResult('action 不能为空')
      }

      const validActions: LSPAction[] = [
        'definition',
        'references',
        'implementations',
        'diagnostics',
        'typeDefinition'
      ]
      if (!validActions.includes(args.action)) {
        return this.createErrorResult(`无效的 action: ${args.action}`)
      }

      if (!args.filePath || args.filePath.trim().length === 0) {
        return this.createErrorResult('filePath 不能为空')
      }

      // 对于需要位置的操作，验证 line 和 character
      const needsPosition = ['definition', 'references', 'implementations', 'typeDefinition']
      if (needsPosition.includes(args.action)) {
        if (args.line === undefined) {
          return this.createErrorResult(`${args.action} 操作需要提供 line 参数`)
        }
        if (args.character === undefined) {
          return this.createErrorResult(`${args.action} 操作需要提供 character 参数`)
        }
      }

      // 获取文档 URI
      const workspaceFolders = vscode.workspace.workspaceFolders
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return this.createErrorResult('没有打开的工作区')
      }

      const workspaceRoot = workspaceFolders[0].uri
      const fileUri = vscode.Uri.joinPath(workspaceRoot, args.filePath)

      // 打开文档
      let document: vscode.TextDocument
      try {
        document = await vscode.workspace.openTextDocument(fileUri)
      } catch (error) {
        return this.createErrorResult(`无法打开文件: ${args.filePath}`)
      }

      // 执行对应的 LSP 操作
      switch (args.action) {
        case 'definition':
          return await this.findDefinition(document, args.line!, args.character!)

        case 'references':
          return await this.findReferences(document, args.line!, args.character!)

        case 'implementations':
          return await this.findImplementations(document, args.line!, args.character!)

        case 'diagnostics':
          return await this.getDiagnostics(document)

        case 'typeDefinition':
          return await this.findTypeDefinition(document, args.line!, args.character!)

        default:
          return this.createErrorResult(`不支持的操作: ${args.action}`)
      }
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 查找定义
   *
   * @param document - 文档
   * @param line - 行号
   * @param character - 列号
   * @returns 执行结果
   */
  private async findDefinition(
    document: vscode.TextDocument,
    line: number,
    character: number
  ): Promise<ToolResult> {
    const position = new vscode.Position(line, character)

    // 调用 VSCode 的 Definition Provider
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider',
      document.uri,
      position
    )

    if (!locations || locations.length === 0) {
      return this.createSuccessResult('未找到定义', { count: 0, locations: [] })
    }

    // 格式化位置信息
    const locationInfos = await this.formatLocations(locations)

    const content = `✅ 找到 ${locations.length} 个定义

${locationInfos.map((info, index) => `${index + 1}. ${info.filePath}:${info.line + 1}:${info.character + 1}
   ${info.text || ''}`).join('\n\n')}

提示: 使用 read_file 读取这些文件以查看完整定义。`

    return this.createSuccessResult(content, {
      count: locations.length,
      locations: locationInfos
    })
  }

  /**
   * 查找引用
   *
   * @param document - 文档
   * @param line - 行号
   * @param character - 列号
   * @returns 执行结果
   */
  private async findReferences(
    document: vscode.TextDocument,
    line: number,
    character: number
  ): Promise<ToolResult> {
    const position = new vscode.Position(line, character)

    // 调用 VSCode 的 References Provider
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      document.uri,
      position
    )

    if (!locations || locations.length === 0) {
      return this.createSuccessResult('未找到引用', { count: 0, locations: [] })
    }

    // 格式化位置信息
    const locationInfos = await this.formatLocations(locations)

    // 按文件分组
    const groupedByFile = this.groupLocationsByFile(locationInfos)

    const content = `✅ 找到 ${locations.length} 个引用（分布在 ${Object.keys(groupedByFile).length} 个文件中）

${Object.entries(groupedByFile)
  .map(
    ([filePath, locs]) =>
      `📄 ${filePath} (${locs.length} 个引用):\n${locs.map((loc) => `   - 行 ${loc.line + 1}:${loc.character + 1}: ${loc.text || ''}`).join('\n')}`
  )
  .join('\n\n')}

提示: 使用 read_file 读取这些文件以查看引用上下文。`

    return this.createSuccessResult(content, {
      count: locations.length,
      fileCount: Object.keys(groupedByFile).length,
      locations: locationInfos
    })
  }

  /**
   * 查找实现
   *
   * @param document - 文档
   * @param line - 行号
   * @param character - 列号
   * @returns 执行结果
   */
  private async findImplementations(
    document: vscode.TextDocument,
    line: number,
    character: number
  ): Promise<ToolResult> {
    const position = new vscode.Position(line, character)

    // 调用 VSCode 的 Implementation Provider
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeImplementationProvider',
      document.uri,
      position
    )

    if (!locations || locations.length === 0) {
      return this.createSuccessResult('未找到实现', { count: 0, locations: [] })
    }

    // 格式化位置信息
    const locationInfos = await this.formatLocations(locations)

    const content = `✅ 找到 ${locations.length} 个实现

${locationInfos.map((info, index) => `${index + 1}. ${info.filePath}:${info.line + 1}:${info.character + 1}
   ${info.text || ''}`).join('\n\n')}

提示: 使用 read_file 读取这些文件以查看具体实现。`

    return this.createSuccessResult(content, {
      count: locations.length,
      locations: locationInfos
    })
  }

  /**
   * 获取诊断信息
   *
   * @param document - 文档
   * @returns 执行结果
   */
  private async getDiagnostics(document: vscode.TextDocument): Promise<ToolResult> {
    // 获取文档的诊断信息
    const diagnostics = vscode.languages.getDiagnostics(document.uri)

    if (diagnostics.length === 0) {
      return this.createSuccessResult('✅ 文件没有错误或警告', {
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        diagnostics: []
      })
    }

    // 按严重程度分类
    const errors = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
    const warnings = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning)
    const infos = diagnostics.filter(
      (d) =>
        d.severity === vscode.DiagnosticSeverity.Information ||
        d.severity === vscode.DiagnosticSeverity.Hint
    )

    const content = `📋 诊断信息

文件: ${document.uri.fsPath}
错误: ${errors.length} 个
警告: ${warnings.length} 个
信息: ${infos.length} 个

${errors.length > 0 ? `❌ 错误:\n${errors.map((d, i) => `${i + 1}. 行 ${d.range.start.line + 1}: ${d.message}\n   来源: ${d.source || '未知'}`).join('\n\n')}` : ''}

${warnings.length > 0 ? `⚠️  警告:\n${warnings.map((d, i) => `${i + 1}. 行 ${d.range.start.line + 1}: ${d.message}\n   来源: ${d.source || '未知'}`).join('\n\n')}` : ''}

${infos.length > 0 ? `ℹ️  信息:\n${infos.map((d, i) => `${i + 1}. 行 ${d.range.start.line + 1}: ${d.message}`).join('\n\n')}` : ''}

提示: 使用 read_file 读取文件以查看具体代码。`

    return this.createSuccessResult(content, {
      errorCount: errors.length,
      warningCount: warnings.length,
      infoCount: infos.length,
      diagnostics: diagnostics.map((d) => ({
        line: d.range.start.line,
        character: d.range.start.character,
        message: d.message,
        severity: d.severity,
        source: d.source
      }))
    })
  }

  /**
   * 查找类型定义
   *
   * @param document - 文档
   * @param line - 行号
   * @param character - 列号
   * @returns 执行结果
   */
  private async findTypeDefinition(
    document: vscode.TextDocument,
    line: number,
    character: number
  ): Promise<ToolResult> {
    const position = new vscode.Position(line, character)

    // 调用 VSCode 的 Type Definition Provider
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeTypeDefinitionProvider',
      document.uri,
      position
    )

    if (!locations || locations.length === 0) {
      return this.createSuccessResult('未找到类型定义', { count: 0, locations: [] })
    }

    // 格式化位置信息
    const locationInfos = await this.formatLocations(locations)

    const content = `✅ 找到 ${locations.length} 个类型定义

${locationInfos.map((info, index) => `${index + 1}. ${info.filePath}:${info.line + 1}:${info.character + 1}
   ${info.text || ''}`).join('\n\n')}

提示: 使用 read_file 读取这些文件以查看完整类型定义。`

    return this.createSuccessResult(content, {
      count: locations.length,
      locations: locationInfos
    })
  }

  /**
   * 格式化位置信息
   *
   * @param locations - VSCode 位置列表
   * @returns 位置信息列表
   */
  private async formatLocations(locations: vscode.Location[]): Promise<LocationInfo[]> {
    const result: LocationInfo[] = []

    for (const location of locations) {
      // 读取位置所在行的文本
      let text: string | undefined
      try {
        const document = await vscode.workspace.openTextDocument(location.uri)
        const line = document.lineAt(location.range.start.line)
        text = line.text.trim()
      } catch (error) {
        // 读取失败，忽略
      }

      result.push({
        filePath: vscode.workspace.asRelativePath(location.uri),
        line: location.range.start.line,
        character: location.range.start.character,
        text
      })
    }

    return result
  }

  /**
   * 按文件分组位置信息
   *
   * @param locations - 位置信息列表
   * @returns 按文件分组的位置信息
   */
  private groupLocationsByFile(locations: LocationInfo[]): Record<string, LocationInfo[]> {
    const grouped: Record<string, LocationInfo[]> = {}

    for (const location of locations) {
      if (!grouped[location.filePath]) {
        grouped[location.filePath] = []
      }
      grouped[location.filePath].push(location)
    }

    return grouped
  }
}
