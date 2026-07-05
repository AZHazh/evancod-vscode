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
 * Skill 目录结构（双目录）：
 * - 全局：~/.claude/cc-evancod/skills/      （所有项目共享）
 *   - commit.md
 *   - review.md
 * - 工作区：<workspace>/.evancod/skills/     （随项目走，可进版本库）
 *   - deploy.md
 *
 * 加载顺序为「全局 → 工作区」，同名 Skill 由工作区覆盖全局，
 * 便于项目内定制专属 Skill 而不影响全局。
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
 * Skill 来源
 * - global：全局目录 ~/.claude/cc-evancod/skills/
 * - workspace：工作区目录 <workspace>/.evancod/skills/
 */
export type SkillSource = 'global' | 'workspace'

/**
 * Skill 定义
 */
export interface Skill {
  /** 元数据 */
  metadata: SkillMetadata

  /** Skill 内容（去除 frontmatter 后的正文） */
  content: string

  /** 文件路径（SKILL.md 或扁平 xxx.md 的完整路径） */
  filePath: string

  /**
   * 技能所在目录。
   * - 目录式技能（skills/imagegen/SKILL.md）：指向 skills/imagegen
   * - 扁平技能（skills/commit.md）：指向 skills
   * 正文中引用的 scripts/、references/ 等相对资源以此为基准。
   */
  skillDir: string

  /** 来源目录（全局 / 工作区） */
  source: SkillSource
}

export class SkillManager {
  /** 已加载的 Skills（同名时工作区覆盖全局） */
  private skills: Map<string, Skill> = new Map()

  /** 全局 Skills 目录路径 */
  private globalSkillsDir: string

  /** 工作区 Skills 目录路径（无工作区时为 undefined） */
  private workspaceSkillsDir?: string

  /** 文件监听器（全局 + 工作区） */
  private watchers: vscode.FileSystemWatcher[] = []

