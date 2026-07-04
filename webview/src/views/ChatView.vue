<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useTaskStore } from '@/stores/task'
import { usePlanStore } from '@/stores/plan'
import { useAgentStore } from '@/stores/agent'
import TopBar from '@/components/header/TopBar.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatInput from '@/components/input/ChatInput.vue'
import TaskPanel from '@/components/task/TaskPanel.vue'
import AgentList from '@/components/agent/AgentList.vue'
import PlanApproval from '@/components/plan/PlanApproval.vue'
import Modal from '@/components/common/Modal.vue'
import NewApiSyncModal from '@/components/provider/NewApiSyncModal.vue'
import ProviderSettings from './ProviderSettings.vue'
import { useProviderStore } from '@/stores/provider'
import { useVSCode } from '@/composables/useVSCode'

const chatStore = useChatStore()
const taskStore = useTaskStore()
const planStore = usePlanStore()
const agentStore = useAgentStore()
const providerStore = useProviderStore()
const vscode = useVSCode()
const showNewApiSyncModal = ref(false)
const showProviderSettings = ref(false)
const taskPanelDismissed = ref(false)
const newApiPreview = ref<any>(null)

// 是否显示 Task 面板
const showTaskPanel = computed(() => taskStore.stats.total > 0 && !taskPanelDismissed.value)

// 是否显示 Agent 列表
const showAgentList = computed(() => agentStore.stats.total > 0)

// 是否显示 Plan 审批对话框
const showPlanApproval = computed({
  get: () => planStore.showApprovalDialog,
  set: (value: boolean) => {
    if (!value) {
      planStore.showApprovalDialog = value
    }
  }
})

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

    <!-- Agent 状态列表（浮动在右下角） -->
    <AgentList v-if="showAgentList" class="agent-list-floating" />

    <!-- Plan 审批对话框 -->
    <Modal v-model="showPlanApproval" title="计划审批" size="large" :show-footer="false">
      <PlanApproval
        v-if="planStore.currentPlan"
        :plan="planStore.currentPlan"
        @approve="planStore.approvePlan()"
        @reject="planStore.rejectPlan($event)"
      />
    </Modal>

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

// Agent 列表浮动样式
.agent-list-floating {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: min(520px, calc(100vw - 32px));
  max-height: min(520px, calc(100vh - 80px));
  z-index: 100;
  background: var(--vscode-sideBar-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}
</style>
