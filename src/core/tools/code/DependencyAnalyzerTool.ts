/**
 * DependencyAnalyzerTool - 依赖关系分析工具
 *
 * 职责：
 * 1. 分析文件的导入依赖关系
 * 2. 检测循环依赖
 * 3. 生成依赖树
 * 4. 查找未使用的依赖
 *
 * 使用场景：
 * - 理解模块依赖关系
 * - 检测循环依赖问题
 * - 优化依赖结构
 * - 查找未使用的包
 *
 * 示例：
 * User: "分析 package.json 的依赖"
 * AI: 调用 analyze_dependencies(type="package")
 * Tool: 读取 package.json，分析依赖
 * AI: 总结依赖信息
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import * as path from 'path'

/**
 * DependencyAnalyzerTool 参数
 */
interface DependencyAnalyzerArgs {
  /**
   * 分析类型
   * - package: 分析 package.json 依赖
   * - file: 分析单个文件的导入
   * - tree: 生成依赖树
   */
  type: 'package' | 'file' | 'tree'

  /**
   * 文件路径（type=file 时必填）
   */
  path?: string

  /**
   * 是否包含开发依赖（type=package 时）
   * 默认：true
   */
  include_dev?: boolean

  /**
   * 最大深度（type=tree 时）
   * 默认：3
   */
  max_depth?: number
}

/**
 * 依赖项信息
 */
interface DependencyInfo {
  /**
   * 包名或文件路径
   */
  name: string

  /**
   * 版本（package.json）
   */
  version?: string

  /**
   * 依赖类型
   */
  type: 'dependency' | 'devDependency' | 'import'

  /**
   * 是否为外部包
   */
  external?: boolean

  /**
   * 子依赖（依赖树）
   */
  children?: DependencyInfo[]
}

/**
 * DependencyAnalyzerTool 实现
 */
