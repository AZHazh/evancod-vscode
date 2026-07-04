<script setup lang="ts">
defineProps<{
  command: string
  description?: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
  status?: 'running' | 'completed' | 'error' | 'timeout' | 'cancelled'
  taskId?: string
}>()

defineEmits<{
  cancel: []
}>()
</script>

<template>
  <div class="terminal-chrome">
    <div class="terminal-chrome__header">
      <div class="terminal-chrome__lights">
        <span class="terminal-chrome__light terminal-chrome__light--danger" />
        <span class="terminal-chrome__light terminal-chrome__light--warning" />
        <span class="terminal-chrome__light terminal-chrome__light--success" />
      </div>
      <span class="terminal-chrome__title">{{ description || taskId || 'terminal' }}</span>
      <span class="terminal-chrome__status" :class="`status-${status || 'completed'}`">{{ status || 'completed' }}</span>
      <button v-if="status === 'running'" class="terminal-chrome__cancel" type="button" @click="$emit('cancel')">
        取消
      </button>
    </div>

    <div class="terminal-chrome__body">
      <pre class="terminal-command"><code><span>$</span> {{ command }}</code></pre>
      <pre v-if="stdout" class="terminal-output"><code>{{ stdout }}</code></pre>
      <pre v-if="stderr" class="terminal-output output-error"><code>{{ stderr }}</code></pre>
      <div v-if="typeof exitCode === 'number'" class="terminal-exit">exit {{ exitCode }}</div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.terminal-chrome {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 20%, transparent);
  border-radius: var(--chat-radius-xl);
  background: var(--chat-color-surface-dim);
}

.terminal-chrome__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--chat-color-terminal-border);
  background: var(--chat-color-terminal-header);
}

.terminal-chrome__lights {
  display: flex;
  gap: 6px;
}

.terminal-chrome__light {
  width: 10px;
  height: 10px;
  border-radius: var(--chat-radius-full);
}

.terminal-chrome__light--danger { background: var(--chat-color-terminal-danger); }
.terminal-chrome__light--warning { background: var(--chat-color-terminal-warning); }
.terminal-chrome__light--success { background: var(--chat-color-terminal-accent); }

.terminal-chrome__title {
  min-width: 0;
  overflow: hidden;
  margin-left: 8px;
  color: var(--chat-color-terminal-muted);
  font-family: var(--chat-font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-chrome__status {
  margin-left: auto;
  color: var(--chat-color-terminal-muted);
  font-size: 10px;
  text-transform: uppercase;
}

.terminal-chrome__cancel {
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--chat-color-terminal-muted) 35%, transparent);
  border-radius: var(--chat-radius-sm);
  background: transparent;
  color: var(--chat-color-terminal-fg);
  cursor: pointer;
  font-size: 11px;
}

.status-error,
.status-timeout,
.status-cancelled {
  color: var(--chat-color-terminal-danger);
}

.status-running {
  color: var(--chat-color-terminal-accent);
}

.terminal-chrome__body {
  background: var(--chat-color-terminal-bg);
  color: var(--chat-color-terminal-fg);
}

.terminal-command,
.terminal-output {
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  font-family: var(--chat-font-mono);
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.terminal-command span {
  color: var(--chat-color-terminal-accent);
}

.output-error {
  color: var(--chat-color-terminal-danger);
}

.terminal-exit {
  padding: 0 12px 10px;
  color: var(--chat-color-terminal-muted);
  font-family: var(--chat-font-mono);
  font-size: 11px;
}
</style>
