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
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { MemoryStore } from './MemoryStore'
import { assertSafeMemory, candidateDecision, containsSensitiveData } from './MemoryPolicy'
import {
  extractAssistantDecision,
  extractExplicitMemory,
  extractUserMemories,
  stableMemoryId,
} from './MemoryExtractor'
import { reconcileMemory } from './MemoryReconciler'
import { retrieveMemories } from './MemoryRetriever'
import type { MemoryCandidate, MemoryRecord, MemoryRetrievalRequest } from './MemoryTypes'
import type { MemorySemanticExtractor } from './LLMMemoryExtractor'

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
  private stores = new Map<string, MemoryStore>()
  private entryWatchers: vscode.FileSystemWatcher[] = []
  private storeReloadTimers = new Map<string, NodeJS.Timeout>()
  private maintenanceTimer?: NodeJS.Timeout
  private metrics = { candidates: 0, automatic: 0, rejected: 0, conflicts: 0 }
  private globalStore: MemoryStore
  private semanticExtractor?: MemorySemanticExtractor

  constructor(private context: vscode.ExtensionContext) {
    this.initMemoryDirectory()
    this.globalStore = new MemoryStore(path.join(context.globalStorageUri.fsPath, 'memory'))
  }

  /**
   * 注册基于模型的多语言语义提取器。
   */
  setSemanticExtractor(extractor: MemorySemanticExtractor): void {
    this.semanticExtractor = extractor
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
    try {
      await this.globalStore.initialize()
      this.watchStore(this.globalStore)
      for (const folder of vscode.workspace.workspaceFolders || []) {
        const root = folder.uri.fsPath
        const directory = path.join(root, '.evancod', 'memory')
        const store = new MemoryStore(directory, path.join(root, '.claude', 'memory'), root)
        await store.initialize()
        this.stores.set(root, store)
        this.watchStore(store)
      }
      if (this.memoryDir) {
        await this.loadAllMemories()
        this.setupWatchers()
      }
      this.maintenanceTimer = setInterval(() => {
        void this.maintain().catch(error => console.error('Memory maintenance failed:', error))
      }, 30 * 60 * 1000)
      void this.maintain().catch(error => console.error('Memory maintenance failed:', error))
      console.log(`Loaded ${this.memories.size} memories`)
    } catch (error) {
      console.error('Failed to initialize Memory Manager:', error)
    }
  }

  private watchStore(store: MemoryStore): void {
    for (const pattern of ['entries/*.md', '*.md', 'candidates/*.json']) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(store.directory, pattern))
      const reload = () => {
        const previous = this.storeReloadTimers.get(store.directory)
        if (previous) clearTimeout(previous)
        this.storeReloadTimers.set(store.directory, setTimeout(() => {
          this.storeReloadTimers.delete(store.directory)
          void store.reload().then(() => store.rebuildIndex()).catch(error => console.error('Memory reload failed:', error))
        }, 200))
      }
      watcher.onDidCreate(reload)
      watcher.onDidChange(reload)
      watcher.onDidDelete(reload)
      this.entryWatchers.push(watcher)
      this.context.subscriptions.push(watcher)
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
      const store = this.memoryDir ? this.stores.get(path.dirname(path.dirname(this.memoryDir))) : undefined
      await store?.reload()
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
    content: string,
    sources: string[] = [],
    workspace?: string
  ): Promise<void> {
    const folder = workspace ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workspace)) : undefined
    if (workspace && !folder) throw new Error('工作目录不属于已打开的工作区')
    const root = folder?.uri.fsPath || (this.memoryDir && path.dirname(path.dirname(this.memoryDir)))
    if (!root) {
      throw new Error('Memory system not available (no workspace folder)')
    }
    await this.initialize()
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(name)) throw new Error('非法记忆名称')
    const store = this.stores.get(root)!
    const now = new Date().toISOString()
    const kind = type === 'user' ? 'preference' : type === 'feedback' ? 'feedback'
      : name === 'project_conventions' ? 'convention' : 'fact'
    const id = stableMemoryId('workspace', kind, name, root)
    const evidence = await Promise.all(sources.map(async ref => {
      const filename = path.resolve(root, ref)
      if (!filename.startsWith(root + path.sep)) throw new Error('配置来源不在工作区内')
      const quote = `sha256:${createHash('sha256').update(await fs.readFile(filename)).digest('hex')}`
      return { type: 'file' as const, ref, quote, capturedAt: now }
    }))
    await store.save({
      id, scope: 'workspace', scopePath: root, kind, subject: name, description, content,
      status: 'active', confidence: sources.length ? 1 : 0.8, confirmed: false,
      sources: evidence,
      tags: [], createdAt: store.get(id)?.createdAt || now, updatedAt: now,
      ...(sources.length ? { lastVerifiedAt: now } : {}),
    }, 'init')
    const metadata: MemoryMetadata = {
      name,
      description,
      type,
      createdAt: now,
      updatedAt: now,
    }

    if (this.memoryDir && root === path.dirname(path.dirname(this.memoryDir))) {
      this.memories.set(name, {
        metadata,
        content,
        filePath: path.join(store.directory, 'entries', `${id}.md`),
      })
    }
  }

  /**
   * 为 /init 创建一个不依赖 Provider 的项目快照。
   * 这里只读取根目录和少量高价值配置，已有记忆由后续 AI 合并更新。
   */
  async initializeProjectMemories(workspace?: string): Promise<ProjectMemoryInitializationResult> {
    await this.initialize()
    const folder = workspace ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workspace)) : undefined
    if (workspace && !folder) throw new Error('工作目录不属于已打开的工作区')
    const projectRoot = folder?.uri.fsPath || (this.memoryDir && path.dirname(path.dirname(this.memoryDir)))
    if (!projectRoot) {
      throw new Error('Memory system not available (no workspace folder)')
    }
    const snapshot = await this.inspectProject(projectRoot)
    const entries = [
      {
        name: 'project_architecture',
        type: 'project' as const,
        description: '项目结构、技术栈与模块入口的基础快照',
        content: this.buildArchitectureMemory(snapshot),
        sources: snapshot.sources,
      },
      {
        name: 'development_commands',
        type: 'project' as const,
        description: '从项目配置中读取的开发、构建和测试命令',
        content: this.buildCommandsMemory(snapshot),
        sources: snapshot.sources.filter(source => source === 'package.json'),
      },
      {
        name: 'project_conventions',
        type: 'project' as const,
        description: '项目指令文件和工程配置所定义的约束入口',
        content: this.buildConventionsMemory(snapshot),
        sources: [...snapshot.instructionFiles, ...snapshot.configFiles.filter(source => /prettier|eslint|tsconfig/.test(source))],
      },
    ]

    const created: string[] = []
    const existing: string[] = []
    for (const entry of entries) {
      const kind = entry.name === 'project_conventions' ? 'convention' : 'fact'
      const id = stableMemoryId('workspace', kind, entry.name, projectRoot)
      const fileName = `entries/${id}.md`
      if (this.stores.get(projectRoot)?.get(id) || (this.memoryDir && projectRoot === path.dirname(path.dirname(this.memoryDir)) && this.memories.has(entry.name))) {
        existing.push(fileName)
        continue
      }
      await this.saveMemory(entry.name, entry.type, entry.description, entry.content, entry.sources, projectRoot)
      created.push(fileName)
    }

    const store = this.stores.get(projectRoot)
    await store?.reload()
    await store?.rebuildIndex()
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
    const store = this.stores.get(path.dirname(path.dirname(this.memoryDir)))
    if (store) {
      await store.rebuildIndex()
      return
    }

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
    const root = path.dirname(path.dirname(this.memoryDir!))
    const store = this.stores.get(root)
    const record = store?.list().find(item => item.subject === name)
    if (record) {
      await store!.save({ ...record, status: 'expired', updatedAt: new Date().toISOString() }, 'forget')
    } else {
      await vscode.workspace.fs.delete(vscode.Uri.file(memory.filePath))
    }
    this.memories.delete(name)
    await this.updateMemoryIndex()
  }

  dispose(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer)
    this.watcher?.dispose()
    this.legacyWatcher?.dispose()
    this.entryWatchers.forEach(watcher => watcher.dispose())
    this.storeReloadTimers.forEach(timer => clearTimeout(timer))
    this.storeReloadTimers.clear()
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer)
    this.memories.clear()
  }

  private storeFor(workspace?: string, scope?: string): MemoryStore | undefined {
    if (scope === 'global') return this.globalStore
    const folder = workspace && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workspace))
    return folder ? this.stores.get(folder.uri.fsPath) : undefined
  }

  list(filter?: { workspace?: string; status?: MemoryRecord['status'] }): MemoryRecord[] {
    const stores = filter?.workspace
      ? [this.globalStore, this.storeFor(filter.workspace)].filter((store): store is MemoryStore => Boolean(store))
      : [this.globalStore, ...this.stores.values()]
    return stores.flatMap(store => store.list()).filter(record => !filter?.status || record.status === filter.status)
  }

  pending(workspace?: string): MemoryCandidate[] {
    const stores = [this.globalStore, ...(workspace ? [this.storeFor(workspace)] : [...this.stores.values()])]
    return stores.filter((store): store is MemoryStore => Boolean(store)).flatMap(store => store.pending())
  }

  async propose(candidate: MemoryCandidate, workspace?: string): Promise<'saved' | 'pending' | 'conflict'> {
    await this.initialize()
    assertSafeMemory(candidate)
    const store = this.storeFor(workspace, candidate.scope)
    if (!store) throw new Error('当前工作区不支持此作用域的记忆')
    const outcome = reconcileMemory(candidate, store.list())
    if (outcome.conflict) {
      await store.propose(outcome.conflict)
      this.metrics.candidates++
      this.metrics.conflicts++
      if (outcome.previous) {
        await store.save({ ...outcome.previous, status: 'disputed', updatedAt: new Date().toISOString() }, 'dispute')
      }
      return 'conflict'
    }
    if (candidate.decision === 'automatic' && candidateDecision(candidate) === 'automatic') {
      await store.save(outcome.record!, 'automatic')
      this.metrics.automatic++
      return 'saved'
    }
    await store.propose(candidate)
    this.metrics.candidates++
    return 'pending'
  }

  async remember(text: string, workspace?: string): Promise<'saved' | 'pending' | 'conflict' | 'ignored'> {
    const root = workspace && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workspace))?.uri.fsPath
    const candidate = extractExplicitMemory(text, root)
    return candidate ? this.propose(candidate, workspace) : 'ignored'
  }

  async captureUserMessage(text: string, workspace?: string, messageId?: string): Promise<void> {
    if (containsSensitiveData(text)) {
      this.metrics.rejected++
      return
    }
    const root = workspace && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workspace))?.uri.fsPath
    const candidates = await this.extractUserCandidates(text, root)
    for (const candidate of candidates) {
      candidate.sources[0].ref = messageId
      try {
        await this.propose(candidate, workspace)
      } catch (error) {
        console.warn('Memory candidate rejected:', error instanceof Error ? error.message : 'unknown')
      }
    }
  }

  async captureAssistantReply(text: string, workspace?: string, messageId?: string): Promise<void> {
    if (containsSensitiveData(text)) {
      this.metrics.rejected++
      return
    }
    const root = workspace && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workspace))?.uri.fsPath
    const candidates = await this.extractAssistantCandidates(text, root)
    for (const candidate of candidates) {
      if (this.list({ workspace: root, status: 'active' }).some(record =>
        record.scope === candidate.scope && record.scopePath === candidate.scopePath &&
        record.kind === candidate.kind && record.subject === candidate.subject &&
        record.content === candidate.content
      )) continue
      candidate.sources[0].ref = messageId
      await this.propose(candidate, workspace)
    }
  }

  /**
   * 优先使用模型理解用户语义，并合并规则提取结果作为离线兜底。
   */
  private async extractUserCandidates(text: string, workspace?: string): Promise<MemoryCandidate[]> {
    const fallback = extractUserMemories(text, workspace)
    if (!this.semanticExtractor) return fallback
    try {
      const semantic = await this.semanticExtractor.extractUserMemories(text, {
        workspace,
        existingMemories: this.list({ workspace, status: 'active' }),
      })
      return semantic.length ? semantic : fallback
    } catch (error) {
      console.warn(
        'Semantic memory extraction failed, using fallback:',
        error instanceof Error ? error.message : 'unknown'
      )
      return fallback
    }
  }

  /**
   * 使用模型识别多语言的已落定决策，失败时退回本地规则。
   */
  private async extractAssistantCandidates(
    text: string,
    workspace?: string
  ): Promise<MemoryCandidate[]> {
    const fallback = extractAssistantDecision(text, workspace)
    if (!this.semanticExtractor) return fallback ? [fallback] : []
    try {
      const semantic = await this.semanticExtractor.extractAssistantMemories(text, {
        workspace,
        existingMemories: this.list({ workspace, status: 'active' }),
      })
      return semantic.length ? semantic : fallback ? [fallback] : []
    } catch (error) {
      console.warn(
        'Semantic memory extraction failed, using fallback:',
        error instanceof Error ? error.message : 'unknown'
      )
      return fallback ? [fallback] : []
    }
  }

  async confirm(id: string, workspace?: string): Promise<MemoryRecord> {
    const store = [this.globalStore, this.storeFor(workspace)].find(item => item?.pending().some(candidate => candidate.id === id))
    const candidate = store?.pending().find(item => item.id === id)
    if (!store || !candidate) throw new Error('候选记忆不存在')
    const now = new Date().toISOString()
    const formalRecord = { ...candidate }
    Reflect.deleteProperty(formalRecord, 'decision')
    const record: MemoryRecord = { ...formalRecord, status: 'active', confirmed: true, confidence: 1, updatedAt: now }
    for (const relatedId of candidate.relatedIds || []) {
      const previous = store.get(relatedId)
      if (previous) await store.save({ ...previous, status: 'superseded', updatedAt: now }, 'supersede')
    }
    await store.save(record, 'confirm')
    await store.removeCandidate(id)
    return record
  }

  async reject(id: string, workspace?: string): Promise<void> {
    const store = [this.globalStore, this.storeFor(workspace)].find(item => item?.pending().some(candidate => candidate.id === id))
    if (!store) throw new Error('候选记忆不存在')
    const candidate = store.pending().find(item => item.id === id)!
    await store.reject(id)
    this.metrics.rejected++
    for (const relatedId of candidate.relatedIds || []) {
      const previous = store.get(relatedId)
      if (previous?.status === 'disputed') {
        await store.save({ ...previous, status: 'active', updatedAt: new Date().toISOString() }, 'restore')
      }
    }
  }

  retrieve(request: MemoryRetrievalRequest): MemoryRecord[] {
    const root = request.workspace && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(request.workspace))?.uri.fsPath
    const records = [this.globalStore.list(), ...(root ? [this.stores.get(root)?.list() || []] : [])].flat()
    const result = retrieveMemories(records, { ...request, workspace: root })
    for (const record of result) {
      const store = this.storeFor(request.workspace, record.scope)
      if (store) {
        void store.touch(record.id).catch(error => console.error('Memory usage update failed:', error))
      }
    }
    return result
  }

  async update(id: string, patch: Partial<Pick<MemoryRecord, 'content' | 'description' | 'status' | 'tags'>>, workspace?: string): Promise<MemoryRecord> {
    const store = [this.globalStore, this.storeFor(workspace)].find(item => item?.get(id))
    const previous = store?.get(id)
    if (!store || !previous) throw new Error('记忆不存在')
    const now = new Date().toISOString()
    const edited = patch.content !== undefined || patch.description !== undefined
    const record = {
      ...previous, ...patch, updatedAt: now,
      ...(edited ? {
        confirmed: true, confidence: 1,
        sources: [...previous.sources, { type: 'user' as const, capturedAt: now }],
      } : {}),
    }
    await store.save(record, 'edit')
    return record
  }

  async forget(id: string, workspace?: string): Promise<void> {
    await this.update(id, { status: 'expired' }, workspace)
  }

  async archiveScope(scope: 'task' | 'session', scopePath: string, workspace?: string): Promise<void> {
    const store = this.storeFor(workspace)
    if (!store) return
    for (const record of store.list()) {
      if (record.scope === scope && record.scopePath === scopePath && record.status === 'active') {
        await store.save({ ...record, status: 'expired', updatedAt: new Date().toISOString() }, 'archive')
      }
    }
  }

  async restore(id: string, workspace?: string): Promise<MemoryRecord> {
    const store = [this.globalStore, this.storeFor(workspace)].find(item => item?.get(id))
    if (!store) throw new Error('记忆不存在')
    return store.restore(id)
  }

  async maintain(workspace?: string): Promise<void> {
    const started = Date.now()
    let expired = 0
    let disputed = 0
    for (const store of [this.globalStore, ...(workspace ? [this.storeFor(workspace)] : [...this.stores.values()])]) {
      if (!store) continue
      await store.reload()
      for (const record of store.list()) {
        if (record.status === 'active' && record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
          await store.save({ ...record, status: 'expired', updatedAt: new Date().toISOString() }, 'expire')
          expired++
          continue
        }
        if (record.status !== 'active' || record.scope === 'global') continue
        const fileEvidence = record.sources.filter(source => source.type === 'file' && source.quote?.startsWith('sha256:'))
        for (const source of fileEvidence) {
          try {
            const root = this.storeRoot(store)
            const filename = path.resolve(root, source.ref || '')
            if (!filename.startsWith(root + path.sep)) throw new Error('来源文件超出工作区')
            const digest = `sha256:${createHash('sha256').update(await fs.readFile(filename)).digest('hex')}`
            if (source.quote === digest) continue
          } catch { console.warn('Memory source unavailable:', source.ref) }
          await store.save({ ...record, status: 'disputed', updatedAt: new Date().toISOString() }, 'source-changed')
          disputed++
          break
        }
      }
      await store.rebuildIndex()
    }
    console.log(`Memory maintenance: ${Date.now() - started}ms, expired=${expired}, disputed=${disputed}, candidates=${this.metrics.candidates}, automatic=${this.metrics.automatic}, rejected=${this.metrics.rejected}, conflicts=${this.metrics.conflicts}`)
  }

  private storeRoot(store: MemoryStore): string {
    return path.dirname(path.dirname(store.directory))
  }
}
