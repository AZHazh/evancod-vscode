/**
 * NotebookEditTool - Jupyter Notebook 编辑工具
 *
 * 职责：
 * AI Agent 调用此工具编辑 Jupyter Notebook (.ipynb) 文件
 *
 * 使用场景：
 * - 添加代码单元格
 * - 添加 Markdown 说明
 * - 修改现有单元格
 * - 删除单元格
 * - 插入单元格
 *
 * 设计原则：
 * - 适配 VSCode Notebook API
 * - 支持代码和 Markdown 单元格
 * - 保持 Notebook 格式完整性
 * - 支持按索引或 ID 操作单元格
 *
 * 示例：
 * 用户："在 Notebook 中添加数据可视化代码"
 * AI 调用：
 * notebook_edit({
 *   filePath: "analysis.ipynb",
 *   action: "insert",
 *   index: 3,
 *   cellType: "code",
 *   content: "import matplotlib.pyplot as plt\\nplt.plot([1,2,3])"
 * })
 *
 * 参数：
 * - filePath: Notebook 文件路径（必需）
 * - action: 操作类型（insert | replace | delete）
 * - index: 单元格索引（必需）
 * - cellType: 单元格类型（code | markdown）
 * - content: 单元格内容
 */

import * as vscode from 'vscode'
import * as path from 'path'
import { Tool, ToolDefinition, ToolResult } from '../base/Tool'

/**
 * Notebook 操作类型
 */
export type NotebookAction = 'insert' | 'replace' | 'delete'

/**
 * 单元格类型
 */
export type CellType = 'code' | 'markdown'

/**
 * Notebook 数据结构（简化版）
 */
interface NotebookData {
  cells: NotebookCell[]
  metadata: any
  nbformat: number
  nbformat_minor: number
}

interface NotebookCell {
  cell_type: string
  source: string[]
  metadata: any
  execution_count?: number | null
  outputs?: any[]
}

