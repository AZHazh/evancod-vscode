<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { FileSearchEntry } from '@/types'

const props = defineProps<{
  entries: FileSearchEntry[]
  selectedIndex: number
}>()

const emit = defineEmits<{
  select: [entry: FileSearchEntry]
  hover: [index: number]
}>()

const menuRef = ref<HTMLElement>()
const rowRefs = ref<HTMLElement[]>([])
const visibleEntries = computed(() => props.entries.slice(0, 50))

watch(() => props.selectedIndex, async index => {
  await nextTick()
  rowRefs.value[index]?.scrollIntoView({ block: 'nearest' })
})

watch(visibleEntries, () => {
  rowRefs.value = []
  if (menuRef.value) menuRef.value.scrollTop = 0
})
</script>

<template>
  <div ref="menuRef" class="file-search-menu">
    <button
      v-for="(entry, index) in visibleEntries"
      :ref="el => { if (el) rowRefs[index] = el as HTMLElement }"
      :key="entry.path"
      class="file-row"
      :class="{ selected: index === selectedIndex }"
      @mouseenter="emit('hover', index)"
      @mousedown.prevent="emit('select', entry)"
    >
      <strong>{{ entry.type === 'directory' ? '目录' : '文件' }} {{ entry.name }}</strong>
      <span>{{ entry.relativePath }}</span>
    </button>
    <div v-if="!props.entries.length" class="empty">没有匹配文件</div>
  </div>
</template>

<style scoped lang="scss">
.file-search-menu {
  max-height: min(520px, 58vh);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.file-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: none;
  border-radius: 10px;
  padding: 10px 12px;
  background: transparent;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;

  &.selected,
  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  span {
    color: var(--color-text-secondary);
    font-size: 12px;
  }
}

.empty {
  padding: 16px;
  color: var(--color-text-secondary);
  font-size: 13px;
}
</style>
