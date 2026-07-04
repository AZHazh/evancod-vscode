<template>
  <div class="custom-input" :class="{ disabled, error: Boolean(error) }">
    <label v-if="label" class="input-label" :for="inputId">
      {{ label }}
      <span v-if="required" class="required-mark">*</span>
    </label>

    <div class="input-wrapper">
      <span v-if="$slots.icon || icon" class="input-icon" aria-hidden="true">
        <slot name="icon">{{ icon }}</slot>
      </span>

      <input
        v-if="type !== 'textarea'"
        :id="inputId"
        class="input-field"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        @input="handleInput"
        @blur="handleBlur"
        @focus="handleFocus"
      />

      <textarea
        v-else
        :id="inputId"
        class="input-field textarea-field"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        :rows="rows"
        @input="handleInput"
        @blur="handleBlur"
        @focus="handleFocus"
      />
    </div>

    <span v-if="error" class="error-message">{{ error }}</span>
    <span v-else-if="hint" class="hint-message">{{ hint }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'

interface Props {
  modelValue: string | number
  type?: 'text' | 'password' | 'email' | 'number' | 'textarea'
  label?: string
  placeholder?: string
  icon?: string
  disabled?: boolean
  required?: boolean
  error?: string
  hint?: string
  rows?: number
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  disabled: false,
  required: false,
  rows: 3
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  blur: []
  focus: []
}>()

const generatedId = useId()
const inputId = computed(() => `input-${generatedId}`)

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement
  const value = props.type === 'number' ? Number(target.value) : target.value
  emit('update:modelValue', value)
}

function handleBlur() {
  emit('blur')
}

function handleFocus() {
  emit('focus')
}
</script>

<style scoped>
.custom-input {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-label {
  font-size: 13px;
  color: var(--color-text-primary);
  font-weight: 600;
}

.required-mark {
  color: var(--color-error);
  margin-left: 2px;
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.input-icon {
  position: absolute;
  left: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
  pointer-events: none;
  line-height: 0;
}

.input-icon :deep(svg) {
  width: 16px;
  height: 16px;
  stroke-width: 1.9;
}

.input-field {
  width: 100%;
  min-height: 38px;
  padding: 8px 12px;
  font-size: 13px;
  font-family: inherit;
  color: var(--color-input-fg);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    background 150ms ease;
}

.input-wrapper .input-icon + .input-field {
  padding-left: 36px;
}

.textarea-field {
  resize: vertical;
  min-height: 72px;
  line-height: 1.5;
}

.input-field:focus {
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}

.input-field::placeholder {
  color: var(--vscode-input-placeholderForeground, var(--color-text-tertiary));
}

.custom-input.disabled .input-field {
  opacity: 0.5;
  cursor: not-allowed;
}

.custom-input.error .input-field {
  border-color: var(--color-error);
  box-shadow: var(--shadow-error-ring);
}

.error-message,
.hint-message {
  font-size: 12px;
}

.error-message {
  color: var(--color-error);
}

.hint-message {
  color: var(--color-text-secondary);
}
</style>
