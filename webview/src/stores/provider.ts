import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useVSCode } from '@/composables/useVSCode'

export type ProviderApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses'
export type ProviderAuthStrategy = 'api_key' | 'auth_token' | 'auth_token_empty_api_key' | 'dual_same_token' | 'dual_dummy'

export interface Provider {
  id: string
  name: string
  type: 'anthropic' | 'bedrock' | 'vertex' | 'azure' | 'custom'
  presetId?: string
  apiFormat: ProviderApiFormat
  runtimeKind?: 'anthropic_compatible' | 'openai_oauth'
  authStrategy?: ProviderAuthStrategy
  baseUrl?: string
  apiKey: string
  models: {
    main: string
    sonnet: string
    opus: string
    haiku: string
  }
  autoCompactWindow?: number
  modelContextWindows?: Record<string, number>
  createdAt: string
  source?: 'manual' | 'newapi-sync'
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export const useProviderStore = defineStore('provider', () => {
  const vscode = useVSCode()
  const providers = ref<Provider[]>([])
  const activeProviderId = ref<string | null>(null)
  const currentModel = ref('claude-3-5-sonnet-20241022')
  const effortLevel = ref<EffortLevel>('medium')
  const permissionMode = ref<PermissionMode>('default')

  const activeProvider = computed(() => providers.value.find(provider => provider.id === activeProviderId.value) || null)

  const modelOptions = computed(() => {
    if (!activeProvider.value) return []

    const entries = [
      ['main', activeProvider.value.models.main],
      ['sonnet', activeProvider.value.models.sonnet],
      ['opus', activeProvider.value.models.opus],
      ['haiku', activeProvider.value.models.haiku],
    ] as const

    const seen = new Set<string>()
    return entries
      .filter(([, model]) => model && !seen.has(model) && seen.add(model))
      .map(([kind, model]) => ({ kind, model }))
  })

  function initialize() {
    window.addEventListener('message', handleMessage)
    loadProviders()
  }

  function handleMessage(event: MessageEvent) {
    const message = event.data

    switch (message.type) {
      case 'provider.list':
        providers.value = message.data.providers
        activeProviderId.value = message.data.activeId
        break
      case 'provider.created':
        providers.value.push(message.data.provider)
        break
      case 'provider.updated':
        providers.value = providers.value.map(provider =>
          provider.id === message.data.provider.id ? message.data.provider : provider
        )
        break
      case 'provider.activated':
        activeProviderId.value = message.data.providerId
        loadProviders()
        resetRuntime()
        break
      case 'runtime.state':
        activeProviderId.value = message.data.activeProviderId
        currentModel.value = message.data.currentModel
        effortLevel.value = message.data.effortLevel || 'medium'
        permissionMode.value = message.data.permissionMode || 'default'
        break
      case 'newapi.sync.complete':
        loadProviders()
        break
    }
  }

  function loadProviders() {
    vscode.postMessage({ type: 'provider.list.request' })
  }

  function activateProvider(id: string) {
    vscode.postMessage({ type: 'provider.activate', data: { id } })
  }

  function setModel(model: string) {
    currentModel.value = model
    vscode.postMessage({ type: 'runtime.set', data: { model } })
  }

  function setEffortLevel(level: EffortLevel) {
    effortLevel.value = level
    vscode.postMessage({ type: 'runtime.set', data: { effortLevel: level } })
  }

  function setPermissionMode(mode: PermissionMode) {
    permissionMode.value = mode
    vscode.postMessage({ type: 'runtime.set', data: { permissionMode: mode } })
  }

  function resetRuntime() {
    vscode.postMessage({ type: 'runtime.reset' })
  }

  return {
    providers,
    activeProviderId,
    activeProvider,
    currentModel,
    effortLevel,
    permissionMode,
    modelOptions,
    initialize,
    loadProviders,
    activateProvider,
    setModel,
    setEffortLevel,
    setPermissionMode,
    resetRuntime,
  }
})
