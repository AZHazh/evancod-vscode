<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { Package, Plus, RefreshCw, Pencil, Trash2, Play } from 'lucide-vue-next'
import { useVSCode } from '@/composables/useVSCode'
import Button from '@/components/common/Button.vue'
import Modal from '@/components/common/Modal.vue'
import AddProviderModal from '@/components/provider/AddProviderModal.vue'
import NewApiSyncModal from '@/components/provider/NewApiSyncModal.vue'

interface Provider {
  id: string
  name: string
  type: 'anthropic' | 'bedrock' | 'vertex' | 'azure' | 'custom'
  presetId?: string
  apiFormat: 'anthropic' | 'openai_chat' | 'openai_responses' | 'openai_image'
  runtimeKind?: 'anthropic_compatible' | 'openai_oauth'
  authStrategy?: 'api_key' | 'auth_token' | 'auth_token_empty_api_key' | 'dual_same_token' | 'dual_dummy'
  baseUrl?: string
  apiKey: string
  models: {
    main: string
    sonnet: string
    opus: string
    haiku: string
  }
  autoCompactWindow?: number
  createdAt: string
  source?: 'manual' | 'newapi-sync'
}

const vscode = useVSCode()
const providers = ref<Provider[]>([])
const activeProviderId = ref<string | null>(null)
const showAddModal = ref(false)
const editingProvider = ref<Provider | null>(null)
const showNewApiSyncModal = ref(false)
const newApiPreview = ref<any>(null)
const deletingProvider = ref<Provider | null>(null)
const showDeleteConfirm = computed(() => !!deletingProvider.value)