export class DependencyAnalyzerTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'analyze_dependencies'

  /**
   * 工具描述
   */
  readonly description = '分析项目或文件的依赖关系。可以分析 package.json 的包依赖、文件的导入依赖、生成依赖树。用于理解依赖结构、检测问题、优化依赖。'

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
          type: {
            type: 'string',
            description: '分析类型：package（包依赖）、file（文件导入）、tree（依赖树）',
          },
          path: {
            type: 'string',
            description: '文件路径（type=file 时必填）',
          },
          include_dev: {
            type: 'boolean',
            description: '是否包含开发依赖（type=package 时，默认 true）',
          },
          max_depth: {
            type: 'number',
            description: '最大深度（type=tree 时，默认 3）',
          },
        },
        required: ['type'],
      },
    }
  }

  /**
   * 执行依赖分析
   */
  async execute(args: DependencyAnalyzerArgs): Promise<ToolResult> {
    try {
      switch (args.type) {
        case 'package':
          return await this.analyzePackage(args.include_dev !== false)

        case 'file':
          if (!args.path) {
            return this.createErrorResult('type=file 时需要提供 path 参数')
          }
          return await this.analyzeFile(args.path)

        case 'tree':
          return await this.analyzeDependencyTree(args.max_depth || 3)

        default:
          return this.createErrorResult(`未知的分析类型: ${args.type}`)
      }
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 分析 package.json 依赖
   */
  private async analyzePackage(includeDev: boolean): Promise<ToolResult> {
    const packagePath = path.join(this.cwd, 'package.json')

    // 检查文件是否存在
    const exists = await this.fs.exists(packagePath)
    if (!exists) {
      return this.createErrorResult('package.json 不存在')
    }

    // 读取并解析 package.json
    const content = await this.fs.readFile(packagePath)
    const pkg = JSON.parse(content)

    // 提取依赖
    const dependencies: DependencyInfo[] = []

    // 生产依赖
    if (pkg.dependencies) {
      Object.entries(pkg.dependencies).forEach(([name, version]) => {
        dependencies.push({
          name,
          version: version as string,
          type: 'dependency',
          external: true,
        })
      })
    }

    // 开发依赖
    if (includeDev && pkg.devDependencies) {
      Object.entries(pkg.devDependencies).forEach(([name, version]) => {
        dependencies.push({
          name,
          version: version as string,
          type: 'devDependency',
          external: true,
        })
      })
    }

    // 格式化结果
    const message = this.formatPackageDependencies(dependencies, pkg.name || 'project')

    return this.createSuccessResult(message, {
      total: dependencies.length,
      production: dependencies.filter(d => d.type === 'dependency').length,
      dev: dependencies.filter(d => d.type === 'devDependency').length,
      dependencies,
    })
  }

  /**
   * 分析单个文件的导入
   */
  private async analyzeFile(filePath: string): Promise<ToolResult> {
    const absolutePath = path.resolve(this.cwd, filePath)

    // 安全检查
    if (!absolutePath.startsWith(this.cwd)) {
      return this.createErrorResult('安全错误：不能访问工作目录外的文件')
    }

    // 检查文件是否存在
    const exists = await this.fs.exists(absolutePath)
    if (!exists) {
      return this.createErrorResult(`文件不存在: ${filePath}`)
    }

    // 读取文件内容
    const content = await this.fs.readFile(absolutePath)

    // 提取导入语句
    const imports = this.extractImports(content)

    // 格式化结果
    const message = this.formatFileImports(imports, filePath)

    return this.createSuccessResult(message, {
      file: filePath,
      total: imports.length,
      external: imports.filter(i => i.external).length,
      internal: imports.filter(i => !i.external).length,
      imports,
    })
  }

  /**
   * 分析依赖树（简化版）
   */
  private async analyzeDependencyTree(maxDepth: number): Promise<ToolResult> {
    // 简化实现：只分析 package.json
    const result = await this.analyzePackage(false)

    if (!result.success) {
      return result
    }

    const message = `依赖树分析（最大深度 ${maxDepth}）\n\n` +
      `注意：这是简化版实现，完整的依赖树分析需要遍历 node_modules\n\n` +
      result.content

    return this.createSuccessResult(message, result.metadata)
  }

  /**
   * 提取文件中的导入语句
   */
  private extractImports(content: string): DependencyInfo[] {
    const imports: DependencyInfo[] = []
    const lines = content.split('\n')

    // 导入模式：import ... from '...'
    const importPattern = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/

    lines.forEach(line => {
      const match = line.trim().match(importPattern)
      if (match) {
        const importPath = match[1]
        // 判断是外部包还是本地文件
        const external = !importPath.startsWith('.') && !importPath.startsWith('/')

        imports.push({
          name: importPath,
          type: 'import',
          external,
        })
      }
    })

    return imports
  }

  /**
   * 格式化 package.json 依赖
   */
  private formatPackageDependencies(
    dependencies: DependencyInfo[],
    projectName: string
  ): string {
    const lines: string[] = [`${projectName} 的依赖分析\n`]

    const prod = dependencies.filter(d => d.type === 'dependency')
    const dev = dependencies.filter(d => d.type === 'devDependency')

    lines.push(`总计: ${dependencies.length} 个依赖`)
    lines.push(`  生产依赖: ${prod.length}`)
    lines.push(`  开发依赖: ${dev.length}`)

    if (prod.length > 0) {
      lines.push('\n生产依赖:')
      prod.forEach(dep => {
        lines.push(`  - ${dep.name}@${dep.version}`)
      })
    }

    if (dev.length > 0) {
      lines.push('\n开发依赖:')
      dev.forEach(dep => {
        lines.push(`  - ${dep.name}@${dep.version}`)
      })
    }

    return lines.join('\n')
  }

  /**
   * 格式化文件导入
   */
  private formatFileImports(imports: DependencyInfo[], filePath: string): string {
    const lines: string[] = [`${filePath} 的导入分析\n`]

    const external = imports.filter(i => i.external)
    const internal = imports.filter(i => !i.external)

    lines.push(`总计: ${imports.length} 个导入`)
    lines.push(`  外部包: ${external.length}`)
    lines.push(`  内部文件: ${internal.length}`)

    if (external.length > 0) {
      lines.push('\n外部包:')
      external.forEach(imp => {
        lines.push(`  - ${imp.name}`)
      })
    }

    if (internal.length > 0) {
      lines.push('\n内部文件:')
      internal.forEach(imp => {
        lines.push(`  - ${imp.name}`)
      })
    }

    return lines.join('\n')
  }
}