  /**
   * 构造函数
   *
   * @param context - VSCode Extension Context
   */
  constructor(private context: vscode.ExtensionContext) {
    // 全局 Skills 目录：~/.claude/cc-evancod/skills/
    const homeDir = os.homedir()
    this.globalSkillsDir = path.join(homeDir, '.claude', 'cc-evancod', 'skills')

    // 工作区 Skills 目录：<workspace>/.evancod/skills/
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders && workspaceFolders.length > 0) {
      const rootPath = workspaceFolders[0].uri.fsPath
      this.workspaceSkillsDir = path.join(rootPath, '.evancod', 'skills')
    }
  }

  /**
   * 初始化 Skill Manager
   *
   * 流程：
   * 1. 确保全局 Skills 目录存在（首次创建示例 Skill）
   * 2. 加载全局 + 工作区所有 Skill 文件
   * 3. 设置文件监听器（热重载）
   */
  async initialize(): Promise<void> {
    try {
      // 确保全局目录存在（工作区目录按需创建，不强制）
      await this.ensureGlobalSkillsDirectory()

      // 加载所有 Skills（全局 → 工作区，工作区覆盖同名全局）
      await this.loadAllSkills()

      console.log(`Loaded ${this.skills.size} skills`)

      // 设置文件监听器
      this.setupFileWatcher()
    } catch (error) {
      console.error('Failed to initialize Skill Manager:', error)
    }
  }

  /**
   * 确保全局 Skills 目录存在
   */
  private async ensureGlobalSkillsDirectory(): Promise<void> {
    try {
      const dirUri = vscode.Uri.file(this.globalSkillsDir)
      await vscode.workspace.fs.stat(dirUri)
    } catch {
      // 目录不存在，创建它
      const dirUri = vscode.Uri.file(this.globalSkillsDir)
      await vscode.workspace.fs.createDirectory(dirUri)
      console.log(`Created skills directory: ${this.globalSkillsDir}`)

      // 创建示例 Skill
      await this.createExampleSkill()
    }
  }

  /**
   * 创建示例 Skill（写入全局目录）
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

    const filePath = path.join(this.globalSkillsDir, 'help.md')
    const fileUri = vscode.Uri.file(filePath)
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(exampleContent, 'utf-8'))
    console.log('Created example skill: help.md')
  }

  /**
   * 加载所有 Skills
   *
   * 顺序：先全局，后工作区。工作区同名 Skill 覆盖全局。
   */
  private async loadAllSkills(): Promise<void> {
    this.skills.clear()
    // 全局优先加载，工作区随后加载以覆盖同名项
    await this.loadSkillsFromDir(this.globalSkillsDir, 'global')
    if (this.workspaceSkillsDir) {
      await this.loadSkillsFromDir(this.workspaceSkillsDir, 'workspace')
    }
  }

  /**
   * 从指定目录加载 Skills
   *
   * 支持两种布局：
   * - 扁平文件：skills/commit.md
   * - 目录式：skills/imagegen/SKILL.md（Claude Skills 标准布局，可携带
   *   scripts/、references/ 等配套资源）
   *
   * @param dir - 目录路径
   * @param source - 来源标记
   */
  private async loadSkillsFromDir(dir: string, source: SkillSource): Promise<void> {
    try {
      const dirUri = vscode.Uri.file(dir)
      const entries = await vscode.workspace.fs.readDirectory(dirUri)

      for (const [name, fileType] of entries) {
        if (fileType === vscode.FileType.File && name.endsWith('.md')) {
          // 扁平技能：技能目录即当前目录
          const filePath = path.join(dir, name)
          await this.loadSkill(filePath, dir, source)
        } else if (fileType === vscode.FileType.Directory) {
          // 目录式技能：查找子目录下的 SKILL.md
          const skillDir = path.join(dir, name)
          const skillFile = path.join(skillDir, 'SKILL.md')
          if (await this.fileExists(skillFile)) {
            await this.loadSkill(skillFile, skillDir, source)
          }
        }
      }
    } catch (error) {
      // 目录不存在（如工作区未创建 skills 目录）时静默跳过
      console.log(`No skills loaded from ${source} dir: ${dir}`)
    }
  }

  /**
   * 判断文件是否存在
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath))
      return stat.type === vscode.FileType.File
    } catch {
      return false
    }
  }

  /**
   * 加载单个 Skill
   *
   * @param filePath - 技能文件路径（SKILL.md 或扁平 xxx.md）
   * @param skillDir - 技能所在目录（相对资源的基准）
   * @param source - 来源标记
   */
  private async loadSkill(filePath: string, skillDir: string, source: SkillSource): Promise<void> {
    try {
      const fileUri = vscode.Uri.file(filePath)
      const fileData = await vscode.workspace.fs.readFile(fileUri)
      const content = Buffer.from(fileData).toString('utf-8')

      // 解析 Skill
      const skill = this.parseSkill(content, filePath, skillDir, source)

      if (skill) {
        this.skills.set(skill.metadata.name, skill)
        console.log(`Loaded skill: ${skill.metadata.name} (${source})`)
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
   * @param skillDir - 技能所在目录
   * @param source - 来源标记
   * @returns Skill 对象
   */
  private parseSkill(content: string, filePath: string, skillDir: string, source: SkillSource): Skill | null {
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

      // name 缺省：目录式技能用其目录名兜底
      if (!metadata.name) {
        metadata.name = path.basename(skillDir)
      }

      // trigger 缺省：未声明时用 /{name} 兜底，保证可通过斜杠命令触发
      if (!metadata.trigger) {
        metadata.trigger = `/${metadata.name}`
      }

      return {
        metadata,
        content: body.trim(),
        filePath,
        skillDir,
        source
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
   *
   * 同时监听全局与工作区两个目录。由于工作区 Skill 会覆盖全局同名项，
   * 单文件增量更新无法正确处理「删除工作区覆盖项后回退到全局」等场景，
   * 因此任何变化都触发一次全量重载，保证 Map 状态始终正确。
   */
  private setupFileWatcher(): void {
    const dirs = [this.globalSkillsDir]
    if (this.workspaceSkillsDir) {
      dirs.push(this.workspaceSkillsDir)
    }

    for (const dir of dirs) {
      // **/*.md 同时覆盖扁平技能（skills/xxx.md）与目录式技能
      // （skills/xxx/SKILL.md 及其配套 .md 资源）
      const pattern = new vscode.RelativePattern(dir, '**/*.md')
      const watcher = vscode.workspace.createFileSystemWatcher(pattern)

      const reload = (uri: vscode.Uri, action: string) => {
        console.log(`Skill file ${action}: ${uri.fsPath}`)
        this.loadAllSkills()
      }

      watcher.onDidCreate((uri) => reload(uri, 'created'))
      watcher.onDidChange((uri) => reload(uri, 'changed'))
      watcher.onDidDelete((uri) => reload(uri, 'deleted'))

      this.watchers.push(watcher)
      this.context.subscriptions.push(watcher)
    }
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
    for (const watcher of this.watchers) {
      watcher.dispose()
    }
    this.watchers = []
    this.skills.clear()
  }
}
