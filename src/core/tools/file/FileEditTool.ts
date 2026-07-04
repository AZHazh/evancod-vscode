/**
 * FileEditTool - 文件编辑工具
 *
 * 职责：
 * 1. 精确替换文件中的指定内容
 * 2. 支持查找和替换
 * 3. 保留文件其他部分不变
 *
 * 使用场景：
 * - 修改现有代码
 * - 修复 bug
 * - 更新配置
 * - 重构代码
 *
 * 与 FileWriteTool 的区别：
 * - FileEditTool: 修改文件的部分内容（推荐）
 * - FileWriteTool: 完全重写文件（适合新文件）
 *
 * 示例：
 * User: "把 hello 改成 hi"
 * AI: 调用 edit_file(path="...", old_string="hello", new_string="hi")
 * Tool: 替换内容
 * AI: 告知用户修改完成
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import * as path from 'path'

/**
 * FileEditTool 参数
 */
interface FileEditArgs {
  /**
   * 文件路径（相对于工作目录）
   */
  file_path: string

  /**
   * 要替换的旧内容
   * 必须精确匹配（包括空格、换行）
   */
  old_string: string

  /**
   * 新内容
   */
  new_string: string

  /**
   * 是否替换所有匹配项（可选）
   * 默认：false（只替换第一个匹配）
   */
  replace_all?: boolean
}

/**
 * FileEditTool 实现
 */
export class FileEditTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'edit_file'

  /**
   * 工具描述
   */
  readonly description = '编辑现有文件的内容。通过精确替换指定的文本来修改文件。old_string 必须与文件中的内容完全匹配（包括缩进、换行）。适合修改代码、修复 bug、更新配置等场景。'

  /**
   * 构造函数
   *
   * @param cwd - 工作目录
   * @param fs - 文件系统适配器
   */
  constructor(
    private cwd: string,
    private fs: IFileSystemAdapter
  ) {
    super()
  }

  /**
   * 获取工具定义
   */
  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: '要编辑的文件路径（相对于项目根目录）',
          },
          old_string: {
            type: 'string',
            description: '要替换的旧内容（必须完全匹配，包括缩进和换行）',
          },
          new_string: {
            type: 'string',
            description: '新内容',
          },
          replace_all: {
            type: 'boolean',
            description: '是否替换所有匹配项（默认 false，只替换第一个）',
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    }
  }

  /**
   * 执行文件编辑
   *
   * 流程：
   * 1. 验证参数
   * 2. 解析为绝对路径
   * 3. 安全检查
   * 4. 读取文件内容
   * 5. 查找要替换的内容
   * 6. 执行替换
   * 7. 写回文件
   * 8. 返回结果
   *
   * @param args - 工具参数
   * @returns Promise<ToolResult> 执行结果
   */
  async execute(args: FileEditArgs): Promise<ToolResult> {
    try {
      // 1. 验证参数
      if (!args.file_path) {
        return this.createErrorResult('参数 file_path 不能为空')
      }

      if (args.old_string === undefined || args.old_string === null) {
        return this.createErrorResult('参数 old_string 不能为空')
      }

      if (args.new_string === undefined || args.new_string === null) {
        return this.createErrorResult('参数 new_string 不能为空')
      }

      // 2. 解析为绝对路径
      const absolutePath = path.resolve(this.cwd, args.file_path)

      // 3. 安全检查
      if (!absolutePath.startsWith(this.cwd)) {
        return this.createErrorResult('安全错误：不能访问工作目录外的文件')
      }

      // 检查文件是否存在
      const exists = await this.fs.exists(absolutePath)
      if (!exists) {
        return this.createErrorResult(`文件不存在: ${args.file_path}`)
      }

      // 4. 读取文件内容
      const originalContent = await this.fs.readFile(absolutePath)

      // 5. 查找要替换的内容
      if (!originalContent.includes(args.old_string)) {
        return this.createErrorResult(
          `在文件中找不到指定的内容。请确保 old_string 与文件内容完全匹配（包括缩进、换行等）。\n\n提示：可以先使用 read_file 工具查看文件内容。`
        )
      }

      // 6. 执行替换
      let newContent: string
      let replaceCount: number

      if (args.replace_all) {
        // 替换所有匹配项
        const regex = new RegExp(this.escapeRegex(args.old_string), 'g')
        const matches = originalContent.match(regex)
        replaceCount = matches ? matches.length : 0
        newContent = originalContent.replace(regex, args.new_string)
      } else {
        // 只替换第一个匹配项
        replaceCount = 1
        newContent = originalContent.replace(args.old_string, args.new_string)
      }

      // 检查是否有实际修改
      if (originalContent === newContent) {
        return this.createErrorResult('替换后内容与原内容相同，未进行任何修改')
      }

      // 7. 写回文件
      await this.fs.writeFile(absolutePath, newContent)

      // 8. 返回结果
      const message = `文件已成功编辑: ${args.file_path}\n替换了 ${replaceCount} 处内容`

      return this.createSuccessResult(message, {
        file_path: args.file_path,
        absolutePath,
        replaceCount,
        oldLength: originalContent.length,
        newLength: newContent.length,
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 转义正则表达式特殊字符
   *
   * @param str - 要转义的字符串
   * @returns 转义后的字符串
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
