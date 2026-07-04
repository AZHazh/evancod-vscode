<template>
  <div class="option-selector">
    <div
      v-for="option in options"
      :key="option.label"
      class="option-item"
      :class="{ selected: isSelected(option.label), 'has-preview': option.preview }"
      @click="handleSelect(option.label)"
    >
      <div class="option-main">
        <div class="option-check">
          <span v-if="allowMultiple" class="checkbox">
            {{ isSelected(option.label) ? '☑' : '☐' }}
          </span>
          <span v-else class="radio">
            {{ isSelected(option.label) ? '⦿' : '◯' }}
          </span>
        </div>

        <div class="option-content">
          <div class="option-label">{{ option.label }}</div>
          <div class="option-description">{{ option.description }}</div>
        </div>
      </div>

      <div v-if="option.preview && isSelected(option.label)" class="option-preview">
        <div class="preview-label">预览:</div>
        <pre class="preview-content">{{ option.preview }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { QuestionOption } from './QuestionCard.vue'

interface Props {
  options: QuestionOption[]
  allowMultiple?: boolean
  selected: string[]
}

const props = withDefaults(defineProps<Props>(), {
  allowMultiple: false
})

const emit = defineEmits<{
  'update:selected': [value: string[]]
}>()

const isSelected = computed(() => {
  return (label: string) => props.selected.includes(label)
})

function handleSelect(label: string) {
  let newSelected: string[]

  if (props.allowMultiple) {
    // 多选模式
    if (props.selected.includes(label)) {
      newSelected = props.selected.filter(l => l !== label)
    } else {
      newSelected = [...props.selected, label]
    }
  } else {
    // 单选模式
    newSelected = [label]
  }

  emit('update:selected', newSelected)
}
</script>

<style scoped>
.option-selector {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.option-item {
  padding: 16px;
  background: var(--vscode-input-background);
  border: 2px solid var(--vscode-panel-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.option-item:hover {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-list-hoverBackground);
}

.option-item.selected {
  border-color: var(--vscode-button-background);
  background: var(--vscode-list-activeSelectionBackground);
}

.option-main {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.option-check {
  flex-shrink: 0;
  font-size: 20px;
  line-height: 1;
  margin-top: 2px;
}

.checkbox,
.radio {
  color: var(--vscode-foreground);
}

.option-content {
  flex: 1;
}

.option-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
  margin-bottom: 4px;
}

.option-description {
  font-size: 13px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.5;
}

.option-preview {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--vscode-panel-border);
}

.preview-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 6px;
}

.preview-content {
  font-size: 12px;
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  padding: 8px;
  border-radius: 4px;
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}
</style>
