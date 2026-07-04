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

export class VSCodeFileSystemAdapter implements IFileSystemAdapter {
  /**
   * 读取文件内容
   *
   * VSCode API 流程：
   * 1. 将路径字符串转换为 VSCode Uri
   * 2. 使用 workspace.fs.readFile 读取（返回 Uint8Array）
   * 3. 将 Uint8Array 转换为 UTF-8 字符串
   */
  async readFile(filePath: string): Promise<string> {
    try {
      // 转换为 VSCode Uri
      const uri = vscode.Uri.file(filePath)

      // 读取文件（返回 Uint8Array）
      const content = await vscode.workspace.fs.readFile(uri)

      // 转换为 UTF-8 字符串
      return Buffer.from(content).toString('utf-8')
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
      const uri = vscode.Uri.file(filePath)
      await vscode.workspace.fs.stat(uri)
      return true
    } catch (error) {
      // FileNotFound 错误表示文件不存在
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
      const uri = vscode.Uri.file(dirPath)
      const entries = await vscode.workspace.fs.readDirectory(uri)
      // entries 格式: [['file1.txt', FileType.File], ['dir1', FileType.Directory]]
      // 只返回名称
      return entries.map(([name]) => name)
    } catch (error) {
      throw new Error(`Failed to read directory ${dirPath}: ${error}`)
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
