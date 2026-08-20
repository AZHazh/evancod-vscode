/**
 * Memory Manager - 记忆管理器
 *
 * 职责：
 * 1. 管理持久化记忆（user/feedback/project/reference）
 * 2. 从会话中提取记忆
 * 3. 在新会话中检索相关记忆
 * 4. 管理 MEMORY.md 索引文件
 *
 * 记忆类型：
 * - user: 用户信息（角色、偏好、技能等）
 * - feedback: 用户反馈（纠正、确认等）
 * - project: 项目信息（目标、约束、决策等）
 * - reference: 外部资源引用
 *
 * 记忆文件格式：
 * ```markdown
 * ---
 * name: user_role
 * description: 用户是一名高级前端工程师
 * type: user
 * ---
 *
 * 用户有 10 年前端开发经验，擅长 React 和 Vue。
 * ```
 *
 * 目录结构：
 * - <workspace>/.evancod/memory/
 *   - MEMORY.md (索引)
 *   - user_role.md
 *   - feedback_testing.md
 *   - project_goals.md
 */

import * as vscode from 'vscode'
import * as path from 'path'

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

export interface MemoryMetadata {
  name: string
  description: string
  type: MemoryType
  createdAt?: string
  updatedAt?: string
}

export interface Memory {
  metadata: MemoryMetadata
  content: string
  filePath: string
}

export interface ProjectMemoryInitializationResult {
  created: string[]
  existing: string[]
  sources: string[]
}

interface ProjectSnapshot {
  projectName: string
  packageManager?: string
  topLevelDirectories: string[]
  sourceDirectories: string[]
  configFiles: string[]
  instructionFiles: string[]
  technologies: string[]
  scripts: Record<string, string>
  workspaces: string[]
  sources: string[]
}

export class MemoryManager {
  private memoryDir?: string
  private legacyMemoryDir?: string
  private memories: Map<string, Memory> = new Map()
  private watcher?: vscode.FileSystemWatcher
  private legacyWatcher?: vscode.FileSystemWatcher
  private reloadTimer?: NodeJS.Timeout
  private initializationPromise?: Promise<void>

  constructor(private context: vscode.ExtensionContext) {
    this.initMemoryDirectory()
  }

