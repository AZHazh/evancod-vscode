/**
 * 文件系统适配器接口
 *
 * 为什么需要适配器？
 * - VSCode API 和 Node.js 标准 API 不同
 * - 统一接口，便于测试（可以 Mock）
 * - 隔离平台差异
 *
 * Node.js 标准 API:
 *   import * as fs from 'fs'
 *   const content = fs.readFileSync('/path/to/file', 'utf-8')
 *
 * VSCode API:
 *   const uri = vscode.Uri.file('/path/to/file')
 *   const content = await vscode.workspace.fs.readFile(uri)
 *   const text = Buffer.from(content).toString('utf-8')
 *
 * 适配器的作用：
 * - 提供统一的接口
 * - 隐藏平台差异
 * - 便于单元测试
 */

/**
 * 目录条目（含类型信息）
 *
 * 为什么需要它：
 * readDirectory 只返回名字，遍历工具就得对每个条目再发一次 stat 去问"是文件还是目录"，
 * 在大目录里就是 O(N) 次多余的往返。readDirectoryWithTypes 一次调用把类型一起带回来，
 * 直接消除这些探测调用。
 */
export interface DirEntry {
  /** 文件或目录名 */
  name: string
  /** 是否为目录 */
  isDirectory: boolean
  /** 是否为普通文件 */
  isFile: boolean
}

/**
 * 文件/目录元信息
 */
export interface FileStat {
  /** 字节大小 */
  size: number
  /** 修改时间（毫秒时间戳） */
  mtime: number
  /** 是否为普通文件 */
  isFile: boolean
  /** 是否为目录 */
  isDirectory: boolean
}

/**
 * 文件系统适配器接口
 * 定义了文件操作的标准方法
 */
export interface IFileSystemAdapter {
  /**
   * 读取文件内容
   *
   * @param path - 文件绝对路径
   * @returns 文件内容（UTF-8 字符串）
   * @throws Error 如果文件不存在或无法读取
   */
  readFile(path: string): Promise<string>

  /**
   * 读取文件原始字节（用于图片等二进制文件）
   *
   * @param path - 文件绝对路径
   * @returns 文件原始字节
   * @throws Error 如果文件不存在或无法读取
   */
  readFileRaw(path: string): Promise<Uint8Array>

  /**
   * 读取文件原始字节
   *
   * 用于读取图片、二进制文件等非文本内容。
   * 文本读取（readFile）会把非法字节替换成 U+FFFD 并膨胀 token，
   * 二进制/图片文件必须走这里拿原始字节再决定如何处理。
   *
   * @param path - 文件绝对路径
   * @returns 文件原始字节（Uint8Array）
   * @throws Error 如果文件不存在或无法读取
   */
  readFileRaw(path: string): Promise<Uint8Array>

  /**
   * 写入文件内容
   * 如果文件不存在会自动创建
   * 如果父目录不存在会自动创建
   *
   * @param path - 文件绝对路径
   * @param content - 要写入的内容
   * @throws Error 如果无法写入
   */
  writeFile(path: string, content: string): Promise<void>

  /**
   * 检查文件或目录是否存在
   *
   * @param path - 文件或目录的绝对路径
   * @returns true 表示存在，false 表示不存在
   */
  exists(path: string): Promise<boolean>

  /**
   * 删除文件
   *
   * @param path - 文件绝对路径
   * @throws Error 如果文件不存在或无法删除
   */
  deleteFile(path: string): Promise<void>

  /**
   * 创建目录
   * 如果父目录不存在会递归创建
   *
   * @param path - 目录绝对路径
   */
  createDirectory(path: string): Promise<void>

  /**
   * 列出目录内容
   *
   * @param path - 目录绝对路径
   * @returns 文件和目录名称数组
   * @throws Error 如果目录不存在
   */
  readDirectory(path: string): Promise<string[]>

  /**
   * 列出目录内容，并一次性带回每个条目的类型（文件/目录）
   *
   * 相比 readDirectory + 逐条 stat，这里只需一次系统调用即可拿到全部类型，
   * 是遍历类工具（grep/find/list）避免 O(N) 次多余往返的关键。
   *
   * @param path - 目录绝对路径
   * @returns 目录条目数组（含类型）
   */
  readDirectoryWithTypes(path: string): Promise<DirEntry[]>

