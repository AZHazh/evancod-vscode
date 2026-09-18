<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-vue-next'
import Button from '@/components/common/Button.vue'
import { useVSCode } from '@/composables/useVSCode'

interface McpServer {
  name: string
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  tools: string[]
  resources: string[]
  prompts: string[]
  capabilities: Record<string, unknown>
  serverVersion?: { name: string; version: string }
  error?: string
  config: {
    command: string
    args: string[]
    cwd?: string
    env?: Record<string, string>
    enabled?: boolean
  }
}

const vscode = useVSCode()
const servers = ref<McpServer[]>([])
const editing = ref(false)
const originalName = ref('')
const name = ref('')
const command = ref('')
const args = ref('')
const cwd = ref('')
const env = ref('')
const enabled = ref(true)
const trusted = ref(false)
const busy = ref('')
const error = ref('')

function load() {
  vscode.postMessage({ type: 'mcp.servers.list.request' })
}

function handleMessage(event: MessageEvent) {
  const message = event.data
  if (message.type === 'mcp.servers.list.response') {
    servers.value = message.data.servers
    error.value = message.data.configError || ''
    busy.value = ''
  } else if (message.type === 'mcp.server.error') {
    error.value = message.data.message
    busy.value = ''
  }
}

function beginCreate() {
  originalName.value = ''
  name.value = ''
  command.value = ''
  args.value = ''
  cwd.value = ''
  env.value = ''
  enabled.value = true
  trusted.value = false
  error.value = ''
  editing.value = true
}

function beginEdit(server: McpServer) {
  originalName.value = server.name
  name.value = server.name
  command.value = server.config.command
  args.value = server.config.args.join('\n')
  cwd.value = server.config.cwd || ''
  env.value = ''
  enabled.value = server.config.enabled !== false
  trusted.value = true
  error.value = ''
  editing.value = true
}

function save() {
  error.value = ''
  let parsedEnv: Record<string, string> | undefined
  try {
    parsedEnv = env.value.trim() ? JSON.parse(env.value) : undefined
    if (parsedEnv && Object.values(parsedEnv).some(value => typeof value !== 'string')) {
      throw new Error('环境变量值必须是字符串')
    }
  } catch (parseError) {
    error.value = parseError instanceof Error ? parseError.message : '环境变量 JSON 无效'
    return
  }
  if (!trusted.value) {
    error.value = '请先确认信任该 MCP Server'
    return
  }
  busy.value = name.value
  vscode.postMessage({
    type: 'mcp.server.save.request',
    data: {
      name: name.value.trim(),
      command: command.value.trim(),
      args: args.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
      cwd: cwd.value.trim() || undefined,
      env: parsedEnv,
      enabled: enabled.value,
    },
  })
  editing.value = false
}

function refresh(server: McpServer) {
  busy.value = server.name
  vscode.postMessage({ type: 'mcp.server.refresh.request', data: { name: server.name } })
}

function toggle(server: McpServer) {
  busy.value = server.name
  vscode.postMessage({
    type: 'mcp.server.enable.request',
    data: { name: server.name, enabled: server.config.enabled === false },
  })
}

function remove(server: McpServer) {
  busy.value = server.name
  vscode.postMessage({ type: 'mcp.server.delete.request', data: { name: server.name } })
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
  load()
})
onUnmounted(() => window.removeEventListener('message', handleMessage))
</script>

