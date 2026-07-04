/**
 * new-api 同步弹窗组件
 *
 * 职责：
 * 1. 提供浏览器授权同步流程
 * 2. 预览可用的 Token 和模型
 * 3. 配置模型映射
 * 4. 批量导入为 Provider
 *
 * 同步流程（4 步）：
 * Step 1: 输入站点 URL 并打开浏览器授权
 * Step 2: 预览 Token 列表，选择要导入的 Token
 * Step 3: 配置模型映射（每个 Token 对应的模型）
 * Step 4: 确认并导入
 *
 * 设计理念：
 * - 分步引导，降低使用难度
 * - 自动映射，减少手动配置
 * - 批量导入，提高效率
 * - 友好的错误提示
 */

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { TriangleAlert, X } from 'lucide-vue-next'
import { useVSCode } from '@/composables/useVSCode'
import Button from '@/components/common/Button.vue'

/**
 * 组件 Props
 */
interface Props {
  /**
   * 是否显示弹窗
   */
  show: boolean
  /**
   * 授权完成后从 Extension 返回的预览数据
   */
  preview?: {
    siteUrl: string
    tokens: NewApiToken[]
    models: string[]
    groupModels?: Record<string, string[]>
  } | null
}

/**
 * 组件 Emits
 */
interface Emits {
  (e: 'close'): void
  (e: 'success', count: number): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const vscode = useVSCode()

/**
 * new-api Token 类型
 */
interface NewApiToken {
  id: number
  name: string
  key: string
  status: number
  remain_quota: number
  /**
   * 支持的模型列表（从 new-api 分组解析）
   */
  models: string[]
}

/**
 * 模型映射
 */
interface ModelMapping {
  main: string
  sonnet: string
  opus: string
  haiku: string
}

// ========== 状态管理 ==========

/**
 * 当前步骤（1-4）
 */
const currentStep = ref(2)

/**
 * 是否正在加载
 */
const isLoading = ref(false)

/**
 * 错误消息
 */
const errorMessage = ref('')

// ========== Step 1: 配置输入 ==========

/**
 * 站点 URL
 */
const siteUrl = ref('')

/**
 * Step 1 表单错误
 */
const step1Errors = ref({
  siteUrl: '',
})

// ========== Step 2 & 3: Token 列表 ==========

/**
 * 获取到的 Token 列表
 */
const tokens = ref<NewApiToken[]>([])

/**
 * 选中的 Token ID 列表
 */
const selectedTokenIds = ref<Set<number>>(new Set())

/**
 * 可用的模型列表（从所有 Token 中提取）
 */
const availableModels = ref<string[]>([])

// ========== Step 4: 模型映射 ==========

/**
 * 每个 Token 的模型映射配置
 * key: Token ID
 * value: 模型映射
 */
const modelMappings = ref<Map<number, ModelMapping>>(new Map())

// ========== 计算属性 ==========

/**
 * 步骤标题
 */
const stepTitle = computed(() => {
  const titles = [
    '',
    '授权同步',
    '选择 Token',
    '配置模型',
    '确认导入',
  ]
  return titles[currentStep.value] || ''
})

/**
 * 是否可以进入下一步
 */
const canGoNext = computed(() => {
  switch (currentStep.value) {
    case 1:
      // Step 1: 只需要填写 URL
      return siteUrl.value.trim()
    case 2:
      // Step 2: 需要选择至少一个 Token
      return selectedTokenIds.value.size > 0
    case 3:
      // Step 3: 所有选中的 Token 都需要配置模型映射
      return Array.from(selectedTokenIds.value).every(id =>
        modelMappings.value.has(id)
      )
    default:
      return true
  }
})

/**
 * 下一步按钮文本
 */
const nextButtonText = computed(() => {
  if (currentStep.value === 1) return '打开浏览器授权'
  if (currentStep.value === 4) return '开始导入'
  return '下一步'
})

// ========== 方法 ==========

watch(
  () => props.preview,
  preview => {
    if (!preview) return
    currentStep.value = 2
    siteUrl.value = preview.siteUrl
    tokens.value = preview.tokens || []
    availableModels.value = preview.models || []
    selectedTokenIds.value = new Set(tokens.value.map(token => token.id))
    modelMappings.value.clear()
    errorMessage.value = ''
  },
  { immediate: true }
)

/**
 * 关闭弹窗
 */
function handleClose() {
  if (!isLoading.value) {
    resetState()
    emit('close')
  }
}

/**
 * 重置状态
 */
function resetState() {
  currentStep.value = props.preview ? 2 : 1
  siteUrl.value = props.preview?.siteUrl || ''
  tokens.value = props.preview?.tokens || []
  selectedTokenIds.value.clear()
  availableModels.value = props.preview?.models || []
  modelMappings.value.clear()
  errorMessage.value = ''
  step1Errors.value = { siteUrl: '' }
}

/**
 * 验证 Step 1 表单
 */
function validateStep1(): boolean {
  let isValid = true

  // 验证 URL
  if (!siteUrl.value.trim()) {
    step1Errors.value.siteUrl = '站点 URL 不能为空'
    isValid = false
  } else if (!isValidUrl(siteUrl.value)) {
    step1Errors.value.siteUrl = 'URL 格式不正确'
    isValid = false
  } else {
    step1Errors.value.siteUrl = ''
  }

  return isValid
}

/**
 * 验证 URL 格式
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * 下一步
 */
async function handleNext() {
  errorMessage.value = ''

  try {
    if (currentStep.value === 1) {
      // Step 1 → Step 2: 验证站点 URL，打开浏览器授权并获取 Token 列表
      if (!validateStep1()) return

      await startAuthorization()
    } else if (currentStep.value === 2) {
      // Step 2 → Step 3: 初始化模型映射
      initializeModelMappings()
      currentStep.value = 3
    } else if (currentStep.value === 3) {
      // Step 3 → Step 4: 进入确认页面
      currentStep.value = 4
    } else if (currentStep.value === 4) {
      // Step 4: 执行导入
      await executeImport()
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '操作失败'
  }
}

/**
 * 上一步
 */
function handlePrevious() {
  if (currentStep.value > 2 && !isLoading.value) {
    currentStep.value--
    errorMessage.value = ''
  }
}

/**
 * 打开浏览器授权
 * Step 1 → Step 2
 */
async function startAuthorization() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    // 发送到 Extension
    vscode.postMessage({
      type: 'newapi.sync.start',
      data: {
        siteUrl: siteUrl.value,
      },
    })

    // 监听响应
    const response = await waitForMessage('newapi.sync.preview')

    // 保存 Token 列表
    tokens.value = response.data.tokens
    availableModels.value = response.data.models

    // 进入 Step 2（选择 Token）
    currentStep.value = 2
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : '授权同步失败'
    )
  } finally {
    isLoading.value = false
  }
}

