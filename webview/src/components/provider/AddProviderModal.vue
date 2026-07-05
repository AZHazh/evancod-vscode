<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { useVSCode } from '@/composables/useVSCode'
import Button from '@/components/common/Button.vue'

type ProviderApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses'
type ProviderAuthStrategy = 'api_key' | 'auth_token' | 'auth_token_empty_api_key' | 'dual_same_token' | 'dual_dummy'

type Provider = {
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
  source?: 'manual' | 'newapi-sync'
}

interface Props {
  show: boolean
  provider?: Provider | null
}

interface Emits {
  (e: 'close'): void
  (e: 'submit', provider: any): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const vscode = useVSCode()

const form = ref({
  name: '',
  type: 'custom' as 'anthropic' | 'bedrock' | 'vertex' | 'azure' | 'custom',
  apiFormat: 'anthropic' as ProviderApiFormat,
  runtimeKind: 'anthropic_compatible' as 'anthropic_compatible' | 'openai_oauth',
  authStrategy: 'api_key' as ProviderAuthStrategy,
  baseUrl: '',
  apiKey: '',
  autoCompactWindow: '',
  models: {
    main: 'claude-3-5-sonnet-20241022',
    sonnet: 'claude-3-5-sonnet-20241022',
    opus: 'claude-3-opus-20240229',
    haiku: 'claude-3-5-haiku-20241022',
  },
})

const errors = ref({
  name: '',
  apiKey: '',
  baseUrl: '',
  mainModel: '',
})

const isSubmitting = ref(false)
const isEditMode = computed(() => !!props.provider)
const title = computed(() => isEditMode.value ? '编辑服务商' : '新增服务商')
const needsBaseUrl = computed(() => form.value.type === 'custom')
const isAnthropicFormat = computed(() => form.value.apiFormat === 'anthropic')

watch(
  () => props.provider,
  provider => {
    if (provider) {
      form.value = {
        name: provider.name,
        type: provider.type,
        apiFormat: normalizeApiFormat(provider.apiFormat),
        runtimeKind: provider.runtimeKind || 'anthropic_compatible',
        authStrategy: provider.authStrategy || 'api_key',
        baseUrl: provider.baseUrl || '',
        apiKey: provider.apiKey,
        autoCompactWindow: provider.autoCompactWindow ? String(provider.autoCompactWindow) : '',
        models: { ...provider.models },
      }
    } else {
      resetForm()
    }
  },
  { immediate: true }
)

function resetForm() {
  form.value = {
    name: '',
    type: 'custom',
    apiFormat: 'anthropic',
    runtimeKind: 'anthropic_compatible',
    authStrategy: 'api_key',
    baseUrl: '',
    apiKey: '',
    autoCompactWindow: '',
    models: {
      main: 'claude-3-5-sonnet-20241022',
      sonnet: 'claude-3-5-sonnet-20241022',
      opus: 'claude-3-opus-20240229',
      haiku: 'claude-3-5-haiku-20241022',
    },
  }
  errors.value = { name: '', apiKey: '', baseUrl: '', mainModel: '' }
}

function validateForm(): boolean {
  let isValid = true

  errors.value = { name: '', apiKey: '', baseUrl: '', mainModel: '' }

  if (!form.value.name.trim()) {
    errors.value.name = '服务商名称不能为空'
    isValid = false
  }

  if (!form.value.apiKey.trim() && form.value.runtimeKind !== 'openai_oauth') {
    errors.value.apiKey = 'API Key 不能为空'
    isValid = false
  }

  if (needsBaseUrl.value && !form.value.baseUrl.trim()) {
    errors.value.baseUrl = 'Base URL 不能为空'
    isValid = false
  }

  if (!form.value.models.main.trim()) {
    errors.value.mainModel = '主模型不能为空'
    isValid = false
  }

  return isValid
}

async function handleSubmit() {
  if (!validateForm()) return

  isSubmitting.value = true

  try {
    // 注意：form.value 及嵌套的 models 是 Vue 响应式 Proxy，无法被 postMessage
    // 的结构化克隆算法序列化（会抛 DataCloneError）。这里显式构造纯对象以剥离
    // Proxy；不用 JSON 深拷贝是为了保留 undefined 值（结构化克隆支持 undefined），
    // 否则编辑时清空 baseUrl / autoCompactWindow 将无法覆盖旧值。
    const providerData = {
      name: form.value.name,
      type: form.value.type,
      apiFormat: form.value.apiFormat,
      runtimeKind: form.value.runtimeKind,
      authStrategy: form.value.authStrategy,
      apiKey: form.value.apiKey,
      presetId: form.value.type,
      baseUrl: needsBaseUrl.value ? form.value.baseUrl.replace(/\/+$/, '') : undefined,
      autoCompactWindow: form.value.autoCompactWindow ? Number(form.value.autoCompactWindow) : undefined,
      source: props.provider?.source || 'manual',
      models: {
        main: form.value.models.main,
        sonnet: form.value.models.sonnet,
        opus: form.value.models.opus,
        haiku: form.value.models.haiku,
      },
    }

    if (isEditMode.value) {
      vscode.postMessage({
        type: 'provider.update',
        data: {
          id: props.provider!.id,
          updates: providerData,
        },
      })
    } else {
      vscode.postMessage({
        type: 'provider.create',
        data: providerData,
      })
    }

    emit('submit', providerData)
    emit('close')
  } finally {
    isSubmitting.value = false
  }
}

function handleClose() {
  if (!isSubmitting.value) {
    emit('close')
  }
}

function normalizeApiFormat(apiFormat: any): ProviderApiFormat {
  if (apiFormat === 'openai') return 'openai_chat'
  if (apiFormat === 'openai_chat' || apiFormat === 'openai_responses') return apiFormat
  return 'anthropic'
}

watch(
  () => form.value.type,
  type => {
    if (type === 'anthropic') {
      form.value.apiFormat = 'anthropic'
      form.value.baseUrl = ''
    }
  }
)
</script>

<template>
  <div v-if="show" class="modal-overlay" @click="handleClose">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>{{ title }}</h2>
        <Button variant="ghost" size="medium" @click="handleClose" :disabled="isSubmitting" aria-label="关闭">
          <template #icon><X /></template>
        </Button>
      </div>

