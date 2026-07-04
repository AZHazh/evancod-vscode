<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { SlashCommand } from '@/types'

const props = defineProps<{
  commands: SlashCommand[]
  selectedIndex: number
}>()

const emit = defineEmits<{
  select: [command: SlashCommand]
  hover: [index: number]
}>()

const menuRef = ref<HTMLElement>()
const rowRefs = ref<HTMLElement[]>([])
const visibleCommands = computed(() => props.commands.slice(0, 50))

watch(() => props.selectedIndex, async index => {
  await nextTick()
  rowRefs.value[index]?.scrollIntoView({ block: 'nearest' })
})

watch(visibleCommands, () => {
  rowRefs.value = []
  if (menuRef.value) menuRef.value.scrollTop = 0
})
</script>

<template>
  <div ref="menuRef" class="slash-command-menu">
    <button
      v-for="(command, index) in visibleCommands"
      :ref="el => { if (el) rowRefs[index] = el as HTMLElement }"
      :key="command.name"
      class="slash-row"
      :class="{ selected: index === selectedIndex }"
      @mouseenter="emit('hover', index)"
      @mousedown.prevent="emit('select', command)"
    >
      <strong>/{{ command.name }}</strong>
      <span>{{ command.description }}</span>
      <small v-if="command.argumentHint">{{ command.argumentHint }}</small>
    </button>
  </div>
</template>

<style scoped lang="scss">
.slash-command-menu {
  max-height: min(520px, 58vh);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.slash-row {
  width: 100%;
  display: grid;
  grid-template-columns: 150px 1fr auto;
  gap: 12px;
  align-items: center;
  border: none;
  border-radius: 10px;
  padding: 12px;
  background: transparent;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;

  &.selected,
  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  span,
  small {
    color: var(--color-text-secondary);
  }
}
</style>