/**
 * 初始化模型映射
 * 为每个选中的 Token 创建默认映射
 */
function initializeModelMappings() {
  for (const tokenId of selectedTokenIds.value) {
    if (!modelMappings.value.has(tokenId)) {
      const token = tokens.value.find(t => t.id === tokenId)
      if (token) {
        // 创建默认映射
        const mapping = createDefaultMapping(token)
        modelMappings.value.set(tokenId, mapping)
      }
    }
  }
}

/**
 * 创建默认模型映射
 * 智能选择合适的模型
 */
function createDefaultMapping(token: NewApiToken): ModelMapping {
  const models = token.models || []

  // 查找 Sonnet 模型
  const sonnet =
    models.find(m => m.includes('sonnet') || m.includes('claude-3-5-sonnet')) ||
    models[0] ||
    'claude-3-5-sonnet-20241022'

  // 查找 Opus 模型
  const opus =
    models.find(m => m.includes('opus') || m.includes('claude-3-opus')) ||
    sonnet

  // 查找 Haiku 模型
  const haiku =
    models.find(m => m.includes('haiku') || m.includes('claude-3-5-haiku')) ||
    sonnet

  return {
    main: sonnet,
    sonnet,
    opus,
    haiku,
  }
}

/**
 * 执行导入
 * Step 5: 批量创建 Provider
 */
async function executeImport() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    // 准备导入数据
    const selectedTokens = tokens.value.filter(t =>
      selectedTokenIds.value.has(t.id)
    )

    console.log('[NewApiSync] 准备导入，选中的 Token:', selectedTokens.length)

    const importData = selectedTokens.map(token => {
      const mapping = modelMappings.value.get(token.id)!
      console.log(`[NewApiSync] Token ${token.name} 映射:`, mapping)
      return {
        tokenId: token.id,
        tokenName: token.name,
        tokenKey: token.key,
        // 将 mapping 转换为普通对象，确保可以被 postMessage 序列化
        mapping: {
          main: mapping.main,
          sonnet: mapping.sonnet,
          opus: mapping.opus,
          haiku: mapping.haiku,
        },
      }
    })

    console.log('[NewApiSync] 发送导入请求:', {
      siteUrl: siteUrl.value,
      tokenCount: importData.length
    })

    // 先监听完成消息，再发送到 Extension，避免响应过快导致丢消息
    const completion = waitForMessage('newapi.sync.complete')

    vscode.postMessage({
      type: 'newapi.sync.import',
      data: {
        siteUrl: siteUrl.value,
        tokens: importData,
      },
    })

    console.log('[NewApiSync] 等待响应...')
    const response = await completion
    console.log('[NewApiSync] 收到响应:', response.data)

    const imported = response.data.imported ?? response.data.count ?? 0
    const failed = response.data.failed ?? 0

    if (imported === 0) {
      if (failed > 0) {
        const firstError = response.data.details?.failed?.[0]?.error
        console.error('[NewApiSync] 全部失败:', firstError)
        throw new Error(firstError || `全部 ${failed} 个 Provider 导入失败`)
      }
      if ((response.data.skipped ?? 0) > 0) {
        console.warn('[NewApiSync] 全部跳过')
        throw new Error('选中的 Token 已全部导入过，无需重复导入')
      }
      console.error('[NewApiSync] 没有导入任何 Provider')
      throw new Error('没有导入任何 Provider')
    }

    console.log(`[NewApiSync] 导入成功: ${imported} 个`)
    // 成功
    emit('success', imported)
    handleClose()
  } catch (error) {
    console.error('[NewApiSync] 导入异常:', error)
    errorMessage.value = error instanceof Error ? error.message : '导入失败'
  } finally {
    isLoading.value = false
  }
}

