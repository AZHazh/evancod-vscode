<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useTaskStore } from '@/stores/task'
import TopBar from '@/components/header/TopBar.vue'
import MessageList from '@/components/chat/MessageList.vue'
import CompactionStatus from '@/components/chat/CompactionStatus.vue'
import ChatInput from '@/components/input/ChatInput.vue'
import TaskPanel from '@/components/task/TaskPanel.vue'
import Modal from '@/components/common/Modal.vue'
import NewApiSyncModal from '@/components/provider/NewApiSyncModal.vue'
import SettingsView from './SettingsView.vue'
import { useProviderStore } from '@/stores/provider'
import { useVSCode } from '@/composables/useVSCode'
import type { SettingsSection } from '@/components/settings/SettingsMenu.vue'

const chatStore = useChatStore()
const taskStore = useTaskStore()
const providerStore = useProviderStore()
const vscode = useVSCode()
const showNewApiSyncModal = ref(false)
const showSettings = ref(false)
const settingsSection = ref<SettingsSection>('providers')
const taskPanelDismissed = ref(false)
const newApiPreview = ref<any>(null)

// 是否显示 Task 面板
const showTaskPanel = computed(() => taskStore.stats.total > 0 && !taskPanelDismissed.value)

function handleSyncNewApi() {
  newApiPreview.value = null
  vscode.postMessage({ type: 'newapi.sync.start' })
}

function handleOpenSettings() {
  providerStore.loadProviders()
  settingsSection.value = 'providers'
  showSettings.value = true
}

function openAgentWizard() {
  settingsSection.value = 'create-agent'
  showSettings.value = true
}

function handleUiMessage(event: MessageEvent) {
  const message = event.data
  if (message.type === 'newapi.sync.preview') {
    newApiPreview.value = message.data
    showNewApiSyncModal.value = true
  } else if (message.type === 'settings.open' && message.data?.section === 'create-agent') {
    openAgentWizard()
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
  window.addEventListener('evancod:open-agent-wizard', openAgentWizard)
  // 请求初始任务列表
  taskStore.fetchTasks()
})

onUnmounted(() => {
  window.removeEventListener('message', handleUiMessage)
  window.removeEventListener('evancod:open-agent-wizard', openAgentWizard)
})
</script>

<template>
  <div class="chat-view">
    <TopBar @sync-new-api="handleSyncNewApi" @open-settings="handleOpenSettings" />
    <MessageList />

    <!-- Task 面板（对话区内，输入框上方，可关闭） -->
    <TaskPanel v-if="showTaskPanel" class="task-panel-inline" @close="taskPanelDismissed = true" />

    <CompactionStatus />
    <ChatInput />

    <Modal v-model="showSettings" title="设置" size="large" :show-footer="false">
      <SettingsView :initial-section="settingsSection" />
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
