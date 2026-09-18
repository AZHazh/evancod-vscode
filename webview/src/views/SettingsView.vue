<script setup lang="ts">
import { ref, watch } from 'vue'
import SettingsMenu, {
  type SettingsSection,
} from '@/components/settings/SettingsMenu.vue'
import ToolPreferences from '@/components/tools/ToolPreferences.vue'
import ProviderSettings from './ProviderSettings.vue'
import AgentCreationWizard from '@/components/agent/AgentCreationWizard.vue'
import AgentRegistryList from '@/components/agent/AgentRegistryList.vue'
import type { AgentDefinition } from '@/types'
import McpSettings from '@/components/mcp/McpSettings.vue'

const props = withDefaults(defineProps<{ initialSection?: SettingsSection }>(), {
  initialSection: 'providers',
})
const activeSection = ref<SettingsSection>(props.initialSection)
const editingAgent = ref<AgentDefinition>()
watch(() => props.initialSection, value => (activeSection.value = value))

function createAgent() {
  editingAgent.value = undefined
  activeSection.value = 'create-agent'
}

function editAgent(definition: AgentDefinition) {
  editingAgent.value = definition
  activeSection.value = 'create-agent'
}
</script>

<template>
  <div class="settings-view">
    <SettingsMenu v-model="activeSection" />
    <main class="settings-content">
      <ProviderSettings v-if="activeSection === 'providers'" />
      <ToolPreferences v-else-if="activeSection === 'tools'" />
      <AgentCreationWizard
        v-else-if="activeSection === 'create-agent'"
        :key="editingAgent?.id || 'new'"
        :initial-definition="editingAgent"
        @saved="activeSection = 'agents'"
        @cancel="activeSection = 'agents'"
      />
      <AgentRegistryList
        v-else-if="activeSection === 'agents'"
        @create="createAgent"
        @edit="editAgent"
      />
      <McpSettings v-else-if="activeSection === 'mcp'" />
    </main>
  </div>
</template>

<style scoped lang="scss">
.settings-view {
  display: flex;
  gap: 18px;
  height: min(680px, calc(85vh - 86px));
  min-height: 420px;
}

.settings-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;

  :deep(.provider-settings) {
    height: 100%;
    padding: 0;
    overflow-y: auto;
  }

  :deep(.provider-settings .header h2) {
    font-size: 18px;
  }
}

@media (max-width: 620px) {
  .settings-view {
    flex-direction: column;
    height: min(720px, calc(85vh - 86px));
  }
}
</style>