/**
 * 等待特定类型的消息
 * 用于异步消息通信
 */
function waitForMessage(type: string, timeout = 60000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('操作超时'))
    }, timeout)

    const handler = (event: MessageEvent) => {
      const message = event.data
      if (message.type === type) {
        clearTimeout(timer)
        window.removeEventListener('message', handler)
        resolve(message)
      } else if (message.type === 'error') {
        clearTimeout(timer)
        window.removeEventListener('message', handler)
        reject(new Error(message.data.message))
      }
    }

    window.addEventListener('message', handler)
  })
}

/**
 * 切换 Token 选择
 */
function toggleTokenSelection(tokenId: number) {
  if (selectedTokenIds.value.has(tokenId)) {
    selectedTokenIds.value.delete(tokenId)
  } else {
    selectedTokenIds.value.add(tokenId)
  }
}

/**
 * 全选/取消全选
 */
function toggleSelectAll() {
  if (selectedTokenIds.value.size === tokens.value.length) {
    // 取消全选
    selectedTokenIds.value.clear()
  } else {
    // 全选
    tokens.value.forEach(t => selectedTokenIds.value.add(t.id))
  }
}
</script>

<template>
  <div v-if="show" class="modal-overlay" @click="handleClose">
    <div class="modal-content large" @click.stop>
      <!-- 标题 -->
      <div class="modal-header">
        <div class="header-content">
          <h2>同步 new-api Token</h2>
          <div class="step-indicator">
            步骤 {{ currentStep }}/4: {{ stepTitle }}
          </div>
        </div>
        <Button variant="ghost" size="medium" @click="handleClose" :disabled="isLoading" aria-label="关闭">
          <template #icon><X /></template>
        </Button>
      </div>

      <!-- 主体内容 -->
      <div class="modal-body">
        <!-- 错误提示 -->
        <div v-if="errorMessage" class="error-banner">
          <TriangleAlert class="banner-icon" /> {{ errorMessage }}
        </div>

        <!-- Step 1: 输入配置 -->
        <div v-if="currentStep === 1" class="step-content">
          <div class="step-description">
            请输入 new-api 站点地址，点击授权后会打开浏览器，请在 new-api 页面确认授权读取密钥列表。
          </div>

          <div class="form-group">
            <label>站点 URL *</label>
            <input
              v-model="siteUrl"
              type="url"
              placeholder="https://www.tiandouai.com"
              :class="{ error: step1Errors.siteUrl }"
            />
            <span v-if="step1Errors.siteUrl" class="error-message">
              {{ step1Errors.siteUrl }}
            </span>
            <span v-else class="form-hint">
              new-api 的完整地址，包括协议（https）
            </span>
          </div>

        </div>

        <!-- Step 2: 选择 Token -->
        <div v-if="currentStep === 2" class="step-content">
          <div class="step-description">
            已完成浏览器授权。请选择要导入的 Token，每个 Token 将创建一个对应的 Provider。
          </div>

          <div class="token-list-header">
            <label class="checkbox-label">
              <input
                type="checkbox"
                :checked="selectedTokenIds.size === tokens.length"
                @change="toggleSelectAll"
              />
              全选（{{ selectedTokenIds.size }}/{{ tokens.length }}）
            </label>
          </div>

          <div class="token-list">
            <div
              v-for="token in tokens"
              :key="token.id"
              class="token-item"
              :class="{ selected: selectedTokenIds.has(token.id) }"
              @click="toggleTokenSelection(token.id)"
            >
              <input
                type="checkbox"
                :checked="selectedTokenIds.has(token.id)"
                @click.stop="toggleTokenSelection(token.id)"
              />
              <div class="token-info">
                <div class="token-name">{{ token.name }}</div>
                <div class="token-details">
                  <span>剩余额度: {{ token.remain_quota }}</span>
                  <span>支持模型: {{ token.models.length }} 个</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 4: 配置模型映射 -->
        <div v-if="currentStep === 3" class="step-content">
          <div class="step-description">
            为每个 Token 配置使用的模型。系统已自动填充推荐配置。
          </div>

          <div class="mapping-list">
            <div
              v-for="tokenId in Array.from(selectedTokenIds)"
              :key="tokenId"
              class="mapping-item"
            >
              <h4>{{ tokens.find(t => t.id === tokenId)?.name }}</h4>

              <div class="form-row">
                <div class="form-group">
                  <label>主模型</label>
                  <select v-model="modelMappings.get(tokenId)!.main">
                    <option
                      v-for="model in availableModels"
                      :key="model"
                      :value="model"
                    >
                      {{ model }}
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 5: 确认导入 -->
        <div v-if="currentStep === 4" class="step-content">
          <div class="confirm-banner">
            <h3>准备导入</h3>
            <div class="confirm-stats">
              <div class="stat-item">
                <span class="stat-label">将导入</span>
                <span class="stat-value">{{ selectedTokenIds.size }}</span>
                <span class="stat-label">个 Provider</span>
              </div>
            </div>
            <p class="confirm-note">
              点击"开始导入"后，系统将为每个选中的 Token 创建一个 Provider。
            </p>
          </div>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="modal-footer">
        <Button v-if="currentStep > 2" variant="secondary" @click="handlePrevious" :disabled="isLoading">上一步</Button>
        <Button variant="ghost" @click="handleClose" :disabled="isLoading">取消</Button>
        <Button variant="primary" @click="handleNext" :disabled="!canGoNext || isLoading" :loading="isLoading">
          {{ nextButtonText }}
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.modal-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--color-overlay-scrim);
  z-index: 1000;
}