<template>
  <section class="mcp-settings">
    <header><div><h2>MCP Server</h2><p>标准 stdio Server、能力和连接状态</p></div><Button size="small" @click="beginCreate"><template #icon><Plus /></template>新增</Button></header>
    <p v-if="error" class="error">{{ error }}</p>

    <form v-if="editing" class="editor" @submit.prevent="save">
      <div class="editor-title"><strong>{{ originalName ? '编辑 Server' : '新增 Server' }}</strong><Button variant="ghost" size="small" title="关闭" @click="editing = false"><template #icon><X /></template></Button></div>
      <div class="form-grid"><label>名称<input v-model="name" :disabled="Boolean(originalName)" /></label><label>命令<input v-model="command" placeholder="node / python / 可执行文件" /></label></div>
      <label>参数，每行一个<textarea v-model="args" rows="3" /></label>
      <label>工作目录<input v-model="cwd" placeholder="可选" /></label>
      <label>环境变量 JSON<textarea v-model="env" rows="3" :placeholder="originalName ? '留空保留现有敏感值' : '{\n  &quot;TOKEN&quot;: &quot;...&quot;\n}'" /></label>
      <label class="check"><input v-model="enabled" type="checkbox" />保存后启用并连接</label>
      <label class="trust"><input v-model="trusted" type="checkbox" />我信任此命令及其参数，并理解该进程拥有当前操作系统账户的权限</label>
      <div class="form-actions"><Button variant="secondary" @click="editing = false">取消</Button><Button :disabled="!name || !command">保存</Button></div>
    </form>

    <div class="server-list">
      <div v-for="server in servers" :key="server.name" class="server-row">
        <div class="server-copy">
          <div class="title"><strong>{{ server.name }}</strong><span class="state" :class="server.state">{{ server.state }}</span><small v-if="server.serverVersion">{{ server.serverVersion.name }} {{ server.serverVersion.version }}</small></div>
          <code>{{ server.config.command }} {{ server.config.args.join(' ') }}</code>
          <p>{{ server.tools.length }} 个工具 · {{ server.resources.length }} 个资源 · {{ server.prompts.length }} 个 Prompt</p>
          <p v-if="server.error" class="error">{{ server.error }}</p>
          <details v-if="server.tools.length || Object.keys(server.capabilities).length"><summary>能力与工具</summary><pre>{{ JSON.stringify({ capabilities: server.capabilities, tools: server.tools, resources: server.resources, prompts: server.prompts }, null, 2) }}</pre></details>
        </div>
        <div class="actions">
          <label class="toggle" title="启用或停用"><input type="checkbox" :checked="server.config.enabled !== false" :disabled="busy === server.name" @change="toggle(server)" /><span /></label>
          <Button variant="ghost" size="small" title="刷新并重连" :loading="busy === server.name" @click="refresh(server)"><template #icon><RefreshCw /></template></Button>
          <Button variant="ghost" size="small" title="编辑" @click="beginEdit(server)"><template #icon><Pencil /></template></Button>
          <Button variant="ghost" size="small" title="删除" @click="remove(server)"><template #icon><Trash2 /></template></Button>
        </div>
      </div>
      <p v-if="!servers.length" class="empty">尚未配置 MCP Server</p>
    </div>
  </section>
</template>

<style scoped lang="scss">
.mcp-settings { height: 100%; overflow-y: auto; }
header, .editor-title, .server-row, .form-actions { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
h2 { margin: 0 0 3px; font-size: 18px; }
header p, .server-copy p { color: var(--color-text-secondary); font-size: 12px; }
.editor { margin: 14px 0; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-container); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
label { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; color: var(--color-text-secondary); font-size: 12px; }
input, textarea { width: 100%; padding: 7px 8px; border: 1px solid var(--color-input-border); border-radius: var(--radius-md); background: var(--color-input-bg); color: var(--color-input-fg); }
.check, .trust { flex-direction: row; align-items: flex-start; }
.check input, .trust input { width: auto; margin-top: 2px; }
.trust { padding: 8px; border-left: 3px solid var(--chat-color-warning); background: var(--chat-color-warning-container); }
.form-actions { justify-content: flex-end; }
.server-list { margin-top: 14px; border-top: 1px solid var(--color-border); }
.server-row { padding: 12px 3px; border-bottom: 1px solid var(--color-border); }
.server-copy { min-width: 0; }
.title { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.state { padding: 1px 6px; border-radius: 4px; background: var(--color-surface-container); font-size: 10px; }
.state.connected { color: var(--chat-color-success); }
.state.error { color: var(--chat-color-error); }
code { display: block; max-width: 100%; margin: 4px 0; overflow: hidden; color: var(--color-text-secondary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: flex; align-items: center; gap: 2px; }
.toggle { position: relative; width: 30px; height: 18px; margin: 0; }
.toggle input { opacity: 0; width: 0; }
.toggle span { position: absolute; inset: 0; border-radius: 9px; background: var(--color-border); }
.toggle span::after { content: ''; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: var(--color-surface); transition: transform 120ms ease; }
.toggle input:checked + span { background: var(--color-accent); }
.toggle input:checked + span::after { transform: translateX(12px); }
details { margin-top: 6px; color: var(--color-text-secondary); font-size: 11px; }
pre { max-height: 180px; margin-top: 5px; padding: 8px; overflow: auto; background: var(--chat-color-code-bg); white-space: pre-wrap; }
.error { color: var(--chat-color-error) !important; }
.empty { padding: 28px; color: var(--color-text-secondary); text-align: center; }
@media (max-width: 620px) { .form-grid { grid-template-columns: 1fr; } .server-row { flex-direction: column; } .actions { align-self: flex-end; } }
</style>
