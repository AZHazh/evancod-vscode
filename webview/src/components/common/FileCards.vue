<script setup lang="ts">
import { File as FileIcon, X } from 'lucide-vue-next'

defineProps<{
  files: Array<{ id?: string; name: string; path?: string; relativePath?: string }>
  removable?: boolean
}>()

const emit = defineEmits<{ remove: [id: string] }>()
</script>

<template>
  <div v-if="files.length" class="file-cards">
    <div
      v-for="(file, index) in files"
      :key="file.id || file.path || `${file.name}-${index}`"
      class="file-card"
    >
      <FileIcon class="file-card__icon" />
      <span class="file-card__name" :title="file.relativePath || file.path || file.name">{{
        file.name
      }}</span>
      <button
        v-if="removable && file.id"
        type="button"
        class="file-card__remove"
        @click="emit('remove', file.id)"
      >
        <X />
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.file-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px 0;
}
.file-card {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-surface-hover) 88%, transparent);
  color: var(--color-text-primary);
  font-size: 13px;
}
.file-card__icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  color: #55b7ff;
}
.file-card__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-card__remove {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.file-card__remove svg {
  width: 14px;
  height: 14px;
}
</style>
