/**
 * ASTAnalyzerTool - 代码结构分析工具
 *
 * 职责：
 * 1. 解析源代码的抽象语法树（AST）
 * 2. 分析代码结构（类、函数、变量等）
 * 3. 提取代码元素信息
 *
 * 使用场景：
 * - 分析代码结构
 * - 查找函数定义
 * - 理解类层次结构
 * - 代码重构前的分析
 *
 * 支持的语言：
 * - TypeScript/JavaScript（使用 @typescript-eslint/parser）
 * - 其他语言待扩展
 *
 * 示例：
 * User: "分析 src/index.ts 的结构"
 * AI: 调用 analyze_ast(path="src/index.ts")
 * Tool: 解析 AST，提取函数、类等
 * AI: 总结代码结构
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import * as path from 'path'

/**
 * ASTAnalyzerTool 参数
 */
interface ASTAnalyzerArgs {
  /**
   * 文件路径（相对于工作目录）
   */
  path: string

  /**
   * 分析类型（可选）
   * 默认：all
   */
  analysis_type?: 'all' | 'functions' | 'classes' | 'imports' | 'exports'
}

/**
 * 代码元素类型
 */
interface CodeElement {
  /**
   * 元素类型
   */
  type: 'function' | 'class' | 'interface' | 'variable' | 'import' | 'export'

  /**
   * 元素名称
   */
  name: string

  /**
   * 起始行号
   */
  line: number

  /**
   * 参数列表（函数）
   */
  params?: string[]

  /**
   * 返回类型（函数）
   */
  returnType?: string

  /**
   * 属性列表（类）
   */
  properties?: string[]

  /**
   * 方法列表（类）
   */
  methods?: string[]

  /**
   * 是否导出
   */
  exported?: boolean
}

/**
 * ASTAnalyzerTool 实现
 */
