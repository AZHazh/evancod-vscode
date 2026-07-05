<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useTaskStore } from '@/stores/task'
import TopBar from '@/components/header/TopBar.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatInput from '@/components/input/ChatInput.vue'
import TaskPanel from '@/components/task/TaskPanel.vue'
import Modal from '@/components/common/Modal.vue'
import NewApiSyncModal from '@/components/provider/NewApiSyncModal.vue'
import ProviderSettings from './ProviderSettings.vue'
import { useProviderStore } from '@/stores/provider'
import { useVSCode } from '@/composables/useVSCode'

const chatStore = useChatStore()
const taskStore = useTaskStore()
const providerStore = useProviderStore()
const vscode = useVSCode()
const showNewApiSyncModal = ref(false)
const showProviderSettings = ref(false)
const taskPanelDismissed = ref(false)
const newApiPreview = ref<any>(null)

// 是否显示 Task 面板
const showTaskPanel = computed(() => taskStore.stats.total > 0 && !taskPanelDismissed.value)

function handleSyncNewApi() {
  newApiPreview.value = null
  vscode.postMessage({ type: 'newapi.sync.start' })
}

function handleOpenProviders() {
  providerStore.loadProviders()
  showProviderSettings.value = true
}

function handleUiMessage(event: MessageEvent) {
  const message = event.data
  if (message.type === 'newapi.sync.preview') {
    newApiPreview.value = message.data
    showNewApiSyncModal.value = true
  }
}

function handleSyncClose() {
  showNewApiSyncModal.value = false
  newApiPreview.value = null
}

onMounted(() => {
  chatStore.initialize()
  providerStore.initialize()
  window.addEventListener('message', handleUiMessage)
  // 请求初始任务列表
  taskStore.fetchTasks()
})

onUnmounted(() => {
  window.removeEventListener('message', handleUiMessage)
})
</script>

<template>
  <div class="chat-view">
    <TopBar @sync-new-api="handleSyncNewApi" @open-providers="handleOpenProviders" />
    <MessageList />

    <!-- Task 面板（对话区内，输入框上方，可关闭） -->
    <TaskPanel v-if="showTaskPanel" class="task-panel-inline" @close="taskPanelDismissed = true" />

    <ChatInput />

    <Modal v-model="showProviderSettings" title="服务商管理" size="large" :show-footer="false">
      <ProviderSettings />
    </Modal>

    <NewApiSyncModal
      :show="showNewApiSyncModal"
      :preview="newApiPreview"
      @close="handleSyncClose"
      @success="handleSyncClose"
    />
  </div>
</template>

<style scoped lang="scss">
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  position: relative;
}

// Task 面板内联样式
.task-panel-inline {
  width: min(70%, 980px);
  flex: 0 0 auto;
  align-self: center;
  margin: 0 0 8px;
  overflow: hidden;
}
</style>
