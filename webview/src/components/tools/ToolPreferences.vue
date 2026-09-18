<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { CheckCheck, RotateCcw, Search, Square, TriangleAlert } from 'lucide-vue-next'
import Button from '@/components/common/Button.vue'
import { useVSCode } from '@/composables/useVSCode'

type Scope = 'global' | 'workspace'
type Capability = 'read' | 'write' | 'execute' | 'network' | 'interactive'

interface ToolEntry {
  id: string
  name: string
  description: string
  source: 'builtin' | 'mcp' | 'plugin'
  category: string
  capabilities: Capability[]
  inputSchema?: unknown
  risk: 'low' | 'medium' | 'high'
}

interface ToolState {
  scope: Scope
  enabledTools: string[]
  catalog: ToolEntry[]
  warnings: string[]
}

const vscode = useVSCode()
const scope = ref<Scope>('workspace')
const catalog = ref<ToolEntry[]>([])
const selected = ref(new Set<string>())
const baseline = ref(new Set<string>())
const search = ref('')
const loading = ref(true)
const saving = ref(false)
const feedback = ref('')
const warnings = ref<string[]>([])

const categoryLabels: Record<string, string> = {
  file: '文件',
  search: '搜索',
  command: '命令',
  code: '代码分析',
  git: 'Git',
  web: 'Web',
  task: '任务',
  agent: 'Agent',
  mcp: 'MCP',
  skill: 'Skill',
  image: '图像',
}

const capabilityLabels: Record<Capability, string> = {
  read: '读取',
  write: '写入',
  execute: '执行',
  network: '网络',
  interactive: '交互',
}

const filteredTools = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return catalog.value
  return catalog.value.filter(tool =>
    [tool.name, tool.id, tool.description, tool.category, tool.source]
      .join(' ')
      .toLowerCase()
      .includes(query)
  )
})

const groupedTools = computed(() => {
  const groups = new Map<string, ToolEntry[]>()
  for (const tool of filteredTools.value) {
    const tools = groups.get(tool.category) || []
    tools.push(tool)
    groups.set(tool.category, tools)
  }
  return [...groups.entries()]
})

const dirty = computed(() => {
  if (selected.value.size !== baseline.value.size) return true
  return [...selected.value].some(id => !baseline.value.has(id))
})

function load() {
  loading.value = true
  feedback.value = ''
  vscode.postMessage({ type: 'tool-preferences.load.request', data: { scope: scope.value } })
}

function handleMessage(event: MessageEvent) {
  const message = event.data
  if (message.type === 'tool-preferences.state') {
    const state = message.data as ToolState
    if (state.scope !== scope.value) return
    catalog.value = state.catalog
    selected.value = new Set(state.enabledTools)
    baseline.value = new Set(state.enabledTools)
    warnings.value = state.warnings || []
    loading.value = false
    saving.value = false
  } else if (message.type === 'tool-preferences.saved') {
    feedback.value = message.data.message
    saving.value = false
  } else if (message.type === 'tool-preferences.error') {
    feedback.value = message.data.message
    saving.value = false
  }
}

function toggleTool(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
  feedback.value = ''
}

function selectVisible() {
  const next = new Set(selected.value)
  for (const tool of filteredTools.value) next.add(tool.id)
  selected.value = next
}

function clearVisible() {
  const next = new Set(selected.value)
  for (const tool of filteredTools.value) next.delete(tool.id)
  selected.value = next
}

function save() {
  saving.value = true
  vscode.postMessage({
    type: 'tool-preferences.save.request',
    data: { scope: scope.value, enabledTools: [...selected.value] },
  })
}

function reset() {
  saving.value = true
  vscode.postMessage({ type: 'tool-preferences.reset.request', data: { scope: scope.value } })
}

function toolTitle(tool: ToolEntry): string {
  const schema = tool.inputSchema ? JSON.stringify(tool.inputSchema, null, 2) : '无参数'
  return `${tool.description}\n\n能力：${tool.capabilities.map(item => capabilityLabels[item]).join('、')}\n风险：${tool.risk}\n\n参数 Schema：\n${schema}`
}

watch(scope, load)
onMounted(() => {
  window.addEventListener('message', handleMessage)
  load()
})
onUnmounted(() => window.removeEventListener('message', handleMessage))
</script>

