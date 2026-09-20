<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from 'lucide-vue-next'
import Button from '@/components/common/Button.vue'
import { useVSCode } from '@/composables/useVSCode'
import { toPlainAgentDefinition } from '@/lib/agentDefinition'
import { useProviderStore } from '@/stores/provider'
import type { AgentDefinition } from '@/types'

const props = defineProps<{ initialDefinition?: AgentDefinition }>()
const emit = defineEmits<{
  saved: [definition: AgentDefinition]
  cancel: []
}>()

interface ToolEntry {
  id: string
  name: string
  description: string
  capabilities: string[]
}

type AgentModelTier = NonNullable<AgentDefinition['modelTier']>
type AgentModelSelection = AgentModelTier | 'inherit' | 'legacy'

const vscode = useVSCode()
const providerStore = useProviderStore()
const step = ref(0)
const steps = ['目标', '职责', '工具', '权限', '模型', '预览', '确认']
const name = ref('')
const description = ref('')
const audience = ref('')
const scenarios = ref('')
const responsibilities = ref('')
const workflow = ref('')
const output = ref('')
const constraints = ref('')
const tools = ref<ToolEntry[]>([])
const enabledTools = ref(new Set<string>())
const readOnly = ref(true)
const allowExecute = ref(false)
const allowNetwork = ref(true)
const permissionMode = ref<'default' | 'acceptEdits' | 'plan'>('default')
const isolation = ref<'none' | 'worktree'>('none')
const modelSelection = ref<AgentModelSelection>('main')
const legacyModel = ref('')
const effortLevel = ref<'low' | 'medium' | 'high' | 'max'>('medium')
const maxIterations = ref(30)
const executionMode = ref<'foreground' | 'background'>('foreground')
const scope = ref<'global' | 'workspace'>('workspace')
const draft = ref<AgentDefinition | null>(null)
const generating = ref(false)
const saving = ref(false)
const error = ref('')
let saveTimeout: ReturnType<typeof setTimeout> | undefined
let saveRequestId: string | undefined

const modelTierLabels: Record<AgentModelTier, string> = {
  main: '主模型',
  sonnet: 'Sonnet',
  opus: 'Opus',
  haiku: 'Haiku',
}
const modelOptions = computed(() => {
  const provider = providerStore.activeProvider
  if (!provider) return []
  return (Object.keys(modelTierLabels) as AgentModelTier[]).map(tier => ({
    tier,
    label: modelTierLabels[tier],
    model: provider.models[tier],
  }))
})
const selectedModel = computed(() => {
  if (modelSelection.value === 'legacy') return legacyModel.value.trim()
  if (modelSelection.value === 'inherit') return providerStore.currentModel
  return providerStore.activeProvider?.models[modelSelection.value]?.trim() || ''
})

const canContinue = computed(() => {
  if (step.value === 0) return Boolean(name.value.trim() && description.value.trim())
  if (step.value === 1) return Boolean(responsibilities.value.trim() && output.value.trim())
  return true
})

function slugify(value: string) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || `agent-${Date.now().toString(36)}`
}

