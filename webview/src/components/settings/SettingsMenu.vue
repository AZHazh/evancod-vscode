<script setup lang="ts">
import { Bot, Plug, ServerCog, SlidersHorizontal, Wrench } from 'lucide-vue-next'

export type SettingsSection = 'providers' | 'tools' | 'create-agent' | 'agents' | 'mcp'

defineProps<{
  modelValue: SettingsSection
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SettingsSection]
}>()

const items = [
  { id: 'providers' as const, label: '服务商', icon: ServerCog, enabled: true },
  { id: 'tools' as const, label: '工具偏好', icon: Wrench, enabled: true },
  { id: 'create-agent' as const, label: '创建 Agent', icon: SlidersHorizontal, enabled: true },
  { id: 'agents' as const, label: 'Agent 管理', icon: Bot, enabled: true },
  { id: 'mcp' as const, label: 'MCP Server', icon: Plug, enabled: true },
]
</script>

<template>
  <nav class="settings-menu" aria-label="设置分类">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="menu-item"
      :class="{ active: modelValue === item.id }"
      :disabled="!item.enabled"
      :title="item.enabled ? item.label : `${item.label}（后续阶段开放）`"
      @click="item.enabled && emit('update:modelValue', item.id)"
    >
      <component :is="item.icon" />
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped lang="scss">
.settings-menu {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 156px;
  flex: 0 0 156px;
  padding-right: 14px;
  border-right: 1px solid var(--color-border);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 34px;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  text-align: left;
  cursor: pointer;

  svg {
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
  }

  &:hover:not(:disabled) {
    background: var(--color-surface-hover);
    color: var(--color-text-primary);
  }

  &.active {
    border-color: var(--color-border);
    background: var(--color-surface-container);
    color: var(--color-text-primary);
  }

  &:disabled {
    opacity: 0.42;
    cursor: default;
  }
}

@media (max-width: 620px) {
  .settings-menu {
    width: 100%;
    flex: none;
    flex-direction: row;
    overflow-x: auto;
    padding: 0 0 10px;
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }

  .menu-item {
    flex: 0 0 auto;
  }
}
</style>