  /**
   * 初始化记忆目录
   */
  private initMemoryDirectory(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders && workspaceFolders.length > 0) {
      const rootPath = workspaceFolders[0].uri.fsPath
      this.memoryDir = path.join(rootPath, '.evancod', 'memory')
      this.legacyMemoryDir = path.join(rootPath, '.claude', 'memory')
    }
  }

  /**
   * 初始化 Memory Manager
   */
  async initialize(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeOnce()
    }
    return this.initializationPromise
  }

  private async initializeOnce(): Promise<void> {
    if (!this.memoryDir) {
      console.log('No workspace folder, memory system disabled')
      return
    }

    try {
      await this.ensureMemoryDirectory()
      await this.migrateLegacyMemories()
      await this.loadAllMemories()
      await this.updateMemoryIndex()
      this.setupWatchers()
      console.log(`Loaded ${this.memories.size} memories`)
    } catch (error) {
      console.error('Failed to initialize Memory Manager:', error)
    }
  }

  /**
   * 确保记忆目录存在
   */
  private async ensureMemoryDirectory(): Promise<void> {
    if (!this.memoryDir) return

    try {
      const dirUri = vscode.Uri.file(this.memoryDir)
      await vscode.workspace.fs.stat(dirUri)
    } catch {
      const dirUri = vscode.Uri.file(this.memoryDir)
      await vscode.workspace.fs.createDirectory(dirUri)
      await this.createMemoryIndex()
    }
  }

  /**
   * 创建 MEMORY.md 索引文件
   */
  private async createMemoryIndex(): Promise<void> {
    if (!this.memoryDir) return

    const indexContent = `# Memory Index

This directory contains persistent memories for this project.

## Memory Types

- **user**: Information about the user's role, preferences, and knowledge
- **feedback**: User feedback on AI behavior and decisions
- **project**: Project goals, constraints, and decisions
- **reference**: References to external resources

## Memories

<!-- Memories will be listed here automatically -->
`

    const indexPath = path.join(this.memoryDir, 'MEMORY.md')
    const indexUri = vscode.Uri.file(indexPath)
    await vscode.workspace.fs.writeFile(indexUri, Buffer.from(indexContent, 'utf-8'))
  }

  /**
   * 加载所有记忆
   */
  private async loadAllMemories(): Promise<void> {
    if (!this.memoryDir) return

    this.memories.clear()
    if (this.legacyMemoryDir && (await this.directoryExists(this.legacyMemoryDir))) {
      await this.loadMemoriesFromDirectory(this.legacyMemoryDir)
    }
    await this.loadMemoriesFromDirectory(this.memoryDir)
  }

  private async directoryExists(directory: string): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(directory))
      return stat.type === vscode.FileType.Directory
    } catch {
      return false
    }
  }

  private async migrateLegacyMemories(): Promise<void> {
    if (!this.memoryDir || !this.legacyMemoryDir) return
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.legacyMemoryDir))
      for (const [filename, fileType] of entries) {
        if (
          fileType !== vscode.FileType.File ||
          !filename.endsWith('.md') ||
          filename.toLowerCase() === 'memory.md'
        ) {
          continue
        }
        const target = vscode.Uri.file(path.join(this.memoryDir, filename))
        try {
          await vscode.workspace.fs.stat(target)
          continue
        } catch {
          // 新目录没有同名条目时才迁移，避免覆盖 Evancod 记录。
        }
        const content = await vscode.workspace.fs.readFile(
          vscode.Uri.file(path.join(this.legacyMemoryDir, filename))
        )
        await vscode.workspace.fs.writeFile(target, content)
      }
    } catch {
      // 没有旧目录时无需迁移。
    }
  }

  private async loadMemoriesFromDirectory(directory: string): Promise<void> {
    try {
      const dirUri = vscode.Uri.file(directory)
      const files = await vscode.workspace.fs.readDirectory(dirUri)

      for (const [filename, fileType] of files) {
        if (
          fileType === vscode.FileType.File &&
          filename.endsWith('.md') &&
          filename !== 'MEMORY.md'
        ) {
          const filePath = path.join(directory, filename)
          await this.loadMemory(filePath)
        }
      }
    } catch (error) {
      console.error('Failed to load memories:', error)
    }
  }

  private setupWatchers(): void {
    if (!this.memoryDir || this.watcher) return

    const watch = (directory: string) => {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(directory, '*.md')
      )
      const scheduleReload = (uri: vscode.Uri) => {
        if (path.basename(uri.fsPath).toLowerCase() === 'memory.md') return
        if (this.reloadTimer) clearTimeout(this.reloadTimer)
        this.reloadTimer = setTimeout(() => {
          void this.reloadMemoriesAndIndex()
        }, 100)
      }
      watcher.onDidCreate(scheduleReload)
      watcher.onDidChange(scheduleReload)
      watcher.onDidDelete(scheduleReload)
      this.context.subscriptions.push(watcher)
      return watcher
    }

    this.watcher = watch(this.memoryDir)
    if (this.legacyMemoryDir) {
      this.legacyWatcher = watch(this.legacyMemoryDir)
    }
  }

  private async reloadMemoriesAndIndex(): Promise<void> {
    try {
      await this.loadAllMemories()
      await this.updateMemoryIndex()
    } catch (error) {
      console.error('Failed to refresh memories:', error)
    }
  }

  /**
   * 加载单个记忆
   */
  private async loadMemory(filePath: string): Promise<void> {
    try {
      const fileUri = vscode.Uri.file(filePath)
      const fileData = await vscode.workspace.fs.readFile(fileUri)
      const content = Buffer.from(fileData).toString('utf-8')

      const memory = this.parseMemory(content, filePath)
      if (memory) {
        this.memories.set(memory.metadata.name, memory)
      }
    } catch (error) {
      console.error(`Failed to load memory from ${filePath}:`, error)
    }
  }

  /**
   * 解析记忆文件
   */
  private parseMemory(content: string, filePath: string): Memory | null {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/
    const match = content.match(frontmatterRegex)

    if (!match) return null

    const [, frontmatter, body] = match
    const metadata = this.parseFrontmatter(frontmatter)

    if (!metadata.name || !metadata.type) return null

    return {
      metadata,
      content: body.trim(),
      filePath,
    }
  }

  /**
   * 解析 Frontmatter
   */
  private parseFrontmatter(frontmatter: string): MemoryMetadata {
    const metadata: any = {}
    const lines = frontmatter.split('\n')

    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue

      const key = line.substring(0, colonIndex).trim()
      const value = line
        .substring(colonIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
      metadata[key] = value
    }

    return metadata as MemoryMetadata
  }

  /**
   * 保存记忆
   */
  async saveMemory(
    name: string,
    type: MemoryType,
    description: string,
    content: string
  ): Promise<void> {
    if (!this.memoryDir) {
      throw new Error('Memory system not available (no workspace folder)')
    }

    const now = new Date().toISOString()
    const fileName = `${name}.md`
    const filePath = path.join(this.memoryDir, fileName)

    const metadata: MemoryMetadata = {
      name,
      description,
      type,
      createdAt: now,
      updatedAt: now,
    }

    const frontmatter = Object.entries(metadata)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')

    const fileContent = `---\n${frontmatter}\n---\n\n${content}`

    const fileUri = vscode.Uri.file(filePath)
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(fileContent, 'utf-8'))

    this.memories.set(name, {
      metadata,
      content,
      filePath,
    })

    await this.updateMemoryIndex()
  }

  /**
   * 为 /init 创建一个不依赖 Provider 的项目快照。
   * 这里只读取根目录和少量高价值配置，已有记忆由后续 AI 合并更新。
   */
  async initializeProjectMemories(): Promise<ProjectMemoryInitializationResult> {
    await this.initialize()
    if (!this.memoryDir) {
      throw new Error('Memory system not available (no workspace folder)')
    }

    const projectRoot = path.dirname(path.dirname(this.memoryDir))
    const snapshot = await this.inspectProject(projectRoot)
    const entries = [
      {
        name: 'project_architecture',
        type: 'project' as const,
        description: '项目结构、技术栈与模块入口的基础快照',
        content: this.buildArchitectureMemory(snapshot),
      },
      {
        name: 'development_commands',
        type: 'project' as const,
        description: '从项目配置中读取的开发、构建和测试命令',
        content: this.buildCommandsMemory(snapshot),
      },
      {
        name: 'project_conventions',
        type: 'project' as const,
        description: '项目指令文件和工程配置所定义的约束入口',
        content: this.buildConventionsMemory(snapshot),
      },
    ]

    const created: string[] = []
    const existing: string[] = []
    for (const entry of entries) {
      const fileName = `${entry.name}.md`
      const fileUri = vscode.Uri.file(path.join(this.memoryDir, fileName))
      try {
        await vscode.workspace.fs.stat(fileUri)
        existing.push(fileName)
      } catch {
        await this.saveMemory(entry.name, entry.type, entry.description, entry.content)
        created.push(fileName)
      }
    }

    await this.reloadMemoriesAndIndex()
    return { created, existing, sources: snapshot.sources }
  }

  private async inspectProject(projectRoot: string): Promise<ProjectSnapshot> {
    const ignoredDirectories = new Set([
      '.git',
      '.evancod',
      '.claude',
      'node_modules',
      'dist',
      'out',
      'build',
      'coverage',
      '.next',
      '.nuxt',
      'target',
    ])
    const rootEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(projectRoot))
    const topLevelDirectories = rootEntries
      .filter(([, type]) => type === vscode.FileType.Directory)
      .map(([name]) => name)
      .filter(name => !ignoredDirectories.has(name))
      .sort()
      .slice(0, 40)

    const rootFiles = new Set(
      rootEntries.filter(([, type]) => type === vscode.FileType.File).map(([name]) => name)
    )
    const configCandidates = [
      'package.json',
      'tsconfig.json',
      'jsconfig.json',
      'vite.config.ts',
      'vite.config.js',
      'webpack.config.js',
      'next.config.js',
      'next.config.mjs',
      'nuxt.config.ts',
      'vue.config.js',
      'pyproject.toml',
      'requirements.txt',
      'Cargo.toml',
      'go.mod',
      'pom.xml',
      'build.gradle',
      'build.gradle.kts',
      'docker-compose.yml',
      'Dockerfile',
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.json',
      'eslint.config.js',
      'eslint.config.mjs',
      '.prettierrc',
      '.prettierrc.json',
      'prettier.config.js',
    ]
    const configFiles = configCandidates.filter(file => rootFiles.has(file))
    const instructionFiles = ['AGENTS.md', 'CLAUDE.md'].filter(file => rootFiles.has(file))
    const sources = [...new Set([...configFiles, ...instructionFiles])]

    const sourceRoot = topLevelDirectories.includes('src')
      ? path.join(projectRoot, 'src')
      : undefined
    let sourceDirectories: string[] = []
    if (sourceRoot) {
      try {
        sourceDirectories = (await vscode.workspace.fs.readDirectory(vscode.Uri.file(sourceRoot)))
          .filter(([, type]) => type === vscode.FileType.Directory)
          .map(([name]) => `src/${name}`)
          .sort()
          .slice(0, 40)
      } catch {
        // src 不可读时保留顶层目录信息即可。
      }
    }

    let projectName = path.basename(projectRoot)
    let scripts: Record<string, string> = {}
    let workspaces: string[] = []
    let technologies: string[] = []
    if (rootFiles.has('package.json')) {
      const packageJson = await this.readJsonFile(path.join(projectRoot, 'package.json'))
      if (packageJson) {
        if (typeof packageJson.name === 'string' && packageJson.name.trim()) {
          projectName = packageJson.name.trim()
        }
        if (packageJson.scripts && typeof packageJson.scripts === 'object') {
          scripts = Object.fromEntries(
            Object.entries(packageJson.scripts)
              .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
              .slice(0, 50)
          )
        }
        const rawWorkspaces = Array.isArray(packageJson.workspaces)
          ? packageJson.workspaces
          : packageJson.workspaces?.packages
        if (Array.isArray(rawWorkspaces)) {
          workspaces = rawWorkspaces.filter(
            (item: unknown): item is string => typeof item === 'string'
          )
        }
        const dependencyNames = new Set([
          ...Object.keys(packageJson.dependencies || {}),
          ...Object.keys(packageJson.devDependencies || {}),
        ])
        const technologyMap: Array<[string, string]> = [
          ['typescript', 'TypeScript'],
          ['vue', 'Vue'],
          ['react', 'React'],
          ['@angular/core', 'Angular'],
          ['vite', 'Vite'],
          ['webpack', 'Webpack'],
          ['next', 'Next.js'],
          ['nuxt', 'Nuxt'],
          ['electron', 'Electron'],
          ['express', 'Express'],
          ['@nestjs/core', 'NestJS'],
          ['vitest', 'Vitest'],
          ['jest', 'Jest'],
          ['playwright', 'Playwright'],
        ]
        technologies = technologyMap
          .filter(([dependency]) => dependencyNames.has(dependency))
          .map(([, label]) => label)
      }
    }

    let packageManager: string | undefined
    if (rootFiles.has('pnpm-lock.yaml')) packageManager = 'pnpm'
    else if (rootFiles.has('yarn.lock')) packageManager = 'yarn'
    else if (rootFiles.has('package-lock.json')) packageManager = 'npm'
    else if (rootFiles.has('bun.lockb') || rootFiles.has('bun.lock')) packageManager = 'bun'

    return {
      projectName,
      packageManager,
      topLevelDirectories,
      sourceDirectories,
      configFiles,
      instructionFiles,
      technologies,
      scripts,
      workspaces,
      sources,
    }
  }

  private async readJsonFile(filePath: string): Promise<any | undefined> {
    try {
      const uri = vscode.Uri.file(filePath)
      const stat = await vscode.workspace.fs.stat(uri)
      if (stat.size > 512 * 1024) return undefined
      const data = await vscode.workspace.fs.readFile(uri)
      return JSON.parse(Buffer.from(data).toString('utf-8'))
    } catch {
      return undefined
    }
  }

  private buildArchitectureMemory(snapshot: ProjectSnapshot): string {
    const directoryLines = snapshot.topLevelDirectories.length
      ? snapshot.topLevelDirectories.map(directory => `- \`${directory}/\``).join('\n')
      : '- 未检测到可记录的顶层源码目录'
    const sourceLines = snapshot.sourceDirectories.length
      ? snapshot.sourceDirectories.map(directory => `- \`${directory}/\``).join('\n')
      : '- 未检测到 `src/` 下的一级模块目录'

    return `# 项目架构

> 此文件由 /init 创建基础快照，AI 可在读取源码后补充模块职责。只记录有文件依据的信息。

## 概览

- 项目名称：${snapshot.projectName}
- 包管理器：${snapshot.packageManager || '未从锁文件确认'}
- 已识别技术：${snapshot.technologies.join('、') || '未从 package.json 确认'}
- 工作区配置：${snapshot.workspaces.join('、') || '未检测到'}

## 顶层目录

${directoryLines}

## 源码模块入口

${sourceLines}

## 信息来源

${this.buildSourceList(snapshot.sources)}`
  }

  private buildCommandsMemory(snapshot: ProjectSnapshot): string {
    const scriptLines = Object.keys(snapshot.scripts).length
      ? Object.entries(snapshot.scripts)
          .map(([name, command]) => `- \`${name}\`：\`${command}\``)
          .join('\n')
      : '- 未从项目配置中检测到脚本'

    return `# 开发命令

> 命令直接摘自项目配置；执行前仍应确认本地环境和必要变量。

## 包管理器

${snapshot.packageManager || '未从锁文件确认'}

## 项目脚本

${scriptLines}

## 信息来源

${this.buildSourceList(snapshot.sources.filter(source => source === 'package.json'))}`
  }

  private buildConventionsMemory(snapshot: ProjectSnapshot): string {
    const instructionLines = snapshot.instructionFiles.length
      ? snapshot.instructionFiles.map(file => `- \`${file}\`：项目级 AI/协作指令入口`).join('\n')
      : '- 未在项目根目录检测到 AGENTS.md 或 CLAUDE.md'
    const configLines = snapshot.configFiles.length
      ? snapshot.configFiles.map(file => `- \`${file}\``).join('\n')
      : '- 未检测到常见工程配置文件'

    return `# 项目规范

> 本文件只列出规范来源，不根据代码风格推断用户个人偏好。

## 项目指令

${instructionLines}

## 工程配置

${configLines}

## 使用原则

- 修改代码前优先读取并遵循上述项目指令与相关配置。
- 用户个人偏好仅在用户明确表达后写入独立的 user 类型记忆。

## 信息来源

${this.buildSourceList(snapshot.sources)}`
  }

  private buildSourceList(sources: string[]): string {
    return sources.length ? sources.map(source => `- \`${source}\``).join('\n') : '- 项目目录结构'
  }

  /**
   * 更新 MEMORY.md 索引
   */
  private async updateMemoryIndex(): Promise<void> {
    if (!this.memoryDir) return

    const memories = Array.from(this.memories.values())
    const memoryList = memories
      .map(m => `- [${m.metadata.name}](${path.basename(m.filePath)}) — ${m.metadata.description}`)
      .join('\n')

    const indexContent = `# Memory Index

This directory contains ${memories.length} persistent memories for this project.

## Memories

${memoryList}
`

    const indexPath = path.join(this.memoryDir, 'MEMORY.md')
    const indexUri = vscode.Uri.file(indexPath)
    await vscode.workspace.fs.writeFile(indexUri, Buffer.from(indexContent, 'utf-8'))
  }

  /**
   * 获取记忆
   */
  getMemory(name: string): Memory | undefined {
    return this.memories.get(name)
  }

  /**
   * 按类型获取记忆
   */
  getMemoriesByType(type: MemoryType): Memory[] {
    return Array.from(this.memories.values()).filter(m => m.metadata.type === type)
  }

  /**
   * 列出所有记忆
   */
  listMemories(): Memory[] {
    return Array.from(this.memories.values())
  }

  /**
   * 删除记忆
   */
  async deleteMemory(name: string): Promise<void> {
    const memory = this.memories.get(name)
    if (!memory) return

    const fileUri = vscode.Uri.file(memory.filePath)
    await vscode.workspace.fs.delete(fileUri)
    this.memories.delete(name)

    await this.updateMemoryIndex()
  }

  dispose(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer)
    this.watcher?.dispose()
    this.legacyWatcher?.dispose()
    this.memories.clear()
  }
}