  /**
   * 获取文件/目录的元信息（大小、修改时间、类型）
   *
   * @param path - 绝对路径
   * @returns 元信息
   * @throws Error 如果路径不存在
   */
  stat(path: string): Promise<FileStat>

  /**
   * 按 glob 模式搜索文件
   *
   * @param pattern - glob 模式
   * @param searchPath - 搜索根路径
   * @returns 匹配的绝对文件路径
   */
  glob(pattern: string, searchPath: string): Promise<string[]>
}

/**
 * VSCode 文件系统适配器实现
 * 使用 VSCode 的 workspace.fs API
 */
import * as vscode from 'vscode'
import * as path from 'path'
import * as fsp from 'fs/promises'

/**
 * 为什么读操作走 Node 原生 fs 而不是 vscode.workspace.fs：
 * - vscode.workspace.fs 每次调用都是「扩展进程 → VSCode 主进程」的跨进程 IPC，
 *   单次往返延迟远高于 Node 原生 fs 的直接系统调用。
 * - grep/find/list 这类工具要遍历成百上千个文件，IPC 往返累积起来就是主要耗时来源。
 * - 扩展宿主与工作区文件同处一台机器（本地或远程开发场景下宿主都运行在文件所在侧），
 *   Node fs 能正确访问，且读盘语义与 workspace.fs 一致（都读磁盘，不读编辑器未保存缓冲区）。
 *
 * 写操作仍保留 vscode.workspace.fs（见 writeFile/createDirectory/deleteFile），
 * 以维持与编辑器状态、文件事件、回收站等的集成，且写操作频率低、不是性能瓶颈。
 */
export class VSCodeFileSystemAdapter implements IFileSystemAdapter {
  /**
   * 读取文件内容（Node 原生 fs，无 IPC）
   */
  async readFile(filePath: string): Promise<string> {
    try {
      return await fsp.readFile(filePath, 'utf-8')
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error}`)
    }
  }

  /**
   * 读取文件原始字节
   *
   * 与 readFile 不同，不做 UTF-8 解码，直接返回字节。
   * 用于图片等二进制文件，避免非法字节被替换成 U+FFFD。
   */
  async readFileRaw(filePath: string): Promise<Uint8Array> {
    try {
      return await fsp.readFile(filePath)
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error}`)
    }
  }

  /**
   * 写入文件内容
   *
   * VSCode API 流程：
   * 1. 确保父目录存在
   * 2. 将字符串转换为 Uint8Array
   * 3. 使用 workspace.fs.writeFile 写入
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      // 确保父目录存在
      const dir = path.dirname(filePath)
      await this.createDirectory(dir)

      // 转换为 VSCode Uri
      const uri = vscode.Uri.file(filePath)

      // 将字符串转换为 Uint8Array
      const buffer = Buffer.from(content, 'utf-8')

      // 写入文件
      await vscode.workspace.fs.writeFile(uri, buffer)
    } catch (error) {
      throw new Error(`Failed to write file ${filePath}: ${error}`)
    }
  }

  /**
   * 检查文件或目录是否存在
   *
   * 实现方式：
   * - 尝试 stat（获取文件信息）
   * - 如果成功则存在
   * - 如果抛出 FileNotFound 错误则不存在
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await fsp.stat(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(filePath)
      // recursive: false 表示只删除文件，不删除目录
      // useTrash: false 表示永久删除，不放入回收站
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false })
    } catch (error) {
      throw new Error(`Failed to delete file ${filePath}: ${error}`)
    }
  }

  /**
   * 创建目录
   *
   * VSCode API 会自动递归创建父目录
   */
  async createDirectory(dirPath: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(dirPath)
      await vscode.workspace.fs.createDirectory(uri)
    } catch (error) {
      // 如果目录已存在，忽略错误
      if (!String(error).includes('already exists')) {
        throw new Error(`Failed to create directory ${dirPath}: ${error}`)
      }
    }
  }

  /**
   * 列出目录内容
   *
   * VSCode API 返回 [name, FileType][] 格式
   * 我们只返回文件名数组
   */
  async readDirectory(dirPath: string): Promise<string[]> {
    try {
      // withFileTypes 一次拿到 Dirent，无需逐条 stat；Node fs 直接读盘，无 IPC
      const entries = await fsp.readdir(dirPath, { withFileTypes: true })
      return entries.map(e => e.name)
    } catch (error) {
      throw new Error(`Failed to read directory ${dirPath}: ${error}`)
    }
  }

  async readDirectoryWithTypes(dirPath: string): Promise<DirEntry[]> {
    try {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true })
      return entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      }))
    } catch (error) {
      throw new Error(`Failed to read directory ${dirPath}: ${error}`)
    }
  }

  async stat(filePath: string): Promise<FileStat> {
    const s = await fsp.stat(filePath)
    return {
      size: s.size,
      mtime: s.mtimeMs,
      isFile: s.isFile(),
      isDirectory: s.isDirectory(),
    }
  }

  async glob(pattern: string, searchPath: string): Promise<string[]> {
    const relativePattern = new vscode.RelativePattern(searchPath, pattern)
    const uris = await vscode.workspace.findFiles(relativePattern)
    return uris.map(uri => uri.fsPath)
  }
}

