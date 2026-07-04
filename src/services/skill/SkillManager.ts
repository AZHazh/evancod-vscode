/**
 * Skill Manager - Skill 管理器
 *
 * 职责：
 * 1. 加载和管理本地 Skill 文件
 * 2. 解析 Skill 的 frontmatter 和内容
 * 3. 提供 Skill 查询和执行接口
 * 4. 支持 Skill 的启用/禁用
 *
 * Skill 文件格式：
 * ```markdown
 * ---
 * name: commit
 * description: 创建 Git commit
 * trigger: /commit
 * ---
 *
 * You are an expert at creating Git commits...
 * ```
 *
 * Skill 目录结构：
 * - ~/.claude/cc-evancod/skills/
 *   - commit.md
 *   - review.md
 *   - refactor.md
 *
 * 使用场景：
 * - 用户输入 /commit 时自动加载并执行对应的 Skill
 * - AI 可以通过 SkillTool 主动调用 Skill
 * - 支持自定义 Skill 扩展
 *
 * 设计原则：
 * - 文件驱动：所有 Skill 都是 Markdown 文件
 * - 热重载：监听文件变化，自动重新加载
 * - Frontmatter：使用 YAML frontmatter 定义元数据
 */

import * as vscode from 'vscode'
import * as path from 'path'
import * as os from 'os'

/**
 * Skill 元数据
 */
export interface SkillMetadata {
  /** Skill 名称 */
  name: string

  /** 描述 */
  description: string

  /** 触发命令（如 /commit） */
  trigger?: string

  /** 是否启用 */
  enabled?: boolean

  /** 作者 */
  author?: string

  /** 版本 */
  version?: string
}

/**
 * Skill 定义
 */
export interface Skill {
  /** 元数据 */
  metadata: SkillMetadata

  /** Skill 内容（去除 frontmatter 后的正文） */
  content: string

  /** 文件路径 */
  filePath: string
}

export class SkillManager {
  /** 已加载的 Skills */
  private skills: Map<string, Skill> = new Map()

  /** Skills 目录路径 */
  private skillsDir: string

  /** 文件监听器 */
  private watcher?: vscode.FileSystemWatcher

  /**
   * 构造函数
   *
   * @param context - VSCode Extension Context
   */
  constructor(private context: vscode.ExtensionContext) {
    // Skills 目录：~/.claude/cc-evancod/skills/
    const homeDir = os.homedir()
    this.skillsDir = path.join(homeDir, '.claude', 'cc-evancod', 'skills')
  }

  /**
   * 初始化 Skill Manager
   *
   * 流程：
   * 1. 确保 Skills 目录存在
   * 2. 加载所有 Skill 文件
   * 3. 设置文件监听器（热重载）
   */
  async initialize(): Promise<void> {
    try {
      // 确保目录存在
      await this.ensureSkillsDirectory()

      // 加载所有 Skills
      await this.loadAllSkills()

      console.log(`Loaded ${this.skills.size} skills`)

      // 设置文件监听器
      this.setupFileWatcher()
    } catch (error) {
      console.error('Failed to initialize Skill Manager:', error)
    }
  }

  /**
   * 确保 Skills 目录存在
   */
  private async ensureSkillsDirectory(): Promise<void> {
    try {
      const dirUri = vscode.Uri.file(this.skillsDir)
      await vscode.workspace.fs.stat(dirUri)
    } catch {
      // 目录不存在，创建它
      const dirUri = vscode.Uri.file(this.skillsDir)
      await vscode.workspace.fs.createDirectory(dirUri)
      console.log(`Created skills directory: ${this.skillsDir}`)

      // 创建示例 Skill
      await this.createExampleSkill()
    }
  }