export class NotebookEditTool extends Tool {
  readonly name = 'notebook_edit'
  readonly description =
    '编辑 Jupyter Notebook 文件。支持插入、替换、删除单元格。可以添加代码或 Markdown 内容。'

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
          filePath: {
            type: 'string',
            description:
              'Notebook 文件路径（相对于工作区根目录），必须是 .ipynb 文件，例如 "analysis.ipynb" 或 "notebooks/data_analysis.ipynb"'
          },
          action: {
            type: 'string',
            description: `操作类型：
- insert: 在指定位置插入新单元格
- replace: 替换指定位置的单元格内容
- delete: 删除指定位置的单元格`,
            enum: ['insert', 'replace', 'delete']
          },
          index: {
            type: 'number',
            description:
              '单元格索引（从 0 开始）。insert 操作会在此位置之前插入新单元格。replace 和 delete 操作会操作此位置的单元格。'
          },
          cellType: {
            type: 'string',
            description: `单元格类型（insert 和 replace 操作需要）：
- code: 代码单元格，用于执行 Python、R 等代码
- markdown: Markdown 单元格，用于添加说明文档`,
            enum: ['code', 'markdown']
          },
          content: {
            type: 'string',
            description:
              '单元格内容（insert 和 replace 操作需要）。对于代码单元格，是可执行的代码；对于 Markdown 单元格，是 Markdown 格式的文本。'
          }
        },
        required: ['filePath', 'action', 'index']
      }
    }
  }

  /**
   * 执行工具 - 编辑 Notebook
   *
   * @param args - 工具参数
   * @returns 执行结果
   */
  async execute(args: {
    filePath: string
    action: NotebookAction
    index: number
    cellType?: CellType
    content?: string
  }): Promise<ToolResult> {
    try {
      // 参数验证
      if (!args.filePath || args.filePath.trim().length === 0) {
        return this.createErrorResult('filePath 不能为空')
      }

      if (!args.filePath.endsWith('.ipynb')) {
        return this.createErrorResult('filePath 必须是 .ipynb 文件')
      }

      const validActions: NotebookAction[] = ['insert', 'replace', 'delete']
      if (!validActions.includes(args.action)) {
        return this.createErrorResult(`无效的 action: ${args.action}`)
      }

      if (args.index < 0) {
        return this.createErrorResult('index 不能为负数')
      }

      // insert 和 replace 操作需要 cellType 和 content
      if (args.action === 'insert' || args.action === 'replace') {
        if (!args.cellType) {
          return this.createErrorResult(`${args.action} 操作需要提供 cellType 参数`)
        }
        if (!args.content) {
          return this.createErrorResult(`${args.action} 操作需要提供 content 参数`)
        }

        const validCellTypes: CellType[] = ['code', 'markdown']
        if (!validCellTypes.includes(args.cellType)) {
          return this.createErrorResult(`无效的 cellType: ${args.cellType}`)
        }
      }

      // 获取 Notebook 文件
      const workspaceFolders = vscode.workspace.workspaceFolders
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return this.createErrorResult('没有打开的工作区')
      }

      const workspaceRoot = workspaceFolders[0].uri
      const fileUri = vscode.Uri.joinPath(workspaceRoot, args.filePath)

      // 读取 Notebook
      const notebookData = await this.readNotebook(fileUri)

      // 验证索引
      if (args.action === 'replace' || args.action === 'delete') {
        if (args.index >= notebookData.cells.length) {
          return this.createErrorResult(
            `索引 ${args.index} 超出范围（Notebook 有 ${notebookData.cells.length} 个单元格）`
          )
        }
      }

      // 执行操作
      let result: string
      switch (args.action) {
        case 'insert':
          result = await this.insertCell(
            fileUri,
            notebookData,
            args.index,
            args.cellType!,
            args.content!
          )
          break

        case 'replace':
          result = await this.replaceCell(
            fileUri,
            notebookData,
            args.index,
            args.cellType!,
            args.content!
          )
          break

        case 'delete':
          result = await this.deleteCell(fileUri, notebookData, args.index)
          break

        default:
          return this.createErrorResult(`不支持的操作: ${args.action}`)
      }

      return this.createSuccessResult(result, {
        filePath: args.filePath,
        action: args.action,
        index: args.index,
        cellCount: notebookData.cells.length
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 读取 Notebook
   *
   * @param uri - 文件 URI
   * @returns Notebook 数据
   */
  private async readNotebook(uri: vscode.Uri): Promise<NotebookData> {
    try {
      const fileData = await vscode.workspace.fs.readFile(uri)
      const content = Buffer.from(fileData).toString('utf-8')
      return JSON.parse(content)
    } catch (error) {
      throw new Error(`无法读取 Notebook: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 写入 Notebook
   *
   * @param uri - 文件 URI
   * @param data - Notebook 数据
   */
  private async writeNotebook(uri: vscode.Uri, data: NotebookData): Promise<void> {
    try {
      const content = JSON.stringify(data, null, 2)
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'))
    } catch (error) {
      throw new Error(`无法写入 Notebook: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 插入单元格
   *
   * @param uri - 文件 URI
   * @param data - Notebook 数据
   * @param index - 插入位置
   * @param cellType - 单元格类型
   * @param content - 单元格内容
   * @returns 结果消息
   */
  private async insertCell(
    uri: vscode.Uri,
    data: NotebookData,
    index: number,
    cellType: CellType,
    content: string
  ): Promise<string> {
    // 创建新单元格
    const newCell: NotebookCell = {
      cell_type: cellType,
      source: content.split('\n'),
      metadata: {}
    }

    if (cellType === 'code') {
      newCell.execution_count = null
      newCell.outputs = []
    }

    // 插入单元格
    data.cells.splice(index, 0, newCell)

    // 写入文件
    await this.writeNotebook(uri, data)

    return `✅ 已在位置 ${index} 插入 ${cellType} 单元格

文件: ${vscode.workspace.asRelativePath(uri)}
单元格类型: ${cellType}
内容长度: ${content.length} 字符
总单元格数: ${data.cells.length}

提示: 在 VSCode 中打开此 Notebook 文件以查看结果。`
  }

  /**
   * 替换单元格
   *
   * @param uri - 文件 URI
   * @param data - Notebook 数据
   * @param index - 单元格索引
   * @param cellType - 新单元格类型
   * @param content - 新单元格内容
   * @returns 结果消息
   */
  private async replaceCell(
    uri: vscode.Uri,
    data: NotebookData,
    index: number,
    cellType: CellType,
    content: string
  ): Promise<string> {
    const oldCell = data.cells[index]
    const oldType = oldCell.cell_type

    // 创建新单元格
    const newCell: NotebookCell = {
      cell_type: cellType,
      source: content.split('\n'),
      metadata: oldCell.metadata || {}
    }

    if (cellType === 'code') {
      newCell.execution_count = null
      newCell.outputs = []
    }

    // 替换单元格
    data.cells[index] = newCell

    // 写入文件
    await this.writeNotebook(uri, data)

    return `✅ 已替换位置 ${index} 的单元格

文件: ${vscode.workspace.asRelativePath(uri)}
旧类型: ${oldType}
新类型: ${cellType}
新内容长度: ${content.length} 字符
总单元格数: ${data.cells.length}

提示: 在 VSCode 中打开此 Notebook 文件以查看结果。`
  }

  /**
   * 删除单元格
   *
   * @param uri - 文件 URI
   * @param data - Notebook 数据
   * @param index - 单元格索引
   * @returns 结果消息
   */
  private async deleteCell(uri: vscode.Uri, data: NotebookData, index: number): Promise<string> {
    const deletedCell = data.cells[index]

    // 删除单元格
    data.cells.splice(index, 1)

    // 写入文件
    await this.writeNotebook(uri, data)

    return `✅ 已删除位置 ${index} 的单元格

文件: ${vscode.workspace.asRelativePath(uri)}
删除的单元格类型: ${deletedCell.cell_type}
剩余单元格数: ${data.cells.length}

提示: 在 VSCode 中打开此 Notebook 文件以查看结果。`
  }
}
