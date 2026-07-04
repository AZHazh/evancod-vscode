/**
 * 存储适配器
 *
 * 职责：
 * 1. 持久化插件状态（跨会话保持）
 * 2. 提供键值对存储
 * 3. 支持工作区级别和全局级别存储
 *
 * VSCode 存储机制：
 * - globalState: 全局存储（所有工作区共享）
 * - workspaceState: 工作区存储（仅当前工作区）
 *
 * 存储位置：
 * - 全局: ~/.vscode/extensions/<extension-id>/globalStorage/
 * - 工作区: .vscode/settings.json 或 VSCode 内部存储
 *
 * 适用场景：
 * - UI 状态（侧边栏是否展开、上次选择的模型等）
 * - 临时缓存
 * - 会话 ID、最后访问时间等元数据
 */

import * as vscode from 'vscode'

/**
 * 存储适配器接口
 */
export interface IStorageAdapter {
  /**
   * 获取全局存储的值
   *
   * @param key - 键
   * @param defaultValue - 默认值（如果键不存在）
   * @returns 存储的值或默认值
   */
  getGlobal<T>(key: string, defaultValue?: T): T | undefined

  /**
   * 设置全局存储的值
   *
   * @param key - 键
   * @param value - 值
   */
  setGlobal<T>(key: string, value: T): Promise<void>

  /**
   * 获取工作区存储的值
   *
   * @param key - 键
   * @param defaultValue - 默认值
   * @returns 存储的值或默认值
   */
  getWorkspace<T>(key: string, defaultValue?: T): T | undefined

  /**
   * 设置工作区存储的值
   *
   * @param key - 键
   * @param value - 值
   */
  setWorkspace<T>(key: string, value: T): Promise<void>

  /**
   * 删除全局存储的键
   */
  deleteGlobal(key: string): Promise<void>

  /**
   * 删除工作区存储的键
   */
  deleteWorkspace(key: string): Promise<void>
}

/**
 * VSCode 存储适配器实现
 */
export class VSCodeStorageAdapter implements IStorageAdapter {
  /**
   * 构造函数
   *
   * @param context - VSCode 扩展上下文
   */
  constructor(private context: vscode.ExtensionContext) {}

  /**
   * 获取全局存储的值
   *
   * VSCode API:
   * - globalState.get(key, defaultValue)
   */
  getGlobal<T>(key: string, defaultValue?: T): T | undefined {
    if (defaultValue === undefined) {
      return this.context.globalState.get<T>(key)
    }
    return this.context.globalState.get<T>(key, defaultValue)
  }

  /**
   * 设置全局存储的值
   *
   * VSCode API:
   * - globalState.update(key, value)
   *
   * 注意：VSCode 会自动序列化为 JSON
   */
  async setGlobal<T>(key: string, value: T): Promise<void> {
    await this.context.globalState.update(key, value)
  }

  /**
   * 获取工作区存储的值
   *
   * VSCode API:
   * - workspaceState.get(key, defaultValue)
   */
  getWorkspace<T>(key: string, defaultValue?: T): T | undefined {
    if (defaultValue === undefined) {
      return this.context.workspaceState.get<T>(key)
    }
    return this.context.workspaceState.get<T>(key, defaultValue)
  }

  /**
   * 设置工作区存储的值
   *
   * VSCode API:
   * - workspaceState.update(key, value)
   */
  async setWorkspace<T>(key: string, value: T): Promise<void> {
    await this.context.workspaceState.update(key, value)
  }

  /**
   * 删除全局存储的键
   *
   * 实现方式：将值设置为 undefined
   */
  async deleteGlobal(key: string): Promise<void> {
    await this.context.globalState.update(key, undefined)
  }

  /**
   * 删除工作区存储的键
   *
   * 实现方式：将值设置为 undefined
   */
  async deleteWorkspace(key: string): Promise<void> {
    await this.context.workspaceState.update(key, undefined)
  }

  /**
   * 获取所有全局存储的键
   *
   * @returns 键数组
   */
  getAllGlobalKeys(): readonly string[] {
    return this.context.globalState.keys()
  }

  /**
   * 获取所有工作区存储的键
   *
   * @returns 键数组
   */
  getAllWorkspaceKeys(): readonly string[] {
    return this.context.workspaceState.keys()
  }
}

/**
 * Mock 存储适配器（用于测试）
 */
export class MockStorageAdapter implements IStorageAdapter {
  private globalStorage = new Map<string, any>()
  private workspaceStorage = new Map<string, any>()

  getGlobal<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.globalStorage.get(key)
    return value !== undefined ? value : defaultValue
  }

  async setGlobal<T>(key: string, value: T): Promise<void> {
    this.globalStorage.set(key, value)
  }

  getWorkspace<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.workspaceStorage.get(key)
    return value !== undefined ? value : defaultValue
  }

  async setWorkspace<T>(key: string, value: T): Promise<void> {
    this.workspaceStorage.set(key, value)
  }

  async deleteGlobal(key: string): Promise<void> {
    this.globalStorage.delete(key)
  }

  async deleteWorkspace(key: string): Promise<void> {
    this.workspaceStorage.delete(key)
  }

  /**
   * 测试辅助方法：清空所有存储
   */
  clear() {
    this.globalStorage.clear()
    this.workspaceStorage.clear()
  }

  /**
   * 测试辅助方法：获取所有全局键
   */
  getAllGlobalKeys(): string[] {
    return Array.from(this.globalStorage.keys())
  }

  /**
   * 测试辅助方法：获取所有工作区键
   */
  getAllWorkspaceKeys(): string[] {
    return Array.from(this.workspaceStorage.keys())
  }
}