<template>
  <section class="tool-preferences">
    <header class="page-header">
      <div>
        <h2>工具偏好</h2>
        <p>控制新请求可使用的工具。工作区设置优先于全局设置。</p>
      </div>
      <div class="scope-control" aria-label="保存范围">
        <button :class="{ active: scope === 'global' }" @click="scope = 'global'">全局</button>
        <button :class="{ active: scope === 'workspace' }" @click="scope = 'workspace'">工作区</button>
      </div>
    </header>

    <div class="toolbar">
      <label class="search-field">
        <Search />
        <input v-model="search" type="search" placeholder="搜索工具" />
      </label>
      <div class="toolbar-actions">
        <Button variant="ghost" size="small" title="启用筛选结果" @click="selectVisible">
          <template #icon><CheckCheck /></template>
        </Button>
        <Button variant="ghost" size="small" title="禁用筛选结果" @click="clearVisible">
          <template #icon><Square /></template>
        </Button>
        <Button variant="ghost" size="small" title="恢复当前范围默认值" @click="reset">
          <template #icon><RotateCcw /></template>
        </Button>
      </div>
    </div>

    <div v-if="warnings.length" class="warning-row">
      <TriangleAlert />
      <span>{{ warnings.join('；') }}</span>
    </div>

    <div v-if="loading" class="empty-state">正在加载工具...</div>
    <div v-else-if="groupedTools.length === 0" class="empty-state">没有匹配的工具</div>
    <div v-else class="tool-groups">
      <section v-for="[category, tools] in groupedTools" :key="category" class="tool-group">
        <h3>{{ categoryLabels[category] || category }}</h3>
        <label v-for="tool in tools" :key="tool.id" class="tool-row" :title="toolTitle(tool)">
          <input
            type="checkbox"
            :checked="selected.has(tool.id)"
            @change="toggleTool(tool.id)"
          />
          <span class="tool-copy">
            <span class="tool-name-row">
              <strong>{{ tool.name }}</strong>
              <code>{{ tool.id }}</code>
              <span class="source">{{ tool.source }}</span>
              <span v-if="tool.risk !== 'low'" class="risk" :class="tool.risk">
                {{ tool.risk === 'high' ? '高风险' : '需注意' }}
              </span>
            </span>
            <span class="description">{{ tool.description }}</span>
            <span class="capabilities">
              <span v-for="capability in tool.capabilities" :key="capability">
                {{ capabilityLabels[capability] }}
              </span>
            </span>
          </span>
        </label>
      </section>
    </div>

    <footer class="save-bar">
      <span class="save-status">{{ feedback || (dirty ? '有未保存的更改' : '已保存') }}</span>
      <Button :disabled="!dirty" :loading="saving" @click="save">保存</Button>
    </footer>
  </section>
</template>

<style scoped lang="scss">
.tool-preferences {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;

  h2 {
    margin: 0 0 3px;
    font-size: 18px;
  }

  p {
    color: var(--color-text-secondary);
    font-size: 12px;
  }
}

.scope-control {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-container);

  button {
    min-width: 58px;
    padding: 4px 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  button.active {
    background: var(--color-surface);
    color: var(--color-text-primary);
    box-shadow: var(--chat-shadow-sm);
  }
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.search-field {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 7px;
  min-height: 32px;
  padding: 0 9px;
  border: 1px solid var(--color-input-border);
  border-radius: var(--radius-md);
  background: var(--color-input-bg);

  svg {
    width: 15px;
    color: var(--color-text-tertiary);
  }

  input {
    width: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-input-fg);
  }
}

.toolbar-actions {
  display: flex;
  gap: 2px;
}

.warning-row {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-bottom: 10px;
  padding: 8px 10px;
  border-left: 3px solid var(--chat-color-warning);
  background: var(--chat-color-warning-container);
  font-size: 12px;

  svg {
    width: 15px;
    flex: 0 0 15px;
  }
}

.tool-groups {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid var(--color-border);
}

.tool-group {
  padding: 12px 0 4px;

  h3 {
    margin: 0 0 4px;
    color: var(--color-text-secondary);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }
}

.tool-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 9px;
  padding: 8px 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 58%, transparent);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }

  input {
    margin-top: 2px;
    accent-color: var(--color-accent);
  }
}

.tool-copy,
.tool-name-row {
  min-width: 0;
}

.tool-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.tool-name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;

  strong {
    font-size: 13px;
  }

  code {
    color: var(--color-text-tertiary);
    font-size: 10px;
  }
}

.source,
.risk,
.capabilities span {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--color-surface-container);
  color: var(--color-text-secondary);
  font-size: 10px;
}

.risk.high {
  background: var(--chat-color-error-container);
  color: var(--chat-color-error);
}

.risk.medium {
  background: var(--chat-color-warning-container);
  color: var(--chat-color-warning);
}

.description {
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capabilities {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.save-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 12px;
}

.save-status {
  color: var(--color-text-secondary);
  font-size: 11px;
}

.empty-state {
  padding: 30px;
  color: var(--color-text-secondary);
  text-align: center;
}

@media (max-width: 620px) {
  .page-header,
  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .scope-control {
    align-self: flex-start;
  }

  .toolbar-actions {
    align-self: flex-end;
  }
}
</style>
