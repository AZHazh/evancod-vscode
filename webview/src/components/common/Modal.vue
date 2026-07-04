<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="modal-overlay" @click="handleOverlayClick">
        <div class="modal-container glass-panel" :class="`size-${size}`" @click.stop>
          <div class="modal-header" v-if="title || $slots.header">
            <slot name="header">
              <h3 class="modal-title">{{ title }}</h3>
            </slot>
            <Button v-if="closable" variant="ghost" size="medium" aria-label="关闭" @click="handleClose">
              <template #icon><X /></template>
            </Button>
          </div>

          <div class="modal-body">
            <slot />
          </div>

          <div class="modal-footer" v-if="$slots.footer || showFooter">
            <slot name="footer">
              <Button variant="ghost" @click="handleClose">取消</Button>
              <Button variant="primary" @click="handleConfirm">确定</Button>
            </slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import Button from './Button.vue'

interface Props {
  modelValue: boolean
  title?: string
  size?: 'small' | 'medium' | 'large'
  closable?: boolean
  closeOnOverlay?: boolean
  showFooter?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'medium',
  closable: true,
  closeOnOverlay: true,
  showFooter: true
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
  confirm: []
}>()

function handleClose() {
  emit('update:modelValue', false)
  emit('close')
}

function handleConfirm() {
  emit('confirm')
}

function handleOverlayClick() {
  if (props.closeOnOverlay) {
    handleClose()
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.modal-container {
  display: flex;
  flex-direction: column;
  max-height: 85vh;
  width: 100%;
  border-radius: var(--radius-xl);
  overflow: hidden;
}

.modal-container.size-small {
  max-width: 400px;
}

.modal-container.size-medium {
  max-width: 600px;
}

.modal-container.size-large {
  max-width: 800px;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 0;
}

.modal-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  color: var(--color-text-primary);
}

.modal-body {
  flex: 1;
  padding: 18px 24px;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 24px 24px;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}

.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition:
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.18s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: translateY(8px) scale(0.98);
  opacity: 0;
}
</style>
