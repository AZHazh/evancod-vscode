/**
 * 配置适配器
 *
 * 职责：
 * 1. 读写 VSCode 配置（workspace settings）
 * 2. 读写扩展自己的配置
 * 3. 提供类型安全的配置访问
 *
 * VSCode 配置层级：
 * 1. 默认配置（扩展定义在 package.json 中）
 * 2. 用户配置（全局 settings.json）
 * 3. 工作区配置（.vscode/settings.json）
 * 4. 文件夹配置（多根工作区）
 *
 * 优先级：4 > 3 > 2 > 1
 */

import * as vscode from 'vscode'
import type { PermissionMode, EffortLevel } from '../types'

/**
 * 配置适配器接口
 */
export interface IConfigAdapter {
  /**
   * 获取当前模型
   */
  getModel(): string

  /**
   * 设置当前模型
   */
  setModel(model: string): Promise<void>

  /**
   * 获取推理程度
   */
  getEffortLevel(): EffortLevel

  /**
   * 设置推理程度
   */
  setEffortLevel(level: EffortLevel): Promise<void>

  /**
   * 获取权限模式
   */
  getPermissionMode(): PermissionMode

  /**
   * 设置权限模式
   */
  setPermissionMode(mode: PermissionMode): Promise<void>
}

/**
 * VSCode 配置适配器实现
 */
export class VSCodeConfigAdapter implements IConfigAdapter {
  /**
   * 配置命名空间
   * 所有配置项的前缀
   *
   * 例如：evancod.model, evancod.effortLevel
   */
  private readonly SECTION = 'evancod'

  /**
   * 获取 VSCode 配置对象
   *
   * @param key - 配置键（可选）
   * @returns 配置值
   */
  private getConfig<T = any>(key?: string): T {
    const config = vscode.workspace.getConfiguration(this.SECTION)
    return key ? config.get<T>(key)! : (config as any)
  }

  /**
   * 设置 VSCode 配置
   *
   * @param key - 配置键
   * @param value - 配置值
   * @param target - 配置目标（全局或工作区）
   */
  private async setConfig(
    key: string,
    value: any,
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.SECTION)
    await config.update(key, value, target)
  }

  /**
   * 获取当前模型
   *
   * 读取顺序（优先级从高到低）：
   * 1. 工作区配置
   * 2. 用户配置
   * 3. 默认值
   */
  getModel(): string {
    return this.getConfig<string>('model') || 'claude-3-5-sonnet-20241022'
  }

  /**
   * 设置当前模型
   *
   * 默认保存到全局配置（所有项目共享）
   * 如果需要保存到工作区，传入 ConfigurationTarget.Workspace
   */
  async setModel(model: string): Promise<void> {
    await this.setConfig('model', model)
  }

  /**
   * 获取推理程度
   */
  getEffortLevel(): EffortLevel {
    return this.getConfig<EffortLevel>('effortLevel') || 'medium'
  }

  /**
   * 设置推理程度
   */
  async setEffortLevel(level: EffortLevel): Promise<void> {
    await this.setConfig('effortLevel', level)
  }

  /**
   * 获取权限模式
   */
  getPermissionMode(): PermissionMode {
    return this.getConfig<PermissionMode>('permissionMode') || 'default'
  }

  /**
   * 设置权限模式
   */
  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.setConfig('permissionMode', mode)
  }
}

/**
 * Mock 配置适配器（用于测试）
 */
export class MockConfigAdapter implements IConfigAdapter {
  private config = new Map<string, any>([
    ['model', 'claude-3-5-sonnet-20241022'],
    ['effortLevel', 'medium'],
    ['permissionMode', 'default'],
  ])

  getModel(): string {
    return this.config.get('model')
  }

  async setModel(model: string): Promise<void> {
    this.config.set('model', model)
  }

  getEffortLevel(): EffortLevel {
    return this.config.get('effortLevel')
  }

  async setEffortLevel(level: EffortLevel): Promise<void> {
    this.config.set('effortLevel', level)
  }

  getPermissionMode(): PermissionMode {
    return this.config.get('permissionMode')
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.config.set('permissionMode', mode)
  }

  /**
   * 测试辅助方法：重置配置
   */
  reset() {
    this.config.clear()
    this.config.set('model', 'claude-3-5-sonnet-20241022')
    this.config.set('effortLevel', 'medium')
    this.config.set('permissionMode', 'default')
  }
}
