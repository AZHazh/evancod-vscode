/**
 * FileSystemAdapter 单元测试
 *
 * 测试目标：
 * 1. Mock 适配器的基本功能
 * 2. 文件读写
 * 3. 目录操作
 * 4. 错误处理
 */

import { MockFileSystemAdapter } from '../adapters/FileSystemAdapter'

describe('FileSystemAdapter', () => {
  let adapter: MockFileSystemAdapter

  /**
   * 每个测试前都创建新的适配器实例
   * 保证测试之间互不影响
   */
  beforeEach(() => {
    adapter = new MockFileSystemAdapter()
  })

  describe('writeFile and readFile', () => {
    it('should write and read file content', async () => {
      const path = '/test/file.txt'
      const content = 'Hello, World!'

      // 写入文件
      await adapter.writeFile(path, content)

      // 读取文件
      const result = await adapter.readFile(path)

      // 验证内容正确
      expect(result).toBe(content)
    })

    it('should overwrite existing file', async () => {
      const path = '/test/file.txt'

      // 第一次写入
      await adapter.writeFile(path, 'First')

      // 第二次写入（覆盖）
      await adapter.writeFile(path, 'Second')

      // 应该读取到第二次的内容
      const result = await adapter.readFile(path)
      expect(result).toBe('Second')
    })

    it('should throw error when reading non-existent file', async () => {
      // 读取不存在的文件应该抛出错误
      await expect(adapter.readFile('/non-existent.txt')).rejects.toThrow('File not found')
    })
  })

  describe('exists', () => {
    it('should return true for existing file', async () => {
      const path = '/test/file.txt'
      await adapter.writeFile(path, 'content')

      const result = await adapter.exists(path)
      expect(result).toBe(true)
    })

    it('should return false for non-existent file', async () => {
      const result = await adapter.exists('/non-existent.txt')
      expect(result).toBe(false)
    })
  })

  describe('deleteFile', () => {
    it('should delete existing file', async () => {
      const path = '/test/file.txt'
      await adapter.writeFile(path, 'content')

      // 删除文件
      await adapter.deleteFile(path)

      // 文件应该不存在了
      const exists = await adapter.exists(path)
      expect(exists).toBe(false)
    })
  })

  describe('readDirectory', () => {
    it('should list files in directory', async () => {
      // 创建几个文件
      await adapter.writeFile('/test/file1.txt', 'content1')
      await adapter.writeFile('/test/file2.txt', 'content2')
      await adapter.writeFile('/test/dir/file3.txt', 'content3')

      // 读取目录
      const files = await adapter.readDirectory('/test')

      // 应该包含 file1.txt, file2.txt, dir
      expect(files).toContain('file1.txt')
      expect(files).toContain('file2.txt')
      expect(files).toContain('dir')
    })

    it('should return empty array for empty directory', async () => {
      const files = await adapter.readDirectory('/empty')
      expect(files).toEqual([])
    })
  })
})