      <div class="modal-body">
        <form @submit.prevent="handleSubmit">
          <div class="form-group">
            <label>服务商名称 *</label>
            <input v-model="form.name" type="text" placeholder="例如：OpenAI 中转" :class="{ error: errors.name }" />
            <span v-if="errors.name" class="error-message">{{ errors.name }}</span>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>服务商类型 *</label>
              <select v-model="form.type">
                <option value="anthropic">Anthropic 官方</option>
                <option value="custom">自定义 API</option>
                <option value="bedrock" disabled>AWS Bedrock（即将支持）</option>
                <option value="vertex" disabled>Google Vertex AI（即将支持）</option>
                <option value="azure" disabled>Azure OpenAI（即将支持）</option>
              </select>
            </div>

            <div class="form-group">
              <label>协议格式 *</label>
              <select v-model="form.apiFormat">
                <option value="anthropic">Anthropic Messages</option>
                <option value="openai_chat">OpenAI Chat Completions</option>
                <option value="openai_responses">OpenAI Responses</option>
              </select>
              <span class="form-hint">OpenAI 协议会按桌面端逻辑转换为可对话格式</span>
            </div>
          </div>

          <div v-if="needsBaseUrl" class="form-group">
            <label>Base URL *</label>
            <input v-model="form.baseUrl" type="url" placeholder="https://api.example.com" :class="{ error: errors.baseUrl }" />
            <span v-if="errors.baseUrl" class="error-message">{{ errors.baseUrl }}</span>
            <span v-else class="form-hint">填写上游根地址，系统会自动拼接 /v1/messages、/v1/chat/completions 或 /v1/responses</span>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>鉴权策略</label>
              <select v-model="form.authStrategy" :disabled="!isAnthropicFormat">
                <option value="api_key">x-api-key / API Key</option>
                <option value="auth_token">Bearer Token</option>
                <option value="auth_token_empty_api_key">Bearer Token + 空 API Key</option>
                <option value="dual_same_token">API Key 和 Bearer 使用相同 Token</option>
                <option value="dual_dummy">API Key 和 Bearer 使用 dummy</option>
              </select>
            </div>

