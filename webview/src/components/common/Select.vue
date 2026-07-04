<template>
  <div class="custom-select" :class="{ disabled: disabled, open: isOpen }">
    <label v-if="label" class="select-label">
      {{ label }}
      <span v-if="required" class="required-mark">*</span>
    </label>

    <div class="select-trigger" @click="toggleOpen">
      <span class="select-value">
        {{ selectedLabel || placeholder }}
      </span>
      <span class="select-arrow">▼</span>
    </div>

    <Transition name="dropdown">
      <div v-if="isOpen" class="select-dropdown">
        <div
          v-for="option in options"
          :key="option.value"
          class="select-option"
          :class="{ selected: option.value === modelValue }"
          @click="handleSelect(option.value)"
        >
          {{ option.label }}
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

interface Option {
  label: string
  value: string | number
}

interface Props {
  modelValue: string | number
  options: Option[]
  label?: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '请选择',
  disabled: false,
  required: false
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
}>()

const isOpen = ref(false)

const selectedLabel = computed(() => {
  const option = props.options.find(o => o.value === props.modelValue)
  return option?.label || ''
})

function toggleOpen() {
  if (!props.disabled) {
    isOpen.value = !isOpen.value
  }
}

function handleSelect(value: string | number) {
  emit('update:modelValue', value)
  isOpen.value = false
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.custom-select')) {
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.custom-select {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.select-label {
  font-size: 13px;
  color: var(--vscode-foreground);
  font-weight: 500;
}

.required-mark {
  color: var(--vscode-inputValidation-errorForeground);
}

.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  font-size: 13px;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.select-trigger:hover:not(.disabled) {
  border-color: var(--vscode-focusBorder);
}

.custom-select.open .select-trigger {
  border-color: var(--vscode-focusBorder);
}

.custom-select.disabled .select-trigger {
  opacity: 0.5;
  cursor: not-allowed;
}

.select-value {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-arrow {
  margin-left: 8px;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  transition: transform 0.2s;
}

.custom-select.open .select-arrow {
  transform: rotate(180deg);
}

.select-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-dropdown-border);
  border-radius: 4px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  max-height: 200px;
  overflow-y: auto;
  z-index: 100;
}

.select-option {
  padding: 8px 10px;
  font-size: 13px;
  color: var(--vscode-dropdown-foreground);
  cursor: pointer;
  transition: background 0.2s;
}

.select-option:hover {
  background: var(--vscode-list-hoverBackground);
}

.select-option.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

/* Transitions */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
