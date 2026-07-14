<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { SkillEntry } from '@/types'

const props = defineProps<{
  skills: SkillEntry[]
  selectedIndex: number
}>()

const emit = defineEmits<{
  select: [skill: SkillEntry]
  hover: [index: number]
}>()

const menuRef = ref<HTMLElement>()
const rowRefs = ref<HTMLElement[]>([])
const visibleSkills = computed(() => props.skills.slice(0, 50))

watch(() => props.selectedIndex, async index => {
  await nextTick()
  rowRefs.value[index]?.scrollIntoView({ block: 'nearest' })
})

watch(visibleSkills, () => {
  rowRefs.value = []
  if (menuRef.value) menuRef.value.scrollTop = 0
})
</script>

<template>
  <div ref="menuRef" class="skill-list-menu">
    <button
      v-for="(skill, index) in visibleSkills"
      :ref="el => { if (el) rowRefs[index] = el as HTMLElement }"
      :key="skill.name"
      class="skill-row"
      :class="{ selected: index === selectedIndex }"
      @mouseenter="emit('hover', index)"
      @mousedown.prevent="emit('select', skill)"
    >
      <div class="skill-row__head">
        <strong>{{ skill.name }}</strong>
        <small class="origin">{{ skill.source === 'workspace' ? '工作区' : '全局' }}</small>
      </div>
      <span>{{ skill.description || '无描述' }}</span>
    </button>
    <div v-if="!props.skills.length" class="empty">没有可用的技能</div>
  </div>
</template>

<style scoped lang="scss">
.skill-list-menu {
  max-height: min(520px, 58vh);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.skill-row {
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

  &__head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  span {
    color: var(--color-text-secondary);
    font-size: 12px;
  }

  .origin {
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    color: var(--color-text-secondary);
    font-size: 11px;
  }
}

.empty {
  padding: 16px;
  color: var(--color-text-secondary);
  font-size: 13px;
}
</style>
