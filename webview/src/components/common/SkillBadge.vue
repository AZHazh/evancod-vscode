<script setup lang="ts">
import { Box, X } from 'lucide-vue-next'
import type { MessageSkill } from '@/types'

withDefaults(defineProps<{ skill: MessageSkill; removable?: boolean }>(), { removable: false })
const emit = defineEmits<{ remove: [] }>()
</script>

<template>
  <span class="skill-badge" :title="skill.description || skill.name">
    <Box class="skill-badge__icon" />
    <strong>{{ skill.name }}</strong>
    <button v-if="removable" type="button" class="skill-badge__remove" @click="emit('remove')">
      <X />
    </button>
  </span>
</template>

<style scoped lang="scss">
.skill-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 4px 9px;
  border: 1px solid color-mix(in srgb, #55b7ff 45%, var(--color-border));
  border-radius: 8px;
  background: color-mix(in srgb, #2386c8 18%, var(--color-surface));
  color: #55b7ff;
  font-size: 13px;
  vertical-align: middle;
}
.skill-badge__icon {
  width: 17px;
  height: 17px;
}
.skill-badge__remove {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: transparent;
  color: currentColor;
  cursor: pointer;
}
.skill-badge__remove svg {
  width: 14px;
  height: 14px;
}
</style>
