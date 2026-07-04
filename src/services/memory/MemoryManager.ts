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
 * - <workspace>/.claude/memory/
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

export class MemoryManager {
  private memoryDir?: string
  private memories: Map<string, Memory> = new Map()

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
      this.memoryDir = path.join(rootPath, '.claude', 'memory')
    }
  }

  /**
   * 初始化 Memory Manager
   */
  async initialize(): Promise<void> {
    if (!this.memoryDir) {
      console.log('No workspace folder, memory system disabled')
      return
    }

    try {
      await this.ensureMemoryDirectory()
      await this.loadAllMemories()
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

    try {
      const dirUri = vscode.Uri.file(this.memoryDir)
      const files = await vscode.workspace.fs.readDirectory(dirUri)

      for (const [filename, fileType] of files) {
        if (fileType === vscode.FileType.File && filename.endsWith('.md') && filename !== 'MEMORY.md') {
          const filePath = path.join(this.memoryDir, filename)
          await this.loadMemory(filePath)
        }
      }
    } catch (error) {
      console.error('Failed to load memories:', error)
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
      filePath
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
      const value = line.substring(colonIndex + 1).trim().replace(/^["']|["']$/g, '')
      metadata[key] = value
    }

    return metadata as MemoryMetadata
  }

  /**
   * 保存记忆
   */
  async saveMemory(name: string, type: MemoryType, description: string, content: string): Promise<void> {
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
      updatedAt: now
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
      filePath
    })

    await this.updateMemoryIndex()
  }

  /**
   * 更新 MEMORY.md 索引
   */
  private async updateMemoryIndex(): Promise<void> {
    if (!this.memoryDir) return

    const memories = Array.from(this.memories.values())
    const memoryList = memories
      .map((m) => `- [${m.metadata.name}](${path.basename(m.filePath)}) — ${m.metadata.description}`)
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
    return Array.from(this.memories.values()).filter((m) => m.metadata.type === type)
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
    this.memories.clear()
  }
}
