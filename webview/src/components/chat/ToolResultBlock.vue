<script setup lang="ts">
import { computed, ref } from 'vue'
import { summarizeError, extractErrorText } from '@/utils/errorSummary'

const props = defineProps<{
  content: unknown
  isError: boolean
}>()

// 预览上限：超过则截断，避免把整段日志/报错全量塞进 DOM 做布局
const MAX_CHARS = 4000

// 错误时优先展示提炼后的主旨；成功结果仍展示原始文本
const errorSummary = computed(() => (props.isError ? summarizeError(props.content) : undefined))

const fullText = computed(() =>
  props.isError
    ? extractErrorText(props.content)
    : typeof props.content === 'string'
      ? props.content
      : JSON.stringify(props.content, null, 2)
)

// 有主旨时，原始日志默认折叠（用户排查才展开）；无主旨时直接展示（截断）
const expanded = ref(false)
const hasSummary = computed(() => Boolean(errorSummary.value))
const showRaw = computed(() => !hasSummary.value || expanded.value)

const isTruncated = computed(() => fullText.value.length > MAX_CHARS)
const displayText = computed(() =>
  !isTruncated.value || expanded.value ? fullText.value : fullText.value.slice(0, MAX_CHARS)
)
</script>

<template>
  <div class="tool-result" :class="{ 'tool-result--error': isError }">
    <div class="tool-result__header">
      <span>{{ isError ? 'Tool error' : 'Tool result' }}</span>
      <button
        v-if="hasSummary"
        class="tool-result__toggle"
        type="button"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起详情' : '查看详情' }}
      </button>
      <button
        v-else-if="isTruncated"
        class="tool-result__toggle"
        type="button"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起' : `显示全部 (${fullText.length} 字符)` }}
      </button>
    </div>

    <!-- 错误主旨：一句话说清错因 -->
    <div v-if="errorSummary" class="tool-result__summary">{{ errorSummary }}</div>

    <!-- 原始日志：有主旨时默认折叠 -->
    <pre v-if="showRaw" class="tool-result__content">{{ displayText
      }}<span v-if="isTruncated && !expanded" class="tool-result__ellipsis">
… 已截断 {{ fullText.length - MAX_CHARS }} 字符</span></pre>
  </div>
</template>

<style scoped lang="scss">
.tool-result {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 50%, transparent);
  border-radius: var(--chat-radius-lg);
  background: var(--chat-color-surface-container-low);
}

.tool-result--error {
  border-color: color-mix(in srgb, var(--chat-color-error) 50%, transparent);
  background: color-mix(in srgb, var(--chat-color-error-container) 35%, var(--chat-color-surface-container-low));
}

.tool-result__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--chat-color-border) 45%, transparent);
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
  font-weight: 600;
}

.tool-result--error .tool-result__header {
  color: var(--chat-color-error);
}

.tool-result__toggle {
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 50%, transparent);
  border-radius: var(--chat-radius-full);
  background: transparent;
  color: var(--chat-color-text-tertiary);
  cursor: pointer;
  font-size: 10px;
  font-weight: 600;

  &:hover {
    color: var(--chat-color-text-primary);
    background: var(--chat-color-surface-container-low);
  }
}

.tool-result__summary {
  padding: 10px 12px;
  color: var(--chat-color-text-primary);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.tool-result__content {
  max-height: 320px;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  color: var(--chat-color-text-secondary);
  font-family: var(--chat-font-mono);
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  /* 离屏时跳过内容渲染，降低长列表的布局成本 */
  content-visibility: auto;
  contain-intrinsic-size: auto 320px;
}

/* 主旨与原始日志同时存在时，日志区加一条分隔线 */
.tool-result__summary + .tool-result__content {
  border-top: 1px solid color-mix(in srgb, var(--chat-color-border) 30%, transparent);
}

.tool-result__ellipsis {
  color: var(--chat-color-text-tertiary);
  font-style: italic;
}
</style>