  /**
   * 创建示例 Skill
   */
  private async createExampleSkill(): Promise<void> {
    const exampleContent = `---
name: help
description: 显示帮助信息
trigger: /help
enabled: true
---

当用户请求帮助时，请友好地介绍 Evancod 的功能和使用方法。

包括：
1. 基本对话和代码生成
2. 文件操作和代码分析
3. Git 操作
4. 斜杠命令
5. MCP 集成
6. 任务管理

使用简洁、友好的语言，避免技术术语。
`

    const filePath = path.join(this.skillsDir, 'help.md')
    const fileUri = vscode.Uri.file(filePath)
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(exampleContent, 'utf-8'))
    console.log('Created example skill: help.md')
  }

  /**
   * 加载所有 Skills
   */
  private async loadAllSkills(): Promise<void> {
    try {
      const dirUri = vscode.Uri.file(this.skillsDir)
      const files = await vscode.workspace.fs.readDirectory(dirUri)

      for (const [filename, fileType] of files) {
        // 只处理 .md 文件
        if (fileType === vscode.FileType.File && filename.endsWith('.md')) {
          const filePath = path.join(this.skillsDir, filename)
          await this.loadSkill(filePath)
        }
      }
    } catch (error) {
      console.error('Failed to load skills:', error)
    }
  }

  /**
   * 加载单个 Skill
   *
   * @param filePath - 文件路径
   */
  private async loadSkill(filePath: string): Promise<void> {
    try {
      const fileUri = vscode.Uri.file(filePath)
      const fileData = await vscode.workspace.fs.readFile(fileUri)
      const content = Buffer.from(fileData).toString('utf-8')

      // 解析 Skill
      const skill = this.parseSkill(content, filePath)

      if (skill) {
        this.skills.set(skill.metadata.name, skill)
        console.log(`Loaded skill: ${skill.metadata.name}`)
      }
    } catch (error) {
      console.error(`Failed to load skill from ${filePath}:`, error)
    }
  }

  /**
   * 解析 Skill 文件
   *
   * @param content - 文件内容
   * @param filePath - 文件路径
   * @returns Skill 对象
   */
  private parseSkill(content: string, filePath: string): Skill | null {
    try {
      // 检查是否有 frontmatter
      const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/
      const match = content.match(frontmatterRegex)

      if (!match) {
        console.warn(`Skill file ${filePath} does not have valid frontmatter`)
        return null
      }

      const [, frontmatter, body] = match

      // 解析 YAML frontmatter（简单实现）
      const metadata = this.parseFrontmatter(frontmatter)

      if (!metadata.name) {
        console.warn(`Skill file ${filePath} does not have a name`)
        return null
      }

      return {
        metadata,
        content: body.trim(),
        filePath
      }
    } catch (error) {
      console.error(`Failed to parse skill from ${filePath}:`, error)
      return null
    }
  }

  /**
   * 解析 YAML Frontmatter（简单实现）
   *
   * @param frontmatter - Frontmatter 字符串
   * @returns 元数据对象
   */
  private parseFrontmatter(frontmatter: string): SkillMetadata {
    const metadata: any = {}
    const lines = frontmatter.split('\n')

    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue

      const key = line.substring(0, colonIndex).trim()
      const value = line.substring(colonIndex + 1).trim()

      // 移除引号
      const cleanValue = value.replace(/^["']|["']$/g, '')

      // 类型转换
      if (cleanValue === 'true') {
        metadata[key] = true
      } else if (cleanValue === 'false') {
        metadata[key] = false
      } else {
        metadata[key] = cleanValue
      }
    }

    return metadata as SkillMetadata
  }

  /**
   * 设置文件监听器（热重载）
   */
  private setupFileWatcher(): void {
    const pattern = new vscode.RelativePattern(this.skillsDir, '*.md')
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern)

    // 文件创建
    this.watcher.onDidCreate((uri) => {
      console.log(`Skill file created: ${uri.fsPath}`)
      this.loadSkill(uri.fsPath)
    })

    // 文件修改
    this.watcher.onDidChange((uri) => {
      console.log(`Skill file changed: ${uri.fsPath}`)
      this.loadSkill(uri.fsPath)
    })

    // 文件删除
    this.watcher.onDidDelete((uri) => {
      console.log(`Skill file deleted: ${uri.fsPath}`)
      const filename = path.basename(uri.fsPath, '.md')
      this.skills.delete(filename)
    })

    this.context.subscriptions.push(this.watcher)
  }

  /**
   * 获取 Skill
   *
   * @param name - Skill 名称
   * @returns Skill 对象
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  /**
   * 通过触发命令获取 Skill
   *
   * @param trigger - 触发命令（如 /commit）
   * @returns Skill 对象
   */
  getSkillByTrigger(trigger: string): Skill | undefined {
    return Array.from(this.skills.values()).find(
      (skill) => skill.metadata.trigger === trigger && skill.metadata.enabled !== false
    )
  }

  /**
   * 列出所有 Skills
   *
   * @returns Skill 数组
   */
  listSkills(): Skill[] {
    return Array.from(this.skills.values())
  }

  /**
   * 列出已启用的 Skills
   *
   * @returns Skill 数组
   */
  listEnabledSkills(): Skill[] {
    return Array.from(this.skills.values()).filter(
      (skill) => skill.metadata.enabled !== false
    )
  }

  /**
   * 启用 Skill
   *
   * @param name - Skill 名称
   */
  async enableSkill(name: string): Promise<void> {
    const skill = this.skills.get(name)
    if (skill) {
      skill.metadata.enabled = true
      await this.saveSkill(skill)
    }
  }

  /**
   * 禁用 Skill
   *
   * @param name - Skill 名称
   */
  async disableSkill(name: string): Promise<void> {
    const skill = this.skills.get(name)
    if (skill) {
      skill.metadata.enabled = false
      await this.saveSkill(skill)
    }
  }

  /**
   * 保存 Skill
   *
   * @param skill - Skill 对象
   */
  private async saveSkill(skill: Skill): Promise<void> {
    try {
      // 重建 frontmatter
      const frontmatter = Object.entries(skill.metadata)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n')

      const content = `---\n${frontmatter}\n---\n\n${skill.content}`

      const fileUri = vscode.Uri.file(skill.filePath)
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'))
    } catch (error) {
      console.error(`Failed to save skill ${skill.metadata.name}:`, error)
    }
  }

  /**
   * 销毁管理器
   */
  dispose(): void {
    this.watcher?.dispose()
    this.skills.clear()
  }
}
