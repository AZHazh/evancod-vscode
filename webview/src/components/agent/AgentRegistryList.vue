<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Pencil, Plus, Trash2 } from 'lucide-vue-next'
import Button from '@/components/common/Button.vue'
import { useVSCode } from '@/composables/useVSCode'
import { toPlainAgentDefinition } from '@/lib/agentDefinition'
import type { AgentDefinition } from '@/types'

const emit = defineEmits<{ create: []; edit: [definition: AgentDefinition] }>()
const vscode = useVSCode()
const definitions = ref<AgentDefinition[]>([])
const error = ref('')

function load() {
  vscode.postMessage({ type: 'agent.registry.list.request' })
}

function handleMessage(event: MessageEvent) {
  const message = event.data
  if (message.type === 'agent.registry.list.response') {
    definitions.value = message.data.definitions
    error.value = (message.data.warnings || []).join('；')
  }
  else if (message.type === 'agent.definition.error') error.value = message.data.message
}

function remove(definition: AgentDefinition) {
  if (definition.source === 'builtin') return
  vscode.postMessage({
    type: 'agent.definition.delete.request',
    data: { id: definition.id, scope: definition.source },
  })
}

function toggle(definition: AgentDefinition) {
  if (definition.source === 'builtin') return
  vscode.postMessage({
    type: 'agent.definition.save.request',
    data: {
      scope: definition.source,
      definition: toPlainAgentDefinition({ ...definition, enabled: !definition.enabled }),
    },
  })
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
  load()
})
onUnmounted(() => window.removeEventListener('message', handleMessage))
</script>

<template>
  <section class="agent-list-view">
    <header><div><h2>Agent 管理</h2><p>内置和自定义子 Agent 定义</p></div><Button size="small" @click="emit('create')"><template #icon><Plus /></template>创建</Button></header>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="agent-list">
      <div v-for="definition in definitions" :key="`${definition.source}:${definition.id}`" class="agent-row">
        <div class="agent-copy">
          <div class="title"><strong>{{ definition.name }}</strong><code>{{ definition.id }}</code><span>{{ definition.source }}</span></div>
          <p>{{ definition.description }}</p>
          <small>{{ definition.enabledTools.length }} 个工具 · {{ definition.readOnly ? '只读' : definition.permissionMode }} · {{ definition.maxIterations }} 轮</small>
        </div>
        <div class="actions">
          <Button variant="ghost" size="small" title="编辑 Agent" @click="emit('edit', definition)"><template #icon><Pencil /></template></Button>
          <label v-if="definition.source !== 'builtin'" class="toggle" title="启用或停用">
            <input type="checkbox" :checked="definition.enabled" @change="toggle(definition)" /><span />
          </label>
          <Button v-if="definition.source !== 'builtin'" variant="ghost" size="small" title="删除 Agent" @click="remove(definition)"><template #icon><Trash2 /></template></Button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.agent-list-view { height: 100%; overflow-y: auto; }
header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
h2 { margin: 0 0 3px; font-size: 18px; }
header p, .agent-copy p, small { color: var(--color-text-secondary); font-size: 12px; }
.agent-list { border-top: 1px solid var(--color-border); }
.agent-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 4px; border-bottom: 1px solid var(--color-border); }
.agent-copy { min-width: 0; }
.title { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.title code, .title span { padding: 1px 5px; border-radius: 4px; background: var(--color-surface-container); color: var(--color-text-secondary); font-size: 10px; }
.agent-copy p { margin: 4px 0; }
.actions { display: flex; align-items: center; gap: 4px; }
.toggle { position: relative; width: 30px; height: 18px; margin: 0; }
.toggle input { opacity: 0; width: 0; }
.toggle span { position: absolute; inset: 0; border-radius: 9px; background: var(--color-border); cursor: pointer; }
.toggle span::after { content: ''; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: var(--color-surface); transition: transform 120ms ease; }
.toggle input:checked + span { background: var(--color-accent); }
.toggle input:checked + span::after { transform: translateX(12px); }
.error { margin-bottom: 10px; color: var(--chat-color-error); }
</style>
