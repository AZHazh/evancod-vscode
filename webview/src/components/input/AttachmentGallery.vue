<script setup lang="ts">
import { Paperclip, X } from 'lucide-vue-next'
import type { ComposerAttachment, WorkspaceReference } from '@/types'

const props = defineProps<{
  attachments: ComposerAttachment[]
  references: WorkspaceReference[]
}>()

const emit = defineEmits<{
  removeAttachment: [id: string]
  removeReference: [id: string]
  previewImage: [id: string]
}>()
</script>

<template>
  <div v-if="props.attachments.length || props.references.length" class="attachment-gallery">
    <span v-for="reference in props.references" :key="reference.id" class="attachment-chip reference-chip">
      @ {{ reference.relativePath }}
      <button @click="emit('removeReference', reference.id)"><X /></button>
    </span>
    <span v-for="attachment in props.attachments" :key="attachment.id" class="attachment-chip">
      <button
        v-if="attachment.type === 'image' && attachment.previewUrl"
        type="button"
        class="attachment-thumb"
        title="点击放大"
        @click="emit('previewImage', attachment.id)"
      >
        <img :src="attachment.previewUrl" alt="" />
      </button>
      <Paperclip v-else />
      {{ attachment.name }}
      <button @click="emit('removeAttachment', attachment.id)"><X /></button>
    </span>
  </div>
</template>

<style scoped lang="scss">
.attachment-gallery {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px 0;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--color-surface-hover);
  color: var(--color-text-primary);
  font-size: 12px;

  img {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    object-fit: cover;
  }

  svg {
    width: 14px;
    height: 14px;
  }

  button {
    display: inline-flex;
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 0;
  }

  .attachment-thumb {
    border-radius: 4px;
    line-height: 0;

    &:hover img {
      opacity: 0.85;
    }
  }
}

.reference-chip {
  background: color-mix(in srgb, var(--vscode-focusBorder) 18%, var(--color-surface-hover));
}
</style>