export class ASTAnalyzerTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'analyze_ast'

  /**
   * 工具描述
   */
  readonly description = '分析源代码的抽象语法树（AST）。提取函数、类、接口、导入导出等信息。支持 TypeScript/JavaScript。用于理解代码结构、查找定义、重构分析。'

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
          path: {
            type: 'string',
            description: '要分析的源文件路径',
          },
          analysis_type: {
            type: 'string',
            description:
              '分析类型：all（全部）、functions（函数）、classes（类）、imports（导入）、exports（导出）',
          },
        },
        required: ['path'],
      },
    }
  }

  /**
   * 执行 AST 分析
   *
   * 流程：
   * 1. 验证参数
   * 2. 读取文件内容
   * 3. 判断文件类型
   * 4. 解析代码（简化版正则分析）
   * 5. 提取代码元素
   * 6. 返回结果
   *
   * 注意：这是简化版实现，使用正则表达式而不是完整的 AST 解析器
   * 完整实现应使用 @typescript-eslint/parser 等专业工具
   *
   * @param args - 工具参数
   * @returns Promise<ToolResult> 执行结果
   */
  async execute(args: ASTAnalyzerArgs): Promise<ToolResult> {
    try {
      // 1. 验证参数
      if (!args.path) {
        return this.createErrorResult('参数 path 不能为空')
      }

      // 2. 解析为绝对路径
      const absolutePath = path.resolve(this.cwd, args.path)

      // 安全检查
      if (!absolutePath.startsWith(this.cwd)) {
        return this.createErrorResult('安全错误：不能访问工作目录外的文件')
      }

      // 3. 检查文件是否存在
      const exists = await this.fs.exists(absolutePath)
      if (!exists) {
        return this.createErrorResult(`文件不存在: ${args.path}`)
      }

      // 4. 读取文件内容
      const content = await this.fs.readFile(absolutePath)

      // 5. 判断文件类型
      const ext = path.extname(absolutePath)
      if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        return this.createErrorResult(
          `不支持的文件类型: ${ext}。仅支持 .ts, .tsx, .js, .jsx`
        )
      }

      // 6. 解析代码（简化版）
      const elements = this.parseCode(content, args.analysis_type || 'all')

      // 7. 格式化结果
      const message = this.formatAnalysis(elements, args.path)

      return this.createSuccessResult(message, {
        path: args.path,
        elements,
        counts: this.countElements(elements),
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 解析代码（简化版）
   * 使用正则表达式提取代码元素
   *
   * 注意：这是简化实现，不能处理复杂情况
   * 完整实现应使用专业的 AST 解析器
   *
   * @param content - 文件内容
   * @param analysisType - 分析类型
   * @returns CodeElement[] 代码元素列表
   */
  private parseCode(content: string, analysisType: string): CodeElement[] {
    const elements: CodeElement[] = []
    const lines = content.split('\n')

    // 提取函数
    if (analysisType === 'all' || analysisType === 'functions') {
      elements.push(...this.extractFunctions(lines))
    }

    // 提取类
    if (analysisType === 'all' || analysisType === 'classes') {
      elements.push(...this.extractClasses(lines))
    }

    // 提取导入
    if (analysisType === 'all' || analysisType === 'imports') {
      elements.push(...this.extractImports(lines))
    }

    // 提取导出
    if (analysisType === 'all' || analysisType === 'exports') {
      elements.push(...this.extractExports(lines))
    }

    return elements
  }

  /**
   * 提取函数定义
   */
  private extractFunctions(lines: string[]): CodeElement[] {
    const functions: CodeElement[] = []

    // 函数声明模式：function name(...) { }
    const funcPattern = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/

    // 箭头函数模式：const name = (...) => { }
    const arrowPattern = /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/

    lines.forEach((line, index) => {
      const trimmed = line.trim()

      // 匹配函数声明
      let match = trimmed.match(funcPattern)
      if (match) {
        functions.push({
          type: 'function',
          name: match[1],
          line: index + 1,
          params: match[2].split(',').map(p => p.trim()).filter(p => p),
          exported: trimmed.startsWith('export'),
        })
      }

      // 匹配箭头函数
      match = trimmed.match(arrowPattern)
      if (match) {
        functions.push({
          type: 'function',
          name: match[1],
          line: index + 1,
          params: match[2].split(',').map(p => p.trim()).filter(p => p),
          exported: trimmed.startsWith('export'),
        })
      }
    })

    return functions
  }

  /**
   * 提取类定义
   */
  private extractClasses(lines: string[]): CodeElement[] {
    const classes: CodeElement[] = []

    // 类声明模式：class Name { }
    const classPattern = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/

    lines.forEach((line, index) => {
      const trimmed = line.trim()
      const match = trimmed.match(classPattern)

      if (match) {
        classes.push({
          type: 'class',
          name: match[1],
          line: index + 1,
          exported: trimmed.startsWith('export'),
        })
      }
    })

    return classes
  }

  /**
   * 提取导入语句
   */
  private extractImports(lines: string[]): CodeElement[] {
    const imports: CodeElement[] = []

    // 导入模式：import ... from '...'
    const importPattern = /import\s+(?:{([^}]+)}|(\w+)|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/

    lines.forEach((line, index) => {
      const trimmed = line.trim()
      const match = trimmed.match(importPattern)

      if (match) {
        const name = match[1] || match[2] || match[3] || 'unknown'
        imports.push({
          type: 'import',
          name: name.trim(),
          line: index + 1,
        })
      }
    })

    return imports
  }

  /**
   * 提取导出语句
   */
  private extractExports(lines: string[]): CodeElement[] {
    const exports: CodeElement[] = []

    // 导出模式：export { ... }
    const exportPattern = /export\s+{([^}]+)}/

    lines.forEach((line, index) => {
      const trimmed = line.trim()
      const match = trimmed.match(exportPattern)

      if (match) {
        const names = match[1].split(',').map(n => n.trim())
        names.forEach(name => {
          exports.push({
            type: 'export',
            name,
            line: index + 1,
          })
        })
      }
    })

    return exports
  }

  /**
   * 统计元素数量
   */
  private countElements(elements: CodeElement[]): Record<string, number> {
    const counts: Record<string, number> = {}

    elements.forEach(elem => {
      counts[elem.type] = (counts[elem.type] || 0) + 1
    })

    return counts
  }

  /**
   * 格式化分析结果
   */
  private formatAnalysis(elements: CodeElement[], filePath: string): string {
    const lines: string[] = [`代码结构分析: ${filePath}\n`]

    // 统计
    const counts = this.countElements(elements)
    lines.push('统计:')
    Object.entries(counts).forEach(([type, count]) => {
      const typeName = {
        function: '函数',
        class: '类',
        interface: '接口',
        import: '导入',
        export: '导出',
      }[type] || type
      lines.push(`  ${typeName}: ${count}`)
    })

    // 详细信息
    if (elements.length > 0) {
      lines.push('\n详细信息:')

      // 按类型分组
      const grouped: Record<string, CodeElement[]> = {}
      elements.forEach(elem => {
        if (!grouped[elem.type]) grouped[elem.type] = []
        grouped[elem.type].push(elem)
      })

      // 输出每个类型
      Object.entries(grouped).forEach(([type, items]) => {
        const typeName = {
          function: '函数',
          class: '类',
          import: '导入',
          export: '导出',
        }[type] || type

        lines.push(`\n${typeName}:`)
        items.forEach(item => {
          let detail = `  - ${item.name} (行 ${item.line})`
          if (item.params && item.params.length > 0) {
            detail += ` - 参数: ${item.params.join(', ')}`
          }
          if (item.exported) {
            detail += ' [导出]'
          }
          lines.push(detail)
        })
      })
    }

    return lines.join('\n')
  }
}