/**
 * Mock 文件系统适配器（用于测试）
 *
 * 使用内存 Map 模拟文件系统
 * 不实际操作磁盘
 */
export class MockFileSystemAdapter implements IFileSystemAdapter {
  /**
   * 内存中的"文件系统"
   * key: 文件路径
   * value: 文件内容
   */
  private files = new Map<string, string>()

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error(`File not found: ${path}`)
    }
    return content
  }

  async readFileRaw(path: string): Promise<Uint8Array> {
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error(`File not found: ${path}`)
    }
    return Buffer.from(content, 'utf-8')
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path)
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path)
  }

  async createDirectory(_path: string): Promise<void> {
    // Mock 实现不需要创建目录
  }

  async readDirectory(path: string): Promise<string[]> {
    // Mock 实现：返回所有以该路径开头的文件
    const prefix = path.endsWith('/') ? path : path + '/'
    const files: string[] = []
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relativePath = filePath.slice(prefix.length)
        const firstPart = relativePath.split('/')[0]
        if (firstPart && !files.includes(firstPart)) {
          files.push(firstPart)
        }
      }
    }
    return files
  }

  async readDirectoryWithTypes(path: string): Promise<DirEntry[]> {
    const prefix = path.endsWith('/') ? path : path + '/'
    const seen = new Map<string, boolean>() // name -> isDirectory
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relativePath = filePath.slice(prefix.length)
        const parts = relativePath.split('/')
        const firstPart = parts[0]
        if (firstPart && !seen.has(firstPart)) {
          // 有后续路径段说明它是目录
          seen.set(firstPart, parts.length > 1)
        }
      }
    }
    return Array.from(seen.entries()).map(([name, isDirectory]) => ({
      name,
      isDirectory,
      isFile: !isDirectory,
    }))
  }

  async stat(path: string): Promise<FileStat> {
    const content = this.files.get(path)
    if (content !== undefined) {
      return { size: content.length, mtime: 0, isFile: true, isDirectory: false }
    }
    // 若作为目录前缀存在，则视为目录
    const prefix = path.endsWith('/') ? path : path + '/'
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        return { size: 0, mtime: 0, isFile: false, isDirectory: true }
      }
    }
    throw new Error(`Path not found: ${path}`)
  }

  async glob(pattern: string, searchPath: string): Promise<string[]> {
    const prefix = searchPath.endsWith('/') ? searchPath : searchPath + '/'
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*') +
        '$'
    )

    return Array.from(this.files.keys()).filter(filePath => {
      if (!filePath.startsWith(prefix)) {
        return false
      }
      return regex.test(filePath.slice(prefix.length))
    })
  }

  /**
   * 测试辅助方法：清空所有文件
   */
  clear() {
    this.files.clear()
  }

  /**
   * 测试辅助方法：获取所有文件路径
   */
  getAllPaths(): string[] {
    return Array.from(this.files.keys())
  }
}