            <div class="form-group">
              <label>API Key *</label>
              <input v-model="form.apiKey" type="password" placeholder="sk-..." :class="{ error: errors.apiKey }" />
              <span v-if="errors.apiKey" class="error-message">{{ errors.apiKey }}</span>
            </div>
          </div>

          <div class="form-section">
            <h3>模型配置</h3>
            <p class="section-hint">和桌面端一致，四类模型会用于主对话、Sonnet、Opus、Haiku 场景。</p>

            <div class="form-group">
              <label>主模型（对话）*</label>
              <input v-model="form.models.main" type="text" placeholder="claude-3-5-sonnet-20241022 或 gpt-4.1" :class="{ error: errors.mainModel }" />
              <span v-if="errors.mainModel" class="error-message">{{ errors.mainModel }}</span>
            </div>

            <div class="form-row two-columns">
              <div class="form-group">
                <label>Sonnet 模型</label>
                <input v-model="form.models.sonnet" type="text" placeholder="claude-3-5-sonnet-20241022" />
              </div>

              <div class="form-group">
                <label>Opus 模型</label>
                <input v-model="form.models.opus" type="text" placeholder="claude-3-opus-20240229" />
              </div>
            </div>

            <div class="form-row two-columns">
              <div class="form-group">
                <label>Haiku 模型</label>
                <input v-model="form.models.haiku" type="text" placeholder="claude-3-5-haiku-20241022" />
              </div>

              <div class="form-group">
                <label>自动压缩窗口</label>
                <input v-model="form.autoCompactWindow" type="number" min="0" placeholder="可选，例如 160000" />
              </div>
            </div>
          </div>
        </form>
      </div>

      <div class="modal-footer">
        <Button variant="ghost" @click="handleClose" :disabled="isSubmitting">取消</Button>
        <Button variant="primary" @click="handleSubmit" :disabled="isSubmitting" :loading="isSubmitting">保存</Button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-surface-glass);
  border: 1px solid var(--color-surface-glass-border);
  border-radius: var(--radius-xl);
  max-width: 760px;
  width: 92%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-dropdown);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-border);

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-md);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);

  &.two-columns {
    align-items: start;
  }
}

.form-group {
  margin-bottom: var(--spacing-md);

  label {
    display: block;
    margin-bottom: var(--spacing-sm);
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-primary);
  }

  input,
  select {
    width: 100%;
    padding: 8px 12px;
    background: var(--color-input-bg);
    color: var(--color-input-fg);
    border: 1px solid var(--color-input-border);
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-family: inherit;

    &:focus {
      outline: none;
      border-color: var(--color-accent);
    }

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    &.error {
      border-color: #f85149;
    }
  }

  .form-hint {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }

  .error-message {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: #f85149;
  }
}

.form-section {
  margin-top: var(--spacing-lg);
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--color-border);

  h3 {
    margin: 0 0 var(--spacing-sm) 0;
    font-size: 16px;
    font-weight: 600;
  }

  .section-hint {
    margin: 0 0 var(--spacing-md) 0;
    font-size: 13px;
    color: var(--color-text-secondary);
  }
}

.modal-footer {
  display: flex;
  gap: var(--spacing-sm);
  justify-content: flex-end;
  padding: var(--spacing-md);
  border-top: 1px solid var(--color-border);
}

@media (max-width: 720px) {
  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
