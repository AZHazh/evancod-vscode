<template>
  <div class="custom-input">
    <Input
      v-model="inputValue"
      type="textarea"
      :placeholder="placeholder"
      :rows="rows"
      icon="✏️"
      @update:modelValue="handleInput"
    />

    <div class="input-hint" v-if="hint">
      {{ hint }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Input from '../common/Input.vue'

interface Props {
  modelValue: string
  placeholder?: string
  rows?: number
  hint?: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '请输入...',
  rows: 3,
  hint: '💡 您可以输入自定义的答案'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const inputValue = ref(props.modelValue)

watch(() => props.modelValue, (newValue) => {
  inputValue.value = newValue
})

function handleInput(value: string | number) {
  emit('update:modelValue', String(value))
}
</script>

<style scoped>
.custom-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-hint {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  padding: 6px 10px;
  background: var(--vscode-input-background);
  border-radius: 4px;
}
</style>
