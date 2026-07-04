<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  oldText?: string
  newText?: string
  content?: string
  filePath?: string
}>()

type DiffLine = {
  id: string
  type: 'added' | 'removed' | 'context'
  text: string
}

function buildDiffLines(): DiffLine[] {
  if (typeof props.content === 'string') {
    return props.content.split('\n').map((text, index) => ({
      id: `content-${index}`,
      type: 'added' as const,
      text,
    }))
  }

  const oldLines = (props.oldText || '').split('\n')
  const newLines = (props.newText || '').split('\n')
  const lines: DiffLine[] = []
  const maxLength = Math.max(oldLines.length, newLines.length)

  for (let index = 0; index < maxLength; index += 1) {
    const oldLine = oldLines[index]
    const newLine = newLines[index]

    if (oldLine === newLine && typeof oldLine === 'string') {
      lines.push({ id: `context-${index}`, type: 'context', text: oldLine })
      continue
    }

    if (typeof oldLine === 'string') {
      lines.push({ id: `removed-${index}`, type: 'removed', text: oldLine })
    }

    if (typeof newLine === 'string') {
      lines.push({ id: `added-${index}`, type: 'added', text: newLine })
    }
  }

  return lines
}

const diffLines = computed(() => buildDiffLines())
const addedCount = computed(() => diffLines.value.filter(line => line.type === 'added').length)
const removedCount = computed(() => diffLines.value.filter(line => line.type === 'removed').length)
</script>

<template>
  <div class="diff-viewer">
    <div class="diff-viewer__header">
      <div class="diff-viewer__path" :title="filePath">{{ filePath || 'Changes' }}</div>
      <div class="diff-viewer__stats">
        <span class="diff-viewer__stat diff-viewer__stat--added">+{{ addedCount }}</span>
        <span class="diff-viewer__stat diff-viewer__stat--removed">-{{ removedCount }}</span>
      </div>
    </div>

    <div class="diff-viewer__body">
      <div
        v-for="(line, index) in diffLines"
        :key="line.id"
        class="diff-line"
        :class="`diff-line--${line.type}`"
      >
        <span class="diff-line__gutter">{{ index + 1 }}</span>
        <span class="diff-line__content">{{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }} {{ line.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.diff-viewer {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 50%, transparent);
  border-radius: var(--chat-radius-lg);
  background: var(--chat-color-surface-container-low);
}

.diff-viewer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 40%, transparent);
  background: var(--chat-color-surface-container);
}

.diff-viewer__path {
  min-width: 0;
  overflow: hidden;
  color: var(--chat-color-text-tertiary);
  font-family: var(--chat-font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-viewer__stats {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.diff-viewer__stat {
  padding: 2px 8px;
  border-radius: var(--chat-radius-full);
}

.diff-viewer__stat--added {
  background: var(--chat-color-diff-added-bg);
  color: var(--chat-color-diff-added-text);
}

.diff-viewer__stat--removed {
  background: var(--chat-color-diff-removed-bg);
  color: var(--chat-color-diff-removed-text);
}

.diff-viewer__body {
  max-height: 400px;
  overflow: auto;
  background: var(--chat-color-code-bg);
  color: var(--chat-color-code-fg);
  font-family: var(--chat-font-mono);
  font-size: 12px;
  line-height: 1.45;
}

.diff-line {
  display: grid;
  grid-template-columns: 40px 1fr;
  min-width: max-content;
}

.diff-line__gutter {
  padding: 1px 8px;
  background: var(--chat-color-surface-container-low);
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
  text-align: right;
  user-select: none;
}

.diff-line__content {
  padding: 1px 8px;
  white-space: pre;
}

.diff-line--added .diff-line__gutter {
  background: var(--chat-color-diff-added-gutter);
  color: var(--chat-color-diff-added-text);
}

.diff-line--added .diff-line__content {
  background: var(--chat-color-diff-added-bg);
}

.diff-line--removed .diff-line__gutter {
  background: var(--chat-color-diff-removed-gutter);
  color: var(--chat-color-diff-removed-text);
}

.diff-line--removed .diff-line__content {
  background: var(--chat-color-diff-removed-bg);
}

.diff-line--context .diff-line__content {
  color: var(--chat-color-text-secondary);
}
</style>