function toggleTool(id: string) {
  const next = new Set(enabledTools.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  enabledTools.value = next
}

function next() {
  error.value = ''
  if (step.value === 4) {
    if (props.initialDefinition) applyRuntimeSettingsToDraft()
    else generateDraft()
    return
  }
  if (step.value < steps.length - 1) step.value++
}

function back() {
  if (step.value > 0 && !generating.value && !saving.value) step.value--
}

function generateDraft() {
  generating.value = true
  vscode.postMessage({
    type: 'agent.draft.generate.request',
    data: {
      answers: {
        name: name.value,
        description: description.value,
        audience: audience.value,
        scenarios: scenarios.value,
        responsibilities: responsibilities.value,
        workflow: workflow.value,
        output: output.value,
        constraints: constraints.value,
        executionMode: executionMode.value,
        model: selectedModel.value,
      },
    },
  })
}

function applyModelDraft(modelDraft: Record<string, unknown>) {
  const capabilities = new Set(
    tools.value
      .filter(tool => enabledTools.value.has(tool.id))
      .flatMap(tool => tool.capabilities)
  )
  const filteredTools = [...enabledTools.value].filter(id => {
    const tool = tools.value.find(item => item.id === id)
    if (!tool) return false
    if (readOnly.value && tool.capabilities.some(item => ['write', 'execute'].includes(item))) return false
    if (!allowExecute.value && tool.capabilities.includes('execute')) return false
    if (!allowNetwork.value && tool.capabilities.includes('network')) return false
    return true
  })
  const prompt = typeof modelDraft.systemPrompt === 'string' ? modelDraft.systemPrompt : responsibilities.value
  draft.value = {
    id: slugify(typeof modelDraft.id === 'string' ? modelDraft.id : name.value),
    name: typeof modelDraft.name === 'string' ? modelDraft.name : name.value,
    description:
      typeof modelDraft.description === 'string' ? modelDraft.description : description.value,
    systemPrompt: `${prompt}\n\n默认执行方式：${executionMode.value === 'background' ? '后台' : '前台'}。`,
    modelTier:
      modelSelection.value === 'legacy' || modelSelection.value === 'inherit'
        ? undefined
        : modelSelection.value,
    model:
      modelSelection.value === 'legacy' ? legacyModel.value.trim() || undefined : undefined,
    effortLevel: effortLevel.value,
    enabledTools: filteredTools,
    readOnly: readOnly.value,
    permissionMode: permissionMode.value,
    maxIterations: maxIterations.value,
    isolation: isolation.value,
    defaultMode: executionMode.value,
    enabled: true,
    source: scope.value,
  }
  if (capabilities.has('execute') && !allowExecute.value) {
    draft.value.systemPrompt += '\n不得执行命令或启动外部进程。'
  }
  step.value = 5
  generating.value = false
}

function applyRuntimeSettingsToDraft() {
  if (!draft.value) return
  draft.value = {
    ...draft.value,
    modelTier:
      modelSelection.value === 'legacy' || modelSelection.value === 'inherit'
        ? undefined
        : modelSelection.value,
    model:
      modelSelection.value === 'legacy' ? legacyModel.value.trim() || undefined : undefined,
    effortLevel: effortLevel.value,
    maxIterations: maxIterations.value,
    defaultMode: executionMode.value,
  }
  step.value = 5
}

function save() {
  if (!draft.value || saving.value) return
  const requestId = `agent-save-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  saveRequestId = requestId
  saving.value = true
  error.value = ''
  try {
    vscode.postMessage({
      type: 'agent.definition.save.request',
      data: {
        definition: toPlainAgentDefinition(draft.value),
        scope: scope.value,
        requestId,
      },
    })
    clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => {
      if (saveRequestId !== requestId) return
      saveRequestId = undefined
      saving.value = false
      error.value = '保存响应超时，请返回 Agent 管理确认是否已保存后再重试'
    }, 60_000)
  } catch (saveError) {
    saveRequestId = undefined
    saving.value = false
    error.value = saveError instanceof Error ? saveError.message : String(saveError)
  }
}

function finishSaving() {
  clearTimeout(saveTimeout)
  saveTimeout = undefined
  saveRequestId = undefined
  saving.value = false
}

function handleMessage(event: MessageEvent) {
  const message = event.data
  if (message.type === 'tool-preferences.state') {
    tools.value = message.data.catalog
    if (!props.initialDefinition) enabledTools.value = new Set(message.data.enabledTools)
  } else if (message.type === 'agent.draft.generate.response') {
    applyModelDraft(message.data.draft)
  } else if (message.type === 'agent.definition.save.response') {
    if (!saveRequestId || message.data.requestId !== saveRequestId) return
    finishSaving()
    step.value = 6
    emit('saved', message.data.definition)
  } else if (message.type === 'agent.definition.error') {
    if (message.data.operation === 'save' && message.data.requestId !== saveRequestId) return
    generating.value = false
    finishSaving()
    error.value = message.data.message
  }
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
  vscode.postMessage({ type: 'tool-preferences.load.request', data: { scope: 'workspace' } })
  if (props.initialDefinition) {
    draft.value = { ...props.initialDefinition, enabledTools: [...props.initialDefinition.enabledTools] }
    name.value = props.initialDefinition.name
    description.value = props.initialDefinition.description
    if (props.initialDefinition.modelTier) {
      modelSelection.value = props.initialDefinition.modelTier
    } else if (props.initialDefinition.model) {
      modelSelection.value = 'legacy'
      legacyModel.value = props.initialDefinition.model
    } else {
      modelSelection.value = 'inherit'
    }
    effortLevel.value = props.initialDefinition.effortLevel || 'medium'
    maxIterations.value = props.initialDefinition.maxIterations
    executionMode.value = props.initialDefinition.defaultMode || 'foreground'
    readOnly.value = props.initialDefinition.readOnly
    permissionMode.value = props.initialDefinition.permissionMode
    isolation.value = props.initialDefinition.isolation
    scope.value = props.initialDefinition.source === 'workspace' ? 'workspace' : 'global'
    enabledTools.value = new Set(props.initialDefinition.enabledTools)
    step.value = 4
  }
})
onUnmounted(() => {
  clearTimeout(saveTimeout)
  window.removeEventListener('message', handleMessage)
})
</script>

<template>
  <section class="wizard">
    <div class="stepper">
      <span v-for="(label, index) in steps" :key="label" :class="{ active: index === step, done: index < step }">
        {{ index + 1 }}<small>{{ label }}</small>
      </span>
    </div>

    <div class="step-content">
      <template v-if="step === 0">
        <h2>目标和名称</h2>
        <label>名称<input v-model="name" maxlength="80" /></label>
        <label>描述<textarea v-model="description" rows="3" /></label>
        <label>服务对象<input v-model="audience" /></label>
        <label>使用场景<textarea v-model="scenarios" rows="3" /></label>
      </template>

      <template v-else-if="step === 1">
        <h2>职责和流程</h2>
        <label>核心职责<textarea v-model="responsibilities" rows="4" /></label>
        <label>工作步骤<textarea v-model="workflow" rows="4" /></label>
        <label>输出与验证要求<textarea v-model="output" rows="4" /></label>
      </template>

      <template v-else-if="step === 2">
        <h2>工具偏好</h2>
        <div class="tool-picker">
          <label v-for="tool in tools" :key="tool.id" :title="tool.description">
            <input type="checkbox" :checked="enabledTools.has(tool.id)" @change="toggleTool(tool.id)" />
            <span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span>
          </label>
        </div>
      </template>

      <template v-else-if="step === 3">
        <h2>约束和权限</h2>
        <label class="check"><input v-model="readOnly" type="checkbox" />只读</label>
        <label class="check"><input v-model="allowExecute" type="checkbox" :disabled="readOnly" />允许命令执行</label>
        <label class="check"><input v-model="allowNetwork" type="checkbox" />允许网络访问</label>
        <label>权限模式
          <select v-model="permissionMode">
            <option value="default">跟随会话确认</option>
            <option value="acceptEdits" :disabled="readOnly">自动接受编辑，但高风险操作仍确认</option>
            <option value="plan">计划模式</option>
          </select>
        </label>
        <label>隔离方式
          <select v-model="isolation"><option value="none">当前工作区</option><option value="worktree">Git worktree</option></select>
        </label>
        <label>其他约束<textarea v-model="constraints" rows="4" /></label>
      </template>

      <template v-else-if="step === 4">
        <h2>模型和运行参数</h2>
        <label>模型
          <select v-model="modelSelection" :disabled="modelOptions.length === 0 && modelSelection !== 'legacy'">
            <option v-if="modelSelection === 'legacy'" value="legacy">原模型（{{ legacyModel }}）</option>
            <option value="inherit">跟随当前会话（{{ providerStore.currentModel }}）</option>
            <option v-if="modelOptions.length === 0 && modelSelection !== 'legacy'" value="main" disabled>请先配置并激活服务商</option>
            <option v-for="option in modelOptions" :key="option.tier" :value="option.tier">
              {{ option.label }}（{{ option.model }}）
            </option>
          </select>
        </label>
        <label>推理程度<select v-model="effortLevel"><option>low</option><option>medium</option><option>high</option><option>max</option></select></label>
        <label>最大轮次<input v-model.number="maxIterations" type="number" min="1" max="500" /></label>
        <label>默认执行方式<select v-model="executionMode"><option value="foreground">前台</option><option value="background">后台</option></select></label>
      </template>

      <template v-else-if="step === 5 && draft">
        <h2>预览和修改</h2>
        <div class="preview-grid">
          <label>ID<input v-model="draft.id" /></label>
          <label>名称<input v-model="draft.name" /></label>
        </div>
        <label>描述<textarea v-model="draft.description" rows="3" /></label>
        <label>系统提示词<textarea v-model="draft.systemPrompt" rows="12" /></label>
      </template>

      <template v-else-if="step === 6">
        <div class="complete-state"><Check /><h2>Agent 已保存</h2><p>{{ draft?.name }}</p></div>
      </template>

      <div v-if="generating" class="loading-state"><LoaderCircle />正在使用当前模型生成草稿...</div>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <footer v-if="step < 6">
      <Button variant="ghost" @click="step === 0 ? emit('cancel') : back()"><template #icon><ArrowLeft /></template>{{ step === 0 ? '取消' : '上一步' }}</Button>
      <div class="scope" v-if="step === 5"><button :class="{ active: scope === 'global' }" @click="scope = 'global'">全局</button><button :class="{ active: scope === 'workspace' }" @click="scope = 'workspace'">工作区</button></div>
      <Button :disabled="!canContinue || generating" :loading="saving" @click="step === 5 ? save() : next()">
        {{ step === 5 ? '确认保存' : step === 4 && !initialDefinition ? '生成草稿' : '下一步' }}<template #icon><ArrowRight /></template>
      </Button>
    </footer>
  </section>
</template>

<style scoped lang="scss">
.wizard { display: flex; flex-direction: column; height: 100%; min-width: 0; }
.stepper { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; margin-bottom: 14px; }
.stepper > span { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 5px 2px; border-top: 2px solid var(--color-border); color: var(--color-text-tertiary); font-size: 11px; }
.stepper > span.active { border-color: var(--color-accent); color: var(--color-text-primary); }
.stepper > span.done { border-color: var(--chat-color-success); color: var(--color-text-secondary); }
.stepper small { font-size: 9px; }
.step-content { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 4px; }
h2 { margin: 0 0 14px; font-size: 18px; }
label { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; color: var(--color-text-secondary); font-size: 12px; }
input, textarea, select { width: 100%; padding: 7px 9px; border: 1px solid var(--color-input-border); border-radius: var(--radius-md); outline: 0; background: var(--color-input-bg); color: var(--color-input-fg); }
textarea { resize: vertical; }
.check { flex-direction: row; align-items: center; }
.check input, .tool-picker input { width: auto; accent-color: var(--color-accent); }
.tool-picker { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 12px; }
.tool-picker label { flex-direction: row; align-items: flex-start; margin: 0; padding: 7px; border-bottom: 1px solid var(--color-border); }
.tool-picker span { display: flex; min-width: 0; flex-direction: column; }
.tool-picker small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 12px; }
.scope { display: flex; padding: 2px; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.scope button { padding: 4px 9px; border: 0; border-radius: 5px; background: transparent; color: var(--color-text-secondary); }
.scope button.active { background: var(--color-surface-container); color: var(--color-text-primary); }
.loading-state, .complete-state { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 8px; min-height: 180px; color: var(--color-text-secondary); }
.loading-state svg { width: 22px; animation: spin 1s linear infinite; }
.complete-state svg { width: 36px; color: var(--chat-color-success); }
.error { margin-top: 10px; color: var(--chat-color-error); white-space: pre-wrap; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 620px) { .tool-picker, .preview-grid { grid-template-columns: 1fr; } .stepper small { display: none; } }
</style>
