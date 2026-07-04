<template>
  <button
    class="custom-button"
    :class="[`variant-${variant}`, `size-${size}`, { disabled, loading, 'icon-only': iconOnly }]"
    :disabled="disabled || loading"
    @click="handleClick"
  >
    <svg v-if="loading" class="loading-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle class="spinner-track" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="spinner-path" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
    <span v-else-if="$slots.icon || icon" class="button-icon" aria-hidden="true">
      <slot name="icon">{{ icon }}</slot>
    </span>
    <span v-if="$slots.default" class="button-text"><slot /></span>
  </button>
</template>

<script setup lang="ts">
import { computed, useSlots } from 'vue'

interface Props {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'small' | 'medium' | 'large'
  icon?: string
  disabled?: boolean
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'medium',
  disabled: false,
  loading: false
})

const slots = useSlots()
const iconOnly = computed(() => !slots.default && (Boolean(slots.icon) || Boolean(props.icon) || props.loading))

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

function handleClick(event: MouseEvent) {
  emit('click', event)
}
</script>

<style scoped>
.custom-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    box-shadow 150ms ease,
    color 150ms ease,
    filter 150ms ease,
    transform 120ms ease;
  white-space: nowrap;
  user-select: none;
}

.custom-button:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus-ring);
}

.custom-button:active:not(.disabled):not(.loading) {
  transform: translateY(1px);
}

.variant-primary {
  background: var(--gradient-btn-primary);
  color: var(--color-btn-primary-fg);
  box-shadow: var(--shadow-button-primary);
}

.variant-primary:hover:not(.disabled):not(.loading) {
  background: var(--gradient-btn-primary-hover);
  filter: brightness(1.05);
}

.variant-secondary {
  background: var(--color-surface);
  color: var(--color-text-primary);
  border-color: var(--color-border);
}

.variant-secondary:hover:not(.disabled):not(.loading) {
  background: var(--color-surface-hover);
}

.variant-danger {
  background: var(--color-error);
  color: var(--color-on-primary);
}

.variant-danger:hover:not(.disabled):not(.loading) {
  opacity: 0.9;
}

.variant-ghost {
  background: transparent;
  color: var(--color-text-secondary);
}

.variant-ghost:hover:not(.disabled):not(.loading) {
  background: var(--color-surface-hover);
  color: var(--color-text-primary);
}

.size-small {
  min-height: 28px;
  padding: 4px 10px;
  font-size: 12px;
}

.size-medium {
  min-height: 34px;
  padding: 7px 14px;
  font-size: 13px;
}

.size-large {
  min-height: 40px;
  padding: 9px 18px;
  font-size: 14px;
}

.icon-only.size-small {
  width: 28px;
  padding: 0;
}

.icon-only.size-medium {
  width: 34px;
  padding: 0;
}

.icon-only.size-large {
  width: 40px;
  padding: 0;
}

.disabled,
.loading {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  animation: spin 1s linear infinite;
}

.spinner-track {
  opacity: 0.25;
}

.spinner-path {
  opacity: 0.75;
}

.button-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
}

.button-icon :deep(svg) {
  width: 16px;
  height: 16px;
  stroke-width: 1.9;
}

.button-text {
  line-height: 1;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
