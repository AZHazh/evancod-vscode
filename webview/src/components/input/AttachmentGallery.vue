<script setup lang="ts">
import { Paperclip, ScanText, X } from 'lucide-vue-next'
import type { ComposerAttachment, WorkspaceReference } from '@/types'
import { pastedTextTitle } from '@/utils/pastedText'

const props = defineProps<{
  attachments: ComposerAttachment[]
  references: WorkspaceReference[]
  pastedTexts?: { id: string; text: string }[]
}>()

const emit = defineEmits<{
  removeAttachment: [id: string]
  removeReference: [id: string]
  previewImage: [id: string]
  removePastedText: [id: string]
  expandPastedText: [id: string]
}>()
</script>

<template>
  <div
    v-if="props.attachments.length || props.references.length || props.pastedTexts?.length"
    class="attachment-gallery"
  >
    <div v-for="item in props.pastedTexts" :key="item.id" class="pasted-text-card">
      <button
        type="button"
        class="pasted-text-card__content"
        :title="`在文本框中显示：${pastedTextTitle(item.text)}`"
        @click="emit('expandPastedText', item.id)"
      >
        <span class="pasted-text-card__icon"><ScanText :size="22" :stroke-width="1.6" /></span>
        <span class="pasted-text-card__copy">
          <span class="pasted-text-card__title">{{ pastedTextTitle(item.text) }}</span>
          <span class="pasted-text-card__subtitle">粘贴的文本</span>
        </span>
      </button>
      <button
        type="button"
        class="pasted-text-card__remove"
        aria-label="移除粘贴的文本"
        @click="emit('removePastedText', item.id)"
      ><X :size="12" /></button>
    </div>
    <template v-for="attachment in props.attachments" :key="attachment.id">
      <span v-if="attachment.type === 'image'" class="attachment-chip">
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
    </template>
  </div>
</template>

<style scoped lang="scss">
.attachment-gallery {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 0;
}

.pasted-text-card {
  position: relative;
  width: min(310px, 100%);
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: var(--color-surface-hover);
  color: var(--color-text-primary);

  button {
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;

    &:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
  }
}

.pasted-text-card__content {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 28px 8px 8px;
  border-radius: inherit;
  background: transparent;
  text-align: left;

  &:hover { background: color-mix(in srgb, var(--color-text-primary) 4%, transparent); }
}

.pasted-text-card__icon {
  display: grid;
  flex: 0 0 44px;
  height: 44px;
  place-items: center;
  border-radius: 10px;
  background: var(--color-bg-primary);
  color: var(--color-text-secondary);
}

.pasted-text-card__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.pasted-text-card__title {
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pasted-text-card__subtitle {
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 16px;
}

.pasted-text-card .pasted-text-card__remove {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  width: 17px;
  height: 17px;
  padding: 0;
  place-items: center;
  border-radius: 50%;
  background: var(--color-text-secondary);
  color: var(--color-bg-primary);

  &:hover { background: var(--color-text-primary); }
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
  vertical-align: middle;

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
