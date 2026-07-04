<script setup lang="ts">
import { onMounted } from 'vue'
import ChatView from './views/ChatView.vue'
import { useVSCode } from './composables/useVSCode'

const vscode = useVSCode()

onMounted(() => {
  // 通知 Extension 已准备好
  vscode.postMessage({ type: 'ready' })
})
</script>

<template>
  <div class="app">
    <ChatView />
  </div>
</template>

<style lang="scss">
.app {
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
}
</style>