.modal-content {
  width: min(90vw, 640px);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-surface-glass);
  border: 1px solid var(--color-surface-glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-dropdown);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: 20px 24px 0;

  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: var(--color-text-primary);
  }
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 24px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  padding: 0 24px 24px;
}

// 样式与 AddProviderModal 类似，增加步骤指示器和 Token 列表样式

.modal-content.large {
  max-width: 800px;
}

.header-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.step-indicator {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.step-content {
  min-height: 400px;
}

.step-description {
  margin-bottom: var(--spacing-md);
  padding: var(--spacing-sm);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--color-text-secondary);
}

.error-banner {
  margin-bottom: var(--spacing-md);
  padding: var(--spacing-sm);
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid #f85149;
  border-radius: var(--radius-md);
  color: #f85149;
}

.banner-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.success-banner {
  display: flex;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  background: rgba(46, 160, 67, 0.1);
  border: 1px solid #2ea043;
  border-radius: var(--radius-md);

  .success-icon {
    width: 48px;
    height: 48px;
    color: #2ea043;
    flex-shrink: 0;
  }

  .success-content {
    h3 {
      margin: 0 0 var(--spacing-sm) 0;
      color: #2ea043;
    }

    p {
      margin: 4px 0;
      color: var(--color-text-primary);
    }
  }
}

.token-list-header {
  margin-bottom: var(--spacing-sm);
  padding-bottom: var(--spacing-sm);
  border-bottom: 1px solid var(--color-border);
}

.token-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  max-height: 400px;
  overflow-y: auto;
}

.token-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--color-accent);
    background: var(--color-input-bg);
  }

  &.selected {
    border-color: var(--color-accent);
    background: rgba(88, 166, 255, 0.1);
  }
}

.token-info {
  flex: 1;

  .token-name {
    font-weight: 500;
    margin-bottom: 4px;
  }

  .token-details {
    display: flex;
    gap: var(--spacing-md);
    font-size: 12px;
    color: var(--color-text-secondary);
  }
}

.mapping-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.mapping-item {
  padding: var(--spacing-md);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);

  h4 {
    margin: 0 0 var(--spacing-md) 0;
  }
}

.form-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--spacing-md);
}

.confirm-banner {
  padding: var(--spacing-lg);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  text-align: center;

  h3 {
    margin: 0 0 var(--spacing-lg) 0;
  }
}

.confirm-stats {
  margin: var(--spacing-lg) 0;
}

.stat-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);

  .stat-value {
    font-size: 32px;
    font-weight: 600;
    color: var(--color-accent);
  }
}

.confirm-note {
  margin: var(--spacing-lg) 0 0 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}
</style>
