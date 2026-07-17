/**
 * Provider 服务 - API 提供商配置管理
 */

import * as vscode from 'vscode'
import type {
  Provider,
  ProviderApiFormat,
  ProviderAuthStrategy,
  ProviderRuntimeKind,
  ProviderType,
} from '../../types'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

interface ProvidersIndex {
  schemaVersion: number
  activeId: string | null
  providers: Provider[]
  providerOrder: string[]
}

export class ProviderService {
  private providers: Provider[] = []
  private activeProviderId: string | null = null
  private providerOrder: string[] = []
  private configPath: string

  constructor(private context: vscode.ExtensionContext) {
    this.configPath = path.join(os.homedir(), '.claude', 'cc-evancod', 'providers.json')
  }

  async initialize() {
    await this.ensureConfigDir()
    await this.loadProviders()
  }

  private async ensureConfigDir() {
    const dir = path.dirname(this.configPath)
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch (err) {
      console.error('Failed to create config directory:', err)
    }
  }

  async loadProviders() {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8')
      const data = JSON.parse(content)
      const normalized = this.normalizeProvidersIndex(data)

      this.providers = normalized.providers
      this.activeProviderId = normalized.activeId
      this.providerOrder = normalized.providerOrder

      console.log(`[ProviderService] Loaded ${this.providers.length} providers, active: ${this.activeProviderId}`)
    } catch (err) {
      console.log('No existing providers config, starting fresh')
      this.providers = []
      this.activeProviderId = null
      this.providerOrder = []
    }
  }

  async saveProviders() {
    const providerIds = new Set(this.providers.map(p => p.id))
    const orderedIds = [
      ...this.providerOrder.filter(id => providerIds.has(id)),
      ...this.providers.map(p => p.id).filter(id => !this.providerOrder.includes(id)),
    ]

    const data: ProvidersIndex = {
      schemaVersion: 2,
      activeId: this.activeProviderId,
      providers: this.providers,
      providerOrder: orderedIds,
    }

    this.providerOrder = orderedIds
    await fs.writeFile(this.configPath, JSON.stringify(data, null, 2), 'utf-8')
  }

  getProviders(): Provider[] {
    const providerById = new Map(this.providers.map(provider => [provider.id, provider]))
    const ordered = this.providerOrder
      .map(id => providerById.get(id))
      .filter((provider): provider is Provider => Boolean(provider))
    const missing = this.providers.filter(provider => !this.providerOrder.includes(provider.id))
    return [...ordered, ...missing]
  }

  getActiveProvider(): Provider | null {
    if (!this.activeProviderId) return null
    return this.providers.find(p => p.id === this.activeProviderId) || null
  }

  /**
   * 获取生图服务商（apiFormat 为 openai_image 的第一个 Provider）
   */
  getImageProvider(): Provider | null {
    return this.providers.find(p => p.apiFormat === 'openai_image') || null
  }

  async addProvider(provider: Omit<Provider, 'id' | 'createdAt'>): Promise<Provider> {
    const newProvider = this.normalizeProvider({
      ...provider,
      id: this.generateId(),
      createdAt: new Date().toISOString(),
    })

    if (!newProvider) {
      throw new Error('Provider 数据无效')
    }

    this.providers.push(newProvider)
    this.providerOrder.push(newProvider.id)
    await this.saveProviders()
    return newProvider
  }

  async updateProvider(id: string, updates: Partial<Provider>): Promise<Provider> {
    const index = this.providers.findIndex(p => p.id === id)
    if (index === -1) {
      throw new Error('Provider 不存在')
    }

    const updatedProvider = this.normalizeProvider({
      ...this.providers[index],
      ...updates,
      id,
      createdAt: this.providers[index].createdAt,
    })

    if (!updatedProvider) {
      throw new Error('Provider 数据无效')
    }

    this.providers[index] = updatedProvider
    await this.saveProviders()
    return updatedProvider
  }

  async activateProvider(id: string) {
    const provider = this.providers.find(p => p.id === id)
    if (!provider) {
      throw new Error(`Provider ${id} not found`)
    }
    this.activeProviderId = id
    await this.saveProviders()
  }

  async deleteProvider(id: string) {
    if (this.activeProviderId === id) {
      throw new Error('不能删除当前激活的 Provider，请先切换到其他 Provider')
    }

    this.providers = this.providers.filter(p => p.id !== id)
    this.providerOrder = this.providerOrder.filter(providerId => providerId !== id)
    await this.saveProviders()
  }

  async reorderProviders(providerOrder: string[]) {
    const providerIds = new Set(this.providers.map(p => p.id))
    this.providerOrder = providerOrder.filter(id => providerIds.has(id))
    await this.saveProviders()
  }

  private normalizeProvidersIndex(data: any): ProvidersIndex {
    const providers: Provider[] = Array.isArray(data.providers)
      ? data.providers
        .map((provider: any) => this.normalizeProvider(provider))
        .filter((provider: Provider | null): provider is Provider => Boolean(provider))
      : []

    const providerIds = new Set(providers.map(provider => provider.id))
    const activeId = typeof data.activeId === 'string'
      ? data.activeId
      : typeof data.activeProviderId === 'string'
        ? data.activeProviderId
        : null

    const rawOrder = Array.isArray(data.providerOrder) ? data.providerOrder : []
    const providerOrder = [
      ...rawOrder.filter((id: any): id is string => typeof id === 'string' && providerIds.has(id)),
      ...providers.map(provider => provider.id).filter(id => !rawOrder.includes(id)),
    ]

    return {
      schemaVersion: 2,
      activeId: activeId && providerIds.has(activeId) ? activeId : null,
      providers,
      providerOrder,
    }
  }

  private normalizeProvider(raw: any): Provider | null {
    if (!raw || typeof raw !== 'object') return null
    if (!raw.id || !raw.name) return null

    const type = this.normalizeProviderType(raw.type || raw.presetId)
    const apiFormat = this.normalizeApiFormat(raw.apiFormat)
    const runtimeKind = this.normalizeRuntimeKind(raw.runtimeKind)
    const authStrategy = this.normalizeAuthStrategy(raw.authStrategy)

    const mainModel = String(raw.models?.main || raw.model || 'claude-3-5-sonnet-20241022')
    const sonnetModel = String(raw.models?.sonnet || mainModel)
    const opusModel = String(raw.models?.opus || mainModel)
    const haikuModel = String(raw.models?.haiku || mainModel)

    return {
      ...raw,
      id: String(raw.id),
      name: String(raw.name),
      type,
      presetId: raw.presetId || type,
      apiFormat,
      runtimeKind,
      authStrategy,
      baseUrl: raw.baseUrl ? String(raw.baseUrl).replace(/\/+$/, '') : undefined,
      apiKey: String(raw.apiKey || ''),
      models: {
        main: mainModel,
        sonnet: sonnetModel,
        opus: opusModel,
        haiku: haikuModel,
      },
      autoCompactWindow: typeof raw.autoCompactWindow === 'number'
        ? raw.autoCompactWindow
        : typeof raw.autoCompactWindow === 'string' && raw.autoCompactWindow.trim()
          ? Number(raw.autoCompactWindow)
          : undefined,
      createdAt: raw.createdAt || new Date().toISOString(),
      source: raw.source === 'newapi-sync' ? 'newapi-sync' : 'manual',
    }
  }

  private normalizeProviderType(type: any): ProviderType {
    if (type === 'anthropic' || type === 'bedrock' || type === 'vertex' || type === 'azure' || type === 'custom') {
      return type
    }
    return 'custom'
  }

  private normalizeApiFormat(apiFormat: any): ProviderApiFormat {
    if (apiFormat === 'openai') return 'openai_chat'
    if (apiFormat === 'anthropic' || apiFormat === 'openai_chat' || apiFormat === 'openai_responses' || apiFormat === 'openai_image') {
      return apiFormat
    }
    return 'anthropic'
  }

  private normalizeAuthStrategy(authStrategy: any): ProviderAuthStrategy {
    if (
      authStrategy === 'api_key' ||
      authStrategy === 'auth_token' ||
      authStrategy === 'auth_token_empty_api_key' ||
      authStrategy === 'dual_same_token' ||
      authStrategy === 'dual_dummy'
    ) {
      return authStrategy
    }
    return 'api_key'
  }

  private normalizeRuntimeKind(runtimeKind: any): ProviderRuntimeKind {
    if (runtimeKind === 'openai_oauth') return 'openai_oauth'
    return 'anthropic_compatible'
  }

  private generateId(): string {
    return `provider-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}
