<template>
  <div class="custom-input">
    <Input
      v-model="inputValue"
      type="textarea"
      :placeholder="placeholder"
      :rows="rows"
      @update:modelValue="handleInput"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Input from '../common/Input.vue'

interface Props {
  modelValue: string
  placeholder?: string
  rows?: number
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '请输入...',
  rows: 3
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
</style>