onMounted(() => {
  loadProviders()
  window.addEventListener('message', handleMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', handleMessage)
})

function loadProviders() {
  vscode.postMessage({ type: 'provider.list.request' })
}

function handleMessage(event: MessageEvent) {
  const message = event.data

  switch (message.type) {
    case 'provider.list':
      providers.value = message.data.providers
      activeProviderId.value = message.data.activeId
      break
    case 'provider.created': {
      // 后端异步写文件，provider.created 可能晚于随后的 provider.list 到达；
      // 若无条件 push 会与 list 刷新叠加产生重复项。这里按 id 去重（存在则替换）。
      const created = message.data.provider
      const index = providers.value.findIndex(provider => provider.id === created.id)
      if (index === -1) {
        providers.value.push(created)
      } else {
        providers.value[index] = created
      }
      break
    }
    case 'provider.updated':
      providers.value = providers.value.map(provider =>
        provider.id === message.data.provider.id ? message.data.provider : provider
      )
      break
    case 'provider.activated':
      activeProviderId.value = message.data.providerId
      break
    case 'newapi.sync.preview':
      newApiPreview.value = message.data
      showNewApiSyncModal.value = true
      break
    case 'newapi.sync.complete':
      loadProviders()
      break
  }
}

function handleAddProvider() {
  editingProvider.value = null
  showAddModal.value = true
}

function handleEditProvider(provider: Provider) {
  editingProvider.value = { ...provider }
  showAddModal.value = true
}

function handleDeleteProvider(id: string) {
  const provider = providers.value.find(p => p.id === id)
  if (!provider) return
  // VSCode webview 运行在未开启 allow-modals 的 sandbox iframe 中，
  // 原生 confirm() 会被禁用并报错，因此改用应用内 Modal 组件确认。
  deletingProvider.value = provider
}

function handleConfirmDelete() {
  const provider = deletingProvider.value
  if (!provider) return

  vscode.postMessage({
    type: 'provider.delete',
    data: { id: provider.id },
  })
  deletingProvider.value = null
}

function handleCancelDelete() {
  deletingProvider.value = null
}

function handleActivateProvider(id: string) {
  vscode.postMessage({
    type: 'provider.activate',
    data: { id },
  })
}

function handleTestProvider(id: string) {
  vscode.postMessage({
    type: 'provider.test',
    data: { id },
  })
}

function handleSyncNewApi() {
  newApiPreview.value = null
  vscode.postMessage({ type: 'newapi.sync.start' })
}

function handleSyncClose() {
  showNewApiSyncModal.value = false
  newApiPreview.value = null
  loadProviders()
}

function handleModalClose() {
  showAddModal.value = false
  editingProvider.value = null
  loadProviders()
}
</script>

<template>
  <div class="provider-settings">
    <div class="header">
      <h2>服务商管理</h2>
      <div class="actions">
        <Button variant="secondary" @click="handleSyncNewApi">
          <template #icon><RefreshCw /></template>
          同步中转
        </Button>
        <Button variant="primary" @click="handleAddProvider">
          <template #icon><Plus /></template>
          新增服务商
        </Button>
      </div>
    </div>

    <div class="provider-list">
      <div
        v-for="provider in providers"
        :key="provider.id"
        class="provider-item"
        :class="{ 'is-active': provider.id === activeProviderId }"
      >
        <div class="provider-info">
          <div class="provider-header">
            <div class="title-row">
              <h3>{{ provider.name }}</h3>
              <span v-if="provider.id === activeProviderId" class="badge-active">激活中</span>
            </div>
            <div class="meta-row">
              <span>{{ provider.apiFormat }}</span>
              <span>{{ provider.type }}</span>
              <span v-if="provider.baseUrl">{{ provider.baseUrl }}</span>
            </div>
          </div>
          <div class="provider-details">
            <div class="detail-item"><span class="label">主模型</span><span class="value">{{ provider.models.main }}</span></div>
            <div class="detail-item"><span class="label">Sonnet</span><span class="value">{{ provider.models.sonnet }}</span></div>
            <div class="detail-item"><span class="label">Opus</span><span class="value">{{ provider.models.opus }}</span></div>
            <div class="detail-item"><span class="label">Haiku</span><span class="value">{{ provider.models.haiku }}</span></div>
          </div>
        </div>

        <div class="provider-actions">
          <Button v-if="provider.id !== activeProviderId" variant="primary" size="small" @click="handleActivateProvider(provider.id)">
            <template #icon><Play /></template>
            激活
          </Button>
          <Button variant="secondary" size="small" @click="handleTestProvider(provider.id)">
            <template #icon><RefreshCw /></template>
            测试
          </Button>
          <Button variant="secondary" size="small" @click="handleEditProvider(provider)">
            <template #icon><Pencil /></template>
            编辑
          </Button>
          <Button variant="danger" size="small" @click="handleDeleteProvider(provider.id)">
            <template #icon><Trash2 /></template>
            删除
          </Button>
        </div>
      </div>

      <div v-if="providers.length === 0" class="empty-state">
        <Package class="empty-icon" />
        <div class="empty-text">还没有配置服务商</div>
        <div class="empty-hint">点击“新增服务商”或“同步中转”开始</div>
      </div>
    </div>

    <AddProviderModal
      :show="showAddModal"
      :provider="editingProvider"
      @close="handleModalClose"
      @submit="handleModalClose"
    />

    <NewApiSyncModal
      :show="showNewApiSyncModal"
      :preview="newApiPreview"
      @close="handleSyncClose"
      @success="handleSyncClose"
    />

    <Modal
      :model-value="showDeleteConfirm"
      title="删除服务商"
      size="small"
      @update:model-value="handleCancelDelete"
      @close="handleCancelDelete"
      @confirm="handleConfirmDelete"
    >
      <p class="delete-confirm-text">
        确定要删除服务商 “{{ deletingProvider?.name }}” 吗？此操作不可撤销。
      </p>
    </Modal>
  </div>
</template>

<style scoped lang="scss">
.provider-settings {
  padding: var(--spacing-lg);
  max-width: 1200px;
  margin: 0 auto;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-lg);

  h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
  }

  .actions {
    display: flex;
    gap: var(--spacing-md);
  }
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.provider-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-lg);
  padding: var(--spacing-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.provider-item.is-active {
  border-color: var(--color-border-focus);
  background: var(--color-surface-container);
}

.provider-info {
  flex: 1;
  min-width: 0;
}

.provider-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--spacing-sm);
}

.title-row,
.meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.provider-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.badge-active {
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--color-accent);
  color: white;
  font-size: 12px;
}

.meta-row {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.provider-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
}

.detail-item {
  display: flex;
  gap: 8px;
  font-size: 13px;
}

.detail-item .label {
  color: var(--color-text-secondary);
  min-width: 56px;
}

.detail-item .value {
  color: var(--color-text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  color: var(--color-text-secondary);
}

.empty-icon {
  width: 48px;
  height: 48px;
  margin-bottom: var(--spacing-md);
  color: var(--color-text-tertiary);
}

.empty-text {
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 6px;
}

.empty-hint {
  font-size: 13px;
}

.delete-confirm-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-primary);
}
</style>
